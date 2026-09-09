import { z } from 'zod';
import { ROLE_KEYS } from '@trace/shared';

const assignableRoleKeys = ROLE_KEYS.filter((k) => k !== 'platform_admin') as [string, ...string[]];

export const inviteMemberSchema = z.object({
  email: z
    .string()
    .email()
    .max(320)
    .transform((v) => v.trim().toLowerCase()),
  roleKeys: z.array(z.enum(assignableRoleKeys)).min(1).max(ROLE_KEYS.length),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

// Custom role keys are validated against the org's own roles in the service, so
// this accepts any slug-shaped key rather than the built-in enum.
export const setMemberRolesSchema = z.object({
  roleKeys: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]{2,39}$/),
    )
    .min(1)
    .max(20),
});
export type SetMemberRolesInput = z.infer<typeof setMemberRolesSchema>;
