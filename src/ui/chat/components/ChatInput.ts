/**
 * ChatInput - Message input component with send functionality
 *
 * Provides text input, send button, and model selection
 */

import { setIcon, App, Component, Notice } from 'obsidian';
import { initializeSuggesters, SuggesterInstances } from './suggesters/initializeSuggesters';
import { ContentEditableHelper } from '../utils/ContentEditableHelper';
import { ReferenceExtractor, ReferenceMetadata } from '../utils/ReferenceExtractor';
import { MessageEnhancement } from './suggesters/base/SuggesterInterfaces';
import { MessageEnhancer } from '../services/MessageEnhancer';
import { isMobile } from '../../../utils/platform';
import { ChatVoiceInputController, ChatVoiceInputState } from '../controllers/ChatVoiceInputController';
import type { LiveVoiceComposerState } from '../types/LiveVoiceTypes';
import type { LLMProviderSettings } from '../../../types/llm/ProviderTypes';
import type { ActiveEditorContextState } from '../controllers/ActiveEditorContextController';

export interface ComposerContextTrayCallbacks {
  onToggleActiveNote: () => void;
  onDismissSelection: () => void;
}

export class ChatInput {
  private element: HTMLElement | null = null;
  private inputElement: HTMLElement | null = null;
  private inputWrapper: HTMLElement | null = null;
  private contextTrayEl: HTMLElement | null = null;
  private contextTrayCallbacks: ComposerContextTrayCallbacks | null = null;
  private voiceVisualElement: HTMLElement | null = null;
  private liveVoiceComposerElement: HTMLElement | null = null;
  private liveVoiceWaveformElement: HTMLElement | null = null;
  private liveVoiceStopButton: HTMLButtonElement | null = null;
  private attachButton: HTMLButtonElement | null = null;
  private modelPillButton: HTMLButtonElement | null = null;
  private modelPillNameEl: HTMLElement | null = null;
  private effortTagEl: HTMLElement | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private onModelPillClick: ((anchorEl: HTMLElement) => void) | null = null;
  private isLoading = false;
  private isPreSendCompacting = false;
  private hasConversation = false;
  private suggesters: SuggesterInstances | null = null;
  private voiceInputState: ChatVoiceInputState = 'idle';
  private liveVoiceState: LiveVoiceComposerState = 'inactive';
  private voiceInputController: ChatVoiceInputController | null = null;
  private voiceVisualResizeObserver: ResizeObserver | null = null;
  private liveVoiceResizeObserver: ResizeObserver | null = null;
  constructor(
    private container: HTMLElement,
    private onSendMessage: (
      message: string,
      enhancement?: MessageEnhancement,
      metadata?: ReferenceMetadata
    ) => Promise<boolean>,
    private getLoadingState: () => boolean,
    private app?: App,
    private onStopGeneration?: () => void,
    private getHasConversation?: () => boolean,
    private component?: Component,
    private onStopLiveVoice?: () => void,
    private getVoiceInputLLMSettings?: () => LLMProviderSettings | null
  ) {
    this.render();
  }

  /**
   * Set loading state
   */
  setLoading(loading: boolean): void {
    this.isLoading = loading;
    this.updateUI();
  }

  /**
   * Set pre-send compaction state.
   */
  setPreSendCompacting(compacting: boolean): void {
    this.isPreSendCompacting = compacting;
    this.updateUI();
  }

  /**
   * Set conversation state (whether a conversation is active)
   */
  setConversationState(hasConversation: boolean): void {
    this.hasConversation = hasConversation;
    this.updateUI();
  }

  /**
   * Set placeholder text
   */
  setPlaceholder(placeholder: string): void {
    if (this.inputElement) {
      this.inputElement.setAttribute('data-placeholder', placeholder);
    }
  }

  /**
   * Render the chat input interface
   */
  private render(): void {
    this.container.empty();
    this.container.addClass('chat-input');
    const component = this.component;

    // Unified composer card
    this.inputWrapper = this.container.createDiv('chat-input-wrapper chat-composer-card');

    // Mobile: Add mobile-specific class for styling
    if (isMobile()) {
      this.inputWrapper.addClass('chat-input-mobile');
    }

    this.contextTrayEl = this.inputWrapper.createDiv('chat-composer-tray is-hidden');
    component?.registerDomEvent(this.contextTrayEl, 'click', (event: MouseEvent) => {
      const target = event.target;
      if (!this.isElement(target)) {
        return;
      }
      const actionEl = target.closest('[data-tray-action]');
      if (!actionEl || !this.contextTrayEl?.contains(actionEl)) {
        return;
      }
      const action = actionEl.getAttribute('data-tray-action');
      if (action === 'toggle-note') {
        this.contextTrayCallbacks?.onToggleActiveNote();
      } else if (action === 'dismiss-selection') {
        this.contextTrayCallbacks?.onDismissSelection();
      }
    });

    // Composer body: textarea and voice visual overlays
    const composerBody = this.inputWrapper.createDiv('chat-composer-body');

    // Contenteditable input
    this.inputElement = composerBody.createDiv('chat-textarea');
    this.inputElement.contentEditable = 'true';
    this.inputElement.setAttribute('data-placeholder', 'Ask anything, or type / · @ · [[…');
    this.inputElement.setAttribute('data-empty', 'true');
    this.inputElement.setAttribute('role', 'textbox');
    this.inputElement.setAttribute('aria-multiline', 'true');

    this.voiceVisualElement = composerBody.createDiv('chat-voice-visual');
    this.voiceVisualElement.setAttribute('aria-hidden', 'true');

    this.liveVoiceComposerElement = composerBody.createDiv('chat-live-composer');
    this.liveVoiceComposerElement.setAttribute('role', 'group');
    this.liveVoiceComposerElement.setAttribute('aria-label', 'Live voice session');
    this.liveVoiceComposerElement.createSpan('chat-live-dot');
    this.liveVoiceWaveformElement = this.liveVoiceComposerElement.createDiv('chat-live-waveform');
    this.liveVoiceWaveformElement.setAttribute('aria-hidden', 'true');
    this.liveVoiceStopButton = this.liveVoiceComposerElement.createEl('button', {
      cls: 'chat-live-stop-button clickable-icon'
    });
    setIcon(this.liveVoiceStopButton, 'square');
    this.liveVoiceStopButton.setAttribute('aria-label', 'Stop live voice');
    this.liveVoiceStopButton.setAttribute('title', 'Stop live voice');
    component?.registerDomEvent(this.liveVoiceStopButton, 'click', () => {
      this.onStopLiveVoice?.();
    });

    // Handle Enter key (send) and Shift+Enter (new line), guarding IME composition
    const keydownHandler = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === 'Process' || Reflect.get(e, 'keyCode') === 229) {
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        // Don't send if any suggester is active (let suggester handle it)
        const anySuggesterActive =
          this.suggesters?.noteSuggester?.getIsActive() ||
          this.suggesters?.toolSuggester?.getIsActive() ||
          this.suggesters?.promptSuggester?.getIsActive() ||
          this.suggesters?.workspaceSuggester?.getIsActive();

        if (!anySuggesterActive) {
          e.preventDefault();
          void this.handleSendMessage().catch(error => console.error('[ChatInput] Send failed:', error));
        }
      }
    };

    // Auto-resize on input
    const inputHandler = () => {
      this.syncEmptyState();
      this.autoResizeInput();
      this.updateUI();
    };

    // Register events with component for auto-cleanup
    if (component) {
      component.registerDomEvent(this.inputElement, 'keydown', keydownHandler);
      component.registerDomEvent(this.inputElement, 'input', inputHandler);
    }

    // Composer footer: left tool triggers + model/effort pill, right send action
    const composerFooter = this.inputWrapper.createDiv('chat-composer-footer');
    const composerTools = composerFooter.createDiv('chat-composer-tools');

    this.attachButton = composerTools.createEl('button', {
      cls: 'chat-attach-button clickable-icon',
      attr: {
        type: 'button',
        'aria-label': 'Reference note',
        title: 'Reference note'
      }
    });
    setIcon(this.attachButton, 'plus');
    component?.registerDomEvent(this.attachButton, 'click', () => {
      this.insertTrigger('[[');
    });

    this.modelPillButton = composerTools.createEl('button', {
      cls: 'chat-model-pill clickable-icon',
      attr: {
        type: 'button',
        'aria-label': 'Select model and thinking effort',
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false'
      }
    });
    this.modelPillNameEl = this.modelPillButton.createSpan({
      cls: 'chat-model-pill-name',
      text: 'Select model'
    });
    this.effortTagEl = this.modelPillButton.createSpan({
      cls: 'chat-effort-tag is-hidden'
    });
    const modelPillChevron = this.modelPillButton.createSpan({
      cls: 'chat-model-pill-chevron',
      attr: { 'aria-hidden': 'true' }
    });
    setIcon(modelPillChevron, 'chevron-up');
    component?.registerDomEvent(this.modelPillButton, 'click', () => {
      if (this.modelPillButton) {
        this.onModelPillClick?.(this.modelPillButton);
      }
    });

    const composerMeta = composerFooter.createDiv('chat-composer-meta');

    // Send button inside composer footer meta cluster
    this.sendButton = composerMeta.createEl('button', {
      cls: 'chat-send-button clickable-icon'
    });

    // Add send icon using Obsidian's setIcon
    setIcon(this.sendButton, 'arrow-up');
    this.sendButton.setAttribute('aria-label', 'Send message');

    const sendClickHandler = () => {
      this.handleSendOrStop();
    };
    component?.registerDomEvent(this.sendButton, 'click', sendClickHandler);

    // Initialize suggesters if app is available
    if (this.app && this.inputElement) {
      this.suggesters = initializeSuggesters(this.app, this.inputElement, this.component);
    }

    this.voiceInputController = new ChatVoiceInputController(this.app, {
      onStateChange: (state) => {
        this.voiceInputState = state;
        this.updateVoiceVisual();
        this.updateUI();
      },
      onTranscriptReady: (text) => {
        this.setValue(text);
        this.focusInput(true);
      },
      onError: (message) => {
        new Notice(message);
      }
    }, this.getVoiceInputLLMSettings);

    this.initializeVoiceVisualResizeHandling();
    this.buildVoiceBars();
    this.initializeLiveVoiceResizeHandling();
    this.buildLiveVoiceBars();

    this.element = this.container;
    this.syncEmptyState();
    this.updateUI();
  }

  /**
   * Handle send or stop based on current state
   */
  private handleSendOrStop(): void {
    const actuallyLoading = this.isLoading || this.getLoadingState();
    const hasPendingInput = this.hasPendingInput();
    const canUseVoiceInput = this.canUseVoiceInput();

    if (this.voiceInputState === 'recording') {
      void this.voiceInputController?.stopRecording();
      return;
    }

    if (this.voiceInputState === 'transcribing') {
      return;
    }

    if (actuallyLoading && !hasPendingInput) {
      // Stop generation
      if (this.onStopGeneration) {
        this.onStopGeneration();
      }
    } else if (!hasPendingInput && canUseVoiceInput) {
      void this.voiceInputController?.startRecording();
    } else {
      // Send message
      void this.handleSendMessage().catch(error => console.error('[ChatInput] Send failed:', error));
    }
  }

  /**
   * Handle sending a message
   */
  private async handleSendMessage(): Promise<void> {
    if (!this.inputElement) return;

    // Check if a conversation is active
    const hasConversation = this.getHasConversation ? this.getHasConversation() : this.hasConversation;
    if (!hasConversation) {
      return;
    }

    const extracted = ReferenceExtractor.extractContent(this.inputElement);
    const message = extracted.plainText.trim();
    if (!message) return;

    // Build enhancement from MessageEnhancer
    let enhancement: MessageEnhancement | undefined = undefined;
    if (this.suggesters?.messageEnhancer && this.suggesters.messageEnhancer.hasEnhancements()) {
      enhancement = this.suggesters.messageEnhancer.buildEnhancement(message);
    }

    const metadata: ReferenceMetadata | undefined =
      extracted.references.length > 0
        ? {
            references: extracted.references
          }
        : undefined;

    // Keep a DOM snapshot so rejected pre-send compaction can restore reference
    // badges and text without replacing anything the user typed meanwhile.
    const originalInput = this.inputElement;
    const draftNodes = Array.from(originalInput.childNodes, node => node.cloneNode(true));

    // Clear the input
    ContentEditableHelper.clear(this.inputElement);
    this.syncEmptyState();
    this.autoResizeInput();

    // Send the message with enhancement
    try {
      const sent = await this.onSendMessage(message, enhancement, metadata);
      if (!sent && this.inputElement === originalInput && !this.getValue().trim()) {
        originalInput.replaceChildren(...draftNodes);
        this.syncEmptyState();
        this.autoResizeInput();
        this.updateUI();
      }
    } catch (error) {
      if (this.inputElement === originalInput && !this.getValue().trim()) {
        originalInput.replaceChildren(...draftNodes);
        this.syncEmptyState();
        this.autoResizeInput();
        this.updateUI();
      }
      throw error;
    }
  }

  /**
   * Auto-resize input based on content (limited to ~4 lines)
   */
  private autoResizeInput(): void {
    if (!this.inputElement) return;

    // Reset height to auto to get the correct scrollHeight
    this.inputElement.style.removeProperty('--chat-input-height');

    // Set height limits - matches CSS min/max heights
    const minHeight = isMobile() ? 64 : 72;
    const maxHeight = isMobile() ? 160 : 200;
    const newHeight = Math.min(Math.max(this.inputElement.scrollHeight, minHeight), maxHeight);

    // Write computed height as a CSS custom property consumed by styles.css
    this.inputElement.style.setProperty('--chat-input-height', newHeight + 'px');

    // Enable scrolling if content exceeds max height
    if (this.inputElement.scrollHeight > maxHeight) {
      this.inputElement.removeClass('chat-input-overflow-hidden');
      this.inputElement.addClass('chat-input-overflow-auto');
    } else {
      this.inputElement.removeClass('chat-input-overflow-auto');
      this.inputElement.addClass('chat-input-overflow-hidden');
    }
  }

  /**
   * Update UI based on current state
   */
  private updateUI(): void {
    if (!this.sendButton || !this.inputElement) return;

    this.syncEmptyState();

    const actuallyLoading = this.isLoading || this.getLoadingState();
    const hasConversation = this.getHasConversation ? this.getHasConversation() : this.hasConversation;
    const hasPendingInput = this.hasPendingInput();
    const canUseVoiceInput = this.canUseVoiceInput();
    this.inputElement.setAttribute('aria-busy', this.isPreSendCompacting ? 'true' : 'false');

    if (this.isPreSendCompacting) {
      this.container.addClass('chat-input-compacting');
    } else {
      this.container.removeClass('chat-input-compacting');
    }

    if (this.attachButton) {
      this.attachButton.disabled =
        !hasConversation ||
        this.isPreSendCompacting ||
        this.liveVoiceState !== 'inactive' ||
        this.voiceInputState !== 'idle';
    }
    if (this.modelPillButton) {
      this.modelPillButton.disabled = !hasConversation;
    }

    if (!hasConversation) {
      // No providers configured - disable composer
      this.sendButton.disabled = true;
      this.sendButton.classList.remove('stop-mode');
      this.sendButton.classList.add('disabled-mode');
      this.sendButton.empty();
      setIcon(this.sendButton, 'arrow-up');
      this.sendButton.setAttribute('aria-label', 'Configure a provider to start chatting');
      this.inputElement.contentEditable = 'false';
      this.inputElement.setAttribute('data-placeholder', 'Configure a provider to start chatting');
    } else if (this.isPreSendCompacting) {
      this.sendButton.disabled = true;
      this.sendButton.classList.remove('stop-mode');
      this.sendButton.classList.add('disabled-mode');
      this.sendButton.empty();
      setIcon(this.sendButton, 'arrow-up');
      this.sendButton.setAttribute('aria-label', 'Compacting');
      this.inputElement.contentEditable = 'false';
      this.inputElement.setAttribute('data-placeholder', 'Compacting');
    } else if (this.liveVoiceState !== 'inactive') {
      this.sendButton.disabled = true;
      this.sendButton.classList.remove('stop-mode');
      this.sendButton.classList.add('disabled-mode');
      this.inputElement.contentEditable = 'false';
      this.inputElement.setAttribute('data-placeholder', 'Ask anything, or type / · @ · [[…');
      if (this.liveVoiceStopButton) {
        this.liveVoiceStopButton.disabled = false;
      }
    } else if (actuallyLoading) {
      // Keep the input active so a new message can interrupt the current turn.
      this.sendButton.disabled = false;
      this.sendButton.empty();
      this.inputElement.contentEditable = 'true';

      if (hasPendingInput) {
        this.sendButton.classList.remove('stop-mode');
        this.sendButton.classList.remove('disabled-mode');
        setIcon(this.sendButton, 'arrow-up');
        this.sendButton.setAttribute('aria-label', 'Interrupt and send message');
        this.inputElement.setAttribute('data-placeholder', 'Send a steering message...');
      } else {
        this.sendButton.classList.add('stop-mode');
        this.sendButton.classList.remove('disabled-mode');
        setIcon(this.sendButton, 'square');
        this.sendButton.setAttribute('aria-label', 'Stop generation');
        this.inputElement.setAttribute('data-placeholder', 'Type to interrupt, or stop generation');
      }
    } else if (this.voiceInputState === 'recording') {
      this.sendButton.disabled = false;
      this.sendButton.classList.add('stop-mode');
      this.sendButton.classList.remove('disabled-mode');
      this.sendButton.empty();
      setIcon(this.sendButton, 'square');
      this.sendButton.setAttribute('aria-label', 'Stop recording');
      this.inputElement.contentEditable = 'false';
      this.inputElement.setAttribute('data-placeholder', 'Ask anything, or type / · @ · [[…');
    } else if (this.voiceInputState === 'transcribing') {
      this.sendButton.disabled = true;
      this.sendButton.classList.add('stop-mode');
      this.sendButton.classList.remove('disabled-mode');
      this.sendButton.empty();
      setIcon(this.sendButton, 'square');
      this.sendButton.setAttribute('aria-label', 'Finishing transcription');
      this.inputElement.contentEditable = 'false';
      this.inputElement.setAttribute('data-placeholder', 'Ask anything, or type / · @ · [[…');
    } else if (!hasPendingInput && canUseVoiceInput) {
      this.sendButton.disabled = false;
      this.sendButton.classList.remove('stop-mode');
      this.sendButton.classList.remove('disabled-mode');
      this.sendButton.empty();
      setIcon(this.sendButton, 'mic');
      this.sendButton.setAttribute('aria-label', 'Start voice input');
      this.inputElement.contentEditable = 'true';
      this.inputElement.setAttribute('data-placeholder', 'Ask anything, or type / · @ · [[…');
    } else {
      // Show normal send button
      this.sendButton.disabled = false;
      this.sendButton.classList.remove('stop-mode');
      this.sendButton.classList.remove('disabled-mode');
      this.sendButton.empty();
      setIcon(this.sendButton, 'arrow-up');
      this.sendButton.setAttribute('aria-label', 'Send message');
      this.inputElement.contentEditable = 'true';
      this.inputElement.setAttribute('data-placeholder', 'Ask anything, or type / · @ · [[…');
    }

    this.updateVoiceVisual();
  }

  private hasPendingInput(): boolean {
    if (!this.inputElement) {
      return false;
    }

    return ContentEditableHelper.getPlainText(this.inputElement).trim().length > 0;
  }

  /**
   * Focus the input
   */
  focus(): void {
    this.focusInput(false);
  }

  /**
   * Focus the input; on mobile only focuses when explicitly triggered by user action.
   */
  focusInput(allowMobile = false): void {
    if (!this.inputElement) {
      return;
    }
    if (isMobile() && !allowMobile) {
      return;
    }
    ContentEditableHelper.focus(this.inputElement);
  }

  setModelPillClickHandler(handler: (anchorEl: HTMLElement) => void): void {
    this.onModelPillClick = handler;
  }

  setModelPillOpen(open: boolean): void {
    if (!this.modelPillButton) return;
    this.modelPillButton.toggleClass('is-open', open);
    this.modelPillButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  updateModelPill(modelName: string, effortLabel: string | null): void {
    if (this.modelPillNameEl) {
      this.modelPillNameEl.textContent = modelName || 'Select model';
    }
    if (this.effortTagEl) {
      if (effortLabel && effortLabel.trim().length > 0) {
        this.effortTagEl.textContent = effortLabel;
        this.effortTagEl.removeClass('is-hidden');
      } else {
        this.effortTagEl.textContent = '';
        this.effortTagEl.addClass('is-hidden');
      }
    }
  }

  setContextTrayCallbacks(callbacks: ComposerContextTrayCallbacks): void {
    this.contextTrayCallbacks = callbacks;
  }

  updateContextTray(state: ActiveEditorContextState): void {
    if (!this.contextTrayEl) {
      return;
    }

    this.contextTrayEl.empty();
    const hasItems = Boolean(state.activeNote || state.selection);
    this.contextTrayEl.toggleClass('is-hidden', !hasItems);
    if (!hasItems) {
      return;
    }

    if (state.activeNote) {
      const labelText = state.includeActiveNote
        ? `Current note attached: ${state.activeNote.path} — tap to exclude`
        : `Current note excluded: ${state.activeNote.path} — tap to attach`;
      const chipEl = this.contextTrayEl.createEl('button', {
        cls: state.includeActiveNote
          ? 'clickable-icon chat-context-chip'
          : 'clickable-icon chat-context-chip is-muted',
        attr: {
          type: 'button',
          'data-tray-action': 'toggle-note',
          'aria-pressed': String(state.includeActiveNote),
          'aria-label': labelText,
          title: labelText
        }
      });
      const iconEl = chipEl.createSpan({
        cls: 'chat-context-chip-icon',
        attr: { 'aria-hidden': 'true' }
      });
      setIcon(iconEl, 'file-text');
      chipEl.createSpan({
        cls: 'chat-context-chip-label',
        text: state.activeNote.basename
      });
      const actionEl = chipEl.createSpan({
        cls: 'chat-context-chip-action',
        attr: { 'aria-hidden': 'true' }
      });
      setIcon(actionEl, state.includeActiveNote ? 'x' : 'plus');
    }

    if (state.selection) {
      const { selection } = state;
      const range = selection.startLine
        ? selection.endLine && selection.endLine !== selection.startLine
          ? `L${selection.startLine}–${selection.endLine}`
          : `L${selection.startLine}`
        : `${selection.selectedText.length} chars`;
      const chipEl = this.contextTrayEl.createEl('button', {
        cls: 'clickable-icon chat-context-chip chat-selection-chip',
        attr: {
          type: 'button',
          'data-tray-action': 'dismiss-selection',
          'aria-label': 'Remove selected text from context',
          title: `Selected from ${selection.filePath} (${range}) — tap to remove`
        }
      });
      const iconEl = chipEl.createSpan({
        cls: 'chat-context-chip-icon',
        attr: { 'aria-hidden': 'true' }
      });
      setIcon(iconEl, 'quote');
      chipEl.createSpan({
        cls: 'chat-context-chip-label',
        text: `${selection.fileName} · ${range}`
      });
      const actionEl = chipEl.createSpan({
        cls: 'chat-context-chip-action',
        attr: { 'aria-hidden': 'true' }
      });
      setIcon(actionEl, 'x');
    }
  }

  insertTrigger(trigger: string): void {
    if (!this.inputElement || this.inputElement.contentEditable !== 'true') {
      return;
    }

    const currentText = ContentEditableHelper.getPlainText(this.inputElement);
    const needsLeadingSpace = currentText.length > 0 && !/\s$/.test(currentText);
    const addition = `${needsLeadingSpace ? ' ' : ''}${trigger}`;

    const doc = this.inputElement.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (doc && typeof doc.createTextNode === 'function' && typeof this.inputElement.appendChild === 'function') {
      this.inputElement.appendChild(doc.createTextNode(addition));
    } else {
      ContentEditableHelper.setPlainText(this.inputElement, `${currentText}${addition}`);
    }
    this.focusInput(true);
    this.syncEmptyState();
    this.autoResizeInput();
    this.updateUI();
    this.inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private syncEmptyState(): void {
    if (!this.inputElement || typeof this.inputElement.setAttribute !== 'function') {
      return;
    }
    const isEmpty = (this.inputElement.textContent ?? '').trim().length === 0;
    this.inputElement.setAttribute('data-empty', isEmpty ? 'true' : 'false');
  }

  /**
   * Clear the input
   */
  clear(): void {
    if (this.inputElement) {
      ContentEditableHelper.clear(this.inputElement);
      this.syncEmptyState();
      this.autoResizeInput();
      this.updateUI();
    }
  }

  /**
   * Get current input value
   */
  getValue(): string {
    return this.inputElement ? ContentEditableHelper.getPlainText(this.inputElement) : '';
  }

  /**
   * Set input value
   */
  setValue(value: string): void {
    if (this.inputElement) {
      ContentEditableHelper.setPlainText(this.inputElement, value);
      this.syncEmptyState();
      this.autoResizeInput();
      this.updateUI();
    }
  }

  setLiveVoiceState(state: LiveVoiceComposerState): void {
    this.liveVoiceState = state;
    this.updateLiveVoiceVisual();
    this.updateUI();
  }

  getLiveVoiceState(): LiveVoiceComposerState {
    return this.liveVoiceState;
  }

  /**
   * Get message enhancer (for accessing enhancements before sending)
   */
  getMessageEnhancer(): MessageEnhancer | null {
    return this.suggesters?.messageEnhancer || null;
  }

  /**
   * Clear message enhancer (call after message is sent)
   */
  clearMessageEnhancer(): void {
    if (this.suggesters?.messageEnhancer) {
      this.suggesters.messageEnhancer.clearEnhancements();
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.voiceVisualResizeObserver?.disconnect();
    this.voiceVisualResizeObserver = null;
    this.liveVoiceResizeObserver?.disconnect();
    this.liveVoiceResizeObserver = null;
    this.voiceInputController?.cleanup();
    this.voiceInputController = null;

    if (this.suggesters) {
      this.suggesters.cleanup();
      this.suggesters = null;
    }

    this.element = null;
    this.inputElement = null;
    this.inputWrapper = null;
    this.contextTrayEl = null;
    this.contextTrayCallbacks = null;
    this.voiceVisualElement = null;
    this.liveVoiceComposerElement = null;
    this.liveVoiceWaveformElement = null;
    this.liveVoiceStopButton = null;
    this.attachButton = null;
    this.modelPillButton = null;
    this.modelPillNameEl = null;
    this.effortTagEl = null;
    this.sendButton = null;
    this.onModelPillClick = null;
  }

  private canUseVoiceInput(): boolean {
    return this.voiceInputController?.isAvailable() ?? false;
  }

  private updateVoiceVisual(): void {
    if (!this.inputWrapper) {
      return;
    }

    this.updateLiveVoiceVisual();

    const isVoiceMode = this.voiceInputState === 'recording' || this.voiceInputState === 'transcribing';
    if (isVoiceMode) {
      this.inputWrapper.addClass('chat-input-voice-recording');
    } else {
      this.inputWrapper.removeClass('chat-input-voice-recording');
    }

    if (this.voiceInputState === 'transcribing') {
      this.inputWrapper.addClass('chat-input-voice-transcribing');
    } else {
      this.inputWrapper.removeClass('chat-input-voice-transcribing');
    }

    if (isVoiceMode) {
      this.buildVoiceBars();
    }
  }

  private updateLiveVoiceVisual(): void {
    if (!this.inputWrapper) {
      return;
    }

    const states: LiveVoiceComposerState[] = [
      'connecting',
      'listening',
      'user-speaking',
      'assistant-speaking',
      'error',
    ];
    const isLive = this.liveVoiceState !== 'inactive';

    if (isLive) {
      this.inputWrapper.addClass('chat-input-live-mode');
    } else {
      this.inputWrapper.removeClass('chat-input-live-mode');
    }

    states.forEach(state => {
      const className = `chat-input-live-${state}`;
      if (this.liveVoiceState === state) {
        this.inputWrapper?.addClass(className);
      } else {
        this.inputWrapper?.removeClass(className);
      }
    });

    if (isLive) {
      this.buildLiveVoiceBars();
    }
  }

  private initializeVoiceVisualResizeHandling(): void {
    if (!this.voiceVisualElement) {
      return;
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.voiceVisualResizeObserver = new ResizeObserver(() => this.buildVoiceBars());
      this.voiceVisualResizeObserver.observe(this.voiceVisualElement);
      return;
    }

    if (this.component && typeof window !== 'undefined') {
      this.component.registerDomEvent(window, 'resize', () => this.buildVoiceBars());
    }
  }

  private initializeLiveVoiceResizeHandling(): void {
    if (!this.liveVoiceWaveformElement) {
      return;
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.liveVoiceResizeObserver = new ResizeObserver(() => this.buildLiveVoiceBars());
      this.liveVoiceResizeObserver.observe(this.liveVoiceWaveformElement);
      return;
    }

    if (this.component && typeof window !== 'undefined') {
      this.component.registerDomEvent(window, 'resize', () => this.buildLiveVoiceBars());
    }
  }

  private buildVoiceBars(): void {
    if (!this.voiceVisualElement || typeof window === 'undefined') {
      return;
    }

    const computedStyle = window.getComputedStyle(this.voiceVisualElement);
    const paddingLeft = Number.parseFloat(computedStyle.paddingLeft || '0');
    const paddingRight = Number.parseFloat(computedStyle.paddingRight || '0');
    const availableWidth = this.voiceVisualElement.clientWidth - paddingLeft - paddingRight;

    if (availableWidth <= 0) {
      return;
    }

    const gap = 4;
    const barWidth = 3;
    const barSlot = barWidth + gap;
    const barCount = Math.max(12, Math.floor(availableWidth / barSlot));

    this.voiceVisualElement.empty();

    for (let index = 0; index < barCount; index += 1) {
      const phaseIndex = index % 8;
      const delayIndex = index % 8;
      this.voiceVisualElement.createSpan(`chat-voice-bar chat-voice-bar-phase-${phaseIndex} chat-voice-bar-delay-${delayIndex}`);
    }
  }

  private buildLiveVoiceBars(): void {
    if (!this.liveVoiceWaveformElement || typeof window === 'undefined') {
      return;
    }

    const computedStyle = window.getComputedStyle(this.liveVoiceWaveformElement);
    const paddingLeft = Number.parseFloat(computedStyle.paddingLeft || '0');
    const paddingRight = Number.parseFloat(computedStyle.paddingRight || '0');
    const availableWidth = this.liveVoiceWaveformElement.clientWidth - paddingLeft - paddingRight;

    if (availableWidth <= 0) {
      return;
    }

    const gap = 3;
    const barWidth = 6;
    const barSlot = barWidth + gap;
    const barCount = Math.max(24, Math.floor(availableWidth / barSlot));

    this.liveVoiceWaveformElement.empty();

    for (let index = 0; index < barCount; index += 1) {
      const phaseIndex = index % 12;
      this.liveVoiceWaveformElement.createSpan(`chat-live-wave-bar chat-live-wave-phase-${phaseIndex}`);
    }
  }

  private isElement(value: EventTarget | null): value is Element {
    return typeof value === 'object' && value !== null && 'closest' in value && typeof value.closest === 'function';
  }
}
