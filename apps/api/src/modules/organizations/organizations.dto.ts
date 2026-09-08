import { z } from 'zod';

export const createOrganizationSchema = z.object({
  legalName: z.string().min(2).max(200),
  country: z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .transform((v) => v.toUpperCase()),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, digits and hyphens only')
    .optional(),
  baseCurrency: z.string().length(3).default('EUR'),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
