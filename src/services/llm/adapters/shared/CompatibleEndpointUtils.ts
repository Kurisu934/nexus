import type {
  AntigravityCompatibleWireProtocol,
  CompatibleDriverKind,
  LLMProviderConfig,
  OpenAICompatibleModelDefinition,
} from '../../../../types/llm/ProviderTypes';

export type ProviderWireFamily = 'anthropic' | 'google' | 'openai-compatible';

const antigravityWireModes = new Map<string, AntigravityCompatibleWireProtocol>();

/** Keep runtime wire-family resolution in sync with saved endpoint settings. */
export function syncCompatibleWireProtocols(
  providers?: Record<string, LLMProviderConfig> | null
): void {
  antigravityWireModes.clear();
  if (!providers) return;
  for (const [id, config] of Object.entries(providers)) {
    if (config?.driverKind === 'antigravity-compatible') {
      antigravityWireModes.set(id, config.antigravityCompatible?.wireProtocol ?? 'auto');
    }
  }
}

export function setAntigravityWireProtocol(
  instanceId: string,
  protocol: AntigravityCompatibleWireProtocol
): void {
  antigravityWireModes.set(instanceId, protocol);
}

/** Strip optional gateway prefix (`agy_paid/gemini-4-carbon`) and `:1m` suffix. */
export function stripCompatibleModelPrefix(modelId: string): string {
  const withoutVariant = modelId.replace(':1m', '');
  const slashIndex = withoutVariant.lastIndexOf('/');
  return slashIndex >= 0 ? withoutVariant.slice(slashIndex + 1) : withoutVariant;
}

export function isClaudeFamilyModelId(modelId?: string | null): boolean {
  if (!modelId) return false;
  return /^claude-/i.test(stripCompatibleModelPrefix(modelId));
}

export function resolveAntigravityModelWire(
  modelId: string | undefined,
  wireProtocol: AntigravityCompatibleWireProtocol = 'auto'
): 'anthropic' | 'google' {
  if (wireProtocol === 'messages') return 'anthropic';
  if (wireProtocol === 'v1beta') return 'google';
  return isClaudeFamilyModelId(modelId) ? 'anthropic' : 'google';
}

export function resolveProviderWireFamily(
  provider?: string | null,
  model?: string | null
): ProviderWireFamily {
  if (!provider) return 'openai-compatible';
  const normalized = provider.toLowerCase();
  if (normalized === 'anthropic' || normalized.startsWith('anthropic-compatible-')) {
    return 'anthropic';
  }
  if (normalized === 'google') {
    return 'google';
  }
  if (normalized.startsWith('antigravity-compatible-')) {
    const mode = antigravityWireModes.get(provider) ?? antigravityWireModes.get(normalized) ?? 'auto';
    return resolveAntigravityModelWire(model ?? undefined, mode);
  }
  return 'openai-compatible';
}

export function isCustomCompatibleDriverKind(value?: string | null): value is CompatibleDriverKind {
  return value === 'openai-compatible'
    || value === 'anthropic-compatible'
    || value === 'antigravity-compatible';
}

export function isCustomCompatibleProviderId(providerId: string): boolean {
  return providerId.startsWith('openai-compatible-')
    || providerId.startsWith('anthropic-compatible-')
    || providerId.startsWith('antigravity-compatible-');
}

export function isCustomCompatibleConfig(config?: LLMProviderConfig | null): boolean {
  if (!config) return false;
  return (config.driverKind === 'openai-compatible' && config.openaiCompatible?.schemaVersion === 1)
    || (config.driverKind === 'anthropic-compatible' && config.anthropicCompatible?.schemaVersion === 1)
    || (config.driverKind === 'antigravity-compatible' && config.antigravityCompatible?.schemaVersion === 1);
}

export function getCustomCompatibleFallbackLabel(driverKind?: string): string {
  switch (driverKind) {
    case 'anthropic-compatible':
      return 'Anthropic-compatible';
    case 'antigravity-compatible':
      return 'Antigravity-compatible';
    default:
      return 'OpenAI-compatible';
  }
}

export function getCustomCompatibleDisplayName(config?: LLMProviderConfig | null): string {
  if (!config) return 'OpenAI-compatible';
  switch (config.driverKind) {
    case 'anthropic-compatible':
      return config.anthropicCompatible?.displayName || 'Anthropic-compatible';
    case 'antigravity-compatible':
      return config.antigravityCompatible?.displayName || 'Antigravity-compatible';
    default:
      return config.openaiCompatible?.displayName || 'OpenAI-compatible';
  }
}

export function getCustomCompatibleBaseUrl(config?: LLMProviderConfig | null): string {
  if (!config) return '';
  switch (config.driverKind) {
    case 'anthropic-compatible':
      return config.anthropicCompatible?.baseUrl?.trim() ?? '';
    case 'antigravity-compatible':
      return config.antigravityCompatible?.baseUrl?.trim() ?? '';
    case 'openai-compatible':
      return config.openaiCompatible?.baseUrl?.trim() ?? '';
    default:
      return '';
  }
}

export function getCustomCompatibleModelsRecord(
  config?: LLMProviderConfig | null
): Record<string, OpenAICompatibleModelDefinition> {
  if (!config) return {};
  switch (config.driverKind) {
    case 'anthropic-compatible':
      return config.anthropicCompatible?.models ?? {};
    case 'antigravity-compatible':
      return config.antigravityCompatible?.models ?? {};
    case 'openai-compatible':
      return config.openaiCompatible?.models ?? {};
    default:
      return {};
  }
}
