#!/usr/bin/env node
/**
 * Automate upstream -> fork merge, metadata conflict resolution, and release
 * version calculation for Nexus.
 *
 * Usage:
 *   node scripts/sync-upstream-merge.mjs [--upstream-ref upstream/main] [--origin-remote origin] [--force-build]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_CONFLICT = 10;

const EXACT_ALLOWLIST = new Set([
  'package.json',
  'package-lock.json',
  'manifest.json',
  'versions.json',
  'schemas/manifest.json',
  'cli-first-tool-schemas.json',
  'tool-schemas.json',
  'src/utils/cliAssets.ts',
  'src/utils/connectorContent.ts',
  'docs/changelog.md',
]);

const VERSIONED_SCHEMA_RE = /^schemas\/\d+\.\d+\.\d+\/(?:cli|mcp)-tools\.json$/;

function printUsage() {
  console.error(
    'Usage: node scripts/sync-upstream-merge.mjs [--upstream-ref <ref>] [--origin-remote <name>] [--force-build]',
  );
}

function parseArgs(argv) {
  const options = {
    upstreamRef: 'upstream/main',
    originRemote: 'origin',
    forceBuild: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--force-build') {
      options.forceBuild = true;
      continue;
    }
    if (arg === '--upstream-ref') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value after --upstream-ref');
      }
      options.upstreamRef = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--upstream-ref=')) {
      const value = arg.slice('--upstream-ref='.length);
      if (!value) {
        throw new Error('Missing value in --upstream-ref=');
      }
      options.upstreamRef = value;
      continue;
    }
    if (arg === '--origin-remote') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value after --origin-remote');
      }
      options.originRemote = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--origin-remote=')) {
      const value = arg.slice('--origin-remote='.length);
      if (!value) {
        throw new Error('Missing value in --origin-remote=');
      }
      options.originRemote = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseSemver(version, label = 'version') {
  if (typeof version !== 'string') {
    throw new Error(`Invalid ${label}: expected string, got ${typeof version}`);
  }
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    throw new Error(`Invalid bare semver for ${label}: "${version}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseSemverSafe(version) {
  if (typeof version !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  const pa = parseSemver(a, 'lhs');
  const pb = parseSemver(b, 'rhs');
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function semverMax(a, b) {
  return compareSemver(a, b) >= 0 ? a : b;
}

function semverLte(a, b) {
  return compareSemver(a, b) <= 0;
}

function incrementPatch(version) {
  const [major, minor, patch] = parseSemver(version);
  return `${major}.${minor}.${patch + 1}`;
}

function runGit(args, { cwd, allowFailure = false } = {}) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    throw new Error(`Failed to execute git ${args.join(' ')}: ${res.error.message}`);
  }
  const status = res.status ?? 1;
  if (!allowFailure && status !== 0) {
    const details = (res.stderr || res.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed (exit ${status})${details ? `: ${details}` : ''}`);
  }
  return {
    status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function hasMergeHead(repoRoot) {
  return runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
    cwd: repoRoot,
    allowFailure: true,
  }).status === 0;
}

function tryAbortMerge(repoRoot) {
  if (hasMergeHead(repoRoot)) {
    runGit(['merge', '--abort'], { cwd: repoRoot, allowFailure: true });
  }
}

function getConflictedFiles(repoRoot) {
  const res = runGit(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: repoRoot });
  return res.stdout
    .split('\0')
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter(Boolean);
}

function isAllowlistedPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  return EXACT_ALLOWLIST.has(normalized) || VERSIONED_SCHEMA_RE.test(normalized);
}

function readStage(repoRoot, stage, filePath) {
  const res = runGit(['show', `:${stage}:${filePath}`], {
    cwd: repoRoot,
    allowFailure: true,
  });
  return res.status === 0 ? res.stdout : null;
}

function readJsonAtRef(repoRoot, revPath) {
  const raw = runGit(['show', revPath], { cwd: repoRoot }).stdout;
  return JSON.parse(raw);
}

function getRemoteTags(repoRoot, originRemote) {
  const res = runGit(['ls-remote', '--tags', originRemote], { cwd: repoRoot });
  const tags = new Set();
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tabIdx = line.indexOf('\t');
    if (tabIdx < 0) continue;
    const ref = line.slice(tabIdx + 1).trim();
    if (ref.startsWith('refs/tags/')) {
      tags.add(ref.slice('refs/tags/'.length).replace(/\^\{\}$/, ''));
    }
  }
  return tags;
}

/**
 * Replace string values at specific JSON object key paths with `"0.0.0"` while
 * preserving exact whitespace, key ordering, and indentation of the input text.
 */
function normalizeJsonVersionFields(rawText, targetPaths) {
  JSON.parse(rawText);

  const replacements = [];
  const stack = [];
  const len = rawText.length;
  let i = 0;

  const matchesTargetPath = (key) => {
    for (const targetPath of targetPaths) {
      if (stack.length !== targetPath.length) continue;
      let ok = true;
      for (let idx = 0; idx < stack.length - 1; idx += 1) {
        const frame = stack[idx];
        if (frame.kind !== 'object' || frame.key !== targetPath[idx]) {
          ok = false;
          break;
        }
      }
      if (ok && key === targetPath[targetPath.length - 1]) {
        return true;
      }
    }
    return false;
  };

  while (i < len) {
    const ch = rawText[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }

    const top = stack[stack.length - 1];

    if (ch === '{') {
      stack.push({ kind: 'object', state: 'key_or_end', key: null });
      i += 1;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent && parent.kind === 'object' && parent.state === 'value') {
        parent.state = 'comma_or_end';
      }
      i += 1;
      continue;
    }
    if (ch === '[') {
      stack.push({ kind: 'array' });
      i += 1;
      continue;
    }
    if (ch === ']') {
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent && parent.kind === 'object' && parent.state === 'value') {
        parent.state = 'comma_or_end';
      }
      i += 1;
      continue;
    }
    if (ch === ':') {
      if (top && top.kind === 'object' && top.state === 'colon') {
        top.state = 'value';
      }
      i += 1;
      continue;
    }
    if (ch === ',') {
      if (top && top.kind === 'object') {
        top.state = 'key_or_end';
        top.key = null;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      const start = i;
      i += 1;
      while (i < len) {
        if (rawText[i] === '\\') {
          i += 2;
          continue;
        }
        if (rawText[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      const end = i;
      const literal = rawText.slice(start, end);
      if (top && top.kind === 'object') {
        if (top.state === 'key_or_end') {
          top.key = JSON.parse(literal);
          top.state = 'colon';
        } else if (top.state === 'value') {
          if (matchesTargetPath(top.key)) {
            replacements.push({ start, end });
          }
          top.state = 'comma_or_end';
        }
      }
      continue;
    }

    // Primitive literal (number, true, false, null)
    while (
      i < len &&
      rawText[i] !== ',' &&
      rawText[i] !== '}' &&
      rawText[i] !== ']' &&
      rawText[i] !== ' ' &&
      rawText[i] !== '\t' &&
      rawText[i] !== '\r' &&
      rawText[i] !== '\n'
    ) {
      i += 1;
    }
    if (top && top.kind === 'object' && top.state === 'value') {
      top.state = 'comma_or_end';
    }
  }

  let output = rawText;
  for (let idx = replacements.length - 1; idx >= 0; idx -= 1) {
    const { start, end } = replacements[idx];
    output = `${output.slice(0, start)}"0.0.0"${output.slice(end)}`;
  }
  JSON.parse(output);
  return output;
}

function runMergeFile(repoRoot, tmpDir, tag, baseText, oursText, theirsText) {
  const prefix = tag.replace(/[^a-zA-Z0-9._-]/g, '_');
  const basePath = path.join(tmpDir, `${prefix}.base`);
  const oursPath = path.join(tmpDir, `${prefix}.ours`);
  const theirsPath = path.join(tmpDir, `${prefix}.theirs`);
  fs.writeFileSync(basePath, baseText, 'utf8');
  fs.writeFileSync(oursPath, oursText, 'utf8');
  fs.writeFileSync(theirsPath, theirsText, 'utf8');

  const res = spawnSync('git', ['merge-file', '-p', oursPath, basePath, theirsPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    throw new Error(`Failed to execute git merge-file: ${res.error.message}`);
  }
  const status = res.status ?? 1;
  if (status < 0) {
    throw new Error(`git merge-file error for ${tag}: ${res.stderr}`);
  }
  return {
    clean: status === 0,
    content: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function isValidJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function hasConflictMarkers(text) {
  return /^(?:<{7}(?: |$)|={7}$|>{7}(?: |$))/m.test(text);
}

function checkoutStageAndAdd(repoRoot, filePath, preference) {
  const hasOurs = readStage(repoRoot, 2, filePath) !== null;
  const hasTheirs = readStage(repoRoot, 3, filePath) !== null;

  if (preference === 'ours') {
    if (hasOurs) {
      runGit(['checkout', '--ours', '--', filePath], { cwd: repoRoot });
      runGit(['add', '--', filePath], { cwd: repoRoot });
      return;
    }
    if (hasTheirs) {
      runGit(['checkout', '--theirs', '--', filePath], { cwd: repoRoot });
      runGit(['add', '--', filePath], { cwd: repoRoot });
      return;
    }
  } else {
    if (hasTheirs) {
      runGit(['checkout', '--theirs', '--', filePath], { cwd: repoRoot });
      runGit(['add', '--', filePath], { cwd: repoRoot });
      return;
    }
    if (hasOurs) {
      runGit(['checkout', '--ours', '--', filePath], { cwd: repoRoot });
      runGit(['add', '--', filePath], { cwd: repoRoot });
      return;
    }
  }

  runGit(['rm', '-f', '--', filePath], { cwd: repoRoot });
}

function parseChangelog(rawText) {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  let title = '# Nexus Changelog';
  let startIdx = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (/^#\s+/.test(trimmed)) {
      title = trimmed;
      startIdx = i + 1;
    }
    break;
  }

  const entries = [];
  let currentMonth = null;
  let entryMonth = null;
  let buf = [];
  let bufStartLine = -1;

  const flush = (endLineExclusive) => {
    let firstNonBlank = 0;
    while (firstNonBlank < buf.length && buf[firstNonBlank].trim() === '') {
      firstNonBlank += 1;
    }
    let lastNonBlank = buf.length - 1;
    while (lastNonBlank >= firstNonBlank && buf[lastNonBlank].trim() === '') {
      lastNonBlank -= 1;
    }
    if (firstNonBlank <= lastNonBlank) {
      const sliced = buf.slice(firstNonBlank, lastNonBlank + 1);
      const raw = sliced.join('\n');
      entries.push({
        month: entryMonth,
        raw,
        norm: raw.replace(/[ \t]+$/gm, '').trim(),
        startLine: bufStartLine + firstNonBlank,
        endLine: bufStartLine + lastNonBlank,
        nextLine: endLineExclusive,
      });
    }
    buf = [];
    bufStartLine = -1;
  };

  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '---') {
      flush(i);
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      flush(i);
      currentMonth = trimmed;
      continue;
    }
    if (/^\*\*v\d+\.\d+\.\d+\*\*/.test(trimmed) && buf.length > 0) {
      flush(i);
    }
    if (buf.length === 0) {
      if (trimmed === '') continue;
      entryMonth = currentMonth;
      bufStartLine = i;
    }
    buf.push(line);
  }
  flush(lines.length);

  return { title, lines, startIdx, entries };
}

function mergeChangelogSections(baseRaw, oursRaw, theirsRaw) {
  const baseParsed = parseChangelog(baseRaw || '');
  const oursParsed = parseChangelog(oursRaw || '');
  const theirsParsed = parseChangelog(theirsRaw || '');

  const baseNorms = new Set(baseParsed.entries.map((e) => e.norm));
  const theirsNorms = new Set(theirsParsed.entries.map((e) => e.norm));
  const customEntries = oursParsed.entries.filter(
    (e) => !baseNorms.has(e.norm) && !theirsNorms.has(e.norm),
  );

  let workingLines = [...theirsParsed.lines];
  if (theirsParsed.startIdx === 0) {
    workingLines = ['# Nexus Changelog', '', ...workingLines];
  } else {
    for (let i = 0; i < theirsParsed.startIdx; i += 1) {
      if (/^#\s+/.test(workingLines[i].trim())) {
        workingLines[i] = '# Nexus Changelog';
        break;
      }
    }
  }

  if (customEntries.length === 0) {
    return `${workingLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  }

  // Group custom entries by month preserving order of first appearance.
  const groups = [];
  const groupsByMonth = new Map();
  for (const entry of customEntries) {
    const key = entry.month ?? '';
    let group = groupsByMonth.get(key);
    if (!group) {
      group = { month: entry.month, items: [] };
      groupsByMonth.set(key, group);
      groups.push(group);
    }
    group.items.push(entry);
  }

  const normalizedTheirs = parseChangelog(workingLines.join('\n'));
  const theirsLines = normalizedTheirs.lines;
  const edits = [];

  for (const group of groups) {
    const combinedBody = group.items.map((item) => item.raw).join('\n\n---\n\n');
    const monthEntries = group.month
      ? normalizedTheirs.entries.filter((e) => e.month === group.month)
      : [];

    if (monthEntries.length > 0) {
      const firstShared = monthEntries.find((e) => baseNorms.has(e.norm));
      if (firstShared) {
        edits.push({
          line: firstShared.startLine,
          order: edits.length,
          insertLines: [...combinedBody.split('\n'), '', '---', ''],
        });
      } else {
        const lastInMonth = monthEntries[monthEntries.length - 1];
        edits.push({
          line: lastInMonth.endLine + 1,
          order: edits.length,
          insertLines: ['', '---', '', ...combinedBody.split('\n'), ''],
        });
      }
    } else {
      // Insert right after `# Nexus Changelog` (with its month heading if present).
      const headerBlock = group.month
        ? [group.month, '', ...combinedBody.split('\n')]
        : combinedBody.split('\n');
      const hasBodyAfterHeader = normalizedTheirs.entries.length > 0;
      edits.push({
        line: normalizedTheirs.startIdx,
        order: edits.length,
        insertLines: hasBodyAfterHeader ? ['', ...headerBlock, '', '---', ''] : ['', ...headerBlock],
      });
    }
  }

  // Apply edits from bottom-most line to top-most (higher original order first on ties).
  edits.sort((a, b) => b.line - a.line || b.order - a.order);
  for (const edit of edits) {
    theirsLines.splice(edit.line, 0, ...edit.insertLines);
  }

  // Collapse excessive blank lines and clean consecutive separators.
  const collapsed = theirsLines
    .join('\n')
    .replace(/(?:^|\n)---(?:\n|\s)*---(?=\n|$)/g, '\n---')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  if (hasConflictMarkers(collapsed)) {
    throw new Error('Merged docs/changelog.md unexpectedly contains conflict markers');
  }

  return `${collapsed}\n`;
}

function resolveAllowlistedConflicts(repoRoot, conflictedFiles) {
  let lockfileRegen = false;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sync-'));

  try {
    for (const filePath of conflictedFiles) {
      const fullPath = path.join(repoRoot, filePath);

      if (filePath === 'package.json') {
        const baseRaw = readStage(repoRoot, 1, filePath);
        const oursRaw = readStage(repoRoot, 2, filePath);
        const theirsRaw = readStage(repoRoot, 3, filePath);
        if (baseRaw === null || oursRaw === null || theirsRaw === null) {
          tryAbortMerge(repoRoot);
          console.error('Conflict in package.json is missing a merge stage; merge aborted.');
          process.exit(EXIT_CONFLICT);
        }
        const merged = runMergeFile(
          repoRoot,
          tmpDir,
          'package.json',
          normalizeJsonVersionFields(baseRaw, [['version']]),
          normalizeJsonVersionFields(oursRaw, [['version']]),
          normalizeJsonVersionFields(theirsRaw, [['version']]),
        );
        if (!merged.clean || !isValidJson(merged.content)) {
          tryAbortMerge(repoRoot);
          console.error('Unresolvable dependency/script conflict in package.json; merge aborted.');
          if (merged.content) console.error(merged.content);
          process.exit(EXIT_CONFLICT);
        }
        fs.writeFileSync(fullPath, merged.content, 'utf8');
        runGit(['add', '--', filePath], { cwd: repoRoot });
        continue;
      }

      if (filePath === 'package-lock.json') {
        const baseRaw = readStage(repoRoot, 1, filePath);
        const oursRaw = readStage(repoRoot, 2, filePath);
        const theirsRaw = readStage(repoRoot, 3, filePath);

        let resolvedCleanly = false;
        if (baseRaw !== null && oursRaw !== null && theirsRaw !== null) {
          const targetPaths = [['version'], ['packages', '', 'version']];
          const merged = runMergeFile(
            repoRoot,
            tmpDir,
            'package-lock.json',
            normalizeJsonVersionFields(baseRaw, targetPaths),
            normalizeJsonVersionFields(oursRaw, targetPaths),
            normalizeJsonVersionFields(theirsRaw, targetPaths),
          );
          if (merged.clean && isValidJson(merged.content)) {
            fs.writeFileSync(fullPath, merged.content, 'utf8');
            runGit(['add', '--', filePath], { cwd: repoRoot });
            resolvedCleanly = true;
          }
        }

        if (!resolvedCleanly) {
          checkoutStageAndAdd(repoRoot, filePath, 'theirs');
          lockfileRegen = true;
        }
        continue;
      }

      if (filePath === 'manifest.json') {
        const oursRaw = readStage(repoRoot, 2, filePath);
        const theirsRaw = readStage(repoRoot, 3, filePath);
        if (oursRaw === null || theirsRaw === null) {
          checkoutStageAndAdd(repoRoot, filePath, 'theirs');
          continue;
        }
        const ours = JSON.parse(oursRaw);
        const theirs = JSON.parse(theirsRaw);
        const minAppVersion =
          ours.minAppVersion && theirs.minAppVersion
            ? semverMax(ours.minAppVersion, theirs.minAppVersion)
            : (ours.minAppVersion ?? theirs.minAppVersion);
        const merged = { ...theirs, minAppVersion };
        fs.writeFileSync(fullPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
        runGit(['add', '--', filePath], { cwd: repoRoot });
        continue;
      }

      if (filePath === 'versions.json') {
        const oursRaw = readStage(repoRoot, 2, filePath);
        const theirsRaw = readStage(repoRoot, 3, filePath);
        if (oursRaw === null || theirsRaw === null) {
          checkoutStageAndAdd(repoRoot, filePath, 'ours');
          continue;
        }
        const ours = JSON.parse(oursRaw);
        const theirs = JSON.parse(theirsRaw);
        const combined = { ...theirs, ...ours };
        const sortedEntries = Object.entries(combined).sort(([left], [right]) => {
          const pl = parseSemverSafe(left);
          const pr = parseSemverSafe(right);
          if (pl && pr) {
            for (let i = 0; i < 3; i += 1) {
              if (pl[i] !== pr[i]) return pl[i] < pr[i] ? -1 : 1;
            }
            return 0;
          }
          return left.localeCompare(right, undefined, { numeric: true });
        });
        const sorted = Object.fromEntries(sortedEntries);
        fs.writeFileSync(fullPath, `${JSON.stringify(sorted, null, '\t')}\n`, 'utf8');
        runGit(['add', '--', filePath], { cwd: repoRoot });
        continue;
      }

      if (filePath === 'schemas/manifest.json') {
        const oursRaw = readStage(repoRoot, 2, filePath);
        const theirsRaw = readStage(repoRoot, 3, filePath);
        if (oursRaw === null || theirsRaw === null) {
          checkoutStageAndAdd(repoRoot, filePath, 'ours');
          continue;
        }
        const ours = JSON.parse(oursRaw);
        const theirs = JSON.parse(theirsRaw);
        const combinedVersions = {
          ...(theirs.versions || {}),
          ...(ours.versions || {}),
        };
        const sortedVersions = Object.fromEntries(
          Object.entries(combinedVersions).sort(([left], [right]) =>
            left.localeCompare(right, undefined, { numeric: true }),
          ),
        );
        const merged = {
          schemaVersion: 1,
          latest: ours.latest,
          versions: sortedVersions,
        };
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
        runGit(['add', '--', filePath], { cwd: repoRoot });
        continue;
      }

      if (
        VERSIONED_SCHEMA_RE.test(filePath) ||
        filePath === 'cli-first-tool-schemas.json' ||
        filePath === 'tool-schemas.json'
      ) {
        checkoutStageAndAdd(repoRoot, filePath, 'ours');
        continue;
      }

      if (filePath === 'src/utils/cliAssets.ts' || filePath === 'src/utils/connectorContent.ts') {
        checkoutStageAndAdd(repoRoot, filePath, 'theirs');
        continue;
      }

      if (filePath === 'docs/changelog.md') {
        const baseRaw = readStage(repoRoot, 1, filePath);
        const oursRaw = readStage(repoRoot, 2, filePath);
        const theirsRaw = readStage(repoRoot, 3, filePath);

        if (baseRaw !== null && oursRaw !== null && theirsRaw !== null) {
          const merged = runMergeFile(
            repoRoot,
            tmpDir,
            'docs_changelog.md',
            baseRaw,
            oursRaw,
            theirsRaw,
          );
          if (merged.clean && !hasConflictMarkers(merged.content)) {
            fs.writeFileSync(fullPath, merged.content, 'utf8');
            runGit(['add', '--', filePath], { cwd: repoRoot });
            continue;
          }
        }

        if (oursRaw !== null && theirsRaw !== null) {
          const combined = mergeChangelogSections(baseRaw ?? '', oursRaw, theirsRaw);
          fs.writeFileSync(fullPath, combined, 'utf8');
          runGit(['add', '--', filePath], { cwd: repoRoot });
        } else {
          checkoutStageAndAdd(repoRoot, filePath, 'theirs');
        }
        continue;
      }

      throw new Error(`Unhandled allowlisted conflict path: ${filePath}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return lockfileRegen;
}

function emitOutputs(outputs) {
  const githubOutputPath = process.env.GITHUB_OUTPUT;
  if (githubOutputPath) {
    const lines = [];
    for (const [key, value] of Object.entries(outputs)) {
      if (value !== undefined) {
        lines.push(`${key}=${String(value)}`);
      }
    }
    fs.appendFileSync(githubOutputPath, `${lines.join('\n')}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(outputs)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(EXIT_OK);
  }

  const repoRoot = runGit(['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
  }).stdout.trim();

  let mergeStartedByUs = false;

  try {
    if (hasMergeHead(repoRoot)) {
      throw new Error('Cannot start sync: a merge is already in progress (MERGE_HEAD exists)');
    }

    const upstreamSha = runGit(['rev-parse', '--verify', `${options.upstreamRef}^{commit}`], {
      cwd: repoRoot,
    }).stdout.trim();

    const oursPkg = readJsonAtRef(repoRoot, 'HEAD:package.json');
    const theirsPkg = readJsonAtRef(repoRoot, `${options.upstreamRef}:package.json`);
    const vOurs = String(oursPkg.version);
    const vTheirs = String(theirsPkg.version);
    parseSemver(vOurs, 'HEAD:package.json version');
    parseSemver(vTheirs, `${options.upstreamRef}:package.json version`);

    const ancestorCheck = runGit(
      ['merge-base', '--is-ancestor', options.upstreamRef, 'HEAD'],
      { cwd: repoRoot, allowFailure: true },
    );
    if (ancestorCheck.status !== 0 && ancestorCheck.status !== 1) {
      throw new Error(
        `git merge-base --is-ancestor failed (exit ${ancestorCheck.status}): ${ancestorCheck.stderr.trim()}`,
      );
    }
    const isAncestor = ancestorCheck.status === 0;

    if (isAncestor && !options.forceBuild) {
      emitOutputs({
        synced: false,
        lockfile_regen: false,
        upstream_sha: upstreamSha,
      });
      return EXIT_OK;
    }

    const existingTags = getRemoteTags(repoRoot, options.originRemote);
    let targetVersion = semverMax(vOurs, vTheirs);
    while (semverLte(targetVersion, vOurs) || existingTags.has(targetVersion)) {
      targetVersion = incrementPatch(targetVersion);
    }

    let lockfileRegen = false;

    if (!isAncestor) {
      const mergeRes = runGit(['merge', '--no-commit', '--no-ff', options.upstreamRef], {
        cwd: repoRoot,
        allowFailure: true,
      });
      if (mergeRes.status === 0 || hasMergeHead(repoRoot)) {
        mergeStartedByUs = true;
      }

      if (mergeRes.status !== 0) {
        if (!hasMergeHead(repoRoot)) {
          const detail = (mergeRes.stderr || mergeRes.stdout || '').trim();
          throw new Error(`git merge failed before creating MERGE_HEAD: ${detail}`);
        }

        const conflictedFiles = getConflictedFiles(repoRoot);
        if (conflictedFiles.length === 0) {
          const detail = (mergeRes.stderr || mergeRes.stdout || '').trim();
          throw new Error(`git merge exited ${mergeRes.status} with no conflicted files: ${detail}`);
        }

        const disallowed = conflictedFiles.filter((filePath) => !isAllowlistedPath(filePath));
        if (disallowed.length > 0) {
          tryAbortMerge(repoRoot);
          console.error('Non-metadata merge conflicts detected; merge aborted.');
          console.error('Conflicted files:');
          for (const filePath of disallowed) {
            console.error(`  - ${filePath}`);
          }
          const allowlisted = conflictedFiles.filter((filePath) => isAllowlistedPath(filePath));
          if (allowlisted.length > 0) {
            console.error('Allowlisted metadata conflicts also present:');
            for (const filePath of allowlisted) {
              console.error(`  - ${filePath}`);
            }
          }
          return EXIT_CONFLICT;
        }

        lockfileRegen = resolveAllowlistedConflicts(repoRoot, conflictedFiles);

        const remainingConflicts = getConflictedFiles(repoRoot);
        if (remainingConflicts.length > 0) {
          throw new Error(
            `Remaining unresolved conflicts after metadata resolution: ${remainingConflicts.join(', ')}`,
          );
        }
      }
    }

    emitOutputs({
      synced: true,
      target_version: targetVersion,
      lockfile_regen: lockfileRegen,
      upstream_sha: upstreamSha,
    });
    return EXIT_OK;
  } catch (err) {
    if (mergeStartedByUs) {
      tryAbortMerge(repoRoot);
    }
    const message = err instanceof Error ? err.stack || err.message : String(err);
    console.error(message);
    return EXIT_ERROR;
  }
}

process.exit(main());
