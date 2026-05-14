import { watch } from "node:fs";

const DEBOUNCE_MS = 500;
const IGNORED_DIRS = new Set([".git", "node_modules", ".cache", "dist", "coverage"]);

let watcher: ReturnType<typeof watch> | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Check if a file path should be ignored by the watcher.
 * Ignores paths containing .git, node_modules, .cache, dist, coverage in any segment.
 */
export function isIgnoredPath(filename: string | undefined | null): boolean {
  if (!filename) return true;
  const segments = filename.split(/[/\\]/);
  return segments.some((s) => IGNORED_DIRS.has(s));
}

/**
 * Start a recursive filesystem watcher on the given directory.
 * Changes are debounced by DEBOUNCE_MS before calling onRefresh.
 */
export function startWatcher(cwd: string, onRefresh: () => void): void {
  stopWatcher();

  try {
    watcher = watch(
      cwd,
      { recursive: true },
      (_eventType, filename) => {
        if (isIgnoredPath(filename)) return;

        if (debounceTimer !== undefined) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          onRefresh();
        }, DEBOUNCE_MS);
      },
    );

    watcher.on("error", () => {
      // Watch errors are non-fatal — the watcher may recover.
      // If the watcher closes entirely, the close event fires.
    });
  } catch {
    // Directory may not exist or fs.watch may not be supported.
    watcher = undefined;
  }
}

/**
 * Stop the filesystem watcher and clear any pending debounce timer.
 */
export function stopWatcher(): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  if (watcher) {
    watcher.close();
    watcher = undefined;
  }
}
