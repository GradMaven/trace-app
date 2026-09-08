import { z } from 'zod';

const country = z
  .string()
  .length(2)
  .regex(/^[A-Za-z]{2}$/)
  .transform((v) => v.toUpperCase());

export const contactInputSchema = z.object({
  email: z.string().email().max(320).transform((v) => v.trim().toLowerCase()),
  name: z.string().min(1).max(200),
  role: z.string().max(120).optional(),
  isPrimary: z.boolean().optional(),
});

export const locationInputSchema = z.object({
  kind: z.enum(['headquarters', 'site', 'warehouse', 'other']).default('site'),
  label: z.string().min(1).max(200),
  country,
  address: z.record(z.string(), z.string()).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const relationshipInputSchema = z.object({
  category: z.string().max(120).optional(),
  tier: z.number().int().min(1).max(10).optional(),
  annualSpend: z.number().nonnegative().optional(),
  currency: z
    .string()
    .length(3)
    .transform((v) => v.toUpperCase())
    .optional(),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const createSupplierSchema = z.object({
  name: z.string().min(2).max(200),
  country,
  industryNace: z.string().max(16).optional(),
  registrationIds: z.record(z.string(), z.string()).optional(),
  contacts: z.array(contactInputSchema).max(20).optional(),
  relationship: relationshipInputSchema.optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  country: country.optional(),
  industryNace: z.string().max(16).nullable().optional(),
  registrationIds: z.record(z.string(), z.string()).optional(),
});
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const listSuppliersQuerySchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

export type ContactInput = z.infer<typeof contactInputSchema>;
export type LocationInput = z.infer<typeof locationInputSchema>;
export type RelationshipInput = z.infer<typeof relationshipInputSchema>;
