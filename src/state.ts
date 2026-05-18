import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export let _api: ExtensionAPI;
export let currentCtx: ExtensionContext | undefined;
export let currentCwd: string | undefined;

export function setApi(pi: ExtensionAPI): void {
  _api = pi;
}

function isStaleError(e: unknown): boolean {
  return e instanceof Error && e.message.includes("stale");
}

export function safeUpdateCtx(ctx: ExtensionContext): boolean {
  try {
    currentCtx = ctx;
    currentCwd = ctx.cwd;
    return true;
  } catch (e) {
    if (isStaleError(e)) {
      return false;
    }
    throw e;
  }
}

export function isCtxStale(ctx: ExtensionContext): boolean {
  try {
    void ctx.cwd;
    return false;
  } catch (e) {
    if (isStaleError(e)) {
      return true;
    }
    throw e;
  }
}

export function getSafeCtx(): ExtensionContext | undefined {
  if (!currentCtx) return undefined;
  if (isCtxStale(currentCtx)) {
    currentCtx = undefined;
    currentCwd = undefined;
    return undefined;
  }
  return currentCtx;
}

export function resetState(): void {
  currentCtx = undefined;
  currentCwd = undefined;
}
