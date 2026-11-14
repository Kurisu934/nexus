import type { App, Workspace, WorkspaceLeaf } from 'obsidian';
import type { ChatOpenLocation } from '../../types/plugin/PluginTypes';

export const DEFAULT_CHAT_OPEN_LOCATION: ChatOpenLocation = 'right-sidebar';

const VALID_CHAT_OPEN_LOCATIONS: Record<ChatOpenLocation, true> = {
  'right-sidebar': true,
  'right-split': true,
  tab: true,
  'left-sidebar': true,
};

interface ChatViewRelocationTarget {
  getCurrentConversationId?: () => string | null;
  openConversationById?: (conversationId: string) => Promise<void>;
}

export function resolveChatOpenLocation(value?: string | null): ChatOpenLocation {
  if (value && Object.prototype.hasOwnProperty.call(VALID_CHAT_OPEN_LOCATIONS, value)) {
    return value as ChatOpenLocation;
  }
  return DEFAULT_CHAT_OPEN_LOCATION;
}

export function matchesChatOpenLocation(
  leaf: WorkspaceLeaf,
  workspace: Workspace,
  location: ChatOpenLocation
): boolean {
  const root = typeof leaf.getRoot === 'function' ? leaf.getRoot() : null;
  if (!root) {
    return true;
  }
  if (location === 'right-sidebar') {
    return root === workspace.rightSplit;
  }
  if (location === 'left-sidebar') {
    return root === workspace.leftSplit;
  }
  return root !== workspace.rightSplit && root !== workspace.leftSplit;
}

export function createChatLeafForLocation(
  workspace: Workspace,
  location: ChatOpenLocation
): WorkspaceLeaf | null {
  switch (location) {
    case 'right-sidebar':
      return workspace.getRightLeaf(false);
    case 'left-sidebar':
      return workspace.getLeftLeaf(false);
    case 'tab':
      return workspace.getLeaf('tab');
    case 'right-split': {
      const anchor =
        typeof workspace.getMostRecentLeaf === 'function' && workspace.rootSplit
          ? workspace.getMostRecentLeaf(workspace.rootSplit)
          : null;
      if (anchor && typeof workspace.createLeafBySplit === 'function') {
        return workspace.createLeafBySplit(anchor, 'vertical');
      }
      return workspace.getLeaf('split', 'vertical');
    }
  }
}

export async function openOrRevealChatLeaf(
  app: App,
  chatViewType: string,
  requestedLocation?: ChatOpenLocation | null,
  options?: { relocateExisting?: boolean }
): Promise<WorkspaceLeaf | null> {
  const location = resolveChatOpenLocation(requestedLocation);
  const { workspace } = app;
  const leaves = workspace.getLeavesOfType(chatViewType);

  const matchingLeaf = leaves.find(leaf => matchesChatOpenLocation(leaf, workspace, location));
  if (matchingLeaf) {
    await workspace.revealLeaf(matchingLeaf);
    return matchingLeaf;
  }

  if (leaves.length > 0 && options?.relocateExisting === false) {
    await workspace.revealLeaf(leaves[0]);
    return leaves[0];
  }

  if (leaves.length > 0) {
    const existingLeaf = leaves[0];
    if (existingLeaf.isDeferred && typeof existingLeaf.loadIfDeferred === 'function') {
      try {
        await existingLeaf.loadIfDeferred();
      } catch {
        // Proceed with best-effort view inspection
      }
    }

    const prevConvId =
      (existingLeaf.view as ChatViewRelocationTarget | undefined)?.getCurrentConversationId?.() ?? null;

    const newLeaf = createChatLeafForLocation(workspace, location);
    if (!newLeaf) {
      await workspace.revealLeaf(existingLeaf);
      return existingLeaf;
    }

    if (newLeaf !== existingLeaf && typeof existingLeaf.detach === 'function') {
      existingLeaf.detach();
    }

    await newLeaf.setViewState({
      type: chatViewType,
      active: true,
    });
    await workspace.revealLeaf(newLeaf);

    if (prevConvId) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const view = newLeaf.view as ChatViewRelocationTarget | undefined;
        if (typeof view?.openConversationById === 'function') {
          try {
            await view.openConversationById(prevConvId);
          } catch {
            // Ignore best-effort conversation restore failure
          }
          break;
        }
        await new Promise<void>(resolve => window.setTimeout(resolve, 25));
      }
    }

    return newLeaf;
  }

  const newLeaf = createChatLeafForLocation(workspace, location);
  if (!newLeaf) {
    return null;
  }

  await newLeaf.setViewState({
    type: chatViewType,
    active: true,
  });
  await workspace.revealLeaf(newLeaf);
  return newLeaf;
}
