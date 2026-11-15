// Blocked-term lexicon for Guardrail stage 1 (design: "Guardrail > Stage 1, lexicon").
//
// PLACEHOLDER CONTENT: every entry below is a deliberately mild stand-in so the pipeline can be
// exercised end to end. The real lists must be curated (with cultural and linguistic review)
// before any public use. Entries are matched after normalization (NFKC, lowercase, leetspeak folding).

export const DEROGATORY_CATEGORIES = [
  'hate_speech',
  'slurs',
  'harassment',
  'sexual_content',
  'demeaning_religious_cultural',
  'graphic_gore',
] as const;
export type DerogatoryCategory = (typeof DEROGATORY_CATEGORIES)[number];

export interface LexiconEntry {
  term: string;
  category: DerogatoryCategory;
  /** True for stand-in entries awaiting curation. */
  placeholder: true;
}

const entries = (category: DerogatoryCategory, terms: readonly string[]): LexiconEntry[] =>
  terms.map((term) => ({ term, category, placeholder: true }));

// Each category also has one or two mild single-word demo terms a tester can type to see the
// moderation path (e.g. "fire 50 arrows, you stupid demon"). None of them is a real slur.
export const BLOCKED_LEXICON: readonly LexiconEntry[] = [
  ...entries('hate_speech', ['placeholder hate term', 'inferior people', 'subhuman']),
  ...entries('slurs', ['placeholder slur', 'nitwit']),
  ...entries('harassment', ['placeholder harassment term', 'you are worthless', 'stupid', 'idiot']),
  ...entries('sexual_content', ['placeholder sexual term', 'lewd']),
  ...entries('demeaning_religious_cultural', ['placeholder demeaning religious term', 'mock the gods', 'fake god']),
  ...entries('graphic_gore', ['placeholder gore term', 'spill guts', 'disembowel']),
];
