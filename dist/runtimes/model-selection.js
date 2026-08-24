/**
 * Builds the ordered model candidate list for Auto mode: every model reported
 * by the runtime, with free models (zero cost tier) first so paid providers
 * are only billed when no free option can serve the request. The orchestrator
 * rotates through this list whenever a provider fails fatally (quota, billing,
 * authentication), which is why exhausted providers never block a run.
 */
export function autoModelCandidates(discovery) {
    const free = new Set(discovery.freeModels ?? []);
    return [
        ...discovery.models.filter((model) => free.has(model)),
        ...discovery.models.filter((model) => !free.has(model)),
    ];
}
/** Human-readable label for interactive model choosers. */
export function modelChoiceLabel(model, discovery) {
    const free = (discovery.freeModels ?? []).includes(model);
    return free ? `${model}  [free]` : model;
}
