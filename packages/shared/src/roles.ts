import { ALL_PERMISSIONS, type Permission } from './permissions';

/**
 * Default role definitions.
 *
 * These are seeded per organization (and the platform role globally). Customers
 * with `role.manage` can create additional roles; these are the baseline the
 * product ships with. Role keys are stable identifiers — display names may be
 * localized later.
 */
export const ROLE_KEYS = [
  'platform_admin',
  'organization_admin',
  'sustainability_manager',
  'esg_analyst',
  'procurement_manager',
  'finance',
  'auditor',
  'supplier_user',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  isPlatform: boolean;
  permissions: readonly Permission[];
}

const READ_ONLY_SUSTAINABILITY: Permission[] = [
  'ai.read',
  'organization.read',
  'member.read',
  'role.read',
  'supplier.read',
  'evidence.read',
  'activity.read',
  'calculation.read',
  'candidate.read',
  'trust.read',
  'compliance.read',
  'audit.read',
];

export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  platform_admin: {
    key: 'platform_admin',
    name: 'Platform Admin',
    description: 'TRACE operator with cross-organization administrative access.',
    isPlatform: true,
    permissions: ALL_PERMISSIONS,
  },

  organization_admin: {
    key: 'organization_admin',
    name: 'Organization Admin',
    description: 'Full control of a single organization: members, roles, configuration, data.',
    isPlatform: false,
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'platform.admin'),
  },

  sustainability_manager: {
    key: 'sustainability_manager',
    name: 'Sustainability Manager',
    description:
      'Owns data collection, supplier engagement, evidence, calculations, and reporting.',
    isPlatform: false,
    permissions: [
      'organization.read',
      'member.read',
      'role.read',
      'supplier.read',
      'supplier.create',
      'supplier.update',
      'supplier.archive',
      'supplier.invite',
      'supplier.request',
      'evidence.read',
      'evidence.create',
      'evidence.update',
      'evidence.verify',
      'activity.read',
      'activity.create',
      'activity.update',
      'emission_factor.manage',
      'calculation.read',
      'calculation.run',
      'calculation.approve',
      'document.process',
      'candidate.read',
      'candidate.review',
      'ai.read',
      'trust.read',
      'trust.run',
      'quality.manage',
      'compliance.read',
      'compliance.manage',
      'audit.read',
      'auditlog.read',
      'report.generate',
    ],
  },

  esg_analyst: {
    key: 'esg_analyst',
    name: 'ESG Analyst',
    description: 'Prepares data and evidence; reviews AI extractions; runs calculations.',
    isPlatform: false,
    permissions: [
      'organization.read',
      'member.read',
      'role.read',
      'supplier.read',
      'supplier.create',
      'supplier.update',
      'supplier.request',
      'evidence.read',
      'evidence.create',
      'evidence.update',
      'activity.read',
      'activity.create',
      'activity.update',
      'emission_factor.manage',
      'calculation.read',
      'calculation.run',
      'document.process',
      'candidate.read',
      'candidate.review',
      'ai.read',
      'trust.read',
      'trust.run',
      'quality.manage',
      'compliance.read',
      'report.generate',
    ],
  },

  procurement_manager: {
    key: 'procurement_manager',
    name: 'Procurement Manager',
    description: 'Supplier sustainability profiles, comparisons, and procurement scenarios.',
    isPlatform: false,
    permissions: [
      'organization.read',
      'member.read',
      'supplier.read',
      'supplier.create',
      'supplier.update',
      'supplier.invite',
      'supplier.request',
      'evidence.read',
      'activity.read',
      'calculation.read',
      'trust.read',
      'compliance.read',
      'report.generate',
    ],
  },

  finance: {
    key: 'finance',
    name: 'Finance',
    description: 'Assurance over reported numbers, financial impact, and audit readiness.',
    isPlatform: false,
    permissions: [
      'organization.read',
      'member.read',
      'supplier.read',
      'evidence.read',
      'activity.read',
      'calculation.read',
      'trust.read',
      'compliance.read',
      'audit.read',
      'auditlog.read',
      'report.generate',
    ],
  },

  auditor: {
    key: 'auditor',
    name: 'Auditor',
    description:
      'Read-only access to evidence, lineage, calculations, approvals, and the activity log.',
    isPlatform: false,
    permissions: [...READ_ONLY_SUSTAINABILITY, 'auditlog.read'],
  },

  supplier_user: {
    key: 'supplier_user',
    name: 'Supplier User',
    description: 'External supplier contact using the supplier portal. Scoped to one supplier.',
    isPlatform: false,
    permissions: ['organization.read', 'portal.access', 'evidence.read', 'evidence.create'],
  },
};

export const DEFAULT_ORG_ROLE_KEYS: RoleKey[] = ROLE_KEYS.filter((k) => k !== 'platform_admin');

/** The role the creator of an organization receives. */
export const ORG_CREATOR_ROLE_KEY: RoleKey = 'organization_admin';
