// The single place that constructs the AI components. Every field is typed by its interface, so a
// real model (LLM Move_Generator, safety classifier, embedding-backed library, judge model) can be
// swapped in here without touching the turn controller or the UI.
import { LexiconGuardrail, type Guardrail } from '../ai/guardrail';
import { KeywordJudge, type Judge } from '../ai/judge';
import { KeywordMoveGenerator, type MoveGenerator } from '../ai/moveGenerator';
import { LocalMoveLibrary, type LocalMoveLibraryOptions, type MoveLibrary } from '../ai/moveLibrary';
import { LocalRecommendationEngine, type RecommendationEngine } from '../ai/recommend';
import { HardcodedScenarioOrchestrator, type ScenarioOrchestrator } from '../ai/scenario';
import { createDefaultRegistry } from '../core/moveblock/primitiveSchemas';
import type { RegistryView } from '../core/moveblock/registry';

export interface Services {
  /** Move_Primitive schemas shared by the generator, the parser, and the Move_Validator. */
  registry: RegistryView;
  scenarioOrchestrator: ScenarioOrchestrator;
  guardrail: Guardrail;
  moveGenerator: MoveGenerator;
  moveLibrary: MoveLibrary;
  recommender: RecommendationEngine;
  judge: Judge;
}

export interface ServiceOptions {
  /** Library storage; `null` keeps the library in memory only (tests). Defaults to localStorage. */
  storage?: LocalMoveLibraryOptions['storage'];
  /** Artificial per-agent delay of the hardcoded Scenario_Orchestrator, so status chips are visible. */
  scenarioAgentDelayMs?: number;
}

/** Builds the hardcoded PoC implementation of every AI interface. */
export function createServices(options: ServiceOptions = {}): Services {
  const registry = createDefaultRegistry();
  const moveLibrary = new LocalMoveLibrary({
    registry,
    ...(options.storage !== undefined ? { storage: options.storage } : {}),
  });
  return {
    registry,
    scenarioOrchestrator: new HardcodedScenarioOrchestrator(
      options.scenarioAgentDelayMs !== undefined ? { agentDelayMs: options.scenarioAgentDelayMs } : {},
    ),
    guardrail: new LexiconGuardrail(),
    moveGenerator: new KeywordMoveGenerator(registry),
    moveLibrary,
    recommender: new LocalRecommendationEngine(moveLibrary),
    judge: new KeywordJudge(),
  };
}
