/**
 * ChatLayoutBuilder - Builds the chat interface DOM structure
 * Location: /src/ui/chat/builders/ChatLayoutBuilder.ts
 *
 * This class is responsible for:
 * - Creating the main chat layout structure
 * - Building header with thread switcher, rename, voice, new chat, and settings buttons
 * - Creating message display and unified composer dock containers
 * - Building sidebar with conversation list
 *
 * Used by ChatView to build the initial DOM structure,
 * following the Builder pattern for complex UI construction.
 */

import { Component, setIcon } from 'obsidian';

export interface ChatLayoutElements {
  messageContainer: HTMLElement;
  inputContainer: HTMLElement;
  toolStatusBarContainer: HTMLElement;
  conversationListContainer: HTMLElement;
  newChatButton: HTMLElement;
  settingsButton: HTMLElement;
  liveVoiceButton: HTMLElement;
  chatTitle: HTMLElement;
  hamburgerButton: HTMLElement;
  renameButton: HTMLElement;
  topNewChatButton: HTMLElement;
  composerDock: HTMLElement;
  backdrop: HTMLElement;
  sidebarContainer: HTMLElement;
  loadingOverlay: HTMLElement;
  branchHeaderContainer: HTMLElement;
  searchInput: HTMLInputElement;
}

export class ChatLayoutBuilder {
  /**
   * Build the complete chat interface layout
   */
  static buildLayout(container: HTMLElement, _component?: Component): ChatLayoutElements {
    container.empty();
    container.addClass('chat-view-container');

    // Create main layout structure
    const chatLayout = container.createDiv('chat-layout');
    const mainContainer = chatLayout.createDiv('chat-main');

    // Header
    const {
      chatTitle,
      hamburgerButton,
      renameButton,
      liveVoiceButton,
      topNewChatButton,
      settingsButton
    } = this.createHeader(mainContainer);

    // Branch header container (above messages, separate from message container)
    // This ensures BranchHeader isn't clobbered when MessageDisplay.setConversation() empties the message container
    const branchHeaderContainer = mainContainer.createDiv('nexus-branch-header-container');

    // Main content areas
    const messageContainer = mainContainer.createDiv('message-display-container');
    const composerDock = mainContainer.createDiv('chat-composer-dock');
    const toolStatusBarContainer = composerDock.createDiv('tool-status-bar-container');
    const inputContainer = composerDock.createDiv('chat-input-container');

    // Nexus model loading overlay (hidden by default)
    const loadingOverlay = this.createLoadingOverlay(mainContainer);

    // Backdrop and sidebar
    const backdrop = chatLayout.createDiv('chat-backdrop');
    const { sidebarContainer, conversationListContainer, newChatButton, searchInput } = this.createSidebar(chatLayout);

    return {
      messageContainer,
      inputContainer,
      toolStatusBarContainer,
      conversationListContainer,
      newChatButton,
      settingsButton,
      liveVoiceButton,
      chatTitle,
      hamburgerButton,
      renameButton,
      topNewChatButton,
      composerDock,
      backdrop,
      sidebarContainer,
      loadingOverlay,
      branchHeaderContainer,
      searchInput
    };
  }

  /**
   * Create Nexus model loading overlay (hidden by default)
   */
  private static createLoadingOverlay(container: HTMLElement): HTMLElement {
    const overlay = container.createDiv('nexus-loading-overlay');
    overlay.addClass('chat-loading-overlay-hidden');

    const content = overlay.createDiv('nexus-loading-content');

    // Animated spinner - using createSvg for safe SVG creation
    const spinner = content.createDiv('nexus-loading-spinner');
    const svg = spinner.createSvg('svg', { attr: { viewBox: '0 0 50 50', class: 'nexus-spinner' } });
    const circle = svg.createSvg('circle', {
      attr: { cx: '25', cy: '25', r: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '4', 'stroke-linecap': 'round' }
    });
    // Add animations via DOM
    circle.createSvg('animate', {
      attr: { attributeName: 'stroke-dasharray', values: '1,150;90,150;90,150', dur: '1.5s', repeatCount: 'indefinite' }
    });
    circle.createSvg('animate', {
      attr: { attributeName: 'stroke-dashoffset', values: '0;-35;-125', dur: '1.5s', repeatCount: 'indefinite' }
    });

    // Status text
    const statusText = content.createDiv('nexus-loading-status');
    statusText.textContent = 'Loading model...';
    statusText.dataset.statusEl = 'true';

    // Progress bar
    const progressContainer = content.createDiv('nexus-loading-progress-container');
    const progressBar = progressContainer.createDiv('nexus-loading-progress-bar');
    progressBar.addClass('chat-progress-bar-reset');
    progressBar.dataset.progressEl = 'true';

    // Progress text
    const progressText = content.createDiv('nexus-loading-progress-text');
    progressText.textContent = '0%';
    progressText.dataset.progressTextEl = 'true';

    return overlay;
  }

  /**
   * Create chat header with thread switcher, rename, voice, new chat, and settings
   */
  private static createHeader(container: HTMLElement): {
    chatTitle: HTMLElement;
    hamburgerButton: HTMLElement;
    renameButton: HTMLElement;
    liveVoiceButton: HTMLElement;
    topNewChatButton: HTMLElement;
    settingsButton: HTMLElement;
  } {
    const chatHeader = container.createDiv('chat-header chat-topbar');
    const topbarLeft = chatHeader.createDiv('chat-topbar-left');

    const hamburgerButton = topbarLeft.createEl('button', {
      cls: 'chat-hamburger-button chat-thread-switcher clickable-icon',
      attr: {
        type: 'button',
        'aria-label': 'Toggle conversations',
        title: 'Toggle conversations'
      }
    });
    const switcherIcon = hamburgerButton.createSpan({ cls: 'chat-thread-switcher-icon' });
    setIcon(switcherIcon, 'panel-left');

    const chatTitle = hamburgerButton.createSpan({ cls: 'chat-title', text: 'New conversation' });

    const chevronIcon = hamburgerButton.createSpan({ cls: 'chat-thread-chevron' });
    setIcon(chevronIcon, 'chevron-down');

    const renameButton = topbarLeft.createEl('button', {
      cls: 'chat-rename-button clickable-icon is-hidden',
      attr: {
        type: 'button',
        'aria-label': 'Rename conversation',
        title: 'Rename conversation'
      }
    });
    setIcon(renameButton, 'pencil');

    const topbarActions = chatHeader.createDiv('chat-topbar-actions');

    const liveVoiceButton = topbarActions.createEl('button', {
      cls: 'chat-live-voice-button clickable-icon',
      attr: {
        type: 'button',
        'aria-label': 'Start live voice',
        title: 'Start live voice'
      }
    });
    setIcon(liveVoiceButton, 'audio-waveform');

    const topNewChatButton = topbarActions.createEl('button', {
      cls: 'chat-topbar-new-button clickable-icon',
      attr: {
        type: 'button',
        'aria-label': 'New conversation',
        title: 'New conversation'
      }
    });
    setIcon(topNewChatButton, 'square-pen');

    const settingsButton = topbarActions.createEl('button', {
      cls: 'chat-settings-button clickable-icon',
      attr: {
        type: 'button',
        'aria-label': 'Chat settings',
        title: 'Chat settings'
      }
    });
    setIcon(settingsButton, 'sliders-horizontal');

    return {
      chatTitle,
      hamburgerButton,
      renameButton,
      liveVoiceButton,
      topNewChatButton,
      settingsButton
    };
  }

  /**
   * Create sidebar with conversation list and search input
   */
  private static createSidebar(container: HTMLElement): {
    sidebarContainer: HTMLElement;
    conversationListContainer: HTMLElement;
    newChatButton: HTMLElement;
    searchInput: HTMLInputElement;
  } {
    const sidebarContainer = container.createDiv('chat-sidebar');
    sidebarContainer.addClass('chat-sidebar-hidden');

    const sidebarHeader = sidebarContainer.createDiv('chat-sidebar-header');
    sidebarHeader.createEl('h3', { text: 'Conversations' });
    const newChatButton = sidebarHeader.createEl('button', {
      cls: 'chat-new-button clickable-icon',
      text: 'New chat',
      attr: { type: 'button' }
    });

    // Search input between header and list
    const searchContainer = sidebarContainer.createDiv('conversation-search-container');
    const searchInput = searchContainer.createEl('input', {
      cls: 'conversation-search-input',
      attr: {
        type: 'text',
        placeholder: 'Search by title...',
        'aria-label': 'Search conversations by title',
      }
    });

    const conversationListContainer = sidebarContainer.createDiv('conversation-list-container');

    return { sidebarContainer, conversationListContainer, newChatButton, searchInput };
  }
}
