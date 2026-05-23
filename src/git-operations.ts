import type { GitStatus, FileChange } from "./types";
import type { StatusResult, DiffResult, FileStatusResult, SimpleGit } from "simple-git";

// ---------------------------------------------------------------------------
// Pure mapping functions (no side effects)
// ---------------------------------------------------------------------------

/**
 * Map a simple-git FileStatusResult to our FileChange status.
 * Uses the working_dir status first (unstaged changes), then index (staged).
 * Handles M, A, D, R, C, T, and conflict codes.
 */
export function mapFileStatus(f: FileStatusResult): FileChange["status"] {
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
 * Build a diff map from a DiffResult for efficient per-file lookups.
 */
export function buildDiffMap(
  diff: DiffResult,
): Map<string, { insertions: number; deletions: number }> {
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

export function buildGitStatus(
  status: StatusResult,
  diff?: DiffResult,
  untrackedDiffs?: Map<string, { insertions: number; deletions: number }>,
): GitStatus {
  const diffMap = diff
    ? buildDiffMap(diff)
    : new Map<string, { insertions: number; deletions: number }>();

  untrackedDiffs?.forEach((counts, file) => {
    if (!diffMap.has(file)) diffMap.set(file, counts);
  });

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

/**
 * Compute line counts for untracked files by diffing against /dev/null.
 * Caps at 20 files to avoid excessive git subprocess spawning.
 *
 * Note: This spawns one `git diff` subprocess per untracked file (up to 20).
 * The simple-git library throttles concurrency to 5 by default.
 * Consider caching or skipping unchanged files for further optimization.
 */
export async function getUntrackedFileDiffs(
  git: SimpleGit,
  untrackedFiles: string[],
): Promise<Map<string, { insertions: number; deletions: number }>> {
  const result = new Map<string, { insertions: number; deletions: number }>();
  if (untrackedFiles.length === 0) return result;

  // Cap at 20 files to avoid spawning too many git processes
  const filesToDiff = untrackedFiles.slice(0, 20);

  const diffs = await Promise.all(
    filesToDiff.map(async (file) => {
      try {
        const diff = await git.diffSummary(["--no-index", "--", "/dev/null", file]);
        return { file, insertions: diff.insertions, deletions: diff.deletions };
      } catch {
        // Binary file, permission denied, or other error — default to 0
        return { file, insertions: 0, deletions: 0 };
      }
    }),
  );

  for (const d of diffs) {
    result.set(d.file, { insertions: d.insertions, deletions: d.deletions });
  }
  return result;
}
