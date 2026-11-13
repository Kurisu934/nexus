import type { AnthropicCompatibleAuthMode, AntigravityCompatibleAuthMode, AntigravityCompatibleWireProtocol, LLMProviderConfig } from '../../types/llm/ProviderTypes';
import { isOpenAICompatibleContextWindow, isOpenAICompatibleModelId, OPENAI_COMPATIBLE_MAX_CONTEXT_WINDOW, OPENAI_COMPATIBLE_MIN_CONTEXT_WINDOW } from '../../services/llm/adapters/openai-compatible/OpenAICompatibleConfig';
import type { OpenAICompatibleContextCheckResult } from '../../services/llm/adapters/openai-compatible/OpenAICompatibleContextCheck';
import { checkAnthropicCompatibleContextWindow, discoverAnthropicCompatibleModels, normalizeAnthropicCompatibleBaseUrl, resolveAnthropicCompatibleContextWindow, validateAnthropicCompatibleConfig } from '../../services/llm/adapters/anthropic-compatible/AnthropicCompatibleConfig';
import { checkAntigravityCompatibleContextWindow, discoverAntigravityCompatibleModels, normalizeAntigravityCompatibleBaseUrl, resolveAntigravityCompatibleContextWindow, validateAntigravityCompatibleConfig } from '../../services/llm/adapters/antigravity-compatible/AntigravityCompatibleConfig';

export type CustomCompatibleKind = 'anthropic-compatible' | 'antigravity-compatible';
export type CustomCompatibleEndpointConfig = LLMProviderConfig & (
  | { driverKind: 'anthropic-compatible'; anthropicCompatible: NonNullable<LLMProviderConfig['anthropicCompatible']> }
  | { driverKind: 'antigravity-compatible'; antigravityCompatible: NonNullable<LLMProviderConfig['antigravityCompatible']> }
);

export function isCustomEndpoint(config: LLMProviderConfig, kind: CustomCompatibleKind): config is CustomCompatibleEndpointConfig {
  return kind === 'anthropic-compatible'
    ? config.driverKind === kind && config.anthropicCompatible?.schemaVersion === 1
    : config.driverKind === kind && config.antigravityCompatible?.schemaVersion === 1;
}

export function copyCustomEndpoint(config: CustomCompatibleEndpointConfig): CustomCompatibleEndpointConfig {
  const models = Object.fromEntries(Object.entries(config.models ?? {}).map(([id, model]) => [id, { ...model }]));
  if (config.driverKind === 'anthropic-compatible') {
    const endpoint = config.anthropicCompatible;
    return { ...config, models, anthropicCompatible: { ...endpoint, models: Object.fromEntries(Object.entries(endpoint.models).map(([id, model]) => [id, { ...model }])) } };
  }
  const endpoint = config.antigravityCompatible;
  return { ...config, models, antigravityCompatible: { ...endpoint, models: Object.fromEntries(Object.entries(endpoint.models).map(([id, model]) => [id, { ...model }])) } };
}

export class CustomCompatibleEditSession {
  readonly draft: CustomCompatibleEndpointConfig;
  private revision = 0;
  private closed = false;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(readonly id: string, config: CustomCompatibleEndpointConfig, private readonly persist: (id: string, config: CustomCompatibleEndpointConfig) => Promise<void>) {
    this.draft = copyCustomEndpoint(config);
  }

  get endpoint() {
    return this.draft.driverKind === 'anthropic-compatible' ? this.draft.anthropicCompatible : this.draft.antigravityCompatible;
  }

  setName(value: string): void { this.endpoint.displayName = value; }
  setBaseUrl(value: string): void {
    if (value === this.endpoint.baseUrl) return;
    this.revision++;
    this.endpoint.baseUrl = value;
  }
  setApiKey(value: string): void { this.revision++; this.draft.apiKey = value; }
  setAnthropicAuthMode(value: AnthropicCompatibleAuthMode): void {
    if (this.draft.driverKind !== 'anthropic-compatible') return;
    this.revision++;
    this.draft.anthropicCompatible.authMode = value;
  }
  setAntigravityWireProtocol(value: AntigravityCompatibleWireProtocol): void {
    if (this.draft.driverKind !== 'antigravity-compatible') return;
    this.revision++;
    this.draft.antigravityCompatible.wireProtocol = value;
  }
  setAntigravityAuthMode(value: AntigravityCompatibleAuthMode): void {
    if (this.draft.driverKind !== 'antigravity-compatible') return;
    this.revision++;
    this.draft.antigravityCompatible.authMode = value;
  }
  setModelEnabled(id: string, enabled: boolean): void {
    this.draft.models = { ...this.draft.models, [id]: { ...this.draft.models?.[id], enabled } };
  }
  setContextWindow(id: string, value: number | undefined): void {
    const definition = this.endpoint.models[id];
    if (!definition) throw new Error('This model is not in the list.');
    if (value !== undefined && !isOpenAICompatibleContextWindow(value)) {
      throw new Error(`Enter a whole number of tokens from ${OPENAI_COMPATIBLE_MIN_CONTEXT_WINDOW.toLocaleString()} to ${OPENAI_COMPATIBLE_MAX_CONTEXT_WINDOW.toLocaleString()}.`);
    }
    const next = { ...definition };
    if (value === undefined) delete next.contextWindow;
    else next.contextWindow = value;
    this.endpoint.models = { ...this.endpoint.models, [id]: next };
  }
  useContextWindow(id: string, value: number): string {
    const followsServer = this.endpoint.models[id]?.reportedContextWindow === value;
    this.setContextWindow(id, followsServer ? undefined : value);
    return followsServer ? '' : String(value);
  }
  resolveContextWindow(id: string, ignoreUser = false) {
    const definition = this.endpoint.models[id];
    const effective = ignoreUser && definition ? { ...definition, contextWindow: undefined } : definition;
    return this.draft.driverKind === 'anthropic-compatible'
      ? resolveAnthropicCompatibleContextWindow(effective, id)
      : resolveAntigravityCompatibleContextWindow(effective, id);
  }
  async checkContextWindow(id: string, signal?: AbortSignal): Promise<OpenAICompatibleContextCheckResult> {
    const error = this.validationError();
    if (error) throw new Error(error);
    if (!this.endpoint.models[id]) throw new Error('This model is not in the list.');
    const request = { baseUrl: this.endpoint.baseUrl, apiKey: this.draft.apiKey, model: id, contextWindow: this.resolveContextWindow(id).contextWindow, signal };
    return this.draft.driverKind === 'anthropic-compatible'
      ? checkAnthropicCompatibleContextWindow({ ...request, authMode: this.draft.anthropicCompatible.authMode })
      : checkAntigravityCompatibleContextWindow({ ...request, authMode: this.draft.antigravityCompatible.authMode, wireProtocol: this.draft.antigravityCompatible.wireProtocol });
  }
  validationError(): string | null {
    if (!this.endpoint.displayName.trim()) return 'Enter a name for this endpoint.';
    try {
      if (this.draft.driverKind === 'anthropic-compatible') validateAnthropicCompatibleConfig(this.draft);
      else validateAntigravityCompatibleConfig(this.draft);
      return null;
    } catch (error) { return error instanceof Error ? error.message : 'Enter a valid API base URL.'; }
  }
  async save(): Promise<void> {
    const error = this.validationError();
    if (error) throw new Error(error);
    const snapshot = copyCustomEndpoint(this.draft);
    const endpoint = snapshot.driverKind === 'anthropic-compatible' ? snapshot.anthropicCompatible : snapshot.antigravityCompatible;
    endpoint.displayName = endpoint.displayName.trim();
    endpoint.baseUrl = snapshot.driverKind === 'anthropic-compatible' ? normalizeAnthropicCompatibleBaseUrl(endpoint.baseUrl) : normalizeAntigravityCompatibleBaseUrl(endpoint.baseUrl);
    const pending = this.saveQueue.catch(() => undefined).then(() => this.persist(this.id, snapshot));
    this.saveQueue = pending;
    return pending;
  }
  addModel(value: string): void {
    const id = value.trim();
    if (!isOpenAICompatibleModelId(id)) throw new Error('Enter the model ID expected by your server, without control characters.');
    if (Object.prototype.hasOwnProperty.call(this.endpoint.models, id)) throw new Error('This model is already in the list.');
    const error = this.validationError();
    if (error) throw new Error(error);
    this.endpoint.models = { ...this.endpoint.models, [id]: { source: 'manual' } };
    this.setModelEnabled(id, true);
    this.draft.enabled = true;
  }
  async connect(): Promise<'connected' | 'empty' | 'stale'> {
    const error = this.validationError();
    if (error) throw new Error(error);
    const revision = ++this.revision;
    const config = this.draft;
    try {
      const discovered = config.driverKind === 'anthropic-compatible'
        ? await discoverAnthropicCompatibleModels(normalizeAnthropicCompatibleBaseUrl(config.anthropicCompatible.baseUrl), config.apiKey, config.anthropicCompatible.authMode)
        : await discoverAntigravityCompatibleModels(normalizeAntigravityCompatibleBaseUrl(config.antigravityCompatible.baseUrl), config.apiKey, config.antigravityCompatible.wireProtocol, config.antigravityCompatible.authMode);
      if (this.closed || revision !== this.revision) return 'stale';
      for (const { id, contextWindow } of discovered) {
        const existing = Object.prototype.hasOwnProperty.call(this.endpoint.models, id) ? this.endpoint.models[id] : undefined;
        const next = { ...(existing ?? { source: 'discovered' as const }) };
        if (contextWindow === undefined) delete next.reportedContextWindow;
        else next.reportedContextWindow = contextWindow;
        this.endpoint.models = { ...this.endpoint.models, [id]: next };
        if (!existing) this.setModelEnabled(id, true);
      }
      if (discovered.length > 0) this.draft.enabled = true;
      await this.save();
      return this.closed || revision !== this.revision ? 'stale' : discovered.length ? 'connected' : 'empty';
    } catch (error) {
      if (this.closed || revision !== this.revision) return 'stale';
      throw error;
    }
  }
  close(): void { this.closed = true; this.revision++; }
}
