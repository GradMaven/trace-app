import { z } from 'zod';
import { ROLE_KEYS } from '@trace/shared';

const assignableRoleKeys = ROLE_KEYS.filter((k) => k !== 'platform_admin') as [string, ...string[]];

export const inviteMemberSchema = z.object({
  email: z.string().email().max(320).transform((v) => v.trim().toLowerCase()),
  roleKeys: z.array(z.enum(assignableRoleKeys)).min(1).max(ROLE_KEYS.length),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
