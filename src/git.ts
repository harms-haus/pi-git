import { isAbsolute } from "node:path";
import { simpleGit } from "simple-git";
import { shortenPath } from "./format";
import { currentCwd, getSafeCtx } from "./state";
import type { GitStatus, FileChange } from "./types";
import type { StatusResult, DiffResult, FileStatusResult } from "simple-git";

// ---------------------------------------------------------------------------
// Pure mapping functions (no side effects)
// ---------------------------------------------------------------------------

/**
 * Map a simple-git FileStatusResult to our FileChange status.
 * Uses the working_dir status first (unstaged changes), then index (staged).
 * Handles M, A, D, R, C, T, and conflict codes.
 */
function mapFileStatus(f: FileStatusResult): FileChange["status"] {
  const wd = f.working_dir;
  const idx = f.index;

  // Untracked — treat as Added (they're new files)
  if (wd === "?" || idx === "?") {
    return "A";
  }

  // Deleted — check both index and working tree
  if (wd === "D" || idx === "D") {
    return "D";
  }

  // Renamed or Copied — treat as Added (the new file appears)
  if (idx === "R" || idx === "C" || wd === "R" || wd === "C") {
    return "A";
  }

  // Added — new file in index or working tree
  if (idx === "A" || wd === "A") {
    return "A";
  }

  // Everything else is Modified (M, T, U, conflict codes, etc.)
  return "M";
}

/**
 * Build a GitStatus from simple-git StatusResult and DiffResult.
 *
 * - StatusResult provides file list with statuses (including renames, copies, untracked).
 * - DiffResult provides per-file insertions/deletions (for tracked, non-renamed files).
 * - Untracked files get insertions/deletions = 0.
 *
 * @internal Exported for testing only.
 */
function buildDiffMap(diff: DiffResult): Map<string, { insertions: number; deletions: number }> {
  const diffMap = new Map<string, { insertions: number; deletions: number }>();
  for (const f of diff.files) {
    if ("binary" in f && f.binary) {
      diffMap.set(f.file, { insertions: -1, deletions: -1 });
    } else {
      diffMap.set(f.file, {
        insertions: f.insertions,
        deletions: f.deletions,
      });
    }
  }
  return diffMap;
}

export function buildGitStatus(status: StatusResult, diff?: DiffResult): GitStatus {
  const diffMap = diff ? buildDiffMap(diff) : new Map<string, { insertions: number; deletions: number }>();

  const files: FileChange[] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;
  let addedCount = 0;
  let modifiedCount = 0;
  let deletedCount = 0;

  for (const f of status.files) {
    const fileStatus = mapFileStatus(f);
    // Use f.path (the current name), or for renames f.from → old, f.path → new
    const filepath = f.path;
    const stats = diffMap.get(filepath);
    // Note: git diff HEAD does not include untracked files, so they will
    // have no entry in diffMap and their insertions/deletions default to 0.
    const insertions = stats?.insertions ?? 0;
    const deletions = stats?.deletions ?? 0;

    files.push({
      file: filepath,
      status: fileStatus,
      insertions,
      deletions,
    });

    // Counting — mapFileStatus only returns "A", "D", or "M"
    if (fileStatus === "A") {
      addedCount++;
    } else if (fileStatus === "M") {
      modifiedCount++;
    } else {
      deletedCount++;
    }

    if (insertions !== -1) {
      totalInsertions += insertions;
    }
    if (deletions !== -1) {
      totalDeletions += deletions;
    }
  }

  const branch = status.current ?? (status.detached ? "detached" : "unknown");

  return {
    branch,
    totalInsertions,
    totalDeletions,
    addedCount,
    modifiedCount,
    deletedCount,
    files,
  };
}

// ---------------------------------------------------------------------------
// Module-level mutable state
// ---------------------------------------------------------------------------

export let gitStatus: GitStatus | null = null;
let gitInstance: ReturnType<typeof simpleGit> | undefined;
let gitRefreshInFlight = false;
let gitRefreshPending = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Update the pi-git footer label with current git status.
 * Reads module-level gitStatus + state (currentCtx, currentCwd).
 */
/** @internal */
function updateFooterLabel(): void {
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
// Refresh logic
// ---------------------------------------------------------------------------

/**
 * Main refresh function: uses simple-git to get status + diff, updates state.
 * Guarded against concurrent execution via gitRefreshInFlight.
 */
export async function refreshGitStatus(): Promise<void> {
  if (!currentCwd) {
    return;
  }
  if (!isAbsolute(currentCwd)) {
    return;
  }
  if (gitRefreshInFlight) {
    gitRefreshPending = true;
    return;
  }

  gitRefreshInFlight = true;

  try {
    if (!gitInstance) {
      gitInstance = simpleGit(currentCwd);
    }
    const git = gitInstance;

    // Check if this is actually a git repo
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      gitStatus = null;
      updateFooterLabel();
      return;
    }

    // Run status and diffSummary in parallel
    // diffSummary('HEAD') compares working tree vs last commit (staged + unstaged)
    const [statusResult, diffResult] = await Promise.all([
      git.status(),
      git.diffSummary("HEAD").catch(() => undefined),
    ]);

    // Re-validate ctx after async work — session may have been replaced
    if (!getSafeCtx()) {
      return;
    }

    gitStatus = buildGitStatus(statusResult, diffResult);
    updateFooterLabel();
  } catch {
    // Unexpected error — clear status gracefully
    gitStatus = null;
    updateFooterLabel();
  } finally {
    gitRefreshInFlight = false;
    // If another refresh was requested while this one was in flight, run it now
    if (gitRefreshPending) {
      gitRefreshPending = false;
      queueMicrotask(() => { void refreshGitStatus(); });
    }
  }
}

/**
 * Debounced wrapper around refreshGitStatus.
 * Clears any pending refresh and schedules a new one after 500ms.
 */
export function debouncedRefreshGitStatus(): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void refreshGitStatus();
  }, 500);
}

/**
 * Clear all git state: reset status, cancel pending debounces, update footer.
 */
export function clearGitState(): void {
  gitStatus = null;
  gitInstance = undefined;
  gitRefreshPending = false;
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  updateFooterLabel();
}
