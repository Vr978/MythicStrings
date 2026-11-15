// Category reduction for the Guardrail (design: "Guardrail > Category reduction").
// Pure: when several categories are reported, exactly one is returned by a fixed priority (Req 10.1).
import { DEROGATORY_CATEGORIES, type DerogatoryCategory } from '../../content/lexicon';

/** Fixed priority, highest first: slurs, hate speech, sexual content, demeaning religious/cultural, harassment, graphic gore. */
export const CATEGORY_PRIORITY: readonly DerogatoryCategory[] = [
  'slurs',
  'hate_speech',
  'sexual_content',
  'demeaning_religious_cultural',
  'harassment',
  'graphic_gore',
];

const KNOWN = new Set<string>(DEROGATORY_CATEGORIES);

export const isDerogatoryCategory = (label: string): label is DerogatoryCategory => KNOWN.has(label);

/**
 * Returns the highest-priority known category among `labels`, ignoring unknown labels.
 * The result does not depend on input order. Returns `null` when no known category is present.
 */
export function pickCategory(labels: Iterable<string>): DerogatoryCategory | null {
  const present = new Set<string>();
  for (const label of labels) if (isDerogatoryCategory(label)) present.add(label);
  for (const category of CATEGORY_PRIORITY) if (present.has(category)) return category;
  return null;
}
