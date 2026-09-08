import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { AIProvider, StructuredRequest, StructuredResult } from '../types';
import { estimateCostEur } from './cost';

/**
 * Real provider: Anthropic Claude via the Messages API with forced tool use, so
 * the model must return structured input matching the tool's JSON schema. The
 * result is then re-validated with the caller's Zod schema; a failure is thrown
 * (never used).
 */
export class ClaudeAIProvider implements AIProvider {
  readonly kind = 'claude' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly models: { extraction: string; classification: string },
  ) {
    this.client = new Anthropic({ apiKey });
  }

  private modelFor(req: StructuredRequest<z.ZodTypeAny>): string {
    if (req.model) return req.model;
    return req.capability === 'classification'
      ? this.models.classification
      : this.models.extraction;
  }

  async extractStructured<T extends z.ZodTypeAny>(
    req: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>> {
    const model = this.modelFor(req);
    const start = Date.now();

    const res = await this.client.messages.create({
      model,
      max_tokens: req.maxTokens ?? 4096,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userContent }],
      tools: [
        {
          name: req.toolName,
          description: `Record the structured result for the ${req.capability} capability.`,
          input_schema: req.toolInputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: req.toolName },
    });

    const toolUse = res.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === req.toolName,
    );
    if (!toolUse) {
      throw new Error(`Claude did not call the "${req.toolName}" tool.`);
    }

    const parsed = req.outputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new Error(
        `Claude output failed validation: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }

    const tokensIn = res.usage.input_tokens;
    const tokensOut = res.usage.output_tokens;

    return {
      output: parsed.data,
      provider: 'claude',
      model,
      tokensIn,
      tokensOut,
      costEur: estimateCostEur(model, tokensIn, tokensOut),
      latencyMs: Date.now() - start,
      confidence: deriveConfidence(parsed.data),
    };
  }
}

function deriveConfidence(output: unknown): number {
  if (output && typeof output === 'object') {
    const o = output as { confidence?: unknown; candidates?: Array<{ confidence?: unknown }> };
    if (typeof o.confidence === 'number') return clamp(o.confidence);
    if (Array.isArray(o.candidates) && o.candidates.length > 0) {
      const vals = o.candidates
        .map((c) => (typeof c.confidence === 'number' ? c.confidence : NaN))
        .filter((n) => !Number.isNaN(n));
      if (vals.length > 0) return clamp(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  }
  return 50;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
