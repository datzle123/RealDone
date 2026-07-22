import type { ProviderExpectation, ProviderObservation } from "../providers/types.js";
import type {
  SourceCleanupObservation,
  SourceCleanupTarget,
  SourceDiscoveryInput,
  SourceExpectation,
  SourceObservation,
  SourceResourceSchema,
  SourceSnapshotInput,
  SourceSnapshotObservation,
} from "../adapters/types.js";

export interface RealDonePlugin {
  apiVersion: "1.0";
  name: string;
  verifyProvider?(expectation: ProviderExpectation): Promise<ProviderObservation> | ProviderObservation;
  verifySource?(expectation: SourceExpectation): Promise<SourceObservation> | SourceObservation;
  discoverSource?(input: SourceDiscoveryInput): Promise<SourceResourceSchema[]> | SourceResourceSchema[];
  snapshotSource?(input: SourceSnapshotInput): Promise<SourceSnapshotObservation> | SourceSnapshotObservation;
  cleanupSource?(target: SourceCleanupTarget): Promise<SourceCleanupObservation> | SourceCleanupObservation;
}

export function definePlugin(plugin: RealDonePlugin): RealDonePlugin {
  return plugin;
}
