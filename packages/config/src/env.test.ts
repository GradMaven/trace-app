import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/trace',
};

describe('loadEnv', () => {
  it('applies defaults for optional variables', () => {
    const env = loadEnv({ source: { ...base }, fresh: true });
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.SESSION_TTL_HOURS).toBe(12);
    expect(env.EMAIL_TRANSPORT).toBe('console');
  });

  it('coerces numeric strings', () => {
    const env = loadEnv({ source: { ...base, API_PORT: '8080' }, fresh: true });
    expect(env.API_PORT).toBe(8080);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadEnv({ source: {}, fresh: true })).toThrow(/DATABASE_URL/);
  });

  it('rejects a short SESSION_SECRET', () => {
    expect(() =>
      loadEnv({ source: { ...base, SESSION_SECRET: 'too-short' }, fresh: true }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('rejects the placeholder SESSION_SECRET in production', () => {
    expect(() =>
      loadEnv({ source: { ...base, NODE_ENV: 'production' }, fresh: true }),
    ).toThrow(/production/i);
  });

  it('accepts a valid production configuration', () => {
    const env = loadEnv({
      source: {
        ...base,
        NODE_ENV: 'production',
        SESSION_SECRET: 'x'.repeat(48),
      },
      fresh: true,
    });
    expect(env.NODE_ENV).toBe('production');
  });
});
