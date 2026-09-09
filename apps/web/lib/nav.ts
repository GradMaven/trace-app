/** Application navigation (brief §22). `ready: false` links render disabled until their phase. */
export interface NavItem {
  label: string;
  href: string;
  ready?: boolean;
}
export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  { label: '', items: [{ label: 'Command Center', href: '/command-center', ready: true }] },
  {
    label: 'Data',
    items: [
      { label: 'Evidence', href: '/data/evidence', ready: true },
      { label: 'Documents', href: '/data/documents', ready: true },
      { label: 'Review Queue', href: '/data/candidates', ready: true },
      { label: 'Activity Data', href: '/data/activity', ready: true },
      { label: 'Calculations', href: '/data/calculations', ready: true },
      { label: 'AI Log', href: '/data/ai-jobs', ready: true },
      { label: 'Data Quality', href: '/data/quality', ready: true },
    ],
  },
  {
    label: 'Supply Chain',
    items: [
      { label: 'Suppliers', href: '/supply-chain/suppliers', ready: true },
      { label: 'Supplier Requests', href: '/supply-chain/requests', ready: true },
      { label: 'Supplier Passports', href: '/supply-chain/passports', ready: true },
      { label: 'Carbon Map', href: '/supply-chain/carbon-map' },
    ],
  },
  {
    label: 'Carbon',
    items: [
      { label: 'Scope 1', href: '/carbon/scope-1', ready: true },
      { label: 'Scope 2', href: '/carbon/scope-2', ready: true },
      { label: 'Scope 3', href: '/carbon/scope-3', ready: true },
      { label: 'Emission Factors', href: '/carbon/factors', ready: true },
      { label: 'Scenarios', href: '/carbon/scenarios' },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { label: 'Requirements', href: '/compliance/requirements', ready: true },
      { label: 'Disclosures', href: '/compliance/disclosures', ready: true },
      { label: 'Gaps', href: '/compliance/gaps', ready: true },
    ],
  },
  {
    label: 'Audit',
    items: [
      { label: 'Readiness', href: '/audit/readiness', ready: true },
      { label: 'Findings', href: '/audit/findings', ready: true },
      { label: 'Evidence Review', href: '/audit/review', ready: true },
      { label: 'Controls', href: '/audit/controls', ready: true },
      { label: 'Audit Package', href: '/audit/packages', ready: true },
      { label: 'Activity Log', href: '/audit/log', ready: true },
    ],
  },
  { label: '', items: [{ label: 'Reports', href: '/reports' }] },
  { label: '', items: [{ label: 'Ask TRACE', href: '/ask', ready: true }] },
  {
    label: 'Settings',
    items: [
      { label: 'Members', href: '/settings/members', ready: true },
      { label: 'Roles', href: '/settings/roles', ready: true },
      { label: 'Organization', href: '/settings/organization' },
    ],
  },
];
