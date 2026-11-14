/**
 * SavePromptModal - Asks whether to save a read-aloud rendering to the note.
 *
 * Shown when the user invokes "Read aloud". Offers three outcomes:
 *   - 'save'  → [Save & read]  : play AND save the audio + insert the embed
 *   - 'read'  → [Just read]    : play only, nothing saved
 *   - 'cancel'→ [Cancel] / dismiss : do nothing
 */

import { App, ButtonComponent, Modal } from 'obsidian';

export type SavePromptChoice = 'save' | 'read' | 'cancel';

export class SavePromptModal extends Modal {
  private choice: SavePromptChoice = 'cancel';

  constructor(app: App, private onChoose: (choice: SavePromptChoice) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('read-aloud-save-prompt');

    contentEl.createEl('h2', { text: 'Read aloud' });
    contentEl.createEl('p', { text: 'Save this read-aloud to the note?' });

    const buttonContainer = contentEl.createDiv('modal-button-container');
    buttonContainer.addClass('modal-button-container-flex');

    new ButtonComponent(buttonContainer)
      .setButtonText('Cancel')
      .setClass('mod-cancel')
      .onClick(() => {
        this.choice = 'cancel';
        this.close();
      });

    new ButtonComponent(buttonContainer)
      .setButtonText('Just read')
      .onClick(() => {
        this.choice = 'read';
        this.close();
      });

    const saveReadBtn = new ButtonComponent(buttonContainer)
      .setButtonText('Save & read')
      .setCta()
      .onClick(() => {
        this.choice = 'save';
        this.close();
      });

    window.setTimeout(() => {
      saveReadBtn.buttonEl.focus();
    }, 0);
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.onChoose(this.choice);
  }
}
