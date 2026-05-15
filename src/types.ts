/** Per-file change record */
export interface FileChange {
  /** Relative path from repo root */
  file: string;
  /** Status: A (added/new), M (modified), D (deleted) */
  status: "A" | "M" | "D";
  /** Lines added (from git diff). -1 if binary or unknown. */
  insertions: number;
  /** Lines deleted (from git diff). -1 if binary or unknown. */
  deletions: number;
}

/** Aggregate of all file changes */
export interface GitStatus {
  /** Current branch name */
  branch: string;
  /** Total insertions across all changed files (excludes binary) */
  totalInsertions: number;
  /** Total deletions across all changed files (excludes binary) */
  totalDeletions: number;
  /** Count of added files (status A, including untracked mapped to A) */
  addedCount: number;
  /** Count of modified files (status M) */
  modifiedCount: number;
  /** Count of deleted files (status D) */
  deletedCount: number;
  /** Per-file details */
  files: FileChange[];
}

/** JSON-serializable value for setStatus("pi-git", ...) contract with pi-powerline */
export interface PiGitStatusValue {
  cwd: string;
  branch: string;
  insertions: number;
  deletions: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
}
