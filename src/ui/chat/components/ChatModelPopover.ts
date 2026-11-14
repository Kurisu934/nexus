import { Component, Notice } from 'obsidian';
import type { ModelAgentManager } from '../services/ModelAgentManager';
import type { ModelOption } from '../types/SelectionTypes';
import { StaticModelsService } from '../../../services/StaticModelsService';
import { getStaticModelCapabilities } from '../../../components/shared/chatSettings/modelCapabilities';
import { formatContextWindow } from '../../../components/shared/chatSettings/sectionSummaries';
import {
  getSupportedThinkingEfforts,
  normalizeThinkingEffortForModel
} from '../../../services/llm/utils/thinkingLevels';
import type { ThinkingEffort, ThinkingSettings } from '../../../types/llm/ProviderTypes';

const EFFORT_SHORT_LABELS: Record<ThinkingEffort, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'xHigh',
  max: 'Max'
};

export interface ChatModelPopoverOptions {
  containerEl: HTMLElement;
  modelAgentManager: ModelAgentManager;
  getConversationId: () => string | null;
  component: Component;
  onChanged: () => void;
  onVisibilityChange?: (isOpen: boolean) => void;
}

export function resolveModelPillInfo(
  model: ModelOption | null,
  thinking: ThinkingSettings
): { modelName: string; effortLabel: string | null } {
  if (!model) {
    return { modelName: 'Select model', effortLabel: null };
  }

  const capabilities = getStaticModelCapabilities(
    StaticModelsService.getInstance(),
    model.providerId,
    model.modelId
  );
  const supportsThinking = Boolean(capabilities?.supportsThinking || model.supportsThinking);
  if (!supportsThinking || !thinking.enabled) {
    return { modelName: model.modelName, effortLabel: null };
  }

  const effectiveEffort = normalizeThinkingEffortForModel(
    model.providerId,
    model.modelId,
    thinking.effort
  );
  return {
    modelName: model.modelName,
    effortLabel: EFFORT_SHORT_LABELS[effectiveEffort] ?? null
  };
}

export class ChatModelPopover {
  private readonly popoverEl: HTMLElement;
  private anchorEl: HTMLElement | null = null;
  private isOpen = false;
  private isLoadingModels = false;
  private isSwitching = false;
  private isDisposed = false;
  private renderGeneration = 0;
  private models: ModelOption[] = [];

  constructor(private readonly options: ChatModelPopoverOptions) {
    this.popoverEl = this.options.containerEl.createDiv({
      cls: 'chat-model-popover is-hidden',
      attr: {
        role: 'dialog',
        'aria-label': 'Select model and thinking effort'
      }
    });

    this.options.component.registerDomEvent(this.popoverEl, 'click', (event: MouseEvent) => {
      const target = event.target;
      if (!this.isElement(target)) {
        return;
      }

      const button = target.closest('button');
      if (!button || !this.popoverEl.contains(button)) {
        return;
      }

      const providerId = button.getAttribute('data-provider-id');
      const modelId = button.getAttribute('data-model-id');
      if (providerId && modelId) {
        void this.selectModel(providerId, modelId);
        return;
      }

      const effort = button.getAttribute('data-effort');
      if (effort) {
        void this.selectEffort(effort);
      }
    });

    const doc = this.options.containerEl.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (doc) {
      this.options.component.registerDomEvent(doc, 'pointerdown', (event: PointerEvent) => {
        if (!this.isOpen) {
          return;
        }
        const target = event.target;
        if (this.isNode(target)) {
          if (this.popoverEl.contains(target) || this.anchorEl?.contains(target)) {
            return;
          }
        }
        this.close();
      });

      this.options.component.registerDomEvent(doc, 'keydown', (event: KeyboardEvent) => {
        if (!this.isOpen || event.key !== 'Escape') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.close();
      });
    }
  }

  toggle(anchorEl: HTMLElement): void {
    if (this.isOpen) {
      this.close();
    } else {
      void this.open(anchorEl);
    }
  }

  async open(anchorEl: HTMLElement): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    const generation = ++this.renderGeneration;
    this.anchorEl = anchorEl;
    this.isOpen = true;
    this.isLoadingModels = true;

    this.updatePosition(anchorEl);
    this.popoverEl.removeClass('is-hidden');
    this.options.onVisibilityChange?.(true);
    this.renderContent();

    try {
      const available = await this.options.modelAgentManager.getAvailableModels();
      if (this.isDisposed || !this.isOpen || generation !== this.renderGeneration) {
        return;
      }
      this.models = available;
    } catch (error) {
      console.error('[ChatModelPopover] Failed to load available models:', error);
    } finally {
      if (!this.isDisposed && generation === this.renderGeneration) {
        this.isLoadingModels = false;
        if (this.isOpen) {
          this.renderContent();
        }
      }
    }
  }

  close(): void {
    if (!this.isOpen) {
      return;
    }

    this.isOpen = false;
    this.renderGeneration += 1;
    this.popoverEl.addClass('is-hidden');
    this.options.onVisibilityChange?.(false);
  }

  refresh(): void {
    if (!this.isOpen || this.isDisposed) {
      return;
    }
    this.renderContent();
  }

  cleanup(): void {
    this.isDisposed = true;
    this.close();
    this.anchorEl = null;
    this.models = [];
    this.popoverEl.remove();
  }

  private updatePosition(anchorEl: HTMLElement): void {
    if (
      typeof this.options.containerEl.getBoundingClientRect !== 'function' ||
      typeof anchorEl.getBoundingClientRect !== 'function'
    ) {
      return;
    }

    const dockEl = anchorEl.closest('.chat-composer-dock, .chat-composer-card') ?? anchorEl;
    const containerRect = this.options.containerEl.getBoundingClientRect();
    const dockRect = dockEl.getBoundingClientRect();

    if (containerRect.height > 0 && dockRect.top > 0) {
      const bottomOffset = Math.max(8, Math.round(containerRect.bottom - dockRect.top + 8));
      this.popoverEl.style.setProperty('--chat-popover-bottom', `${bottomOffset}px`);
    }
  }

  private renderContent(): void {
    this.popoverEl.empty();

    const selected = this.options.modelAgentManager.getSelectedModel();
    const modelHeader = this.popoverEl.createDiv('chat-popover-section-label');
    modelHeader.createSpan({ text: 'Model' });

    const listEl = this.popoverEl.createDiv('chat-model-list');
    const displayModels = this.models.length > 0 ? this.models : selected ? [selected] : [];

    if (displayModels.length === 0) {
      listEl.createDiv({
        cls: 'chat-model-empty',
        text: this.isLoadingModels ? 'Loading models...' : 'No configured models available'
      });
    } else {
      for (const model of displayModels) {
        const isSelected =
          selected?.providerId === model.providerId &&
          selected?.modelId === model.modelId;

        const optionBtn = listEl.createEl('button', {
          cls: isSelected
            ? 'clickable-icon chat-model-option is-selected'
            : 'clickable-icon chat-model-option',
          attr: {
            type: 'button',
            'aria-pressed': isSelected ? 'true' : 'false',
            'data-provider-id': model.providerId,
            'data-model-id': model.modelId
          }
        });
        optionBtn.disabled = this.isSwitching;

        optionBtn.createSpan({
          cls: 'chat-model-option-name',
          text: model.modelName
        });

        const contextLabel = model.contextWindow > 0 ? formatContextWindow(model.contextWindow) : null;
        const subLabel = contextLabel ? `${model.providerName} · ${contextLabel}` : model.providerName;
        optionBtn.createSpan({
          cls: 'chat-model-option-sub',
          text: subLabel
        });
      }
    }

    if (!selected) {
      return;
    }

    const capabilities = getStaticModelCapabilities(
      StaticModelsService.getInstance(),
      selected.providerId,
      selected.modelId
    );
    const supportsThinking = Boolean(capabilities?.supportsThinking || selected.supportsThinking);
    const efforts = supportsThinking
      ? getSupportedThinkingEfforts(selected.providerId, selected.modelId)
      : [];

    if (!supportsThinking && efforts.length === 0) {
      return;
    }

    const thinkingHeader = this.popoverEl.createDiv('chat-popover-section-label');
    thinkingHeader.createSpan({ text: 'Thinking effort' });

    const thinking = this.options.modelAgentManager.getThinkingSettings();
    const activeEffort = thinking.enabled
      ? normalizeThinkingEffortForModel(selected.providerId, selected.modelId, thinking.effort)
      : null;

    const segmentedEl = this.popoverEl.createDiv('chat-effort-segmented');
    const offBtn = segmentedEl.createEl('button', {
      cls: !thinking.enabled
        ? 'clickable-icon chat-effort-seg-btn is-active'
        : 'clickable-icon chat-effort-seg-btn',
      text: 'Off',
      attr: {
        type: 'button',
        'aria-pressed': !thinking.enabled ? 'true' : 'false',
        'data-effort': 'off'
      }
    });
    offBtn.disabled = this.isSwitching;

    for (const tier of efforts) {
      const isActive = thinking.enabled && activeEffort === tier;
      const tierBtn = segmentedEl.createEl('button', {
        cls: isActive
          ? 'clickable-icon chat-effort-seg-btn is-active'
          : 'clickable-icon chat-effort-seg-btn',
        text: EFFORT_SHORT_LABELS[tier],
        attr: {
          type: 'button',
          'aria-pressed': isActive ? 'true' : 'false',
          'data-effort': tier
        }
      });
      tierBtn.disabled = this.isSwitching;
    }
  }

  private async selectModel(providerId: string, modelId: string): Promise<void> {
    if (this.isSwitching || this.isDisposed) {
      return;
    }

    const current = this.options.modelAgentManager.getSelectedModel();
    if (current?.providerId === providerId && current?.modelId === modelId) {
      return;
    }

    this.isSwitching = true;
    this.renderContent();

    try {
      const changed = await this.options.modelAgentManager.requestContextChange({
        providerId,
        modelId
      });
      if (this.isDisposed) {
        return;
      }

      if (changed) {
        if (!this.options.getConversationId()) {
          this.options.modelAgentManager.carrySelectionsIntoNextConversation();
        }
        this.options.onChanged();
      }
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Failed to switch model');
    } finally {
      this.isSwitching = false;
      if (!this.isDisposed && this.isOpen) {
        this.renderContent();
      }
    }
  }

  private async selectEffort(effortValue: string): Promise<void> {
    if (this.isSwitching || this.isDisposed) {
      return;
    }

    const current = this.options.modelAgentManager.getThinkingSettings();
    const nextSettings: ThinkingSettings = effortValue === 'off'
      ? { enabled: false, effort: current.effort }
      : this.isThinkingEffort(effortValue)
        ? { enabled: true, effort: effortValue }
        : current;

    this.options.modelAgentManager.setThinkingSettings(nextSettings);

    const conversationId = this.options.getConversationId();
    this.isSwitching = true;
    this.renderContent();

    try {
      if (conversationId) {
        await this.options.modelAgentManager.saveToConversation(conversationId);
      } else {
        this.options.modelAgentManager.carrySelectionsIntoNextConversation();
      }
      if (!this.isDisposed) {
        this.options.onChanged();
      }
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Failed to update thinking effort');
    } finally {
      this.isSwitching = false;
      if (!this.isDisposed && this.isOpen) {
        this.renderContent();
      }
    }
  }

  private isThinkingEffort(value: string): value is ThinkingEffort {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
  }

  private isElement(value: EventTarget | null): value is Element {
    return typeof value === 'object' && value !== null && 'closest' in value && typeof value.closest === 'function';
  }

  private isNode(value: EventTarget | null): value is Node {
    return typeof value === 'object' && value !== null && 'nodeType' in value;
  }
}
