/**
 * pi-git Extension — Git operations barrel.
 *
 * Re-exports git state and refresh functions from split modules.
 */

export { buildGitStatus } from "./git-operations";
export {
  gitStatus,
  setGitStatus,
  setGitInstance,
  setRefreshChain,
  setDebounceTimer,
  incrementRefreshEpoch,
  clearGitState,
  updateFooterLabel,
  DEBOUNCE_DELAY_MS,
  refreshEpoch,
} from "./git-state";
export { refreshGitStatus, debouncedRefreshGitStatus } from "./git-refresh";
