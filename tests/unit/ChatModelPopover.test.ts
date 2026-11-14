import { Component, createFakeRoot, FakeElement } from 'obsidian';
import { ChatModelPopover } from '../../src/ui/chat/components/ChatModelPopover';
import type { ModelAgentManager } from '../../src/ui/chat/services/ModelAgentManager';
import type { ModelOption } from '../../src/ui/chat/types/SelectionTypes';
import type { ThinkingSettings } from '../../src/types/llm/ProviderTypes';

function makeModel(overrides: Partial<ModelOption> = {}): ModelOption {
  return {
    providerId: 'openai',
    providerName: 'OpenAI',
    modelId: 'gpt-5',
    modelName: 'GPT-5',
    contextWindow: 200000,
    supportsThinking: true,
    ...overrides
  };
}

function attachRect(el: FakeElement, rect: Partial<DOMRect>): void {
  const getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 360,
    height: 400,
    top: 0,
    left: 0,
    bottom: 400,
    right: 360,
    toJSON: () => ({}),
    ...rect
  });
  Object.assign(el, { getBoundingClientRect });
}

function attachStylePropertySupport(el: FakeElement): void {
  Object.defineProperty(el.style, 'setProperty', {
    enumerable: false,
    configurable: true,
    value: (name: string, value: string) => {
      el.style[name] = value;
    }
  });
}

function createPopoverHarness(options?: {
  models?: ModelOption[];
  selected?: ModelOption | null;
  thinking?: ThinkingSettings;
  conversationId?: string | null;
}) {
  const root = createFakeRoot('div');
  attachRect(root, { top: 40, bottom: 540, height: 500 });

  const dock = root.createDiv('chat-composer-dock');
  attachRect(dock, { top: 410, bottom: 530, height: 120 });
  const anchor = dock.createEl('button', { cls: 'chat-model-pill' });
  attachRect(anchor, { top: 420, bottom: 452, height: 32 });

  const models = options?.models ?? [
    makeModel({ providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-sonnet-4-6', modelName: 'Claude Sonnet 4.6', contextWindow: 200000, supportsThinking: true }),
    makeModel({ providerId: 'openai', providerName: 'OpenAI', modelId: 'gpt-5.4', modelName: 'GPT-5.4', contextWindow: 1000000, supportsThinking: true }),
    makeModel({ providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-opus-4-6', modelName: 'Claude Opus 4.6', contextWindow: 200000, supportsThinking: true }),
  ];

  let selectedModel: ModelOption | null = options?.selected === undefined ? models[0] ?? null : options.selected;
  let thinkingSettings: ThinkingSettings = options?.thinking ?? { enabled: true, effort: 'medium' };

  const modelAgentManager = {
    getAvailableModels: jest.fn(async () => models),
    getSelectedModel: jest.fn(() => selectedModel),
    getThinkingSettings: jest.fn(() => thinkingSettings),
    setThinkingSettings: jest.fn((next: ThinkingSettings) => {
      thinkingSettings = next;
    }),
    requestContextChange: jest.fn(async (req: { providerId: string; modelId: string }) => {
      const next = models.find(m => m.providerId === req.providerId && m.modelId === req.modelId) ?? null;
      if (!next) return false;
      selectedModel = next;
      return true;
    }),
    saveToConversation: jest.fn(async () => undefined),
    carrySelectionsIntoNextConversation: jest.fn()
  };

  const component = new Component();
  component.load();
  const onChanged = jest.fn();
  const onVisibilityChange = jest.fn();

  const popover = new ChatModelPopover({
    containerEl: root as unknown as HTMLElement,
    modelAgentManager: modelAgentManager as unknown as ModelAgentManager,
    getConversationId: () => options?.conversationId ?? null,
    component,
    onChanged,
    onVisibilityChange
  });

  const popoverEl = root.querySelector('.chat-model-popover')!;
  attachStylePropertySupport(popoverEl);

  return {
    root,
    dock,
    anchor,
    popover,
    popoverEl,
    component,
    modelAgentManager,
    onChanged,
    onVisibilityChange
  };
}

describe('ChatModelPopover', () => {
  it('groups models by providerName in first-seen order and renders main/sub/check structure', async () => {
    const { popover, popoverEl, anchor, component } = createPopoverHarness();

    await popover.open(anchor as unknown as HTMLElement);

    const groupHeaders = popoverEl.querySelectorAll('.chat-model-group-header');
    expect(groupHeaders.map(el => el.textContent)).toEqual(['Anthropic', 'OpenAI']);

    const options = popoverEl.querySelectorAll('.chat-model-option');
    expect(options).toHaveLength(3);
    expect(options.map(btn => btn.getAttribute('data-model-id'))).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'gpt-5.4'
    ]);

    const firstMain = options[0].querySelector('.chat-model-option-main');
    expect(firstMain?.querySelector('.chat-model-option-name')?.textContent).toBe('Claude Sonnet 4.6');
    expect(firstMain?.querySelector('.chat-model-option-sub')?.textContent).toBe('200K');
    expect(options[0].hasClass('is-selected')).toBe(true);
    expect(options[0].querySelector('.chat-model-option-check')).not.toBeNull();
    expect(options[1].querySelector('.chat-model-option-check')).toBeNull();

    // <= 5 models omits the search bar
    expect(popoverEl.querySelector('.chat-model-search-wrap')).toBeNull();

    popover.cleanup();
    component.unload();
  });

  it('scrolls the selected model button into view on initial open', async () => {
    const models = [
      makeModel({ providerId: 'openai', providerName: 'OpenAI', modelId: 'gpt-5', modelName: 'GPT-5' }),
      makeModel({ providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-opus-4-6', modelName: 'Claude Opus 4.6' })
    ];
    const { popover, popoverEl, anchor, component } = createPopoverHarness({
      models,
      selected: models[1]
    });

    const scrollSpy = jest.fn();
    const originalCreateEl = FakeElement.prototype.createEl;
    const createElSpy = jest.spyOn(FakeElement.prototype, 'createEl').mockImplementation(function (
      this: FakeElement,
      tag: string,
      info?: Parameters<FakeElement['createEl']>[1],
      cb?: Parameters<FakeElement['createEl']>[2]
    ) {
      const created = originalCreateEl.call(this, tag, info, cb);
      if (tag === 'button') {
        Object.assign(created, { scrollIntoView: scrollSpy });
      }
      return created;
    });

    try {
      await popover.open(anchor as unknown as HTMLElement);
      const selectedBtn = popoverEl.querySelector('.chat-model-option.is-selected');
      expect(selectedBtn).not.toBeNull();
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      createElSpy.mockRestore();
      popover.cleanup();
      component.unload();
    }
  });

  it('shows filter input when > 5 models, filters list in-place without recreating input, and resets on close', async () => {
    const models = [
      makeModel({ providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-sonnet-4-6', modelName: 'Claude Sonnet 4.6' }),
      makeModel({ providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-opus-4-6', modelName: 'Claude Opus 4.6' }),
      makeModel({ providerId: 'openai', providerName: 'OpenAI', modelId: 'gpt-5', modelName: 'GPT-5' }),
      makeModel({ providerId: 'openai', providerName: 'OpenAI', modelId: 'gpt-5.4', modelName: 'GPT-5.4' }),
      makeModel({ providerId: 'google', providerName: 'Google', modelId: 'gemini-3.1-pro-preview', modelName: 'Gemini 3.1 Pro' }),
      makeModel({ providerId: 'ollama', providerName: 'Ollama', modelId: 'qwen3:8b', modelName: 'Qwen 3 8B', contextWindow: 0, supportsThinking: false }),
    ];

    const { popover, popoverEl, anchor, component } = createPopoverHarness({
      models,
      selected: models[0]
    });

    await popover.open(anchor as unknown as HTMLElement);

    const searchInput = popoverEl.querySelector('.chat-model-search-input');
    expect(searchInput).not.toBeNull();
    expect(searchInput?.getAttribute('type')).toBe('search');
    expect(popoverEl.querySelectorAll('.chat-model-option')).toHaveLength(6);

    // Filter to Gemini
    searchInput!.value = 'gemini';
    searchInput!.dispatch('input');

    // Input node must remain the exact same instance (focus preserved)
    expect(popoverEl.querySelector('.chat-model-search-input')).toBe(searchInput);
    const filteredOptions = popoverEl.querySelectorAll('.chat-model-option');
    expect(filteredOptions).toHaveLength(1);
    expect(filteredOptions[0].getAttribute('data-model-id')).toBe('gemini-3.1-pro-preview');
    expect(popoverEl.querySelectorAll('.chat-model-group-header').map(el => el.textContent)).toEqual(['Google']);

    // Filter with no matches keeps search input intact and shows empty state
    searchInput!.value = 'nonexistent-model';
    searchInput!.dispatch('input');
    expect(popoverEl.querySelector('.chat-model-search-input')).toBe(searchInput);
    expect(popoverEl.querySelector('.chat-model-empty')?.textContent).toBe('No matching models');

    // Close resets filterQuery so reopening restores all models
    popover.close();
    await popover.open(anchor as unknown as HTMLElement);
    expect(popoverEl.querySelector('.chat-model-search-input')?.value).toBe('');
    expect(popoverEl.querySelectorAll('.chat-model-option')).toHaveLength(6);

    popover.cleanup();
    component.unload();
  });

  it('sets --chat-popover-bottom and --chat-popover-max-height and clamps short panes to 180px', async () => {
    const { popover, popoverEl, dock, anchor, component } = createPopoverHarness();

    await popover.open(anchor as unknown as HTMLElement);

    // container bottom (540) - dock top (410) + 8 = 138px
    expect(popoverEl.style['--chat-popover-bottom']).toBe('138px');
    // dock top (410) - container top (40) - 16 = 354px
    expect(popoverEl.style['--chat-popover-max-height']).toBe('354px');

    // Short split pane where dock top is close to container top -> clamps at 180px
    popover.close();
    attachRect(dock, { top: 120, bottom: 240, height: 120 });
    await popover.open(anchor as unknown as HTMLElement);
    expect(popoverEl.style['--chat-popover-max-height']).toBe('180px');

    popover.cleanup();
    component.unload();
  });

  it('omits sublabel for zero contextWindow and omits thinking section for non-thinking models', async () => {
    const localModel = makeModel({
      providerId: 'ollama',
      providerName: 'Ollama',
      modelId: 'llama3.2',
      modelName: 'Llama 3.2',
      contextWindow: 0,
      supportsThinking: false
    });
    const { popover, popoverEl, anchor, component } = createPopoverHarness({
      models: [localModel],
      selected: localModel
    });

    await popover.open(anchor as unknown as HTMLElement);

    expect(popoverEl.querySelector('.chat-model-option-sub')).toBeNull();
    expect(popoverEl.querySelector('.chat-effort-segmented')).toBeNull();

    popover.cleanup();
    component.unload();
  });

  it('updates thinking effort pills when switching effort or selecting another model', async () => {
    const models = [
      makeModel({ providerId: 'openai', providerName: 'OpenAI', modelId: 'gpt-5.4', modelName: 'GPT-5.4', supportsThinking: true }),
      makeModel({ providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-opus-4-6', modelName: 'Claude Opus 4.6', supportsThinking: true })
    ];
    const { popover, popoverEl, anchor, component, modelAgentManager, onChanged } = createPopoverHarness({
      models,
      selected: models[0],
      thinking: { enabled: true, effort: 'medium' },
      conversationId: 'conv-123'
    });

    await popover.open(anchor as unknown as HTMLElement);

    const effortButtons = popoverEl.querySelectorAll('.chat-effort-seg-btn');
    expect(effortButtons.map(b => b.getAttribute('data-effort'))).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);
    expect(effortButtons.find(b => b.getAttribute('data-effort') === 'medium')?.hasClass('is-active')).toBe(true);

    // Select 'high' effort
    const highBtn = effortButtons.find(b => b.getAttribute('data-effort') === 'high')!;
    popoverEl.dispatch('click', { target: highBtn });
    await Promise.resolve();
    await Promise.resolve();

    expect(modelAgentManager.setThinkingSettings).toHaveBeenCalledWith({ enabled: true, effort: 'high' });
    expect(modelAgentManager.saveToConversation).toHaveBeenCalledWith('conv-123');
    expect(onChanged).toHaveBeenCalled();
    expect(popoverEl.querySelector('.chat-effort-seg-btn.is-active')?.getAttribute('data-effort')).toBe('high');

    // Switch to Anthropic Opus 4.6 (supports low/medium/high/max, no xhigh)
    const opusBtn = popoverEl.querySelectorAll('.chat-model-option').find(
      b => b.getAttribute('data-model-id') === 'claude-opus-4-6'
    )!;
    popoverEl.dispatch('click', { target: opusBtn });
    await Promise.resolve();
    await Promise.resolve();

    expect(modelAgentManager.requestContextChange).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6'
    });
    const updatedEfforts = popoverEl.querySelectorAll('.chat-effort-seg-btn').map(b => b.getAttribute('data-effort'));
    expect(updatedEfforts).toEqual(['off', 'low', 'medium', 'high', 'max']);

    popover.cleanup();
    component.unload();
  });
});
