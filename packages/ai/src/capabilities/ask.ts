import type { AIProvider, StructuredResult } from '../types';
import {
  ASK_ANSWER_PROMPT_VERSION,
  ASK_ANSWER_SYSTEM_PROMPT,
  ASK_INTENT_PROMPT_VERSION,
  ASK_INTENT_SYSTEM_PROMPT,
} from '../prompts';
import {
  askAnswerSchema,
  askIntentSchema,
  type AskAnswerResult,
  type AskIntent,
  type AskIntentResult,
} from '../schemas';
import { ASK_ANSWER_TOOL_SCHEMA, ASK_INTENT_TOOL_SCHEMA } from './tool-schemas';

/**
 * Ask TRACE capability (Phase 10). Two model calls, both narrow:
 *  1. classifyAskIntent — free-text question → one fixed intent (never an answer).
 *  2. composeAskAnswer   — question + numbered records `@trace/db` retrieved
 *     with hand-written queries → a grounded answer + the record numbers used.
 * The model never authors a query and never answers tenant facts from parametric
 * knowledge.
 */

const MAX_QUESTION_CHARS = 1_000;

export interface ClassifyAskIntentInput {
  question: string;
  model?: string;
}

export async function classifyAskIntent(
  provider: AIProvider,
  input: ClassifyAskIntentInput,
): Promise<StructuredResult<AskIntentResult>> {
  return provider.extractStructured({
    capability: 'nl_analytics',
    systemPrompt: ASK_INTENT_SYSTEM_PROMPT,
    promptVersion: ASK_INTENT_PROMPT_VERSION,
    userContent: `QUESTION:\n${input.question.slice(0, MAX_QUESTION_CHARS)}`,
    toolName: 'record_intent',
    toolInputSchema: ASK_INTENT_TOOL_SCHEMA as unknown as Record<string, unknown>,
    outputSchema: askIntentSchema,
    model: input.model,
    maxTokens: 256,
  });
}

export interface AskRecordForModel {
  ref: number;
  kind: string;
  title: string;
  detail: string;
}

export interface ComposeAskAnswerInput {
  question: string;
  intent: AskIntent;
  records: AskRecordForModel[];
  model?: string;
}

export function renderAskRecords(records: AskRecordForModel[]): string {
  return records.map((r) => `[${r.ref}] (${r.kind}) ${r.title} — ${r.detail}`).join('\n');
}

export async function composeAskAnswer(
  provider: AIProvider,
  input: ComposeAskAnswerInput,
): Promise<StructuredResult<AskAnswerResult>> {
  const userContent =
    `QUESTION:\n${input.question.slice(0, MAX_QUESTION_CHARS)}\n\n` +
    `RECORDS (the only facts you may use):\n${renderAskRecords(input.records)}`;

  return provider.extractStructured({
    capability: 'nl_analytics',
    systemPrompt: ASK_ANSWER_SYSTEM_PROMPT,
    promptVersion: ASK_ANSWER_PROMPT_VERSION,
    userContent,
    toolName: 'compose_answer',
    toolInputSchema: ASK_ANSWER_TOOL_SCHEMA as unknown as Record<string, unknown>,
    outputSchema: askAnswerSchema,
    model: input.model,
    maxTokens: 1024,
  });
}

export { ASK_INTENT_PROMPT_VERSION, ASK_ANSWER_PROMPT_VERSION };
