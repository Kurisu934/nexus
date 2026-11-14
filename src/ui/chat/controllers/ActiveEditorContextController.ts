import {
  App,
  Component,
  Editor,
  EventRef,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
import type { ActiveEditorPromptContext, CapturedSelectionInfo } from '../services/SystemPromptBuilder';

export type { ActiveEditorPromptContext, CapturedSelectionInfo } from '../services/SystemPromptBuilder';

export interface ActiveEditorContextState {
  activeNote: { path: string; basename: string } | null;
  includeActiveNote: boolean;
  selection: CapturedSelectionInfo | null;
}

export interface ActiveEditorContextControllerOptions {
  app: App;
  chatContainerEl: HTMLElement;
  component: Component;
  onChange: (state: ActiveEditorContextState) => void;
  onFocusComposer?: () => void;
}

interface FileLike {
  path: string;
  basename: string;
}

interface ContainerElementLike {
  isConnected?: boolean;
  ownerDocument?: Document | null;
  contains?: (node: Node) => boolean;
}

interface MarkdownViewShape {
  file?: FileLike | null;
  editor?: Editor;
  containerEl?: ContainerElementLike;
  getMode?: () => string;
  getViewType?: () => string;
}

interface WorkspaceLeafShape {
  containerEl?: ContainerElementLike;
  view?: MarkdownViewShape;
}

interface WorkspaceWithOptionalEvents {
  on?: {
    (name: 'active-leaf-change', cb: (leaf: WorkspaceLeaf | null) => void): EventRef;
    (name: 'file-open', cb: (file: TFile | null) => void): EventRef;
    (name: 'editor-menu', cb: (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => void): EventRef;
  };
  offref?: (ref: EventRef) => void;
  getLeavesOfType?: (viewType: string) => WorkspaceLeaf[];
  getActiveFile?: () => TFile | null;
}

interface VaultWithOptionalEvents {
  on?: {
    (name: 'rename', cb: (file: unknown, oldPath: string) => void): EventRef;
    (name: 'delete', cb: (file: unknown) => void): EventRef;
  };
  offref?: (ref: EventRef) => void;
}

function isFileLike(value: unknown): value is FileLike {
  if (value instanceof TFile) {
    return true;
  }
  return Boolean(
    value &&
    typeof value === 'object' &&
    'path' in value &&
    typeof value.path === 'string' &&
    'basename' in value &&
    typeof value.basename === 'string'
  );
}

function isMarkdownViewLike(value: unknown): value is MarkdownView {
  if (value instanceof MarkdownView) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if ('getViewType' in value && typeof value.getViewType === 'function') {
    const getViewType = value.getViewType as () => unknown;
    return getViewType.call(value) === 'markdown';
  }
  return 'editor' in value || ('getMode' in value && typeof value.getMode === 'function');
}

function asOptionalWorkspace(workspace: unknown): WorkspaceWithOptionalEvents | null {
  // Real Obsidian Workspace provides .on/.getLeavesOfType/.getActiveFile; test mocks omit them.
  return workspace && typeof workspace === 'object' ? workspace : null;
}

function asOptionalVault(vault: unknown): VaultWithOptionalEvents | null {
  // Real Obsidian Vault provides .on/.offref; test mocks omit them.
  return vault && typeof vault === 'object' ? vault : null;
}
function getLeafFile(leaf: WorkspaceLeaf | null | undefined): FileLike | null {
  if (!leaf || typeof leaf !== 'object' || !('view' in leaf)) {
    return null;
  }
  const view: unknown = leaf.view;
  if (!view || typeof view !== 'object' || !('file' in view)) {
    return null;
  }
  return isFileLike(view.file) ? view.file : null;
}

function getClosestElement(node: Node | null | undefined, selector: string, classNames: string[]): Element | null {
  if (!node) {
    return null;
  }
  let el: Element | null = null;
  if ('closest' in node && typeof node.closest === 'function') {
    el = node as Element;
  } else if (node.parentElement) {
    el = node.parentElement;
  } else if (node.parentNode && ('closest' in node.parentNode || 'classList' in node.parentNode)) {
    el = node.parentNode as Element;
  }
  if (!el) {
    return null;
  }
  if (typeof el.closest === 'function') {
    return el.closest(selector);
  }
  let current: Element | null = el;
  while (current) {
    const classList = current.classList;
    if (classList && typeof classList.contains === 'function') {
      if (classNames.some(cls => classList.contains(cls))) {
        return current;
      }
    }
    current = current.parentElement;
  }
  return null;
}

export class ActiveEditorContextController {
  private lastMarkdownView: MarkdownView | null = null;
  private activeFile: FileLike | null = null;
  private includeActiveNote = true;
  private selection: CapturedSelectionInfo | null = null;
  private dismissedSignature: string | null = null;
  private cleanupCallbacks: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly options: ActiveEditorContextControllerOptions) {
    this.resolveInitialContext();
    this.registerListeners();
  }

  getState(): ActiveEditorContextState {
    return {
      activeNote: this.activeFile
        ? { path: this.activeFile.path, basename: this.activeFile.basename }
        : null,
      includeActiveNote: this.includeActiveNote,
      selection: this.selection ? { ...this.selection } : null,
    };
  }

  getPromptContext(): ActiveEditorPromptContext | null {
    const activeNotePath = this.includeActiveNote ? (this.activeFile?.path ?? null) : null;
    const selection = this.selection && this.selection.selectedText.trim().length > 0
      ? { ...this.selection }
      : null;

    if (!activeNotePath && !selection) {
      return null;
    }

    return {
      activeNotePath,
      selection,
    };
  }

  toggleIncludeActiveNote(): void {
    this.setIncludeActiveNote(!this.includeActiveNote);
  }

  setIncludeActiveNote(include: boolean): void {
    if (this.disposed || this.includeActiveNote === include) {
      return;
    }
    this.includeActiveNote = include;
    this.notifyChange();
  }

  dismissSelection(): void {
    if (this.disposed || !this.selection) {
      return;
    }
    this.dismissedSignature = this.buildSelectionSignature(this.selection);
    this.selection = null;
    this.notifyChange();
  }

  consumeSelectionAfterSend(): void {
    if (this.disposed || !this.selection) {
      return;
    }
    this.dismissedSignature = this.buildSelectionSignature(this.selection);
    this.selection = null;
    this.notifyChange();
  }

  captureNow(): void {
    if (this.disposed) {
      return;
    }
    const prevSnapshot = this.snapshotStateKey();
    this.captureSelectionInternal(false);
    this.emitIfChanged(prevSnapshot);
  }

  cleanup(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const callbacks = this.cleanupCallbacks.splice(0, this.cleanupCallbacks.length);
    for (const cb of callbacks) {
      try {
        cb();
      } catch {
        // Best-effort listener teardown
      }
    }
  }

  private resolveInitialContext(): void {
    const workspace = asOptionalWorkspace(this.options.app?.workspace);
    const activeView = this.options.app?.workspace?.getActiveViewOfType?.(MarkdownView) ?? null;
    if (activeView && isFileLike(activeView.file)) {
      this.lastMarkdownView = activeView;
      this.activeFile = activeView.file;
    } else {
      const markdownLeaves = this.getMarkdownLeaves();
      const leafWithFile = markdownLeaves.find(leaf => getLeafFile(leaf) !== null);
      if (leafWithFile) {
        this.activeFile = getLeafFile(leafWithFile);
        if (isMarkdownViewLike(leafWithFile.view)) {
          this.lastMarkdownView = leafWithFile.view;
        }
      } else {
        const activeFile = workspace?.getActiveFile?.() ?? null;
        if (isFileLike(activeFile)) {
          this.activeFile = activeFile;
        }
      }
    }

    this.captureSelectionInternal(false);
  }
  private registerListeners(): void {
    const workspace = asOptionalWorkspace(this.options.app?.workspace);
    const vault = asOptionalVault(this.options.app?.vault);
    const { chatContainerEl, component } = this.options;

    if (typeof workspace?.on === 'function') {
      const leafRef = workspace.on('active-leaf-change', (leaf) => {
        this.handleActiveLeafChange(leaf);
      });
      this.trackEventRef(leafRef, () => workspace.offref?.(leafRef));

      const fileOpenRef = workspace.on('file-open', (file) => {
        this.handleFileOpen(file);
      });
      this.trackEventRef(fileOpenRef, () => workspace.offref?.(fileOpenRef));

      const editorMenuRef = workspace.on('editor-menu', (menu, editor, info) => {
        this.handleEditorMenu(menu, editor, info);
      });
      this.trackEventRef(editorMenuRef, () => workspace.offref?.(editorMenuRef));
    }

    if (typeof vault?.on === 'function') {
      const renameRef = vault.on('rename', (file, oldPath) => {
        this.handleVaultRename(file, oldPath);
      });
      this.trackEventRef(renameRef, () => vault.offref?.(renameRef));

      const deleteRef = vault.on('delete', (file) => {
        this.handleVaultDelete(file);
      });
      this.trackEventRef(deleteRef, () => vault.offref?.(deleteRef));
    }

    const onPointerDownCapture = () => {
      this.captureNow();
    };
    if (typeof chatContainerEl?.addEventListener === 'function') {
      chatContainerEl.addEventListener('pointerdown', onPointerDownCapture, { capture: true });
      this.cleanupCallbacks.push(() => {
        chatContainerEl.removeEventListener?.('pointerdown', onPointerDownCapture, { capture: true });
      });
    }

    const doc = this.getOwnerDocument();
    const onSelectionChange = () => {
      this.handleSelectionChange();
    };
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('selectionchange', onSelectionChange);
      this.cleanupCallbacks.push(() => {
        doc.removeEventListener?.('selectionchange', onSelectionChange);
      });
    }

    component.register?.(() => {
      this.cleanup();
    });
  }

  private trackEventRef(ref: EventRef | undefined, off: () => void): void {
    if (!ref) {
      return;
    }
    this.options.component.registerEvent?.(ref);
    this.cleanupCallbacks.push(off);
  }

  private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    if (this.disposed) {
      return;
    }

    const prevSnapshot = this.snapshotStateKey();
    const view = leaf?.view;

    if (isMarkdownViewLike(view) && isFileLike(view.file)) {
      const nextFile = view.file;
      this.lastMarkdownView = view;
      this.activeFile = nextFile;

      if (this.selection && this.selection.filePath !== nextFile.path) {
        this.selection = null;
        this.dismissedSignature = null;
      }

      this.captureSelectionInternal(true);
      this.emitIfChanged(prevSnapshot);
      return;
    }

    // Non-markdown leaf (e.g., ChatView): preserve active note and selection
    // while activeFile remains open in any markdown leaf.
    const workspace = asOptionalWorkspace(this.options.app?.workspace);
    if (this.activeFile && typeof workspace?.getLeavesOfType === 'function') {
      const markdownLeaves = this.getMarkdownLeaves();
      const stillOpen = markdownLeaves.some(
        markdownLeaf => getLeafFile(markdownLeaf)?.path === this.activeFile?.path
      );
      if (!stillOpen) {
        this.activeFile = null;
        this.lastMarkdownView = null;
        this.selection = null;
        this.dismissedSignature = null;
      }
    }

    this.emitIfChanged(prevSnapshot);
  }

  private handleFileOpen(file: unknown): void {
    if (this.disposed) {
      return;
    }

    const prevSnapshot = this.snapshotStateKey();
    const workspace = asOptionalWorkspace(this.options.app?.workspace);
    if (isFileLike(file)) {
      this.activeFile = file;
      const matchingLeaf = this.findMarkdownLeafForPath(file.path);
      if (matchingLeaf && isMarkdownViewLike(matchingLeaf.view)) {
        this.lastMarkdownView = matchingLeaf.view;
      } else if (this.lastMarkdownView?.file?.path !== file.path) {
        const activeView = this.options.app?.workspace?.getActiveViewOfType?.(MarkdownView) ?? null;
        this.lastMarkdownView = activeView && isFileLike(activeView.file) && activeView.file.path === file.path
          ? activeView
          : null;
      }

      if (this.selection && this.selection.filePath !== file.path) {
        this.selection = null;
        this.dismissedSignature = null;
      }

      this.captureSelectionInternal(false);
      this.emitIfChanged(prevSnapshot);
      return;
    }

    if (file === null) {
      if (typeof workspace?.getLeavesOfType === 'function') {
        const markdownLeaves = this.getMarkdownLeaves();
        const firstOpenLeaf = markdownLeaves.find(leaf => getLeafFile(leaf) !== null);
        if (!firstOpenLeaf) {
          this.activeFile = null;
          this.lastMarkdownView = null;
          this.selection = null;
          this.dismissedSignature = null;
        } else if (
          this.activeFile &&
          !markdownLeaves.some(leaf => getLeafFile(leaf)?.path === this.activeFile?.path)
        ) {
          this.activeFile = getLeafFile(firstOpenLeaf);
          this.lastMarkdownView = isMarkdownViewLike(firstOpenLeaf.view) ? firstOpenLeaf.view : null;
          if (this.selection && this.selection.filePath !== this.activeFile?.path) {
            this.selection = null;
            this.dismissedSignature = null;
          }
        }
      } else {
        this.activeFile = null;
        this.lastMarkdownView = null;
        this.selection = null;
        this.dismissedSignature = null;
      }

      this.emitIfChanged(prevSnapshot);
    }
  }

  private handleVaultRename(file: unknown, oldPath: string): void {
    if (this.disposed) {
      return;
    }

    const prevSnapshot = this.snapshotStateKey();
    const renamedActive = Boolean(
      this.activeFile && (this.activeFile === file || this.activeFile.path === oldPath)
    );

    if (renamedActive && isFileLike(file)) {
      this.activeFile = file;
    }

    let selectionUpdated = false;
    if (this.selection && this.selection.filePath === oldPath && isFileLike(file)) {
      const oldSignature = this.buildSelectionSignature(this.selection);
      this.selection = {
        ...this.selection,
        filePath: file.path,
        fileName: file.basename,
      };
      if (this.dismissedSignature === oldSignature) {
        this.dismissedSignature = this.buildSelectionSignature(this.selection);
      }
      selectionUpdated = true;
    } else if (this.dismissedSignature && this.dismissedSignature.startsWith(`${oldPath}::`) && isFileLike(file)) {
      this.dismissedSignature = `${file.path}::${this.dismissedSignature.slice(oldPath.length + 2)}`;
    }

    // Obsidian mutates TFile.path/basename in place before emitting 'rename'.
    if (renamedActive || selectionUpdated) {
      this.notifyChange();
    } else {
      this.emitIfChanged(prevSnapshot);
    }
  }

  private handleVaultDelete(file: unknown): void {
    if (this.disposed) {
      return;
    }

    const prevSnapshot = this.snapshotStateKey();
    const deletedPath = file && typeof file === 'object' && 'path' in file && typeof file.path === 'string'
      ? file.path
      : undefined;

    if (
      this.activeFile &&
      (this.activeFile === file || (deletedPath !== undefined && this.activeFile.path === deletedPath))
    ) {
      this.activeFile = null;
      this.lastMarkdownView = null;
    }

    if (this.selection && deletedPath !== undefined && this.selection.filePath === deletedPath) {
      this.selection = null;
      this.dismissedSignature = null;
    }

    this.emitIfChanged(prevSnapshot);
  }

  private handleEditorMenu(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
    if (this.disposed || !editor?.somethingSelected?.()) {
      return;
    }

    const targetFile = isFileLike(info?.file) ? info.file : this.activeFile;
    if (!targetFile) {
      return;
    }

    const initialSelection = this.extractEditorSelection(editor, targetFile);
    if (!initialSelection) {
      return;
    }

    menu.addItem((item) => {
      item
        .setTitle('Add selection to Nexus chat')
        .setIcon('quote')
        .onClick(() => {
          if (this.disposed) {
            return;
          }
          if (isMarkdownViewLike(info)) {
            this.lastMarkdownView = info;
          }
          this.activeFile = targetFile;
          this.dismissedSignature = null;
          this.selection = this.extractEditorSelection(editor, targetFile) ?? initialSelection;
          this.notifyChange();
          this.options.onFocusComposer?.();
        });
    });
  }

  private handleSelectionChange(): void {
    if (this.disposed) {
      return;
    }

    const doc = this.getOwnerDocument();
    const domSel = doc?.getSelection?.() ?? null;
    if (this.isNodeInsideChat(domSel?.anchorNode ?? null)) {
      return;
    }

    const prevSnapshot = this.snapshotStateKey();
    this.captureSelectionInternal(true);
    this.emitIfChanged(prevSnapshot);
  }

  private captureSelectionInternal(allowClear: boolean): void {
    const doc = this.getOwnerDocument();
    const domSel = doc?.getSelection?.() ?? null;
    const activeEl: Node | null = doc?.activeElement ?? null;
    const focusInChat = this.isNodeInsideChat(activeEl);
    const anchorInChat = this.isNodeInsideChat(domSel?.anchorNode ?? null);

    if (this.isMarkdownViewValid(this.lastMarkdownView)) {
      const view = this.lastMarkdownView;
      const viewFile = view.file;
      const viewShape = view as unknown as MarkdownViewShape;
      const isSourceMode = typeof viewShape.getMode !== 'function' || viewShape.getMode() === 'source';

      if (isSourceMode && isFileLike(viewFile) && view.editor) {
        const captured = this.extractEditorSelection(view.editor, viewFile);
        if (captured) {
          const signature = this.buildSelectionSignature(captured);
          if (signature !== this.dismissedSignature) {
            this.selection = captured;
          }
          return;
        }

        if (allowClear && !focusInChat && this.isActiveElementInsideView(view, activeEl)) {
          this.selection = null;
          this.dismissedSignature = null;
          return;
        }
      }
    }

    if (anchorInChat) {
      return;
    }

    if (domSel && !domSel.isCollapsed) {
      const readingViewEl = getClosestElement(
        domSel.anchorNode,
        '.markdown-reading-view, .markdown-preview-view',
        ['markdown-reading-view', 'markdown-preview-view']
      );
      if (readingViewEl && !this.isNodeInsideChat(readingViewEl)) {
        const text = typeof domSel.toString === 'function' ? domSel.toString() : '';
        if (text.trim().length > 0) {
          const file = this.resolveReadingViewFile(readingViewEl);
          if (file) {
            const captured: CapturedSelectionInfo = {
              filePath: file.path,
              fileName: file.basename,
              selectedText: text,
            };
            const signature = this.buildSelectionSignature(captured);
            if (signature !== this.dismissedSignature) {
              this.selection = captured;
            }
            return;
          }
        }
      }
    }

    if (allowClear && !focusInChat && (!domSel || domSel.isCollapsed)) {
      const readingAnchor = getClosestElement(
        domSel?.anchorNode,
        '.markdown-reading-view, .markdown-preview-view',
        ['markdown-reading-view', 'markdown-preview-view']
      );
      const readingFocus = getClosestElement(
        activeEl,
        '.markdown-reading-view, .markdown-preview-view',
        ['markdown-reading-view', 'markdown-preview-view']
      );
      if (
        (readingAnchor && !this.isNodeInsideChat(readingAnchor)) ||
        (readingFocus && !this.isNodeInsideChat(readingFocus))
      ) {
        this.selection = null;
        this.dismissedSignature = null;
      }
    }
  }

  private extractEditorSelection(editor: Editor, file: FileLike): CapturedSelectionInfo | null {
    const selectedText = editor.getSelection?.() ?? '';
    if (selectedText.trim().length === 0) {
      return null;
    }

    let startLine: number | undefined;
    let endLine: number | undefined;

    if (typeof editor.getCursor === 'function') {
      const from = editor.getCursor('from');
      const to = editor.getCursor('to');
      if (from && typeof from.line === 'number') {
        startLine = from.line + 1;
        if (to && typeof to.line === 'number') {
          endLine = (to.ch === 0 && to.line > from.line) ? to.line : to.line + 1;
          if (endLine < startLine) {
            endLine = startLine;
          }
        } else {
          endLine = startLine;
        }
      }
    }

    return {
      filePath: file.path,
      fileName: file.basename,
      selectedText,
      ...(startLine !== undefined ? { startLine } : {}),
      ...(endLine !== undefined ? { endLine } : {}),
    };
  }

  private resolveReadingViewFile(readingViewEl: Element): FileLike | null {
    const leafEl = getClosestElement(readingViewEl, '.workspace-leaf', ['workspace-leaf']);
    const workspace = asOptionalWorkspace(this.options.app?.workspace);
    if (leafEl && typeof workspace?.getLeavesOfType === 'function') {
      const matchingLeaf = this.getMarkdownLeaves().find((leaf) => {
        const leafShape = leaf as unknown as WorkspaceLeafShape;
        const leafContainer: unknown = leafShape.containerEl;
        const viewContainer = leafShape.view?.containerEl;
        const viewContainerIdentity: unknown = viewContainer;
        if (leafContainer === leafEl || viewContainerIdentity === leafEl) {
          return true;
        }
        return Boolean(
          viewContainer &&
          typeof viewContainer.contains === 'function' &&
          viewContainer.contains(readingViewEl)
        );
      });
      const leafFile = getLeafFile(matchingLeaf);
      if (leafFile) {
        return leafFile;
      }
    }
    return this.activeFile;
  }

  private findMarkdownLeafForPath(path: string): WorkspaceLeaf | null {
    return this.getMarkdownLeaves().find(leaf => getLeafFile(leaf)?.path === path) ?? null;
  }

  private isMarkdownViewValid(view: MarkdownView | null): view is MarkdownView {
    if (!view || !isFileLike(view.file)) {
      return false;
    }
    const viewShape = view as unknown as MarkdownViewShape;
    if (viewShape.containerEl && viewShape.containerEl.isConnected === false) {
      return false;
    }
    return true;
  }

  private isActiveElementInsideView(view: MarkdownView, activeEl: Node | null): boolean {
    if (!activeEl) {
      return false;
    }
    const viewShape = view as unknown as MarkdownViewShape;
    const containerEl = viewShape.containerEl;
    if (!containerEl || typeof containerEl.contains !== 'function') {
      return false;
    }
    try {
      return containerEl.contains(activeEl);
    } catch {
      return false;
    }
  }

  private isNodeInsideChat(node: Node | null | undefined): boolean {
    if (!node || typeof this.options.chatContainerEl?.contains !== 'function') {
      return false;
    }
    try {
      return this.options.chatContainerEl.contains(node);
    } catch {
      return false;
    }
  }

  private buildSelectionSignature(selection: CapturedSelectionInfo): string {
    return `${selection.filePath}::${selection.startLine ?? ''}::${selection.endLine ?? ''}::${selection.selectedText}`;
  }

  private snapshotStateKey(): string {
    const notePart = this.activeFile ? `${this.activeFile.path}|${this.activeFile.basename}` : '';
    const selPart = this.selection ? this.buildSelectionSignature(this.selection) : '';
    return `${notePart}::${this.includeActiveNote ? '1' : '0'}::${selPart}`;
  }

  private emitIfChanged(prevSnapshot: string): void {
    if (this.snapshotStateKey() !== prevSnapshot) {
      this.notifyChange();
    }
  }

  private notifyChange(): void {
    if (!this.disposed) {
      this.options.onChange(this.getState());
    }
  }

  private getOwnerDocument(): Document | null {
    return this.options.chatContainerEl?.ownerDocument
      ?? (typeof window !== 'undefined' ? (window.activeDocument ?? window.document) : null);
  }

  private getMarkdownLeaves(): WorkspaceLeaf[] {
    const workspace = asOptionalWorkspace(this.options.app?.workspace);
    if (typeof workspace?.getLeavesOfType !== 'function') {
      return [];
    }
    const leaves = workspace.getLeavesOfType('markdown');
    return Array.isArray(leaves) ? leaves : [];
  }
}
