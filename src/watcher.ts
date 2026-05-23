import { watch, existsSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PATH_SEPARATOR_RE = /[/\\]/;
const MAX_WATCHERS = 100;
const IGNORED_DIRS = new Set([".git", "node_modules", ".cache", "dist", "coverage"]);

const activeWatchers = new Set<ReturnType<typeof watch>>();
let epoch = 0;

/**
 * Check if a file path should be ignored by the watcher.
 * Ignores paths containing .git, node_modules, .cache, dist, coverage in any segment.
 * @internal
 */
export function isIgnoredPath(filename: string | null): boolean {
  if (filename === null) {
    return true;
  }
  const segments = filename.split(PATH_SEPARATOR_RE);
  return segments.some((s) => IGNORED_DIRS.has(s));
}

/**
 * Check if a path is a symbolic link.
 * Returns true on error (e.g., ENOENT) to skip by default.
 */
async function isSymlink(absPath: string): Promise<boolean> {
  try {
    const stats = await lstat(absPath);
    return stats.isSymbolicLink();
  } catch {
    return true;
  }
}

/**
 * Collect watchable directories under root via BFS.
 * Skips IGNORED_DIRS, symlinks, and stops at MAX_WATCHERS.
 */
async function collectWatchableDirs(root: string): Promise<string[]> {
  const results: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0 && results.length < MAX_WATCHERS) {
    const dir = queue.shift();
    // Safety guard — unreachable because queue.length > 0 in while condition
    if (!dir) {
      break;
    }
    results.push(dir);

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const subdirs: string[] = [];
    for (const entry of entries) {
      if (results.length + queue.length >= MAX_WATCHERS) {
        break;
      }

      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      subdirs.push(join(dir, entry.name));
    }

    const symlinkChecks = await Promise.all(subdirs.map((p) => isSymlink(p)));
    for (let i = 0; i < subdirs.length; i++) {
      if (!symlinkChecks[i]) {
        queue.push(subdirs[i]);
      }
    }
  }

  return results;
}

/**
 * Start per-directory filesystem watchers on the given directory tree.
 * Calls onRefresh directly — the callback is expected to handle its own debouncing.
 */
export async function startWatcher(cwd: string, onRefresh: () => void): Promise<void> {
  if (cwd === homedir() || !existsSync(cwd)) {
    return;
  }

  const myEpoch = ++epoch;
  stopWatcher();

  try {
    const dirs = await collectWatchableDirs(cwd);

    if (myEpoch !== epoch) {
      return;
    }

    for (const dir of dirs) {
      const w = watch(dir, (_eventType, filename) => {
        if (isIgnoredPath(filename)) {
          return;
        }
        onRefresh();
      });

      w.on("error", (err) => {
        console.warn("[pi-git] watcher error:", err.message);
        w.close();
        activeWatchers.delete(w);
      });

      activeWatchers.add(w);
    }
  } catch {
    // Directory may not exist or fs.watch may not be supported.
    stopWatcher();
  }
}

/**
 * Stop all filesystem watchers.
 */
export function stopWatcher(): void {
  for (const w of activeWatchers) {
    w.close();
  }
  activeWatchers.clear();
}
