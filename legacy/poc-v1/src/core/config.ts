// All timing and limit constants for the proof of concept live here.
// Requirement references are given next to each value.

/** Move_Input_Window duration in whole seconds (Req 7.1). */
export const INPUT_WINDOW_SEC_DEFAULT = 10;
export const INPUT_WINDOW_SEC_MIN = 5;
export const INPUT_WINDOW_SEC_MAX = 30;

/** Minimum Similarity_Score for the Move_Library to reuse a stored Move_Block. */
export const REUSE_THRESHOLD_DEFAULT = 0.85;

/** Move_Validator limits (Req 11.2 to 11.4). */
export const VALIDATION_PASS_TIMEOUT_MS = 500;
export const MAX_SPAWNED_BODIES = 200;
export const MAX_SIM_DURATION_SEC = 8;

/** Fixed physics timestep (60 Hz) and the derived step cap (480 steps = 8 s). */
export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
export const MAX_SIM_STEPS = MAX_SIM_DURATION_SEC * PHYSICS_HZ;

/** Voting_Window duration in seconds. */
export const VOTING_WINDOW_SEC_DEFAULT = 10;
export const VOTING_WINDOW_SEC_MIN = 1;
export const VOTING_WINDOW_SEC_MAX = 60;

/** Optional Turn limit range. */
export const TURN_LIMIT_MIN = 1;
export const TURN_LIMIT_MAX = 200;
