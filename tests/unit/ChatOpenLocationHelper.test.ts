import type { App, Workspace, WorkspaceLeaf } from 'obsidian';
import {
  createChatLeafForLocation,
  DEFAULT_CHAT_OPEN_LOCATION,
  matchesChatOpenLocation,
  openOrRevealChatLeaf,
  resolveChatOpenLocation
} from '../../src/core/ui/ChatOpenLocationHelper';

const CHAT_VIEW_TYPE = 'nexus-chat-view';

interface MockView {
  getCurrentConversationId?: jest.Mock<string | null, []>;
  openConversationById?: jest.Mock<Promise<void>, [string]>;
}

interface MockLeaf {
  root: object | null;
  view: MockView;
  getRoot: jest.Mock<object | null, []>;
  setViewState: jest.Mock<Promise<void>, [unknown]>;
  detach: jest.Mock<void, []>;
}

function createMockLeaf(root: object | null, view: MockView = {}): MockLeaf {
  return {
    root,
    view,
    getRoot: jest.fn(() => root),
    setViewState: jest.fn(async () => undefined),
    detach: jest.fn(),
  };
}

function createMockWorkspace(options: {
  existingLeaves?: MockLeaf[];
  rightLeaf?: MockLeaf | null;
  leftLeaf?: MockLeaf | null;
  tabLeaf?: MockLeaf | null;
  splitLeaf?: MockLeaf | null;
  anchorLeaf?: MockLeaf | null;
  bySplitLeaf?: MockLeaf | null;
} = {}) {
  const rightSplit = { id: 'right-split' };
  const leftSplit = { id: 'left-split' };
  const rootSplit = { id: 'root-split' };
  const existingLeaves = options.existingLeaves ?? [];

  const rightLeaf = options.rightLeaf === undefined ? createMockLeaf(rightSplit) : options.rightLeaf;
  const leftLeaf = options.leftLeaf === undefined ? createMockLeaf(leftSplit) : options.leftLeaf;
  const tabLeaf = options.tabLeaf === undefined ? createMockLeaf(rootSplit) : options.tabLeaf;
  const splitLeaf = options.splitLeaf === undefined ? createMockLeaf(rootSplit) : options.splitLeaf;
  const anchorLeaf = options.anchorLeaf === undefined ? createMockLeaf(rootSplit) : options.anchorLeaf;
  const bySplitLeaf = options.bySplitLeaf === undefined ? createMockLeaf(rootSplit) : options.bySplitLeaf;

  const workspace = {
    rightSplit,
    leftSplit,
    rootSplit,
    getLeavesOfType: jest.fn(() => existingLeaves),
    getRightLeaf: jest.fn(() => rightLeaf),
    getLeftLeaf: jest.fn(() => leftLeaf),
    getLeaf: jest.fn((mode?: string) => (mode === 'tab' ? tabLeaf : splitLeaf)),
    getMostRecentLeaf: jest.fn(() => anchorLeaf),
    createLeafBySplit: jest.fn(() => bySplitLeaf),
    revealLeaf: jest.fn(async () => undefined),
  };

  return {
    app: { workspace } as unknown as App,
    workspace,
    rightSplit,
    leftSplit,
    rootSplit,
    rightLeaf,
    leftLeaf,
    tabLeaf,
    splitLeaf,
    anchorLeaf,
    bySplitLeaf,
  };
}

describe('ChatOpenLocationHelper', () => {
  describe('resolveChatOpenLocation', () => {
    it('accepts valid locations and falls back to right-sidebar for invalid or empty values', () => {
      expect(DEFAULT_CHAT_OPEN_LOCATION).toBe('right-sidebar');
      expect(resolveChatOpenLocation('right-sidebar')).toBe('right-sidebar');
      expect(resolveChatOpenLocation('right-split')).toBe('right-split');
      expect(resolveChatOpenLocation('tab')).toBe('tab');
      expect(resolveChatOpenLocation('left-sidebar')).toBe('left-sidebar');
      expect(resolveChatOpenLocation(undefined)).toBe('right-sidebar');
      expect(resolveChatOpenLocation(null)).toBe('right-sidebar');
      expect(resolveChatOpenLocation('unknown')).toBe('right-sidebar');
      expect(resolveChatOpenLocation('toString')).toBe('right-sidebar');
    });
  });

  describe('matchesChatOpenLocation', () => {
    it('matches leaves against their workspace root split and falls back to true when getRoot is absent', () => {
      const { workspace, rightSplit, leftSplit, rootSplit } = createMockWorkspace();
      const ws = workspace as unknown as Workspace;

      expect(matchesChatOpenLocation({} as WorkspaceLeaf, ws, 'right-sidebar')).toBe(true);
      expect(matchesChatOpenLocation(createMockLeaf(rightSplit) as unknown as WorkspaceLeaf, ws, 'right-sidebar')).toBe(true);
      expect(matchesChatOpenLocation(createMockLeaf(rootSplit) as unknown as WorkspaceLeaf, ws, 'right-sidebar')).toBe(false);
      expect(matchesChatOpenLocation(createMockLeaf(leftSplit) as unknown as WorkspaceLeaf, ws, 'left-sidebar')).toBe(true);
      expect(matchesChatOpenLocation(createMockLeaf(rightSplit) as unknown as WorkspaceLeaf, ws, 'left-sidebar')).toBe(false);
      expect(matchesChatOpenLocation(createMockLeaf(rootSplit) as unknown as WorkspaceLeaf, ws, 'right-split')).toBe(true);
      expect(matchesChatOpenLocation(createMockLeaf(rootSplit) as unknown as WorkspaceLeaf, ws, 'tab')).toBe(true);
      expect(matchesChatOpenLocation(createMockLeaf(rightSplit) as unknown as WorkspaceLeaf, ws, 'right-split')).toBe(false);
      expect(matchesChatOpenLocation(createMockLeaf(leftSplit) as unknown as WorkspaceLeaf, ws, 'tab')).toBe(false);
    });
  });

  describe('createChatLeafForLocation / openOrRevealChatLeaf', () => {
    it('opens a new leaf in the right sidebar by default', async () => {
      const { app, workspace, rightLeaf } = createMockWorkspace();

      const leaf = await openOrRevealChatLeaf(app, CHAT_VIEW_TYPE, 'right-sidebar');

      expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
      expect(rightLeaf?.setViewState).toHaveBeenCalledWith({ type: CHAT_VIEW_TYPE, active: true });
      expect(workspace.revealLeaf).toHaveBeenCalledWith(rightLeaf);
      expect(leaf).toBe(rightLeaf);
    });

    it('opens a new leaf in split-right using createLeafBySplit on rootSplit', async () => {
      const { app, workspace, rootSplit, anchorLeaf, bySplitLeaf } = createMockWorkspace();

      const leaf = await openOrRevealChatLeaf(app, CHAT_VIEW_TYPE, 'right-split');

      expect(workspace.getMostRecentLeaf).toHaveBeenCalledWith(rootSplit);
      expect(workspace.createLeafBySplit).toHaveBeenCalledWith(anchorLeaf, 'vertical');
      expect(bySplitLeaf?.setViewState).toHaveBeenCalledWith({ type: CHAT_VIEW_TYPE, active: true });
      expect(workspace.revealLeaf).toHaveBeenCalledWith(bySplitLeaf);
      expect(leaf).toBe(bySplitLeaf);
    });

    it('falls back to getLeaf("split", "vertical") when rootSplit has no anchor leaf', () => {
      const { workspace, splitLeaf } = createMockWorkspace({ anchorLeaf: null });

      const leaf = createChatLeafForLocation(workspace as unknown as Workspace, 'right-split');

      expect(workspace.createLeafBySplit).not.toHaveBeenCalled();
      expect(workspace.getLeaf).toHaveBeenCalledWith('split', 'vertical');
      expect(leaf).toBe(splitLeaf);
    });

    it('opens a new leaf in a new tab', async () => {
      const { app, workspace, tabLeaf } = createMockWorkspace();

      const leaf = await openOrRevealChatLeaf(app, CHAT_VIEW_TYPE, 'tab');

      expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
      expect(tabLeaf?.setViewState).toHaveBeenCalledWith({ type: CHAT_VIEW_TYPE, active: true });
      expect(workspace.revealLeaf).toHaveBeenCalledWith(tabLeaf);
      expect(leaf).toBe(tabLeaf);
    });

    it('opens a new leaf in the left sidebar', async () => {
      const { app, workspace, leftLeaf } = createMockWorkspace();

      const leaf = await openOrRevealChatLeaf(app, CHAT_VIEW_TYPE, 'left-sidebar');

      expect(workspace.getLeftLeaf).toHaveBeenCalledWith(false);
      expect(leftLeaf?.setViewState).toHaveBeenCalledWith({ type: CHAT_VIEW_TYPE, active: true });
      expect(workspace.revealLeaf).toHaveBeenCalledWith(leftLeaf);
      expect(leaf).toBe(leftLeaf);
    });

    it('reveals an existing leaf that already matches the requested location', async () => {
      const { app, workspace, rightSplit } = createMockWorkspace();
      const existing = createMockLeaf(rightSplit);
      workspace.getLeavesOfType.mockReturnValue([existing]);

      const leaf = await openOrRevealChatLeaf(app, CHAT_VIEW_TYPE, 'right-sidebar');

      expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
      expect(existing.detach).not.toHaveBeenCalled();
      expect(workspace.getRightLeaf).not.toHaveBeenCalled();
      expect(leaf).toBe(existing);
    });

    it('keeps an existing leaf in another dock when relocateExisting is false', async () => {
      const { app, workspace, rightSplit } = createMockWorkspace();
      const existing = createMockLeaf(rightSplit);
      workspace.getLeavesOfType.mockReturnValue([existing]);

      const leaf = await openOrRevealChatLeaf(app, CHAT_VIEW_TYPE, 'right-split', {
        relocateExisting: false,
      });

      expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
      expect(existing.detach).not.toHaveBeenCalled();
      expect(workspace.createLeafBySplit).not.toHaveBeenCalled();
      expect(leaf).toBe(existing);
    });

    it('relocates an existing right-sidebar leaf to right-split and preserves the active conversation', async () => {
      const order: string[] = [];
      const openConversationById = jest.fn(async (_id: string) => {
        order.push('openConversationById');
      });
      const getCurrentConversationId = jest.fn(() => {
        order.push('getCurrentConversationId');
        return 'conv-123';
      });

      const oldLeaf = createMockLeaf({ id: 'right-split' }, { getCurrentConversationId });
      oldLeaf.detach.mockImplementation(() => {
        order.push('detach');
      });

      const newLeaf = createMockLeaf({ id: 'root-split' }, {});
      newLeaf.setViewState.mockImplementation(async () => {
        order.push('setViewState');
        newLeaf.view.openConversationById = openConversationById;
      });

      const rightSplit = { id: 'right-split' };
      const leftSplit = { id: 'left-split' };
      const rootSplit = { id: 'root-split' };
      oldLeaf.root = rightSplit;
      oldLeaf.getRoot.mockReturnValue(rightSplit);

      const anchorLeaf = createMockLeaf(rootSplit);
      const workspace = {
        rightSplit,
        leftSplit,
        rootSplit,
        getLeavesOfType: jest.fn(() => [oldLeaf]),
        getRightLeaf: jest.fn(),
        getLeftLeaf: jest.fn(),
        getLeaf: jest.fn(),
        getMostRecentLeaf: jest.fn(() => anchorLeaf),
        createLeafBySplit: jest.fn(() => {
          order.push('createLeafBySplit');
          return newLeaf;
        }),
        revealLeaf: jest.fn(async () => {
          order.push('revealLeaf');
        }),
      };

      const leaf = await openOrRevealChatLeaf(
        { workspace } as unknown as App,
        CHAT_VIEW_TYPE,
        'right-split',
        { relocateExisting: true }
      );

      expect(leaf).toBe(newLeaf);
      expect(getCurrentConversationId).toHaveBeenCalledTimes(1);
      expect(workspace.getMostRecentLeaf).toHaveBeenCalledWith(rootSplit);
      expect(workspace.createLeafBySplit).toHaveBeenCalledWith(anchorLeaf, 'vertical');
      expect(oldLeaf.detach).toHaveBeenCalledTimes(1);
      expect(newLeaf.setViewState).toHaveBeenCalledWith({ type: CHAT_VIEW_TYPE, active: true });
      expect(workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
      expect(openConversationById).toHaveBeenCalledWith('conv-123');
      expect(order).toEqual([
        'getCurrentConversationId',
        'createLeafBySplit',
        'detach',
        'setViewState',
        'revealLeaf',
        'openConversationById',
      ]);
    });

    it('polls briefly for openConversationById if the relocated view attaches asynchronously', async () => {
      const openConversationById = jest.fn(async () => undefined);
      const rightSplit = { id: 'right-split' };
      const leftSplit = { id: 'left-split' };
      const rootSplit = { id: 'root-split' };
      const oldLeaf = createMockLeaf(rightSplit, {
        getCurrentConversationId: jest.fn(() => 'conv-delayed'),
      });
      const newLeaf = createMockLeaf(rootSplit, {});
      let pollCount = 0;
      const timeoutSpy = jest.spyOn(window, 'setTimeout').mockImplementation(((cb: () => void) => {
        pollCount += 1;
        if (pollCount === 2) {
          newLeaf.view.openConversationById = openConversationById;
        }
        cb();
        return 0;
      }) as unknown as typeof window.setTimeout);

      const workspace = {
        rightSplit,
        leftSplit,
        rootSplit,
        getLeavesOfType: jest.fn(() => [oldLeaf]),
        getRightLeaf: jest.fn(),
        getLeftLeaf: jest.fn(),
        getLeaf: jest.fn(),
        getMostRecentLeaf: jest.fn(() => createMockLeaf(rootSplit)),
        createLeafBySplit: jest.fn(() => newLeaf),
        revealLeaf: jest.fn(async () => undefined),
      };

      try {
        await openOrRevealChatLeaf(
          { workspace } as unknown as App,
          CHAT_VIEW_TYPE,
          'right-split',
          { relocateExisting: true }
        );
      } finally {
        timeoutSpy.mockRestore();
      }

      expect(pollCount).toBe(2);
      expect(openConversationById).toHaveBeenCalledWith('conv-delayed');
    });

    it('keeps and reveals the existing leaf when creating a replacement leaf returns null', async () => {
      const rightSplit = { id: 'right-split' };
      const leftSplit = { id: 'left-split' };
      const rootSplit = { id: 'root-split' };
      const existing = createMockLeaf(rightSplit);

      const workspace = {
        rightSplit,
        leftSplit,
        rootSplit,
        getLeavesOfType: jest.fn(() => [existing]),
        getRightLeaf: jest.fn(),
        getLeftLeaf: jest.fn(),
        getLeaf: jest.fn(() => null),
        getMostRecentLeaf: jest.fn(() => null),
        createLeafBySplit: jest.fn(() => null),
        revealLeaf: jest.fn(async () => undefined),
      };

      const leaf = await openOrRevealChatLeaf(
        { workspace } as unknown as App,
        CHAT_VIEW_TYPE,
        'tab',
        { relocateExisting: true }
      );

      expect(existing.detach).not.toHaveBeenCalled();
      expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
      expect(leaf).toBe(existing);
    });
  });
});
