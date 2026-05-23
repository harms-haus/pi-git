import { isAbsolute } from "node:path";
import { simpleGit } from "simple-git";
import { buildGitStatus, getUntrackedFileDiffs } from "./git-operations";
import {
  gitInstance as _gitInstance,
  gitRefreshInFlight,
  gitRefreshPending,
  debounceTimer,
  refreshEpoch,
  DEBOUNCE_DELAY_MS,
  updateFooterLabel,
  setGitStatus,
  setGitInstance,
  setGitRefreshInFlight,
  setGitRefreshPending,
  setDebounceTimer,
} from "./git-state";
import { currentCwd, getSafeCtx } from "./state";

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
  const myEpoch = refreshEpoch;

  if (gitRefreshInFlight) {
    setGitRefreshPending(true);
    return;
  }

  setGitRefreshInFlight(true);

  try {
    if (!_gitInstance) {
      setGitInstance(simpleGit(currentCwd));
    }
    const git = _gitInstance;

    if (!git) {
      setGitStatus(null);
      updateFooterLabel();
      return;
    }

    // Check if this is actually a git repo
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      setGitStatus(null);
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

    // Abort if clearGitState() was called while we were awaiting results
    if (myEpoch !== refreshEpoch) return;

    // Compute diffs for untracked files
    const untrackedFiles = statusResult.files
      .filter((f) => f.working_dir === "?" || f.index === "?")
      .map((f) => f.path);
    const untrackedDiffs =
      untrackedFiles.length > 0 ? await getUntrackedFileDiffs(git, untrackedFiles) : undefined;

    if (myEpoch !== refreshEpoch) return;

    setGitStatus(buildGitStatus(statusResult, diffResult ?? undefined, untrackedDiffs));
    updateFooterLabel();
  } catch {
    // Unexpected error — clear status gracefully
    setGitStatus(null);
    updateFooterLabel();
  } finally {
    setGitRefreshInFlight(false);
    // If another refresh was requested while this one was in flight, run it now
    if (gitRefreshPending) {
      setGitRefreshPending(false);
      queueMicrotask(() => {
        void refreshGitStatus();
      });
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
  setDebounceTimer(
    setTimeout(() => {
      setDebounceTimer(undefined);
      void refreshGitStatus();
    }, DEBOUNCE_DELAY_MS),
  );
}
