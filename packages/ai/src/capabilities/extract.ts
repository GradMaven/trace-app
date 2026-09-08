import type { AIProvider, StructuredResult } from '../types';
import { EXTRACTION_PROMPT_VERSION, EXTRACTION_SYSTEM_PROMPT } from '../prompts';
import { extractionSchema, type ExtractionResult } from '../schemas';
import { EXTRACTION_TOOL_SCHEMA } from './tool-schemas';
import type { ClassificationResult } from '../schemas';

const MAX_CONTEXT_CHARS = 40_000;

export interface ExtractInput {
  text: string;
  filename?: string;
  classification?: ClassificationResult | null;
  model?: string;
}

export async function extractDatapoints(
  provider: AIProvider,
  input: ExtractInput,
): Promise<StructuredResult<ExtractionResult>> {
  const header =
    (input.filename ? `Filename: ${input.filename}\n` : '') +
    (input.classification
      ? `Classified as: ${input.classification.documentType}` +
        (input.classification.issuer ? ` from ${input.classification.issuer}` : '') +
        (input.classification.reportingPeriod
          ? ` covering ${input.classification.reportingPeriod}`
          : '') +
        '\n'
      : '');
  const context = `${header}\nDocument text:\n\n${input.text.slice(0, MAX_CONTEXT_CHARS)}`;

  return provider.extractStructured({
    capability: 'extraction',
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    userContent: context,
    toolName: 'record_extraction',
    toolInputSchema: EXTRACTION_TOOL_SCHEMA as unknown as Record<string, unknown>,
    outputSchema: extractionSchema,
    model: input.model,
    maxTokens: 4096,
  });
}

export { EXTRACTION_PROMPT_VERSION };
