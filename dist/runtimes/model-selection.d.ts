import type { RuntimeModelDiscovery } from './runtime.js';
/**
 * Builds the ordered model candidate list for Auto mode: every model reported
 * by the runtime, with free models (zero cost tier) first so paid providers
 * are only billed when no free option can serve the request. The orchestrator
 * rotates through this list whenever a provider fails fatally (quota, billing,
 * authentication), which is why exhausted providers never block a run.
 */
export declare function autoModelCandidates(discovery: RuntimeModelDiscovery): string[];
/** Human-readable label for interactive model choosers. */
export declare function modelChoiceLabel(model: string, discovery: RuntimeModelDiscovery): string;
