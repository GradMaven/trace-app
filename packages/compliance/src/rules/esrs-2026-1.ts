import type { RuleStore } from '../rule-store';

/**
 * ESRS rule store — climate (E1) first slice, version `esrs@2026.1`.
 *
 * Illustrative and deliberately partial: it covers the ESRS E1 climate and
 * value-chain concepts that the TRACE carbon engine already produces data for
 * (Scope 1/2/3, energy mix, targets, transition plan). It is NOT the full ESRS
 * E1 datapoint set and is NOT legal guidance. The schema is regulation-agnostic;
 * adding EU Taxonomy or CBAM later is a new rule-store dataset, not an engine
 * change.
 */
export const ESRS_2026_1: RuleStore = {
  version: 'esrs@2026.1',
  notice:
    'Illustrative ESRS E1 (climate) slice for demonstration. Not the complete ESRS datapoint set and not legal advice — TRACE supports professional judgement, it does not determine compliance.',
  regulation: {
    key: 'esrs',
    name: 'European Sustainability Reporting Standards (ESRS)',
    jurisdiction: 'EU',
    description:
      'Delegated Regulation (EU) 2023/2772 — sustainability reporting standards under the CSRD. This store covers ESRS E1 Climate change.',
    requirements: [
      {
        code: 'E1-1',
        title: 'Transition plan for climate change mitigation',
        description:
          'The undertaking discloses its transition plan for climate change mitigation, including decarbonisation levers and alignment with limiting warming to 1.5°C.',
        disclosures: [
          {
            code: 'E1-1',
            title: 'Transition plan for climate change mitigation',
            guidance:
              'A transition plan exists, is approved by the administrative bodies, and explains how targets are to be achieved.',
            requiredDatapoints: [
              {
                key: 'esrs_e1_1_transition_plan',
                metricKey: 'climate_transition_plan_exists',
                unit: null,
                cardinality: 'single',
                subjectScope: 'organization',
                label: 'A climate transition plan exists and is approved',
              },
            ],
            evidenceRequirements: [
              {
                key: 'esrs_e1_1_ev_plan',
                description: 'Board-approved transition plan or equivalent strategy document.',
                acceptableTypes: ['audit_report', 'external_dataset', 'contract'],
              },
            ],
            controls: [
              {
                key: 'esrs_e1_1_ctrl_governance',
                name: 'Transition-plan governance',
                description:
                  'The transition plan is reviewed and formally approved by the administrative, management or supervisory bodies.',
              },
            ],
          },
        ],
      },
      {
        code: 'E1-4',
        title: 'Targets related to climate change mitigation and adaptation',
        description:
          'The undertaking discloses the GHG emission reduction targets it has set, the base year and target year.',
        disclosures: [
          {
            code: 'E1-4',
            title: 'GHG emission reduction targets',
            guidance:
              'At least one quantified GHG reduction target with a base year, expressed as a percentage reduction.',
            requiredDatapoints: [
              {
                key: 'esrs_e1_4_reduction_target',
                metricKey: 'ghg_reduction_target_pct',
                unit: '%',
                cardinality: 'single',
                subjectScope: 'organization',
                label: 'GHG emission reduction target (% vs. base year)',
              },
            ],
            evidenceRequirements: [
              {
                key: 'esrs_e1_4_ev_target',
                description:
                  'Approved target register, SBTi validation letter, or board resolution setting the target.',
                acceptableTypes: ['audit_report', 'certificate', 'external_dataset'],
              },
            ],
            controls: [
              {
                key: 'esrs_e1_4_ctrl_target_review',
                name: 'Target setting & review',
                description: 'Targets are documented, owned, and reviewed at a defined cadence.',
              },
            ],
          },
        ],
      },
      {
        code: 'E1-5',
        title: 'Energy consumption and mix',
        description:
          'The undertaking discloses total energy consumption and the share from renewable sources.',
        disclosures: [
          {
            code: 'E1-5',
            title: 'Energy consumption and mix',
            guidance:
              'Total energy consumption in MWh and the renewable share of electricity as a percentage.',
            requiredDatapoints: [
              {
                key: 'esrs_e1_5_energy_total',
                metricKey: 'energy_consumption_total_mwh',
                unit: 'MWh',
                cardinality: 'single',
                subjectScope: 'organization',
                label: 'Total energy consumption (MWh)',
              },
              {
                key: 'esrs_e1_5_renewable_share',
                metricKey: 'renewable_electricity_pct',
                unit: '%',
                cardinality: 'single',
                subjectScope: 'any',
                label: 'Share of renewable electricity (%)',
                minTrustScore: 45,
              },
            ],
            evidenceRequirements: [
              {
                key: 'esrs_e1_5_ev_energy',
                description:
                  'Utility bills, energy-management records, or supplier energy attestations.',
                acceptableTypes: ['utility_bill', 'invoice', 'erp_record', 'supplier_report'],
              },
            ],
            controls: [
              {
                key: 'esrs_e1_5_ctrl_meter',
                name: 'Energy data completeness',
                description:
                  'All consuming sites are captured; meter data is reconciled to invoices.',
              },
            ],
          },
        ],
      },
      {
        code: 'E1-6',
        title: 'Gross Scopes 1, 2, 3 and Total GHG emissions',
        description:
          'The undertaking discloses its gross Scope 1, gross Scope 2 (location- and market-based) and gross Scope 3 GHG emissions.',
        disclosures: [
          {
            code: 'E1-6',
            title: 'Gross GHG emissions by scope',
            guidance:
              'Gross Scope 1, gross Scope 2 (location- and market-based) and material Scope 3 categories, each in tonnes CO2e, traceable to activity data and emission factors.',
            requiredDatapoints: [
              {
                key: 'esrs_e1_6_scope_1',
                metricKey: 'emission_scope_1_tco2e',
                unit: 'tCO2e',
                cardinality: 'multiple',
                subjectScope: 'organization',
                label: 'Gross Scope 1 GHG emissions (tCO2e)',
                aggregation: 'sum',
                minTrustScore: 50,
              },
              {
                key: 'esrs_e1_6_scope_2_lb',
                metricKey: 'emission_scope_2_location_tco2e',
                unit: 'tCO2e',
                cardinality: 'multiple',
                subjectScope: 'organization',
                label: 'Gross Scope 2 GHG emissions — location-based (tCO2e)',
                aggregation: 'sum',
                minTrustScore: 50,
              },
              {
                key: 'esrs_e1_6_scope_2_mb',
                metricKey: 'emission_scope_2_market_tco2e',
                unit: 'tCO2e',
                cardinality: 'multiple',
                subjectScope: 'organization',
                label: 'Gross Scope 2 GHG emissions — market-based (tCO2e)',
                aggregation: 'sum',
                minTrustScore: 50,
              },
              {
                key: 'esrs_e1_6_scope_3_pgs',
                metricKey: 'emission_cat_1_purchased_goods_services_tco2e',
                unit: 'tCO2e',
                cardinality: 'multiple',
                subjectScope: 'any',
                label: 'Scope 3 — Category 1: Purchased goods and services (tCO2e)',
                aggregation: 'sum',
                minTrustScore: 50,
              },
              {
                key: 'esrs_e1_6_scope_3_ut',
                metricKey: 'emission_cat_4_upstream_transportation_tco2e',
                unit: 'tCO2e',
                cardinality: 'multiple',
                subjectScope: 'any',
                label: 'Scope 3 — Category 4: Upstream transportation and distribution (tCO2e)',
                aggregation: 'sum',
                minTrustScore: 50,
              },
            ],
            evidenceRequirements: [
              {
                key: 'esrs_e1_6_ev_activity',
                description:
                  'Activity data records (energy, fuel, freight, purchased goods) and the emission-factor sources and methodology used.',
                acceptableTypes: [
                  'utility_bill',
                  'invoice',
                  'erp_record',
                  'logistics_record',
                  'supplier_report',
                  'epd',
                  'lca',
                ],
              },
            ],
            controls: [
              {
                key: 'esrs_e1_6_ctrl_inventory',
                name: 'GHG inventory management',
                description:
                  'A documented inventory boundary, consistent methodology, and a recalculation policy are in place.',
              },
              {
                key: 'esrs_e1_6_ctrl_factors',
                name: 'Emission-factor governance',
                description:
                  'Emission factors come from recognised sources, are version-pinned, and are within their validity window.',
              },
            ],
          },
        ],
      },
    ],
  },
};
