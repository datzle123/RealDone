import type { ActionSpec } from "../types.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface SafetyPolicy {
  target: URL;
  allowHosts: string[];
  allowDestructive: boolean;
  allowExternal: boolean;
}

export function isMutationHostAllowed(target: URL, allowHosts: string[]): boolean {
  const hostname = target.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(hostname) || hostname.endsWith(".test") || hostname.endsWith(".local")) {
    return true;
  }
  return allowHosts.some((host) => host.toLowerCase() === hostname);
}

export function validateTarget(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid target URL: ${input}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("RealDone only supports http:// and https:// targets.");
  }
  return url;
}

export function actionSkipReason(action: ActionSpec, policy: SafetyPolicy): string | undefined {
  if (action.kind === "navigation" && action.fingerprint.href) {
    try {
      const current = new URL(action.pageUrl);
      const destination = new URL(action.fingerprint.href, current);
      if (destination.href === current.href) {
        return "Navigation target is already the current page.";
      }
    } catch {
      return "Invalid navigation target blocked by the default safety policy.";
    }
  }
  if (action.kind === "navigation" && action.fingerprint.href && !policy.allowExternal) {
    try {
      const destination = new URL(action.fingerprint.href, action.pageUrl);
      if (destination.origin !== new URL(action.pageUrl).origin) {
        return "Cross-origin navigation blocked by the default safety policy. Use --allow-external explicitly.";
      }
    } catch {
      return "Invalid navigation target blocked by the default safety policy.";
    }
  }
  if (!isMutationHostAllowed(policy.target, policy.allowHosts) && action.kind === "mutation") {
    return "Production-like host: mutation actions are discovery-only. Use --allow-host explicitly for staging.";
  }
  if (action.risk === "destructive" && !policy.allowDestructive) {
    return "Destructive action blocked by the default safety policy.";
  }
  if (action.risk === "external" && !policy.allowExternal) {
    return "External-effect action blocked by the default safety policy.";
  }
  return undefined;
}
