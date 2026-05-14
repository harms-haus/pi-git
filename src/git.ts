import type { GitStatus, FileChange, PiGitStatusValue } from "./types";
import { api, currentCtx, currentCwd } from "./state";
import { shortenPath } from "./format";

// ---------------------------------------------------------------------------
// Pure parsing functions (no side effects)
// ---------------------------------------------------------------------------

/**
 * Parse `git diff --numstat HEAD` output.
 * Each line: `{insertions}\t{deletions}\t{filepath}`
 * Binary files: `-\t-\t{filepath}` → { insertions: -1, deletions: -1 }
 */
export function parseGitNumstat(
  output: string,
): Map<string, { insertions: number; deletions: number }> {
  const result = new Map<string, { insertions: number; deletions: number }>();
  if (!output) return result;

  const lines = output.trim().split("\n");
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [insStr, delStr, filepath] = parts;
    const rawIns = parseInt(insStr, 10);
    const rawDel = parseInt(delStr, 10);
    const insertions = insStr === "-" || Number.isNaN(rawIns) ? -1 : rawIns;
    const deletions = delStr === "-" || Number.isNaN(rawDel) ? -1 : rawDel;
    result.set(filepath, { insertions, deletions });
  }
  return result;
}

/**
 * Parse `git diff --name-status HEAD` output.
 * Each line: `{status}\t{filepath}` where status is A, M, or D.
 */
export function parseGitNameStatus(
  output: string,
): Map<string, "A" | "M" | "D"> {
  const result = new Map<string, "A" | "M" | "D">();
  if (!output) return result;

  const lines = output.trim().split("\n");
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const [status, filepath] = parts;
    if (status === "A" || status === "M" || status === "D") {
      result.set(filepath, status);
    }
  }
  return result;
}

/**
 * Parse `git status --porcelain` output.
 * Each line: `{XY} {filepath}` where XY is a 2-char status code.
 * Lines starting with `??` are untracked.
 */
export function parseGitStatusPorcelain(
  output: string,
): Array<{ file: string; status: "A" | "M" | "D" | "??" }> {
  const result: Array<{ file: string; status: "A" | "M" | "D" | "??" }> = [];
  if (!output) return result;

  const lines = output.trim().split("\n");
  for (const line of lines) {
    if (!line) continue;
    // Format: XY filename — X is index, Y is working tree
    // At least 3 chars: XY + space + filename
    if (line.length < 4) continue;

    const xy = line.slice(0, 2);
    const filepath = line.slice(3);

    let status: "A" | "M" | "D" | "??";
    if (xy.startsWith("??")) {
      status = "??";
    } else {
      const firstChar = xy[0];
      if (firstChar === "A") {
        status = "A";
      } else if (firstChar === "D") {
        status = "D";
      } else {
        status = "M";
      }
    }

    result.push({ file: filepath, status });
  }
  return result;
}

/**
 * Merge all three git data sources into a single GitStatus object.
 *
 * - Key files by filepath from numstat + nameStatus (tracked files).
 * - Overlay untracked files from porcelain (status "??", insertions/deletions = 0).
 * - For files in numstat but not in nameStatus, default status to "M".
 * - Binary files (insertions=-1) are excluded from totals but included in the files array.
 */
export function buildGitStatus(
  numstat: Map<string, { insertions: number; deletions: number }>,
  nameStatus: Map<string, "A" | "M" | "D">,
  porcelain: Array<{ file: string; status: string }>,
  branch: string,
): GitStatus {
  const fileMap = new Map<string, FileChange>();

  // Merge tracked files from numstat + nameStatus
  for (const [filepath, stats] of numstat) {
    const status = nameStatus.get(filepath) ?? "M";
    fileMap.set(filepath, {
      file: filepath,
      status,
      insertions: stats.insertions,
      deletions: stats.deletions,
    });
  }

  // Overlay untracked files from porcelain
  for (const entry of porcelain) {
    if (entry.status === "??" && !fileMap.has(entry.file)) {
      fileMap.set(entry.file, {
        file: entry.file,
        status: "??",
        insertions: 0,
        deletions: 0,
      });
    }
  }

  const files = Array.from(fileMap.values());
  let totalInsertions = 0;
  let totalDeletions = 0;
  let addedCount = 0;
  let modifiedCount = 0;
  let deletedCount = 0;

  for (const f of files) {
    if (f.status === "A" || f.status === "??") {
      addedCount++;
    } else if (f.status === "M") {
      modifiedCount++;
    } else if (f.status === "D") {
      deletedCount++;
    }

    if (f.insertions !== -1) {
      totalInsertions += f.insertions;
    }
    if (f.deletions !== -1) {
      totalDeletions += f.deletions;
    }
  }

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
export function updateFooterLabel(): void {
  const ctx = currentCtx;
  if (!ctx || !ctx.ui) return;

  if (!gitStatus || gitStatus.files.length === 0) {
    ctx.ui.setStatus("pi-git", undefined);
    return;
  }

  const cwd = currentCwd ?? "";
  const value: PiGitStatusValue = {
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
 * Main refresh function: runs git commands, parses output, updates state.
 * Guarded against concurrent execution via gitRefreshInFlight.
 */
export async function refreshGitStatus(): Promise<void> {
  if (!currentCwd) return;
  if (gitRefreshInFlight) {
    gitRefreshPending = true;
    return;
  }

  gitRefreshInFlight = true;

  try {
    // Run four git commands in parallel for performance
    const [numstatResult, nameStatusResult, porcelainResult, branchResult] =
      await Promise.all([
        api.exec("git", ["diff", "--numstat", "HEAD"], {
          cwd: currentCwd,
          timeout: 5000,
        }),
        api.exec("git", ["diff", "--name-status", "HEAD"], {
          cwd: currentCwd,
          timeout: 5000,
        }),
        api.exec("git", ["status", "--porcelain"], {
          cwd: currentCwd,
          timeout: 5000,
        }),
        api.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: currentCwd,
          timeout: 3000,
        }),
      ]);

    if (numstatResult.code !== 0) {
      gitStatus = null;
      updateFooterLabel();
      return;
    }

    if (nameStatusResult.code !== 0) {
      gitStatus = null;
      updateFooterLabel();
      return;
    }

    if (porcelainResult.code !== 0) {
      gitStatus = null;
      updateFooterLabel();
      return;
    }

    // Determine branch name
    let branch = "detached";
    if (branchResult.code === 0 && branchResult.stdout.trim()) {
      branch = branchResult.stdout.trim();
    }

    // Parse all three outputs
    const numstat = parseGitNumstat(numstatResult.stdout);
    const nameStatus = parseGitNameStatus(nameStatusResult.stdout);
    const porcelain = parseGitStatusPorcelain(porcelainResult.stdout);

    // Merge into final status
    gitStatus = buildGitStatus(numstat, nameStatus, porcelain, branch);
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
      refreshGitStatus();
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
    refreshGitStatus();
  }, 500);
}

/**
 * Clear all git state: reset status, cancel pending debounces, update footer.
 */
export function clearGitState(): void {
  gitStatus = null;
  gitRefreshPending = false;
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  updateFooterLabel();
}
