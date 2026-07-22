export { runScan, type ScanProgress, type ScanResult } from "./scan.js";
export { runReplay, type ReplayOptions } from "./replay.js";
export { detect, findingFromEvidence } from "./detectors/index.js";
export { classifyAction } from "./core/classify.js";
export { validateTarget, isMutationHostAllowed } from "./core/safety.js";
export type * from "./types.js";
