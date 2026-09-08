import { z } from 'zod';

/**
 * Single source of truth for environment configuration.
 *
 * Nothing in TRACE reads `process.env` directly — everything goes through
 * `loadEnv()` so that (a) the shape is validated once at boot and (b) a missing
 * or malformed variable fails loudly instead of surfacing as `undefined` deep in
 * a request.
 */

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // API
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters')
    .default('dev-only-insecure-session-secret-change-me'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(15),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_URL_TEST: z.string().url().optional(),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // Object storage (S3-compatible, EU)
  STORAGE_ENDPOINT: z.string().url().optional().or(z.literal('')).default(''),
  STORAGE_REGION: z.string().default('eu-central-1'),
  STORAGE_BUCKET: z.string().default('trace-dev'),
  STORAGE_ACCESS_KEY_ID: z.string().default(''),
  STORAGE_SECRET_ACCESS_KEY: z.string().default(''),

  // AI (Phase 5+; optional in Phase 1)
  ANTHROPIC_API_KEY: z.string().default(''),
  AI_MODEL_EXTRACTION: z.string().default('claude-sonnet-5'),
  AI_MODEL_CLASSIFICATION: z.string().default('claude-haiku-4-5'),

  // Observability
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal('')).default(''),
  SENTRY_DSN: z.string().optional().or(z.literal('')).default(''),

  // Email (magic links)
  EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  SMTP_URL: z.string().optional().or(z.literal('')).default(''),
  EMAIL_FROM: z.string().default('no-reply@trace.local'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export interface LoadEnvOptions {
  /** Raw source; defaults to `process.env`. */
  source?: NodeJS.ProcessEnv;
  /** Bypass the module-level cache (useful in tests). */
  fresh?: boolean;
}

export function loadEnv(options: LoadEnvOptions = {}): Env {
  if (cached && !options.fresh) return cached;

  const parsed = envSchema.safeParse(options.source ?? process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  if (parsed.data.NODE_ENV === 'production') {
    assertProductionSecrets(parsed.data);
  }

  if (!options.fresh) cached = parsed.data;
  return parsed.data;
}

function assertProductionSecrets(env: Env): void {
  const problems: string[] = [];
  if (env.SESSION_SECRET === 'dev-only-insecure-session-secret-change-me') {
    problems.push('SESSION_SECRET must be set to a real secret in production');
  }
  if (problems.length > 0) {
    throw new Error(`Unsafe production configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/** Test helper: drop the cached env so the next `loadEnv()` re-parses. */
export function resetEnvCache(): void {
  cached = undefined;
}
