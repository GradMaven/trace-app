import { describe, expect, it } from 'vitest';
import {
  listQuestions,
  questionnaireCompleteness,
  validateResponses,
} from './questionnaire';

const requiredIds = listQuestions()
  .filter((q) => q.required)
  .map((q) => q.id);

function fullValidSubmission(): Record<string, unknown> {
  return {
    reporting_period: 'FY2025',
    primary_activity: 'Steel forging',
    ghg_inventory_exists: true,
    reduction_target: true,
    iso14001: true,
    human_rights_policy: true,
    code_of_conduct: true,
    anti_corruption_policy: true,
    sustainability_contact: 'Sara Lind, sara@supplier.example',
  };
}

describe('validateResponses', () => {
  it('flags every missing required question on an empty submission', () => {
    const issues = validateResponses({});
    expect(issues.map((i) => i.questionId).sort()).toEqual([...requiredIds].sort());
  });

  it('accepts a submission that answers all required questions', () => {
    expect(validateResponses(fullValidSubmission())).toEqual([]);
  });

  it('rejects a negative number and an over-100 percentage', () => {
    const issues = validateResponses({
      ...fullValidSubmission(),
      scope1_tco2e: -5,
      renewable_electricity_pct: 140,
    });
    expect(issues.map((i) => i.questionId)).toContain('scope1_tco2e');
    expect(issues.map((i) => i.questionId)).toContain('renewable_electricity_pct');
  });

  it('rejects an invalid single_select and multi_select value', () => {
    const issues = validateResponses({
      ...fullValidSubmission(),
      scope2_method: 'guessed',
      scope3_categories_reported: ['cat1', 'cat99'],
    });
    expect(issues.map((i) => i.questionId)).toContain('scope2_method');
    expect(issues.map((i) => i.questionId)).toContain('scope3_categories_reported');
  });

  it('requires booleans to be actual booleans', () => {
    const issues = validateResponses({ ...fullValidSubmission(), ghg_inventory_exists: 'yes' });
    expect(issues.map((i) => i.questionId)).toContain('ghg_inventory_exists');
  });
});

describe('questionnaireCompleteness', () => {
  it('is 0 for an empty submission and 100 for a full one', () => {
    expect(questionnaireCompleteness({})).toBe(0);
    const all: Record<string, unknown> = {};
    for (const q of listQuestions()) {
      all[q.id] =
        q.kind === 'boolean'
          ? true
          : q.kind === 'number'
            ? 1
            : q.kind === 'multi_select'
              ? [q.options![0]!.value]
              : q.kind === 'single_select'
                ? q.options![0]!.value
                : 'x';
    }
    expect(questionnaireCompleteness(all)).toBe(100);
  });

  it('ignores empty arrays', () => {
    expect(questionnaireCompleteness({ scope3_categories_reported: [] })).toBe(0);
  });
});
