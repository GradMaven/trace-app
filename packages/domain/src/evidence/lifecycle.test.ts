import { describe, expect, it } from 'vitest';
import {
  canTransition,
  checkTransition,
  isTerminal,
  nextStates,
  requiredPermissionForTransition,
} from './lifecycle';

describe('evidence lifecycle', () => {
  it('allows the happy path uploaded → reviewed → verified', () => {
    expect(canTransition('uploaded', 'reviewed')).toBe(true);
    expect(canTransition('reviewed', 'verified')).toBe(true);
  });

  it('forbids skipping straight to verified', () => {
    expect(canTransition('uploaded', 'verified')).toBe(false);
  });

  it('treats superseded as terminal', () => {
    expect(isTerminal('superseded')).toBe(true);
    expect(nextStates('superseded')).toEqual([]);
  });

  it('requires evidence.verify for verified / rejected / expired only', () => {
    expect(requiredPermissionForTransition('verified')).toBe('evidence.verify');
    expect(requiredPermissionForTransition('rejected')).toBe('evidence.verify');
    expect(requiredPermissionForTransition('reviewed')).toBe('evidence.update');
    expect(requiredPermissionForTransition('superseded')).toBe('evidence.update');
  });

  it('checkTransition enforces the state machine and permissions', () => {
    expect(checkTransition('reviewed', 'verified', ['evidence.update'])).toMatchObject({
      ok: false,
      requiredPermission: 'evidence.verify',
    });
    expect(checkTransition('reviewed', 'verified', ['evidence.verify'])).toEqual({
      ok: true,
      requiredPermission: 'evidence.verify',
    });
    expect(checkTransition('uploaded', 'verified', ['evidence.verify'])).toMatchObject({ ok: false });
    expect(checkTransition('verified', 'verified', ['evidence.verify'])).toMatchObject({ ok: false });
  });
});
