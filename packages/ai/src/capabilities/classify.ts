import type { AIProvider, StructuredResult } from '../types';
import {
  CLASSIFICATION_PROMPT_VERSION,
  CLASSIFICATION_SYSTEM_PROMPT,
} from '../prompts';
import { classificationSchema, type ClassificationResult } from '../schemas';
import { CLASSIFICATION_TOOL_SCHEMA } from './tool-schemas';

const MAX_CONTEXT_CHARS = 24_000;

export interface ClassifyInput {
  text: string;
  filename?: string;
  model?: string;
}

export async function classifyDocument(
  provider: AIProvider,
  input: ClassifyInput,
): Promise<StructuredResult<ClassificationResult>> {
  const context =
    (input.filename ? `Filename: ${input.filename}\n\n` : '') +
    `Document text:\n\n${input.text.slice(0, MAX_CONTEXT_CHARS)}`;

  return provider.extractStructured({
    capability: 'classification',
    systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
    promptVersion: CLASSIFICATION_PROMPT_VERSION,
    userContent: context,
    toolName: 'record_classification',
    toolInputSchema: CLASSIFICATION_TOOL_SCHEMA as unknown as Record<string, unknown>,
    outputSchema: classificationSchema,
    model: input.model,
    maxTokens: 512,
  });
}

export { CLASSIFICATION_PROMPT_VERSION };
