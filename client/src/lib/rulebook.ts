import type { RulebookConfidence } from '../api/types';

/** How each of the rulebook's confidence levels reads on the Plan tab. */
export const CONFIDENCE_LABEL: Record<RulebookConfidence, string> = {
  HIGH: 'High confidence',
  MODERATE: 'Moderate evidence',
  PROVISIONAL: 'Provisional',
};
