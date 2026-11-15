// Move_Input_Window close decision (Req 7.4 to 7.8). Pure.

/** What closed (or tried to close) the window. */
export type CloseTrigger =
  /** The acting Player pressed submit before the deadline. */
  | 'submit'
  /** The acting Player clicked a recommended or previous Move before the deadline. */
  | 'select'
  /** The countdown reached 0. */
  | 'deadline';

export type WindowDecision<S> =
  /** Keep the window open and the countdown running; show the empty-prompt indicator (Req 7.7). */
  | { kind: 'keep_open'; reason: 'empty_prompt' | 'no_selection' }
  /** Pass the field text exactly as typed (Req 7.4, 7.5). */
  | { kind: 'prompt'; text: string }
  /** Pass the selected stored Move (Req 7.4, 7.8). */
  | { kind: 'stored'; selection: S }
  /** Perform a Fallback_Move (Req 7.6). */
  | { kind: 'fallback'; reason: 'no_input' };

const hasText = (s: string): boolean => s.trim().length > 0;

/**
 * Decides what closing the Move_Input_Window produces.
 * - submit: field text if it has a non-whitespace character, otherwise keep open (Req 7.4, 7.7)
 * - select: the selected stored Move (Req 7.4)
 * - deadline: field text if non-blank (Req 7.5), else the selection (Req 7.8), else a fallback (Req 7.6)
 */
export function closeWindowDecision<S>(
  fieldText: string,
  selection: S | null | undefined,
  trigger: CloseTrigger,
): WindowDecision<S> {
  switch (trigger) {
    case 'submit':
      return hasText(fieldText) ? { kind: 'prompt', text: fieldText } : { kind: 'keep_open', reason: 'empty_prompt' };
    case 'select':
      return selection != null ? { kind: 'stored', selection } : { kind: 'keep_open', reason: 'no_selection' };
    case 'deadline':
      if (hasText(fieldText)) return { kind: 'prompt', text: fieldText };
      if (selection != null) return { kind: 'stored', selection };
      return { kind: 'fallback', reason: 'no_input' };
  }
}
