/**
 * ConversationManager - Handles all conversation CRUD operations
 * with pagination and search state management
 */

import { App } from 'obsidian';
import { ChatService } from '../../../services/chat/ChatService';
import { ConversationData } from '../../../types/chat/ChatTypes';
import type { PaginatedResult } from '../../../types/pagination/PaginationTypes';
import { BranchManager } from './BranchManager';
import { ConversationTitleModal } from '../components/ConversationTitleModal';

export interface ConversationManagerEvents {
  onConversationSelected: (conversation: ConversationData) => void;
  onConversationsChanged: () => void;
  onError: (message: string) => void;
}

/** Default number of conversations per page */
const PAGE_SIZE = 20;

export const DEFAULT_NEW_CONVERSATION_TITLE = 'New chat';

/**
 * Derive a clean single-line conversation title from a user message.
 */
export function deriveConversationTitleFromMessage(message: string): string {
  const clean = message
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[#>`\s]+/, '')
    .trim();

  if (!clean) {
    return DEFAULT_NEW_CONVERSATION_TITLE;
  }

  return clean.length > 50 ? clean.substring(0, 47) + '...' : clean;
}

export class ConversationManager {
  private currentConversation: ConversationData | null = null;
  private conversations: ConversationData[] = [];
  private autoTitledConversationIds = new Set<string>();
  // Pagination state
  private currentPage = 0;
  private _hasMore = false;
  private _isLoading = false;
  private _isSearchActive = false;

  // Race condition guard: incremented on every new load/search request.
  // Stale responses (whose captured generation doesn't match) are discarded.
  private generation = 0;

  constructor(
    private app: App,
    private chatService: ChatService,
    private branchManager: BranchManager,
    private events: ConversationManagerEvents
  ) {}

  /** Whether more conversations can be loaded */
  get hasMore(): boolean {
    return this._hasMore;
  }

  /** Whether a load or search is in progress */
  get isLoading(): boolean {
    return this._isLoading;
  }

  /** Whether the list is showing search results */
  get isSearchActive(): boolean {
    return this._isSearchActive;
  }

  /**
   * Get current conversation
   */
  getCurrentConversation(): ConversationData | null {
    return this.currentConversation;
  }

  /**
   * Get all conversations
   */
  getConversations(): ConversationData[] {
    return this.conversations;
  }

  /**
   * Load conversations from the chat service (page 0, resets state)
   */
  async loadConversations(): Promise<void> {
    const gen = ++this.generation;
    this._isLoading = true;
    this._isSearchActive = false;
    this.currentPage = 0;

    try {
      const result = await this.chatService.listConversations({
        limit: PAGE_SIZE,
        page: 0
      });

      // Discard stale response
      if (gen !== this.generation) return;

      this.applyPaginatedResult(result, false);
      this._isLoading = false;
      this.events.onConversationsChanged();

      // Auto-select the most recent conversation
      if (this.conversations.length > 0 && !this.currentConversation) {
        await this.selectConversation(this.conversations[0]);
      }
    } catch {
      if (gen !== this.generation) return;
      this._isLoading = false;
      this.events.onError('Failed to load conversations');
    } finally {
      if (gen === this.generation) {
        this._isLoading = false;
      }
    }
  }

  /**
   * Load next page of conversations, appending to existing list
   */
  async loadMoreConversations(): Promise<void> {
    if (this._isLoading || !this._hasMore || this._isSearchActive) return;

    const gen = ++this.generation;
    this._isLoading = true;
    const nextPage = this.currentPage + 1;

    try {
      const result = await this.chatService.listConversations({
        limit: PAGE_SIZE,
        page: nextPage
      });

      // Discard stale response
      if (gen !== this.generation) return;

      this.applyPaginatedResult(result, true);
      this.currentPage = nextPage;
      this._isLoading = false;
      this.events.onConversationsChanged();
    } catch {
      if (gen !== this.generation) return;
      this._isLoading = false;
      this.events.onError('Failed to load more conversations');
    } finally {
      if (gen === this.generation) {
        this._isLoading = false;
      }
    }
  }

  /**
   * Search conversations by title (FTS). Replaces the paginated list.
   */
  async searchConversations(query: string): Promise<void> {
    if (!query.trim()) {
      await this.clearSearch();
      return;
    }

    const gen = ++this.generation;
    this._isLoading = true;
    this._isSearchActive = true;
    this._hasMore = false;

    try {
      const results = await this.chatService.searchConversations(query);

      // Discard stale response
      if (gen !== this.generation) return;

      // searchConversations returns ConversationListItem[] — map to ConversationData
      this.conversations = results.map(item => ({
        id: item.id,
        title: item.title,
        messages: [],
        created: item.created,
        updated: item.lastUpdated,
      }));

      this._isLoading = false;
      this.events.onConversationsChanged();
    } catch {
      if (gen !== this.generation) return;
      this._isLoading = false;
      this.events.onError('Failed to search conversations');
    } finally {
      if (gen === this.generation) {
        this._isLoading = false;
      }
    }
  }

  /**
   * Clear search and return to paginated browse at page 0
   */
  async clearSearch(): Promise<void> {
    if (!this._isSearchActive) return;
    this._isSearchActive = false;
    await this.loadConversations();
  }

  /**
   * Apply a PaginatedResult, replacing or appending to the conversation list
   */
  private applyPaginatedResult(
    result: PaginatedResult<ConversationData>,
    append: boolean
  ): void {
    if (append) {
      this.conversations = [...this.conversations, ...result.items];
    } else {
      this.conversations = result.items;
    }
    this._hasMore = result.hasNextPage;
  }

  /**
   * Select and display a conversation
   */
  async selectConversation(conversation: ConversationData): Promise<void> {
    try {
      this.currentConversation = conversation;

      // Load full conversation data
      const fullConversation = await this.chatService.getConversation(conversation.id);

      if (fullConversation) {
        this.currentConversation = fullConversation;
        this.events.onConversationSelected(fullConversation);
      }
    } catch {
      this.events.onError('Failed to load conversation');
    }
  }

  /**
   * Create a new conversation
   */
  async createNewConversation(title?: string): Promise<void> {
    try {
      const trimmedTitle = title?.trim();
      const isAutoTitled = !trimmedTitle;
      const conversationTitle = trimmedTitle || DEFAULT_NEW_CONVERSATION_TITLE;

      const result = await this.chatService.createConversation(conversationTitle);

      if (result.success && result.conversationId) {
        if (isAutoTitled) {
          this.autoTitledConversationIds.add(result.conversationId);
        } else {
          this.autoTitledConversationIds.delete(result.conversationId);
        }

        // Reload conversations and select the new one
        await this.loadConversations();
        const newConversation = await this.chatService.getConversation(result.conversationId);
        if (newConversation) {
          await this.selectConversation(newConversation);
        }
      } else {
        this.events.onError(result.error || 'Failed to create conversation');
      }
    } catch {
      this.events.onError('Failed to create conversation');
    }
  }

  /**
   * Create new conversation with initial message
   */
  async createNewConversationWithMessage(
    message: string,
    options?: {
      provider?: string;
      model?: string;
      systemPrompt?: string;
      workspaceId?: string;
      sessionId?: string;
    }
  ): Promise<void> {
    const title = deriveConversationTitleFromMessage(message);

    try {
      const result = await this.chatService.createConversation(
        title,
        message,
        {
          ...options,
          workspaceId: options?.workspaceId
        }
      );

      if (result.success && result.conversationId && result.sessionId) {
        // Reload conversations and select the new one
        await this.loadConversations();
        const newConversation = await this.chatService.getConversation(result.conversationId);

        if (newConversation) {
          await this.selectConversation(newConversation);
        }
      } else if (result.success && result.conversationId) {
        // Fallback for conversations without session ID (shouldn't happen with new code)
        await this.loadConversations();
        const newConversation = await this.chatService.getConversation(result.conversationId);
        if (newConversation) {
          await this.selectConversation(newConversation);
        }
      } else {
        this.events.onError(result.error || 'Failed to create conversation');
      }
    } catch {
      this.events.onError('Failed to create conversation');
    }
  }

  /**
   * Delete a conversation (optimistic removal from local list)
   */
  async deleteConversation(conversationId: string): Promise<void> {
    try {
      const success = await this.chatService.deleteConversation(conversationId);

      if (success) {
        this.autoTitledConversationIds.delete(conversationId);

        // If this was the current conversation, clear it
        if (this.currentConversation?.id === conversationId) {
          this.currentConversation = null;
        }

        // Optimistic removal from local list
        this.conversations = this.conversations.filter(c => c.id !== conversationId);
        this.events.onConversationsChanged();
      } else {
        this.events.onError('Failed to delete conversation');
      }
    } catch {
      this.events.onError('Failed to delete conversation');
    }
  }

  /**
   * Rename a conversation
   */
  async renameConversation(conversationId: string, newTitle: string): Promise<void> {
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) {
      return;
    }

    this.autoTitledConversationIds.delete(conversationId);

    try {
      const success = await this.chatService.updateConversationTitle(conversationId, trimmedTitle);

      if (success) {
        // Update current conversation title if this is the active one
        if (this.currentConversation?.id === conversationId) {
          this.currentConversation.title = trimmedTitle;
        }

        // Update title in the local conversations list
        const conversation = this.conversations.find(c => c.id === conversationId);
        if (conversation) {
          conversation.title = trimmedTitle;
        }

        // Notify UI of the change
        this.events.onConversationsChanged();
      } else {
        this.events.onError('Failed to rename conversation');
      }
    } catch {
      this.events.onError('Failed to rename conversation');
    }
  }

  /**
   * Auto-title an empty default-titled conversation from its first user message.
   */
  async autoTitleConversationFromFirstMessage(conversationId: string, message: string): Promise<void> {
    const isCurrentEmptyDefault =
      this.currentConversation?.id === conversationId &&
      this.currentConversation.messages.length === 0 &&
      this.currentConversation.title === DEFAULT_NEW_CONVERSATION_TITLE;

    if (!this.autoTitledConversationIds.has(conversationId) && !isCurrentEmptyDefault) {
      return;
    }

    this.autoTitledConversationIds.delete(conversationId);

    const derived = deriveConversationTitleFromMessage(message);
    const existingTitle = this.currentConversation?.id === conversationId
      ? this.currentConversation.title
      : this.conversations.find(c => c.id === conversationId)?.title;

    if (derived !== existingTitle) {
      await this.renameConversation(conversationId, derived);
    }
  }

  /**
   * Open rename modal for a specific conversation (or the current active one).
   */
  async promptRenameConversation(conversationId?: string): Promise<void> {
    const target = conversationId
      ? (this.conversations.find(c => c.id === conversationId) ??
        (this.currentConversation?.id === conversationId ? this.currentConversation : null))
      : this.currentConversation;

    if (!target) {
      return;
    }

    const submittedTitle = await this.promptForRenameTitle(target.title);
    if (submittedTitle && submittedTitle !== target.title) {
      await this.renameConversation(target.id, submittedTitle);
    }
  }

  /**
   * Update current conversation data
   */
  updateCurrentConversation(conversation: ConversationData): void {
    this.currentConversation = conversation;
  }

  /**
   * Set current conversation directly (no events fired)
   * Used when navigating to branches - the branch IS a conversation
   * but we don't want to fire selection events that would update the list
   */
  setCurrentConversation(conversation: ConversationData | null): void {
    this.currentConversation = conversation;
  }

  /**
   * Prompt user to rename a conversation using Obsidian's Modal
   */
  private promptForRenameTitle(initialTitle: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new ConversationTitleModal(
        this.app,
        (title) => {
          resolve(title);
        },
        {
          initialTitle,
          mode: 'rename'
        }
      );
      modal.open();
    });
  }
}
