import { resolveUnit, UnitError } from './units';

/**
 * Emission-factor selection (pure). Given a set of candidate factor versions and
 * the activity they must apply to, pick the best match. The caller fetches
 * candidates (org-specific + global library); this decides which one wins and
 * why, so the choice is explainable.
 */

export interface FactorCandidate {
  id: string;
  organizationId: string | null; // null = shared library
  source: string;
  sourceRef: string;
  version: number;
  numeratorUnit: string;
  denominatorUnit: string;
  gwpSet: string;
  scope: string;
  ghgCategory: string | null;
  geography: string | null; // ISO country / region code, or null = generic
  methodology: string | null;
  validFrom: string; // ISO date
  validTo: string | null; // ISO date, null = open-ended
}

export interface FactorCriteria {
  activityUnit: string;
  scope: string;
  ghgCategory?: string | null;
  geography?: string | null;
  /** ISO date the activity occurred / the reporting period anchor. */
  asOf: string;
  methodologyPreference?: string | null;
}

export interface FactorSelection {
  factor: FactorCandidate;
  reasons: string[];
}

function sameDimension(a: string, b: string): boolean {
  try {
    return resolveUnit(a).dimension === resolveUnit(b).dimension;
  } catch (err) {
    if (err instanceof UnitError) return false;
    throw err;
  }
}

function withinValidity(c: FactorCandidate, asOf: string): boolean {
  if (c.validFrom > asOf) return false;
  if (c.validTo && c.validTo < asOf) return false;
  return true;
}

export function selectEmissionFactor(
  candidates: readonly FactorCandidate[],
  criteria: FactorCriteria,
): FactorSelection | null {
  const eligible = candidates.filter(
    (c) =>
      c.scope === criteria.scope &&
      sameDimension(c.denominatorUnit, criteria.activityUnit) &&
      withinValidity(c, criteria.asOf) &&
      (c.ghgCategory === null ||
        criteria.ghgCategory === undefined ||
        criteria.ghgCategory === null ||
        c.ghgCategory === criteria.ghgCategory) &&
      (c.geography === null ||
        !criteria.geography ||
        c.geography === criteria.geography),
  );
  if (eligible.length === 0) return null;

  const scored = eligible
    .map((c) => {
      let score = 0;
      const reasons: string[] = [];
      if (c.organizationId !== null) {
        score += 1000;
        reasons.push('organization-specific factor');
      } else {
        reasons.push('shared library factor');
      }
      if (
        criteria.methodologyPreference &&
        c.methodology === criteria.methodologyPreference
      ) {
        score += 300;
        reasons.push(`methodology match (${c.methodology})`);
      }
      if (criteria.geography && c.geography === criteria.geography) {
        score += 200;
        reasons.push(`geography match (${c.geography})`);
      } else if (c.geography === null) {
        reasons.push('generic geography');
      }
      if (criteria.ghgCategory && c.ghgCategory === criteria.ghgCategory) {
        score += 100;
        reasons.push(`category match (${c.ghgCategory})`);
      }
      // Prefer the most recent applicable version.
      score += Date.parse(c.validFrom) / 1e10;
      score += c.version;
      reasons.push(`version ${c.version}, valid from ${c.validFrom}`);
      return { c, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  return { factor: best.c, reasons: best.reasons };
}
