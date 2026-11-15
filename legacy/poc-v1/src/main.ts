// App entry point: load Rapier, show the scenario screen, start a hot-seat Battle with the returned
// Scenario (Player 1 controls the first character, Player 2 the second), and run the render loop.
import './ui/styles.css';
import type { Ticker } from 'pixi.js';
import { DomBattleView } from './app/domView';
import { createServices } from './app/services';
import { TurnController } from './app/turnController';
import type { Scenario } from './core/scenario/types';
import { DEFAULT_BATTLE_CONFIG } from './core/turn/state';
import { createStage, PuppetRenderer, type StageView } from './render';
import { SimWorld } from './sim/world';
import { systemClock } from './ui/clock';
import { el } from './ui/dom';
import { createLayout, type UiLayout } from './ui/layout';
import { runScenarioSubmission, ScenarioScreen } from './ui/scenarioScreen';

interface RunningBattle {
  stage: StageView;
  renderer: PuppetRenderer;
  controller: TurnController;
  tick: (ticker: Ticker) => void;
}

const services = createServices();
let battle: RunningBattle | null = null;

function battleSeed(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]! & 0x7fffffff;
}

function showScenarioScreen(layout: UiLayout): void {
  const screen = new ScenarioScreen({
    onSubmit: async (text) => {
      const scenario = await runScenarioSubmission(
        screen,
        { guardrail: services.guardrail, orchestrator: services.scenarioOrchestrator },
        text,
      );
      if (scenario) await startBattle(layout, scenario);
    },
  });
  layout.modal.replaceChildren(screen.root);
  screen.field.focus();
}

async function startBattle(layout: UiLayout, scenario: Scenario): Promise<void> {
  endBattle(layout);
  const seed = battleSeed();
  const stage = await createStage(layout.stage, scenario.stage, seed);
  const renderer = new PuppetRenderer(stage, scenario);
  const config = { ...DEFAULT_BATTLE_CONFIG };
  const view = new DomBattleView(layout, scenario, { votingEnabled: config.votingEnabled });
  view.attachRenderer(renderer);
  const controller = new TurnController({
    scenario,
    config,
    seed,
    services,
    view,
    clock: systemClock,
    onNewBattle: () => {
      endBattle(layout);
      showScenarioScreen(layout);
    },
  });
  const tick = (ticker: Ticker) => {
    controller.frame(ticker.deltaMS);
    renderer.sync(controller.live.world);
    view.animate(performance.now());
  };
  stage.app?.ticker.add(tick);
  battle = { stage, renderer, controller, tick };
  renderer.sync(controller.live.world);
  controller.start();
}

function endBattle(layout: UiLayout): void {
  if (!battle) return;
  const { stage, renderer, controller, tick } = battle;
  battle = null;
  stage.app?.ticker.remove(tick);
  controller.dispose();
  renderer.destroy();
  stage.destroy();
  for (const slot of [layout.hud, layout.top, layout.center, layout.bottom, layout.side, layout.stage]) slot.replaceChildren();
}

async function main(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) return;
  const layout = createLayout(host);
  layout.modal.replaceChildren(el('p', { class: 'loading', text: 'Lighting the lamp…' }));
  try {
    await SimWorld.init();
  } catch (e) {
    layout.modal.replaceChildren(
      el('p', { class: 'loading', text: `The physics engine failed to load: ${e instanceof Error ? e.message : String(e)}` }),
    );
    return;
  }
  showScenarioScreen(layout);
}

void main();
