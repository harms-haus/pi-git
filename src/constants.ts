import type { FileChange } from "./types";

/**
 * pi-git Extension — Shared constants and utility functions
 *
 * Centralises status icon mappings and count formatting used across modules.
 */

/** Maps file change status letters to display characters. */
export const STATUS_ICONS: Record<FileChange["status"], string> = {
  A: "+",
  M: "~",
  D: "-",
};

/**
 * Format insertion/deletion counts as display strings.
 * Returns an array of formatted strings like ["+5", "-3"].
 * Omits entries when the corresponding count is zero.
 */
export function formatCounts(insertions: number, deletions: number): string[] {
  const parts: string[] = [];
  if (insertions > 0) {
    parts.push(`+${insertions}`);
  }
  if (deletions > 0) {
    parts.push(`-${deletions}`);
  }
  return parts;
}
