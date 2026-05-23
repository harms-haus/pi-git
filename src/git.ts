/**
 * pi-git Extension — Git operations barrel.
 *
 * Re-exports from the split modules for backward compatibility.
 */

export { mapFileStatus, buildDiffMap, buildGitStatus } from "./git-operations";
export {
  gitStatus,
  setGitStatus,
  setGitInstance,
  setGitRefreshInFlight,
  setGitRefreshPending,
  setDebounceTimer,
  incrementRefreshEpoch,
  clearGitState,
  updateFooterLabel,
  DEBOUNCE_DELAY_MS,
} from "./git-state";
export { refreshGitStatus, debouncedRefreshGitStatus } from "./git-refresh";
