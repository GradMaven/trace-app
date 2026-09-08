import { z } from 'zod';

export const requestMagicLinkSchema = z.object({
  email: z.string().email().max(320).transform((v) => v.trim().toLowerCase()),
});
export type RequestMagicLinkInput = z.infer<typeof requestMagicLinkSchema>;

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(20).max(200),
});
export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;

export const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
});
export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>;
