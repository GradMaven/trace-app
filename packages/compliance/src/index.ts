import { registerRuleStore } from './rule-store';
import { ESRS_2026_1 } from './rules/esrs-2026-1';

// Register the shipped rule-store versions on import.
registerRuleStore(ESRS_2026_1);

export * from './rule-store';
export * from './status';
export * from './evaluate';
export { ESRS_2026_1 };
