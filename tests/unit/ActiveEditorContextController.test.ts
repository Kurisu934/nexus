import { App, Component, Editor, MarkdownView, Menu, TFile, WorkspaceLeaf } from 'obsidian';
import {
  ActiveEditorContextController,
  type ActiveEditorContextState,
} from '../../src/ui/chat/controllers/ActiveEditorContextController';

interface MockEventEmitter {
  on: (name: string, cb: (...args: unknown[]) => void) => { id: number };
  offref: jest.Mock;
  emit: (name: string, ...args: unknown[]) => void;
}

function createEventEmitter(): MockEventEmitter {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let nextId = 1;
  const refToEntry = new Map<object, { name: string; cb: (...args: unknown[]) => void }>();

  const on = jest.fn((name: string, cb: (...args: unknown[]) => void) => {
    let set = listeners.get(name);
    if (!set) {
      set = new Set();
      listeners.set(name, set);
    }
    set.add(cb);
    const ref = { id: nextId++ };
    refToEntry.set(ref, { name, cb });
    return ref;
  });

  const offref = jest.fn((ref: object) => {
    const entry = refToEntry.get(ref);
    if (entry) {
      listeners.get(entry.name)?.delete(entry.cb);
      refToEntry.delete(ref);
    }
  });

  const emit = (name: string, ...args: unknown[]) => {
    const set = listeners.get(name);
    if (!set) return;
    for (const cb of [...set]) {
      cb(...args);
    }
  };

  return { on, offref, emit };
}

interface MockDomNode {
  parentElement: MockDomNode | null;
  parentNode: MockDomNode | null;
  children: MockDomNode[];
  classList: { contains: (cls: string) => boolean };
  contains: (target: unknown) => boolean;
  closest?: (selector: string) => MockDomNode | null;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  dispatch: (type: string) => void;
  ownerDocument?: MockDocument;
  isConnected?: boolean;
}

interface MockSelection {
  isCollapsed: boolean;
  anchorNode: MockDomNode | null;
  toString: () => string;
}

interface MockDocument {
  activeElement: MockDomNode | null;
  getSelection: () => MockSelection | null;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  dispatch: (type: string) => void;
}

function makeMockNode(classes: string[] = [], ownerDocument?: MockDocument): MockDomNode {
  const classSet = new Set(classes);
  const listeners = new Map<string, Array<() => void>>();
  const node: MockDomNode = {
    parentElement: null,
    parentNode: null,
    children: [],
    ownerDocument,
    isConnected: true,
    classList: {
      contains: (cls: string) => classSet.has(cls),
    },
    contains: (target: unknown): boolean => {
      if (!target || typeof target !== 'object') return false;
      if (target === node) return true;
      return node.children.some(child => child.contains(target));
    },
    addEventListener: jest.fn((type: string, cb: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(cb);
      listeners.set(type, list);
    }),
    removeEventListener: jest.fn((type: string, cb: () => void) => {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter(fn => fn !== cb));
    }),
    dispatch: (type: string) => {
      for (const cb of listeners.get(type) ?? []) {
        cb();
      }
    },
  };
  return node;
}

function attachChild(parent: MockDomNode, child: MockDomNode): MockDomNode {
  child.parentElement = parent;
  child.parentNode = parent;
  parent.children.push(child);
  return child;
}

function createMockDocument(): MockDocument & { setSelection: (sel: MockSelection | null) => void } {
  const listeners = new Map<string, Array<() => void>>();
  let currentSelection: MockSelection | null = null;
  const doc: MockDocument & { setSelection: (sel: MockSelection | null) => void } = {
    activeElement: null,
    getSelection: () => currentSelection,
    setSelection: (sel: MockSelection | null) => {
      currentSelection = sel;
    },
    addEventListener: jest.fn((type: string, cb: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(cb);
      listeners.set(type, list);
    }),
    removeEventListener: jest.fn((type: string, cb: () => void) => {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter(fn => fn !== cb));
    }),
    dispatch: (type: string) => {
      for (const cb of listeners.get(type) ?? []) {
        cb();
      }
    },
  };
  return doc;
}

interface HarnessOptions {
  initialActiveView?: MarkdownView | null;
  markdownLeaves?: WorkspaceLeaf[];
  initialActiveFile?: TFile | null;
  hasGetLeavesOfType?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const doc = createMockDocument();
  const chatContainerEl = makeMockNode(['chat-container'], doc);
  const chatTextareaEl = attachChild(chatContainerEl, makeMockNode(['chat-textarea'], doc));
  const component = new Component();
  component.load();

  const workspaceEmitter = createEventEmitter();
  const vaultEmitter = createEventEmitter();
  let markdownLeaves = options.markdownLeaves ?? [];
  let activeView = options.initialActiveView ?? null;
  let activeFile = options.initialActiveFile ?? null;

  const app = new App();
  const workspace = app.workspace as unknown as Record<string, unknown>;
  workspace.on = workspaceEmitter.on;
  workspace.offref = workspaceEmitter.offref;
  workspace.getActiveViewOfType = jest.fn(() => activeView);
  workspace.getActiveFile = jest.fn(() => activeFile);
  if (options.hasGetLeavesOfType !== false) {
    workspace.getLeavesOfType = jest.fn((type: string) => (type === 'markdown' ? markdownLeaves : []));
  }

  const vault = app.vault as unknown as Record<string, unknown>;
  vault.on = vaultEmitter.on;
  vault.offref = vaultEmitter.offref;

  const onChange = jest.fn<void, [ActiveEditorContextState]>();
  const onFocusComposer = jest.fn();

  const controller = new ActiveEditorContextController({
    app,
    chatContainerEl: chatContainerEl as unknown as HTMLElement,
    component,
    onChange,
    onFocusComposer,
  });

  return {
    app,
    doc,
    chatContainerEl,
    chatTextareaEl,
    component,
    controller,
    onChange,
    onFocusComposer,
    workspaceEmitter,
    vaultEmitter,
    setMarkdownLeaves: (leaves: WorkspaceLeaf[]) => {
      markdownLeaves = leaves;
    },
    setActiveView: (view: MarkdownView | null) => {
      activeView = view;
    },
    setActiveFile: (file: TFile | null) => {
      activeFile = file;
    },
  };
}

function createMarkdownViewWithContainer(
  file: TFile,
  doc: MockDocument,
  mode: 'source' | 'preview' = 'source'
): { view: MarkdownView; leaf: WorkspaceLeaf; leafEl: MockDomNode; containerEl: MockDomNode } {
  const view = new MarkdownView(file);
  const leafEl = makeMockNode(['workspace-leaf'], doc);
  const containerEl = attachChild(leafEl, makeMockNode(['workspace-leaf-content'], doc));
  const viewMutable = view as unknown as {
    containerEl: MockDomNode;
    getMode: () => string;
    getViewType: () => string;
  };
  viewMutable.containerEl = containerEl;
  viewMutable.getMode = () => mode;
  viewMutable.getViewType = () => 'markdown';

  const leaf = new WorkspaceLeaf(view);
  (leaf as unknown as { containerEl: MockDomNode }).containerEl = leafEl;
  return { view, leaf, leafEl, containerEl };
}

describe('ActiveEditorContextController', () => {
  it('detects initial active note and selection from the active MarkdownView', () => {
    const doc = createMockDocument();
    const file = new TFile('Daily.md', 'Journal/Daily.md');
    const { view, leaf } = createMarkdownViewWithContainer(file, doc);
    view.editor.setSelection('Line two\nLine three\n', { line: 1, ch: 0 }, { line: 3, ch: 0 });

    const { controller } = createHarness({
      initialActiveView: view,
      markdownLeaves: [leaf],
    });

    expect(controller.getState()).toEqual({
      activeNote: { path: 'Journal/Daily.md', basename: 'Daily' },
      includeActiveNote: true,
      selection: {
        filePath: 'Journal/Daily.md',
        fileName: 'Daily',
        selectedText: 'Line two\nLine three\n',
        startLine: 2,
        endLine: 3,
      },
    });
    expect(controller.getPromptContext()).toEqual({
      activeNotePath: 'Journal/Daily.md',
      selection: {
        filePath: 'Journal/Daily.md',
        fileName: 'Daily',
        selectedText: 'Line two\nLine three\n',
        startLine: 2,
        endLine: 3,
      },
    });
  });

  it('falls back to open markdown leaves or workspace.getActiveFile when no active view is focused', () => {
    const fileA = new TFile('Alpha.md', 'Notes/Alpha.md');
    const leafA = new WorkspaceLeaf(new MarkdownView(fileA));
    const harnessFromLeaf = createHarness({
      initialActiveView: null,
      markdownLeaves: [leafA],
    });
    expect(harnessFromLeaf.controller.getState().activeNote).toEqual({
      path: 'Notes/Alpha.md',
      basename: 'Alpha',
    });

    const fileB = new TFile('Beta.md', 'Notes/Beta.md');
    const harnessFromActiveFile = createHarness({
      initialActiveView: null,
      markdownLeaves: [],
      initialActiveFile: fileB,
    });
    expect(harnessFromActiveFile.controller.getState().activeNote).toEqual({
      path: 'Notes/Beta.md',
      basename: 'Beta',
    });
  });

  it('preserves active note and selection across pointerdown and active-leaf-change to ChatView', () => {
    const doc = createMockDocument();
    const file = new TFile('Spec.md', 'Docs/Spec.md');
    const { view, leaf, containerEl } = createMarkdownViewWithContainer(file, doc);
    const {
      controller,
      chatContainerEl,
      chatTextareaEl,
      doc: harnessDoc,
      onChange,
      workspaceEmitter,
      setMarkdownLeaves,
    } = createHarness({
      initialActiveView: view,
      markdownLeaves: [leaf],
    });
    // Re-point view container to harnessDoc for realism
    expect(containerEl).toBeDefined();

    // User selects text in editor
    view.editor.setSelection('important clause', { line: 4, ch: 2 }, { line: 4, ch: 18 });
    harnessDoc.activeElement = containerEl;
    // User clicks into ChatView: capture-phase pointerdown fires before blur
    chatContainerEl.dispatch('pointerdown');

    expect(controller.getState().selection).toEqual({
      filePath: 'Docs/Spec.md',
      fileName: 'Spec',
      selectedText: 'important clause',
      startLine: 5,
      endLine: 5,
    });

    // Focus moves to chat textarea and active-leaf-change switches to ChatView
    harnessDoc.activeElement = chatTextareaEl;
    harnessDoc.setSelection({
      isCollapsed: true,
      anchorNode: chatTextareaEl,
      toString: () => '',
    });
    workspaceEmitter.emit('active-leaf-change', {
      view: { getViewType: () => 'nexus-chat' },
    });
    harnessDoc.dispatch('selectionchange');

    expect(controller.getState().activeNote).toEqual({ path: 'Docs/Spec.md', basename: 'Spec' });
    expect(controller.getState().selection?.selectedText).toBe('important clause');

    // If markdown leaf is actually closed when switching to non-markdown leaf, active note clears
    onChange.mockClear();
    setMarkdownLeaves([]);
    workspaceEmitter.emit('active-leaf-change', {
      view: { getViewType: () => 'nexus-chat' },
    });
    expect(controller.getState()).toEqual({
      activeNote: null,
      includeActiveNote: true,
      selection: null,
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clears selection when collapsed inside the MarkdownView editor itself, not when in ChatView', () => {
    const file = new TFile('Note.md', 'Note.md');
    const docForView = createMockDocument();
    const { view, leaf, containerEl } = createMarkdownViewWithContainer(file, docForView);
    const editorBody = attachChild(containerEl, makeMockNode(['cm-content'], docForView));

    const { controller, doc, chatTextareaEl, onChange } = createHarness({
      initialActiveView: view,
      markdownLeaves: [leaf],
    });

    // Select text while inside editor
    doc.activeElement = editorBody;
    view.editor.setSelection('selected phrase', { line: 0, ch: 0 }, { line: 0, ch: 15 });
    doc.dispatch('selectionchange');
    expect(controller.getState().selection?.selectedText).toBe('selected phrase');

    // Selection collapses inside chat container -> ignored, editor selection remains
    doc.activeElement = chatTextareaEl;
    doc.setSelection({ isCollapsed: true, anchorNode: chatTextareaEl, toString: () => '' });
    doc.dispatch('selectionchange');
    expect(controller.getState().selection?.selectedText).toBe('selected phrase');

    // Even if editor reports empty while activeElement is in chat, selection is preserved
    view.editor.setSelection('');
    doc.setSelection(null);
    doc.dispatch('selectionchange');
    expect(controller.getState().selection?.selectedText).toBe('selected phrase');

    // User clicks back inside the editor itself to collapse selection -> clears
    onChange.mockClear();
    doc.activeElement = editorBody;
    doc.dispatch('selectionchange');
    expect(controller.getState().selection).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('captures and clears Reading View DOM selections across blur', () => {
    const file = new TFile('Guide.md', 'Docs/Guide.md');
    const docForView = createMockDocument();
    const { view, leaf, containerEl } = createMarkdownViewWithContainer(file, docForView, 'preview');
    const readingView = attachChild(containerEl, makeMockNode(['markdown-reading-view'], docForView));
    const paragraphNode = attachChild(readingView, makeMockNode([], docForView));

    const { controller, doc, chatContainerEl, chatTextareaEl } = createHarness({
      initialActiveView: view,
      markdownLeaves: [leaf],
    });

    // Highlight text in Reading View
    doc.activeElement = readingView;
    doc.setSelection({
      isCollapsed: false,
      anchorNode: paragraphNode,
      toString: () => 'Reading view excerpt',
    });

    // Clicking chat container triggers pointerdown capture before blur
    chatContainerEl.dispatch('pointerdown');
    expect(controller.getState().selection).toEqual({
      filePath: 'Docs/Guide.md',
      fileName: 'Guide',
      selectedText: 'Reading view excerpt',
    });

    // Blur moves DOM selection into chat textarea -> preserved
    doc.activeElement = chatTextareaEl;
    doc.setSelection({
      isCollapsed: true,
      anchorNode: chatTextareaEl,
      toString: () => '',
    });
    doc.dispatch('selectionchange');
    expect(controller.getState().selection?.selectedText).toBe('Reading view excerpt');

    // Clicking inside Reading View collapses selection -> cleared
    doc.activeElement = readingView;
    doc.setSelection({
      isCollapsed: true,
      anchorNode: paragraphNode,
      toString: () => '',
    });
    doc.dispatch('selectionchange');
    expect(controller.getState().selection).toBeNull();
  });

  it('toggles active note inclusion and computes getPromptContext accurately', () => {
    const file = new TFile('Plan.md', 'Plan.md');
    const leaf = new WorkspaceLeaf(new MarkdownView(file));
    const { controller, onChange } = createHarness({
      initialActiveView: leaf.view,
      markdownLeaves: [leaf],
    });

    expect(controller.getPromptContext()).toEqual({
      activeNotePath: 'Plan.md',
      selection: null,
    });

    controller.toggleIncludeActiveNote();
    expect(controller.getState().includeActiveNote).toBe(false);
    expect(controller.getPromptContext()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);

    // Setting same value is a no-op
    controller.setIncludeActiveNote(false);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Selection still contributes even when includeActiveNote is false
    leaf.view.editor.setSelection('key section', { line: 2, ch: 0 }, { line: 2, ch: 11 });
    controller.captureNow();
    expect(controller.getPromptContext()).toEqual({
      activeNotePath: null,
      selection: {
        filePath: 'Plan.md',
        fileName: 'Plan',
        selectedText: 'key section',
        startLine: 3,
        endLine: 3,
      },
    });
  });

  it('dismissSelection suppresses stale re-capture until selection changes or collapses', () => {
    const file = new TFile('Draft.md', 'Draft.md');
    const docForView = createMockDocument();
    const { view, leaf, containerEl } = createMarkdownViewWithContainer(file, docForView);
    const editorBody = attachChild(containerEl, makeMockNode(['cm-content'], docForView));

    const { controller, doc, onChange } = createHarness({
      initialActiveView: view,
      markdownLeaves: [leaf],
    });

    doc.activeElement = editorBody;
    view.editor.setSelection('stale text', { line: 1, ch: 0 }, { line: 1, ch: 10 });
    doc.dispatch('selectionchange');
    expect(controller.getState().selection?.selectedText).toBe('stale text');

    onChange.mockClear();
    controller.dismissSelection();
    expect(controller.getState().selection).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);

    // Same selection still highlighted in editor must NOT re-pop
    controller.captureNow();
    doc.dispatch('selectionchange');
    expect(controller.getState().selection).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);

    // Different selection DOES capture
    view.editor.setSelection('fresh text', { line: 1, ch: 0 }, { line: 1, ch: 10 });
    doc.dispatch('selectionchange');
    expect(controller.getState().selection?.selectedText).toBe('fresh text');

    // Dismissing then collapsing in editor allows re-selecting the same text later
    controller.dismissSelection();
    view.editor.setSelection('');
    doc.dispatch('selectionchange');
    view.editor.setSelection('fresh text', { line: 1, ch: 0 }, { line: 1, ch: 10 });
    doc.dispatch('selectionchange');
    expect(controller.getState().selection?.selectedText).toBe('fresh text');
  });

  it('consumeSelectionAfterSend clears selection without re-popping while keeping activeNote intact', () => {
    const file = new TFile('Summary.md', 'Summary.md');
    const leaf = new WorkspaceLeaf(new MarkdownView(file));
    leaf.view.editor.setSelection('paragraph', { line: 0, ch: 0 }, { line: 0, ch: 9 });

    const { controller, onChange } = createHarness({
      initialActiveView: leaf.view,
      markdownLeaves: [leaf],
    });

    expect(controller.getState().selection?.selectedText).toBe('paragraph');
    onChange.mockClear();

    controller.consumeSelectionAfterSend();
    expect(controller.getState()).toEqual({
      activeNote: { path: 'Summary.md', basename: 'Summary' },
      includeActiveNote: true,
      selection: null,
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Stale editor selection must not re-appear after send
    controller.captureNow();
    expect(controller.getState().selection).toBeNull();
  });

  it('registers editor-menu item in sentence case when text is selected and focuses composer on click', () => {
    const file = new TFile('Snippet.md', 'Code/Snippet.md');
    const leaf = new WorkspaceLeaf(new MarkdownView(file));
    const { controller, workspaceEmitter, onFocusComposer } = createHarness({
      initialActiveView: leaf.view,
      markdownLeaves: [leaf],
    });
    controller.setIncludeActiveNote(false);

    const items: Array<{ title?: string; icon?: string; click?: () => void }> = [];
    const fakeMenu = {
      addItem(cb: (item: {
        setTitle: (t: string) => unknown;
        setIcon: (i: string) => unknown;
        onClick: (fn: () => void) => unknown;
      }) => void) {
        const entry: { title?: string; icon?: string; click?: () => void } = {};
        const builder = {
          setTitle(title: string) {
            entry.title = title;
            return builder;
          },
          setIcon(icon: string) {
            entry.icon = icon;
            return builder;
          },
          onClick(fn: () => void) {
            entry.click = fn;
            return builder;
          },
        };
        cb(builder);
        items.push(entry);
        return fakeMenu;
      },
    } as unknown as Menu;

    const editor = new Editor();
    workspaceEmitter.emit('editor-menu', fakeMenu, editor, leaf.view);
    expect(items).toHaveLength(0);

    editor.setSelection('chosen snippet', { line: 6, ch: 0 }, { line: 7, ch: 4 });
    workspaceEmitter.emit('editor-menu', fakeMenu, editor, leaf.view);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Add selection to Nexus chat');
    expect(items[0].icon).toBe('quote');

    items[0].click?.();
    expect(controller.getState()).toEqual({
      activeNote: { path: 'Code/Snippet.md', basename: 'Snippet' },
      includeActiveNote: false,
      selection: {
        filePath: 'Code/Snippet.md',
        fileName: 'Snippet',
        selectedText: 'chosen snippet',
        startLine: 7,
        endLine: 8,
      },
    });
    expect(onFocusComposer).toHaveBeenCalledTimes(1);
  });

  it('handles file-open, vault rename/delete, and cleanup on Component unload', () => {
    const fileA = new TFile('A.md', 'Folder/A.md');
    const fileB = new TFile('B.md', 'Folder/B.md');
    const leafA = new WorkspaceLeaf(new MarkdownView(fileA));
    leafA.view.editor.setSelection('alpha text', { line: 0, ch: 0 }, { line: 0, ch: 10 });

    const {
      controller,
      doc,
      chatContainerEl,
      component,
      workspaceEmitter,
      vaultEmitter,
      setMarkdownLeaves,
    } = createHarness({
      initialActiveView: leafA.view,
      markdownLeaves: [leafA],
    });

    // Obsidian mutates TFile in-place before emitting rename
    fileA.path = 'Archive/A-renamed.md';
    fileA.basename = 'A-renamed';
    fileA.name = 'A-renamed.md';
    vaultEmitter.emit('rename', fileA, 'Folder/A.md');

    expect(controller.getState()).toEqual({
      activeNote: { path: 'Archive/A-renamed.md', basename: 'A-renamed' },
      includeActiveNote: true,
      selection: {
        filePath: 'Archive/A-renamed.md',
        fileName: 'A-renamed',
        selectedText: 'alpha text',
        startLine: 1,
        endLine: 1,
      },
    });

    // file-open(null) does not clear while markdown leaf still holds a file
    workspaceEmitter.emit('file-open', null);
    expect(controller.getState().activeNote?.path).toBe('Archive/A-renamed.md');

    // Opening fileB clears selection belonging to fileA
    const leafB = new WorkspaceLeaf(new MarkdownView(fileB));
    setMarkdownLeaves([leafB]);
    workspaceEmitter.emit('file-open', fileB);
    expect(controller.getState()).toEqual({
      activeNote: { path: 'Folder/B.md', basename: 'B' },
      includeActiveNote: true,
      selection: null,
    });
    // Deleting fileB clears activeNote
    vaultEmitter.emit('delete', fileB);
    expect(controller.getState().activeNote).toBeNull();

    // Re-open fileB, then emit file-open(null) with zero open markdown leaves -> clears activeNote
    setMarkdownLeaves([]);
    workspaceEmitter.emit('file-open', fileB);
    expect(controller.getState().activeNote?.path).toBe('Folder/B.md');
    workspaceEmitter.emit('file-open', null);
    expect(controller.getState().activeNote).toBeNull();
    // Unloading component detaches DOM & event listeners
    component.unload();
    expect(chatContainerEl.removeEventListener).toHaveBeenCalledWith(
      'pointerdown',
      expect.any(Function),
      { capture: true }
    );
    expect(doc.removeEventListener).toHaveBeenCalledWith('selectionchange', expect.any(Function));
    expect(workspaceEmitter.offref).toHaveBeenCalled();
    expect(vaultEmitter.offref).toHaveBeenCalled();
  });
});
