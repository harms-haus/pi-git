import type { simpleGit } from "simple-git";
import { shortenPath } from "./format";
import { currentCwd, getSafeCtx } from "./state";
import type { GitStatus } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEBOUNCE_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Module-level mutable state
// ---------------------------------------------------------------------------

export let gitStatus: GitStatus | null = null;
export let gitInstance: ReturnType<typeof simpleGit> | undefined;
export let gitRefreshInFlight = false;
export let gitRefreshPending = false;
export let debounceTimer: ReturnType<typeof setTimeout> | undefined;
export let refreshEpoch = 0;

// ---------------------------------------------------------------------------
// State setters (allow mutation from other modules)
// ---------------------------------------------------------------------------

export function setGitStatus(status: GitStatus | null): void {
  gitStatus = status;
}

export function setGitInstance(instance: ReturnType<typeof simpleGit> | undefined): void {
  gitInstance = instance;
}

export function setGitRefreshInFlight(value: boolean): void {
  gitRefreshInFlight = value;
}

export function setGitRefreshPending(value: boolean): void {
  gitRefreshPending = value;
}

export function setDebounceTimer(timer: ReturnType<typeof setTimeout> | undefined): void {
  debounceTimer = timer;
}

export function incrementRefreshEpoch(): void {
  refreshEpoch++;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Update the pi-git footer label with current git status.
 * Reads module-level gitStatus + state (currentCtx, currentCwd).
 */
export function updateFooterLabel(): void {
  const ctx = getSafeCtx();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ui can be undefined at runtime when hasUI is false
  if (!ctx || !ctx.ui) {
    return;
  }

  if (!gitStatus || gitStatus.files.length === 0) {
    ctx.ui.setStatus("pi-git", undefined);
    return;
  }

  const cwd = currentCwd ?? "";
  const value = {
    cwd: shortenPath(cwd),
    branch: gitStatus.branch,
    insertions: gitStatus.totalInsertions,
    deletions: gitStatus.totalDeletions,
    addedCount: gitStatus.addedCount,
    modifiedCount: gitStatus.modifiedCount,
    deletedCount: gitStatus.deletedCount,
  };

  ctx.ui.setStatus("pi-git", JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

/**
 * Clear all git state: reset status, cancel pending debounces, update footer.
 */
export function clearGitState(): void {
  gitStatus = null;
  gitInstance = undefined;
  gitRefreshInFlight = false;
  gitRefreshPending = false;
  refreshEpoch++;
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  updateFooterLabel();
}
