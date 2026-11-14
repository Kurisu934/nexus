/**
 * ConversationTitleModal - Modal for creating or renaming a conversation
 *
 * Properly extends Obsidian's Modal class for proper focus management
 */

import { App, Component, Modal, Setting } from 'obsidian';

export class ConversationTitleModal extends Modal {
  private result: string | null = null;
  private submitted = false;
  private inputEl: HTMLInputElement | null = null;
  private modalEvents: Component | null = null;

  constructor(
    app: App,
    private onSubmit: (title: string | null) => void,
    private options?: { initialTitle?: string; mode?: 'create' | 'rename' }
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEvents = new Component();
    this.modalEvents.load();
    const isRename = this.options?.mode === 'rename' || this.options?.initialTitle !== undefined;
    const initialTitle = this.options?.initialTitle ?? '';
    this.result = initialTitle || null;
    this.submitted = false;

    const { contentEl } = this;
    contentEl.addClass('chat-conversation-title-modal');

    contentEl.createEl('h2', { text: isRename ? 'Rename conversation' : 'New conversation' });
    contentEl.createEl('p', {
      text: isRename
        ? 'Enter a new title for this conversation:'
        : 'Enter a title for your new conversation:'
    });

    new Setting(contentEl)
      .setName('Conversation title')
      .addText((text) => {
        this.inputEl = text.inputEl;

        text.setPlaceholder('Chat title');
        if (initialTitle) {
          text.setValue(initialTitle);
        }
        text.onChange((value) => {
          this.result = value;
        });

        this.modalEvents?.registerDomEvent(text.inputEl, 'keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            this.submit();
          }
        });
      });

    // Action buttons
    const buttonContainer = contentEl.createDiv('modal-button-container');
    buttonContainer.addClass('modal-button-container-flex');

    const cancelBtn = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'mod-cancel'
    });
    this.modalEvents.registerDomEvent(cancelBtn, 'click', () => this.close());

    const submitBtn = buttonContainer.createEl('button', {
      text: isRename ? 'Save' : 'Create',
      cls: 'mod-cta'
    });
    this.modalEvents.registerDomEvent(submitBtn, 'click', () => this.submit());

    // Focus the input after modal is fully rendered
    window.setTimeout(() => {
      if (typeof this.inputEl?.focus === 'function') {
        this.inputEl.focus();
      }
      if (isRename && typeof this.inputEl?.select === 'function') {
        this.inputEl.select();
      }
    }, 0);
  }

  private submit() {
    const title = this.result?.trim();
    if (!title) {
      // Show error state on input
      if (this.inputEl) {
        this.inputEl.addClass('is-invalid');
        if (typeof this.inputEl.focus === 'function') {
          this.inputEl.focus();
        }
        window.setTimeout(() => {
          this.inputEl?.removeClass('is-invalid');
        }, 2000);
      }
      return;
    }

    this.submitted = true;
    this.close();
  }

  onClose(): void {
    // Release focus from modal elements before cleanup
    if (typeof this.inputEl?.blur === 'function') {
      this.inputEl.blur();
    }

    const { contentEl } = this;
    contentEl.empty();
    this.modalEvents?.unload();
    this.modalEvents = null;

    // Call the callback with result (or null if cancelled)
    if (this.submitted && this.result?.trim()) {
      this.onSubmit(this.result.trim());
    } else {
      this.onSubmit(null);
    }

    // Restore focus to workspace so cursor is not trapped
    if (typeof window.activeDocument?.body?.focus === 'function') {
      window.activeDocument.body.focus();
    }
  }
}
