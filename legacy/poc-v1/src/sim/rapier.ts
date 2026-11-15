import RAPIER from '@dimforge/rapier2d-deterministic-compat';

export type Rapier = typeof RAPIER;

let ready: Promise<Rapier> | null = null;

/**
 * Initializes the deterministic Rapier2D WASM module once and returns it.
 * Concurrent and repeated calls share the same initialization promise.
 */
export function loadRapier(): Promise<Rapier> {
  if (!ready) {
    ready = RAPIER.init().then(
      () => RAPIER,
      (err: unknown) => {
        ready = null; // allow a retry after a failed init
        throw err;
      },
    );
  }
  return ready;
}
