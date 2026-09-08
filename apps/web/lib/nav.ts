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
      { label: 'Evidence', href: '/data/evidence' },
      { label: 'Activity Data', href: '/data/activity' },
      { label: 'Calculations', href: '/data/calculations' },
      { label: 'Data Quality', href: '/data/quality' },
    ],
  },
  {
    label: 'Supply Chain',
    items: [
      { label: 'Suppliers', href: '/supply-chain/suppliers' },
      { label: 'Supplier Requests', href: '/supply-chain/requests' },
      { label: 'Supplier Passports', href: '/supply-chain/passports' },
      { label: 'Carbon Map', href: '/supply-chain/carbon-map' },
    ],
  },
  {
    label: 'Carbon',
    items: [
      { label: 'Scope 1', href: '/carbon/scope-1' },
      { label: 'Scope 2', href: '/carbon/scope-2' },
      { label: 'Scope 3', href: '/carbon/scope-3' },
      { label: 'Emission Factors', href: '/carbon/factors' },
      { label: 'Scenarios', href: '/carbon/scenarios' },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { label: 'Requirements', href: '/compliance/requirements' },
      { label: 'ESRS', href: '/compliance/esrs' },
      { label: 'Disclosures', href: '/compliance/disclosures' },
      { label: 'Gaps', href: '/compliance/gaps' },
    ],
  },
  {
    label: 'Audit',
    items: [
      { label: 'Readiness', href: '/audit/readiness' },
      { label: 'Evidence Review', href: '/audit/review' },
      { label: 'Controls', href: '/audit/controls' },
      { label: 'Activity Log', href: '/audit/log', ready: true },
    ],
  },
  { label: '', items: [{ label: 'Reports', href: '/reports' }] },
  { label: '', items: [{ label: 'Ask TRACE', href: '/ask' }] },
  {
    label: 'Settings',
    items: [
      { label: 'Members', href: '/settings/members', ready: true },
      { label: 'Roles', href: '/settings/roles', ready: true },
      { label: 'Organization', href: '/settings/organization' },
    ],
  },
];
