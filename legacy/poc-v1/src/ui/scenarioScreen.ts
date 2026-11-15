// Scenario screen (design: "Game_Client > Scenario screen"): Scenario_Prompt field, length check,
// per-agent status chips, and rejection / error messages that keep the text editable.
import {
  SCENARIO_AGENTS,
  SCENARIO_PROMPT_MAX,
  SCENARIO_PROMPT_MIN,
  validateScenarioPrompt,
  type AgentStatus,
  type ScenarioAgent,
  type ScenarioOrchestrator,
} from '../ai/scenario';
import { SCENARIO_PROMPT_TIMEOUT_MS, withDeadline, type Guardrail } from '../ai/guardrail';
import type { DerogatoryCategory } from '../content/lexicon';
import type { Scenario } from '../core/scenario/types';
import { el, setVisible } from './dom';
import { AGENT_LABELS, AGENT_STATUS_LABELS, CATEGORY_LABELS } from './labels';

export const DEFAULT_SCENARIO_PROMPT = 'Arjun vs Duryodhan';
export const SCENARIO_LIMIT_MESSAGE = `Enter a scenario of ${SCENARIO_PROMPT_MIN} to ${SCENARIO_PROMPT_MAX} characters.`;

export interface ScenarioScreenOptions {
  /**
   * Called with the unchanged prompt text after the 1-500 character check passes (Req 3.3).
   * Submit stays disabled until the returned promise settles (Req 3.7).
   */
  onSubmit: (text: string) => Promise<void> | void;
  initialPrompt?: string;
}

export type MessageKind = 'validation' | 'rejection' | 'error' | 'info';

export class ScenarioScreen {
  readonly root: HTMLElement;
  readonly field: HTMLTextAreaElement;
  readonly submitButton: HTMLButtonElement;
  readonly retryButton: HTMLButtonElement;
  private readonly message: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly chips = new Map<ScenarioAgent, HTMLElement>();
  private readonly onSubmit: ScenarioScreenOptions['onSubmit'];
  private busy = false;

  constructor(options: ScenarioScreenOptions) {
    this.onSubmit = options.onSubmit;
    this.field = el('textarea', {
      class: 'scenario-field',
      rows: 2,
      'aria-label': 'Scenario prompt',
      placeholder: 'Who fights whom? e.g. Arjun vs Duryodhan',
    });
    this.field.value = options.initialPrompt ?? DEFAULT_SCENARIO_PROMPT;
    this.counter = el('span', { class: 'scenario-counter' });
    this.submitButton = el('button', { class: 'btn btn-primary', type: 'button', text: 'Raise the curtain' });
    this.retryButton = el('button', { class: 'btn', type: 'button', text: 'Retry' });
    setVisible(this.retryButton, false);
    this.message = el('p', { class: 'scenario-message', role: 'status', 'aria-live': 'polite' });
    setVisible(this.message, false);

    const chipRow = el('div', { class: 'agent-chips' });
    for (const agent of SCENARIO_AGENTS) {
      const chip = el('span', { class: 'chip', 'data-agent': agent });
      this.chips.set(agent, chip);
      chipRow.append(chip);
    }
    setVisible(chipRow, false);

    this.root = el('section', { class: 'scenario-screen' }, [
      el('h1', { class: 'title', text: 'Mythic Strings' }),
      el('p', { class: 'subtitle', text: 'A shadow-puppet battle. Name your matchup.' }),
      this.field,
      el('div', { class: 'scenario-actions' }, [this.counter, this.retryButton, this.submitButton]),
      this.message,
      chipRow,
    ]);

    this.field.addEventListener('input', () => this.updateCounter());
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.submit();
      }
    });
    this.submitButton.addEventListener('click', () => void this.submit());
    this.retryButton.addEventListener('click', () => void this.submit());
    this.resetAgents();
    this.updateCounter();
  }

  get text(): string {
    return this.field.value;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** Runs the length check, then hands the unchanged text to `onSubmit` while submit is disabled. */
  async submit(): Promise<void> {
    if (this.busy) return;
    const text = this.field.value;
    if (!validateScenarioPrompt(text).ok) {
      this.showMessage('validation', SCENARIO_LIMIT_MESSAGE);
      return;
    }
    this.clearMessage();
    this.setBusy(true);
    try {
      await this.onSubmit(text);
    } catch (e) {
      this.showError(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.setBusy(false);
    }
  }

  /** Disables the submit actions; the field stays editable. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.submitButton.disabled = busy;
    this.retryButton.disabled = busy;
    this.root.classList.toggle('busy', busy);
  }

  setAgentStatus(agent: ScenarioAgent, status: AgentStatus): void {
    const chip = this.chips.get(agent);
    if (!chip) return;
    chip.dataset.status = status;
    chip.textContent = `${AGENT_LABELS[agent]}: ${AGENT_STATUS_LABELS[status]}`;
    setVisible(chip.parentElement!, true);
  }

  resetAgents(): void {
    for (const agent of SCENARIO_AGENTS) this.setAgentStatus(agent, 'pending');
    setVisible(this.chips.get('scene')!.parentElement!, false);
  }

  agentStatus(agent: ScenarioAgent): AgentStatus | undefined {
    return this.chips.get(agent)?.dataset.status as AgentStatus | undefined;
  }

  showRejection(category: DerogatoryCategory): void {
    this.showMessage('rejection', `This scenario was blocked for ${CATEGORY_LABELS[category]}. Please edit it and try again.`);
  }

  /** Error with a Retry option; the text stays as typed (Req 3.6, 4.8). */
  showError(message: string): void {
    this.showMessage('error', message);
    setVisible(this.retryButton, true);
  }

  showMessage(kind: MessageKind, message: string): void {
    this.message.textContent = message;
    this.message.dataset.kind = kind;
    setVisible(this.message, true);
    setVisible(this.retryButton, kind === 'error');
  }

  clearMessage(): void {
    this.message.textContent = '';
    delete this.message.dataset.kind;
    setVisible(this.message, false);
    setVisible(this.retryButton, false);
  }

  get messageText(): string {
    return this.message.hidden ? '' : (this.message.textContent ?? '');
  }

  get messageKind(): MessageKind | undefined {
    return this.message.hidden ? undefined : (this.message.dataset.kind as MessageKind | undefined);
  }

  private updateCounter(): void {
    const n = [...this.field.value.trim()].length;
    this.counter.textContent = `${n} / ${SCENARIO_PROMPT_MAX}`;
    this.counter.classList.toggle('over', n > SCENARIO_PROMPT_MAX);
  }
}

export interface ScenarioFlowDeps {
  guardrail: Guardrail;
  orchestrator: ScenarioOrchestrator;
  /** Classification budget, default 2 s (Req 3.2, 3.6). */
  classifyTimeoutMs?: number;
}

/**
 * The standard submit flow: Guardrail check with a 2 s deadline, then generation with live agent chips.
 * Returns the Scenario on success, or null after showing the matching message on the screen.
 */
export async function runScenarioSubmission(
  screen: ScenarioScreen,
  deps: ScenarioFlowDeps,
  text: string,
): Promise<Scenario | null> {
  screen.resetAgents();
  screen.showMessage('info', 'Checking your scenario…');
  const verdict = await withDeadline(
    deps.guardrail.classify(text, 'scenario_prompt'),
    deps.classifyTimeoutMs ?? SCENARIO_PROMPT_TIMEOUT_MS,
  );
  if (!verdict.ok) {
    screen.showError('The scenario prompt could not be checked. Please try again.');
    return null;
  }
  if (verdict.value.kind === 'derogatory') {
    screen.showRejection(verdict.value.category);
    return null;
  }
  screen.showMessage('info', 'The puppeteers are building your scene…');
  const result = await deps.orchestrator.generate(text, {
    onAgentStatus: (agent, status) => screen.setAgentStatus(agent, status),
  });
  if (!result.ok) {
    if (result.error.kind === 'invalid_prompt') screen.showMessage('validation', SCENARIO_LIMIT_MESSAGE);
    else screen.showError(result.error.message);
    return null;
  }
  screen.clearMessage();
  return result.value;
}
