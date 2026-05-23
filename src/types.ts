/** Shape of the JSON payload stored in agent messages for git summary */
export interface GitSummaryPayload {
  files: Array<{
    file: string;
    status: string;
    insertions: number;
    deletions: number;
  }>;
  totalFiles?: number;
  totalInsertions?: number;
  totalDeletions?: number;
  addedCount?: number;
  modifiedCount?: number;
  deletedCount?: number;
}

/** Type guard for GitSummaryPayload */
export function isGitSummaryPayload(value: unknown): value is GitSummaryPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.files);
}

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
