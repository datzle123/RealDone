import type { ProviderExpectation, ProviderObservation } from "../providers/types.js";

export interface RealDonePlugin {
  apiVersion: "1.0";
  name: string;
  verifyProvider(expectation: ProviderExpectation): Promise<ProviderObservation> | ProviderObservation;
}

export function definePlugin(plugin: RealDonePlugin): RealDonePlugin {
  return plugin;
}
