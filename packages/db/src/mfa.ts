import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { withOrgContext, type PrismaClient } from './client';
import { writeAuditLog } from './audit';

/**
 * TOTP two-factor auth persistence (Phase 13b). `user_mfa` is platform-scoped
 * (keyed on the user, spans every org) and not RLS'd — like `session`. The pure
 * crypto is in `@trace/domain/access/totp`; this module stores the secret and
 * the hashed single-use recovery codes and drives enrolment / challenge / disable.
 */

export interface MfaStatus {
  enrolled: boolean;
  pending: boolean;
  confirmedAt: string | null;
  recoveryCodesRemaining: number;
  lastUsedAt: string | null;
}

export async function getMfaStatus(prisma: PrismaClient, userId: string): Promise<MfaStatus> {
  const row = await prisma.userMfa.findUnique({ where: { userId } });
  return {
    enrolled: !!row?.confirmedAt,
    pending: !!row && !row.confirmedAt,
    confirmedAt: row?.confirmedAt?.toISOString() ?? null,
    recoveryCodesRemaining: row?.recoveryCodes.length ?? 0,
    lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
  };
}

/** Start enrolment: mint a secret (unconfirmed). Returns the secret + otpauth URI. */
export async function beginMfaEnrollment(
  prisma: PrismaClient,
  userId: string,
  accountName: string,
): Promise<{ secret: string; otpauthUrl: string }> {
  const existing = await prisma.userMfa.findUnique({ where: { userId } });
  if (existing?.confirmedAt) {
    throw AppError.conflict(
      'mfa.already_enrolled',
      'Two-factor auth is already enabled. Disable it first to re-enrol.',
    );
  }
  const secret = generateTotpSecret();
  await prisma.userMfa.upsert({
    where: { userId },
    create: { userId, secret, recoveryCodes: [] },
    update: { secret, recoveryCodes: [], confirmedAt: null },
  });
  return { secret, otpauthUrl: otpauthUrl({ secret, accountName }) };
}

/** Confirm enrolment with a live code. Returns the one-time recovery codes. */
export async function confirmMfaEnrollment(
  prisma: PrismaClient,
  args: { userId: string; code: string; organizationId?: string; requestId?: string },
): Promise<{ recoveryCodes: string[] }> {
  const row = await prisma.userMfa.findUnique({ where: { userId: args.userId } });
  if (!row) throw AppError.unprocessable('mfa.not_started', 'Start enrolment before confirming.');
  if (row.confirmedAt)
    throw AppError.conflict('mfa.already_enrolled', 'Two-factor auth is already enabled.');
  if (verifyTotp(row.secret, args.code) === null) {
    throw AppError.unprocessable(
      'mfa.bad_code',
      'That code is not valid. Check your authenticator app and try again.',
    );
  }

  const recoveryCodes = generateRecoveryCodes();
  await prisma.userMfa.update({
    where: { userId: args.userId },
    data: {
      confirmedAt: new Date(),
      lastUsedAt: new Date(),
      recoveryCodes: recoveryCodes.map(hashRecoveryCode),
    },
  });
  await prisma.user.update({ where: { id: args.userId }, data: { mfaEnabled: true } });

  if (args.organizationId) {
    await withOrgContext(args.organizationId, (db) =>
      writeAuditLog(db, {
        organizationId: args.organizationId!,
        actorId: args.userId,
        action: 'mfa.enrolled',
        resourceType: 'user_mfa',
        resourceId: args.userId,
        before: null,
        after: { method: 'totp' },
        requestId: args.requestId ?? 'unknown',
      }),
    );
  }
  return { recoveryCodes };
}

/**
 * Verify an MFA challenge for an already-enrolled user: a TOTP code, or a
 * single-use recovery code (which is then consumed). Returns whether it passed.
 */
export async function verifyMfaChallenge(
  prisma: PrismaClient,
  args: { userId: string; code: string },
): Promise<{ ok: boolean; usedRecoveryCode: boolean; recoveryCodesRemaining: number }> {
  const row = await prisma.userMfa.findUnique({ where: { userId: args.userId } });
  if (!row?.confirmedAt) return { ok: false, usedRecoveryCode: false, recoveryCodesRemaining: 0 };

  if (verifyTotp(row.secret, args.code) !== null) {
    await prisma.userMfa.update({
      where: { userId: args.userId },
      data: { lastUsedAt: new Date() },
    });
    return { ok: true, usedRecoveryCode: false, recoveryCodesRemaining: row.recoveryCodes.length };
  }

  const presentedHash = hashRecoveryCode(args.code);
  if (row.recoveryCodes.includes(presentedHash)) {
    const remaining = row.recoveryCodes.filter((h) => h !== presentedHash);
    await prisma.userMfa.update({
      where: { userId: args.userId },
      data: { recoveryCodes: remaining, lastUsedAt: new Date() },
    });
    return { ok: true, usedRecoveryCode: true, recoveryCodesRemaining: remaining.length };
  }

  return { ok: false, usedRecoveryCode: false, recoveryCodesRemaining: row.recoveryCodes.length };
}

export async function disableMfa(
  prisma: PrismaClient,
  args: { userId: string; code: string; organizationId?: string; requestId?: string },
): Promise<void> {
  const row = await prisma.userMfa.findUnique({ where: { userId: args.userId } });
  if (!row?.confirmedAt)
    throw AppError.unprocessable('mfa.not_enrolled', 'Two-factor auth is not enabled.');

  const check = await verifyMfaChallenge(prisma, { userId: args.userId, code: args.code });
  if (!check.ok) {
    throw AppError.unprocessable(
      'mfa.bad_code',
      'That code is not valid — enter a current code or a recovery code.',
    );
  }
  await prisma.userMfa.delete({ where: { userId: args.userId } });
  await prisma.user.update({ where: { id: args.userId }, data: { mfaEnabled: false } });

  if (args.organizationId) {
    await withOrgContext(args.organizationId, (db) =>
      writeAuditLog(db, {
        organizationId: args.organizationId!,
        actorId: args.userId,
        action: 'mfa.disabled',
        resourceType: 'user_mfa',
        resourceId: args.userId,
        before: { method: 'totp' },
        after: null,
        requestId: args.requestId ?? 'unknown',
      }),
    );
  }
}

/**
 * For the AuthGuard: does this user have to pass MFA on the current session?
 * True if they are enrolled, or if their active org mandates it (even before
 * they enrol — they must then enrol to proceed).
 */
export async function resolveMfaRequirement(
  prisma: PrismaClient,
  userId: string,
  activeOrganizationId: string | null,
): Promise<{ mustSatisfy: boolean; enrolled: boolean; orgMandates: boolean }> {
  const [row, org] = await Promise.all([
    prisma.userMfa.findUnique({ where: { userId }, select: { confirmedAt: true } }),
    activeOrganizationId
      ? prisma.organization.findUnique({
          where: { id: activeOrganizationId },
          select: { requireMfa: true },
        })
      : Promise.resolve(null),
  ]);
  const enrolled = !!row?.confirmedAt;
  const orgMandates = !!org?.requireMfa;
  return { mustSatisfy: enrolled || orgMandates, enrolled, orgMandates };
}
