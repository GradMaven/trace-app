import type { AIProvider, AIProviderConfig } from '../types';
import { ClaudeAIProvider } from './claude';
import { StubAIProvider } from './stub';

export { ClaudeAIProvider } from './claude';
export { StubAIProvider, STUB_MODEL } from './stub';
export { estimateCostEur } from './cost';

export function createAIProvider(config: AIProviderConfig): AIProvider {
  const useClaude =
    config.mode === 'claude' ||
    (config.mode === 'auto' && !!config.anthropicApiKey);

  if (useClaude) {
    if (!config.anthropicApiKey) {
      throw new Error('AI_PROVIDER=claude but ANTHROPIC_API_KEY is not set.');
    }
    return new ClaudeAIProvider(config.anthropicApiKey, {
      extraction: config.extractionModel,
      classification: config.classificationModel,
    });
  }
  return new StubAIProvider();
}
