import type { z } from 'zod';

/**
 * Provider abstraction (ADR-005). Domain/pipeline code depends only on this
 * interface; the concrete provider (Claude, or a deterministic dev stub) is
 * chosen by `createAIProvider`.
 */

export type AICapability =
  | 'classification'
  | 'extraction'
  | 'data_quality'
  | 'evidence_reasoning'
  | 'compliance_mapping'
  | 'nl_analytics'
  | 'recommendation';

export interface StructuredRequest<T extends z.ZodTypeAny> {
  capability: AICapability;
  /** Fixed, versioned system prompt. */
  systemPrompt: string;
  promptVersion: string;
  /** Bounded, already-cited context (never "the whole document, figure it out"). */
  userContent: string;
  /** Name of the tool/function the model must call. */
  toolName: string;
  /** JSON Schema for the tool input. */
  toolInputSchema: Record<string, unknown>;
  /** Zod schema the parsed output must satisfy. */
  outputSchema: T;
  model?: string;
  maxTokens?: number;
}

export interface StructuredResult<T> {
  output: T;
  provider: 'claude' | 'stub';
  model: string;
  tokensIn: number;
  tokensOut: number;
  costEur: number;
  latencyMs: number;
  /** Provider-reported / heuristic confidence, 0–100. */
  confidence: number;
}

export interface AIProvider {
  readonly kind: 'claude' | 'stub';
  extractStructured<T extends z.ZodTypeAny>(
    req: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>>;
}

export interface AIProviderConfig {
  /** 'auto' picks claude when an API key is present, otherwise the stub. */
  mode: 'auto' | 'claude' | 'stub';
  anthropicApiKey?: string;
  extractionModel: string;
  classificationModel: string;
}
