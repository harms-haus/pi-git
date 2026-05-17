import { watch } from "node:fs";

const IGNORED_DIRS = new Set([".git", "node_modules", ".cache", "dist", "coverage"]);

let watcher: ReturnType<typeof watch> | undefined;

/**
 * Check if a file path should be ignored by the watcher.
 * Ignores paths containing .git, node_modules, .cache, dist, coverage in any segment.
 * @internal
 */
export function isIgnoredPath(filename: string | undefined | null): boolean {
  if (!filename) {
    return true;
  }
  const segments = filename.split(/[/\\]/);
  return segments.some((s) => IGNORED_DIRS.has(s));
}

/**
 * Start a recursive filesystem watcher on the given directory.
 * Calls onRefresh directly — the callback is expected to handle its own debouncing.
 */
export function startWatcher(cwd: string, onRefresh: () => void): void {
  stopWatcher();

  try {
    watcher = watch(cwd, { recursive: true }, (_eventType, filename) => {
      if (isIgnoredPath(filename)) {
        return;
      }
      onRefresh();
    });

    watcher.on("error", (err) => {
      console.warn("[pi-git] watcher error:", (err as Error).message);
    });
  } catch {
    // Directory may not exist or fs.watch may not be supported.
    watcher = undefined;
  }
}

/**
 * Stop the filesystem watcher.
 */
export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = undefined;
  }
}
