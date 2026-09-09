/**
 * The permission catalog.
 *
 * Authorization in TRACE is permission-based, never role-name-based
 * (docs/security.md, brief §18). Guards declare a required permission key; a
 * request's permission set is resolved from the actor's roles in the active
 * organization.
 *
 * Keys are `<resource>.<action>`. Add new keys here and grant them to roles in
 * `roles.ts`. Nothing else in the codebase should invent permission strings.
 */
export const PERMISSIONS = {
  // Organization & configuration
  'organization.read': 'View organization profile and settings',
  'organization.update': 'Edit organization profile and settings',

  // Membership & access
  'member.read': 'View members of the organization',
  'member.invite': 'Invite users to the organization',
  'member.remove': 'Remove members from the organization',
  'role.read': 'View roles and their permissions',
  'role.manage': 'Create, edit, and assign roles',

  // Suppliers
  'supplier.read': 'View suppliers',
  'supplier.create': 'Create suppliers',
  'supplier.update': 'Edit suppliers, contacts, locations, and the relationship',
  'supplier.archive': 'Archive and restore suppliers',
  'supplier.invite': 'Invite supplier-portal users',
  'supplier.request': 'Send and manage information requests to suppliers',

  // Supplier portal (external supplier users)
  'portal.access': 'Access the supplier portal for the linked supplier',

  // Evidence
  'evidence.read': 'View evidence',
  'evidence.create': 'Upload and create evidence',
  'evidence.update': 'Edit evidence metadata and lifecycle state',
  'evidence.verify': 'Mark evidence as verified',

  // Activity data & calculations
  'activity.read': 'View activity data',
  'activity.create': 'Create activity data',
  'activity.update': 'Edit, delete, and link evidence to activity data',
  'emission_factor.manage': 'Create and manage organization emission factors',
  'calculation.read': 'View calculations and lineage',
  'calculation.run': 'Execute calculations',
  'calculation.approve': 'Approve calculation results',

  // AI extraction & review queue
  'document.process': 'Run the AI extraction pipeline on a document',
  'candidate.read': 'View AI-extracted candidate datapoints',
  'candidate.review': 'Promote or reject candidate datapoints',
  'ai.read': 'View the AI operation log (models, tokens, cost, status)',

  // Ask TRACE (natural-language analytics over the tenant's own records)
  'ask.use': 'Ask TRACE natural-language questions about this workspace',

  // Trust & data quality
  'trust.read': 'View Trust Scores, data-quality issues, and anomalies',
  'trust.run': 'Run Trust Score computation and data-quality scans',
  'quality.manage': 'Triage data-quality issues and anomalies (acknowledge, resolve, dismiss)',

  // Compliance
  'compliance.read': 'View compliance requirements, mappings, and gaps',
  'compliance.manage': 'Confirm mappings and manage disclosure status',

  // Audit
  'audit.read': 'View audit workspace, findings, and readiness',
  'audit.manage': 'Manage audits, findings, and packages',
  'auditlog.read': 'Read the immutable activity log',

  // Reports
  'report.generate': 'Generate reports and audit packages',

  // Platform (cross-organization)
  'platform.admin': 'Administer the TRACE platform across organizations',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}
