/**
 * UIStateController - Manages all UI state transitions and visual feedback
 */

import { setIcon, Component } from 'obsidian';

export interface UIStateControllerEvents {
  onSidebarToggled: (visible: boolean) => void;
}

export class UIStateController {
  private sidebarVisible = false;
  private onOpenProviderSettings?: () => void;
  private onStarterTrigger?: (trigger: string) => void;

  constructor(
    private containerEl: HTMLElement,
    private events: UIStateControllerEvents,
    private component: Component
  ) {}

  private registerClickHandler(element: HTMLElement, handler: () => void): void {
    this.component.registerDomEvent(element, 'click', handler);
  }

  /**
   * Set the callback for the no-provider welcome button, which opens
   * Settings → Nexus → Providers (not the per-chat settings modal).
   */
  setOpenProviderSettingsCallback(callback: () => void): void {
    this.onOpenProviderSettings = callback;
  }

  /**
   * Set the callback invoked when a starter chip in the ready state is clicked.
   */
  setStarterTriggerCallback(callback: (trigger: string) => void): void {
    this.onStarterTrigger = callback;
  }

  /**
   * Get sidebar visibility state
   */
  getSidebarVisible(): boolean {
    return this.sidebarVisible;
  }

  /**
   * Show welcome state when no conversation is selected
   * @param hasConfiguredProviders - Whether any LLM providers are set up
   */
  showWelcomeState(hasConfiguredProviders = true): void {
    const messageDisplay = this.containerEl.querySelector('.message-display-container');
    if (!messageDisplay) return;

    (messageDisplay as HTMLElement).empty();
    messageDisplay.addClass('message-display');

    const welcome = (messageDisplay as HTMLElement).createDiv('chat-welcome');

    if (hasConfiguredProviders) {
      // Zero-friction ready state: composer is unlocked and starter chips insert triggers
      welcome.addClass('chat-ready-state');
      const hero = welcome.createDiv('chat-ready-hero');

      hero.createDiv({
        text: 'Ready to chat',
        cls: 'chat-welcome-title chat-ready-title'
      });

      hero.createEl('p', {
        text: 'Type a message below to start a new conversation, or pick a shortcut:',
        cls: 'chat-welcome-desc chat-ready-subtitle'
      });

      const starterList = hero.createDiv('chat-starter-list');
      const starters = [
        { trigger: '[[', label: 'Reference a note' },
        { trigger: '/', label: 'Select a tool' },
        { trigger: '@', label: 'Select an agent' }
      ];

      starters.forEach((starter) => {
        const chip = starterList.createEl('button', {
          cls: 'clickable-icon chat-starter-chip',
          attr: {
            type: 'button',
            'aria-label': starter.label
          }
        });
        chip.createSpan({ cls: 'chat-starter-kbd', text: starter.trigger });
        chip.createSpan({ text: starter.label });
        this.registerClickHandler(chip, () => {
          this.onStarterTrigger?.(starter.trigger);
        });
      });
    } else {
      const welcomeContent = welcome.createDiv('chat-welcome-content');
      const welcomeIcon = welcomeContent.createDiv('chat-welcome-icon');
      // Setup needed - no providers configured
      setIcon(welcomeIcon, 'settings');

      welcomeContent.createEl('p', {
        text: 'Configure a provider to start chatting.',
        cls: 'chat-welcome-hint'
      });

      const settingsBtn = welcomeContent.createEl('button', {
        cls: 'chat-welcome-button',
        text: 'Open settings'
      });
      const settingsBtnIcon = settingsBtn.createSpan({ cls: 'chat-welcome-button-icon' });
      setIcon(settingsBtnIcon, 'settings');
      settingsBtn.insertBefore(settingsBtnIcon, settingsBtn.firstChild);
      const settingsHandler = () => {
        this.onOpenProviderSettings?.();
      };
      this.registerClickHandler(settingsBtn, settingsHandler);
    }
  }

  /**
   * Show chat state when conversation is selected
   */
  showChatState(): void {
    // Chat state is handled by MessageDisplay component
    // This method exists for state management consistency
  }

  /**
   * Toggle conversation list visibility
   */
  toggleConversationList(): void {
    const sidebar = this.containerEl.querySelector('.chat-sidebar');
    const backdrop = this.containerEl.querySelector('.chat-backdrop');
    if (!sidebar || !backdrop) return;
    
    this.sidebarVisible = !this.sidebarVisible;
    
    if (this.sidebarVisible) {
      sidebar.removeClass('chat-sidebar-hidden');
      sidebar.addClass('chat-sidebar-visible');
      backdrop.addClass('chat-backdrop-visible');
    } else {
      sidebar.removeClass('chat-sidebar-visible');
      sidebar.addClass('chat-sidebar-hidden');
      backdrop.removeClass('chat-backdrop-visible');
    }

    this.events.onSidebarToggled(this.sidebarVisible);
  }

  /**
   * Show an error until the user dismisses it or starts another turn. It used to
   * vanish after five seconds, too soon to read a provider's quota message on a
   * phone (#429). Only the latest error is kept.
   */
  showError(message: string): void {
    const container = this.containerEl.querySelector<HTMLElement>('.message-display-container');
    if (!container) return;

    this.clearError();
    const errorEl = container.createDiv({ cls: 'chat-error', attr: { role: 'alert' } });
    errorEl.createSpan({ cls: 'chat-error-text', text: message });
    const dismiss = errorEl.createEl('button', {
      cls: 'chat-error-dismiss clickable-icon',
      attr: { 'aria-label': 'Dismiss error', type: 'button' }
    });
    setIcon(dismiss, 'x');
    this.registerClickHandler(dismiss, () => errorEl.remove());
  }

  /** Remove any error shown by showError. */
  clearError(): void {
    this.containerEl.querySelectorAll('.chat-error').forEach(el => el.remove());
  }

  /**
   * Set loading state on chat input
   * Note: ChatInput component now manages its own loading state and stop button
   * This method is kept for backward compatibility but does nothing
   */
  setInputLoading(_loading: boolean): void {
    // ChatInput component handles its own state now
    // No-op to avoid conflicts with ChatInput's updateUI()
  }

  /**
   * Set input placeholder text
   */
  setInputPlaceholder(placeholder: string): void {
    const textarea = this.containerEl.querySelector<HTMLElement>('.chat-textarea');
    if (textarea) {
      textarea.setAttribute('data-placeholder', placeholder);
    }
  }

  /**
   * Initialize UI event listeners
   */
  initializeEventListeners(): void {
    // Hamburger menu button
    const hamburgerButton = this.containerEl.querySelector('.chat-hamburger-button');
    if (hamburgerButton) {
      const hamburgerHandler = () => this.toggleConversationList();
      this.registerClickHandler(hamburgerButton as HTMLElement, hamburgerHandler);
    }

    // Backdrop click to close sidebar
    const backdrop = this.containerEl.querySelector('.chat-backdrop');
    if (backdrop) {
      const backdropHandler = () => {
        if (this.sidebarVisible) {
          this.toggleConversationList();
        }
      };
      this.registerClickHandler(backdrop as HTMLElement, backdropHandler);
    }
  }

  cleanup(): void {
    // Event listeners are cleaned up via component.registerDomEvent on Component teardown.
  }
}
