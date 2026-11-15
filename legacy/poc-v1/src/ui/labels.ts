// Human-readable labels for categories, fallback reasons, and agent statuses.
import type { DerogatoryCategory } from '../content/lexicon';
import type { AgentStatus, ScenarioAgent } from '../ai/scenario';
import type { FallbackReason } from '../core/turn/state';

/** The rejection category names from Req 10.1. */
export const CATEGORY_LABELS: Record<DerogatoryCategory, string> = {
  hate_speech: 'hate speech',
  slurs: 'slurs',
  harassment: 'harassment',
  sexual_content: 'sexual content',
  demeaning_religious_cultural: 'demeaning depiction of religious or cultural figures',
  graphic_gore: 'graphic gore',
};

/** Substitution reasons from Req 17.5 (plus the 18.5 budget expiry). */
export const FALLBACK_REASON_LABELS: Record<FallbackReason, string> = {
  no_input: 'The move window ended with no input.',
  generator_timeout_empty_library: 'The move generator timed out while the move library was empty.',
  guardrail_rejected: 'The Guardrail rejected the move prompt.',
  guardrail_unavailable: 'The Guardrail was unavailable or did not respond within 200 ms.',
  invalid_after_clamp: 'The move stayed invalid after clamping.',
  budget_expired: 'The move could not be prepared in time.',
};

export const AGENT_LABELS: Record<ScenarioAgent, string> = {
  scene: 'Scene',
  character: 'Character',
  trait: 'Trait',
};

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  pending: 'pending',
  in_progress: 'in progress',
  complete: 'complete',
  failed: 'failed',
};
