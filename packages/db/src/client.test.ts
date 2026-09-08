import { describe, expect, it } from 'vitest';
import { assertUuid } from './client';

describe('assertUuid', () => {
  it('accepts a well-formed UUID', () => {
    expect(assertUuid('00000000-0000-4000-8000-0000000000d1')).toBe(
      '00000000-0000-4000-8000-0000000000d1',
    );
  });

  it('rejects non-UUID strings (SQL-injection guard for set_config scope)', () => {
    expect(() => assertUuid("'; drop table organization; --")).toThrow(/UUID/);
    expect(() => assertUuid('nordwerk')).toThrow(/UUID/);
    expect(() => assertUuid('')).toThrow(/UUID/);
  });
});
