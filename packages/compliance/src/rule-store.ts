import type { EvidenceType, RequiredDatapointCardinality } from '@trace/shared';

/**
 * The regulatory rule store (Principle 7: regulatory logic is versioned data,
 * not code). Each `RuleStore` is a frozen, versioned dataset — a `Regulation`
 * tree of `Requirement` → `Disclosure` → (`RequiredDatapoint` |
 * `EvidenceRequirement` | `ControlSpec`). Superseding a version never mutates
 * prior rows; a new version is a new dataset with a new `version` stamp.
 *
 * This package is pure data + a pure evaluator. `@trace/db` loads a store into
 * the `regulation` / `requirement` / `disclosure` / `required_datapoint` /
 * `evidence_requirement` tables and evaluates a tenant against it.
 */

/** Which subject a required datapoint is expected to be reported for. */
export type SubjectScope = 'organization' | 'any';

/**
 * How multiple candidate datapoints for one metric key are reconciled:
 *  - `single` (default) — expect exactly one; >1 materially different = conflict.
 *  - `sum`    — additive contributions (e.g. Scope 1 = fuel + fleet); summed.
 *  - `latest` — take the most recently created candidate.
 */
export type Aggregation = 'single' | 'sum' | 'latest';

export interface RequiredDatapoint {
  /** Stable key within the rule store, e.g. `esrs_e1_6_gross_scope_1`. */
  key: string;
  /** The TRACE metric key the tenant's data must carry to satisfy this. */
  metricKey: string;
  /** Expected unit (for a unit-mismatch check); null = unit-agnostic / narrative. */
  unit: string | null;
  cardinality: RequiredDatapointCardinality;
  subjectScope: SubjectScope;
  /** How multiple candidates are reconciled. Default `single`. */
  aggregation?: Aggregation;
  /** Human label. */
  label: string;
  /** Only required when this predicate holds for the org; omitted = always required. */
  conditions?: Record<string, unknown>;
  /** Minimum Trust Score for this datapoint to reach `mapping_complete`. */
  minTrustScore?: number;
}

export interface EvidenceRequirement {
  key: string;
  description: string;
  acceptableTypes: EvidenceType[];
}

export interface ControlSpec {
  key: string;
  name: string;
  description: string;
}

export interface Disclosure {
  code: string;
  title: string;
  guidance: string;
  requiredDatapoints: RequiredDatapoint[];
  evidenceRequirements: EvidenceRequirement[];
  controls: ControlSpec[];
}

export interface Requirement {
  code: string;
  title: string;
  description: string;
  disclosures: Disclosure[];
}

export interface Regulation {
  key: string;
  name: string;
  jurisdiction: string;
  description: string;
  requirements: Requirement[];
}

export interface RuleStore {
  /** e.g. `esrs@2026.1`. */
  version: string;
  regulation: Regulation;
  /** Free-text provenance / disclaimer shown in the UI. */
  notice: string;
}

const STORES = new Map<string, RuleStore>();

export function registerRuleStore(store: RuleStore): void {
  STORES.set(store.version, deepFreeze(store));
}

export function getRuleStore(version: string): RuleStore {
  const store = STORES.get(version);
  if (!store) {
    throw new Error(
      `Unknown rule-store version "${version}". Known: ${[...STORES.keys()].join(', ') || '(none)'}.`,
    );
  }
  return store;
}

export function listRuleStoreVersions(): string[] {
  return [...STORES.keys()].sort();
}

export interface FlatRequiredDatapoint {
  regulationKey: string;
  requirementCode: string;
  disclosureCode: string;
  datapoint: RequiredDatapoint;
}

/** Every required datapoint in the store, with its regulation/requirement/disclosure path. */
export function flattenRequiredDatapoints(store: RuleStore): FlatRequiredDatapoint[] {
  const out: FlatRequiredDatapoint[] = [];
  for (const req of store.regulation.requirements) {
    for (const dis of req.disclosures) {
      for (const dp of dis.requiredDatapoints) {
        out.push({
          regulationKey: store.regulation.key,
          requirementCode: req.code,
          disclosureCode: dis.code,
          datapoint: dp,
        });
      }
    }
  }
  return out;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
