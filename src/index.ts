/**
 * pi-git Extension — Entry point
 *
 * Registers message renderer and wires up event handlers for git status tracking.
 */

import {
  isBashToolResult,
  isEditToolResult,
  isWriteToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ThemeColor,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { STATUS_ICONS, formatCounts } from "./constants";
import { refreshGitStatus, debouncedRefreshGitStatus, clearGitState, gitStatus } from "./git";
import { setApi, safeUpdateCtx, resetState, getSafeCtx } from "./state";
import { startWatcher, stopWatcher } from "./watcher";

const MAX_SEND_FILES = 20;
const MAX_DISPLAY_FILES = 20;

interface GitSummaryPayload {
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

function isGitSummaryPayload(value: unknown): value is GitSummaryPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.files);
}

function renderFileLine(
  f: GitSummaryPayload["files"][number],
  theme: { fg: (color: ThemeColor, text: string) => string },
): string {
  const icon = STATUS_ICONS[f.status] ?? "~";
  const iconColor: ThemeColor =
    f.status === "A" ? "success" : f.status === "D" ? "error" : "warning";
  const parts: string[] = [theme.fg(iconColor, icon), " ", theme.fg("dim", f.file)];
  let countParts = formatCounts(f.insertions, f.deletions).map((c) =>
    c.startsWith("+") ? theme.fg("success", c) : theme.fg("error", c),
  );
  if (f.insertions === -1 && f.deletions === -1) {
    countParts = [theme.fg("dim", "(binary)")];
  }
  if (countParts.length > 0) {
    parts.push("  ");
    parts.push(...countParts);
  }
  return parts.join("");
}

function renderOverflowSummary(
  typed: GitSummaryPayload,
  displayFiles: GitSummaryPayload["files"],
): string {
  const remaining = (typed.totalFiles ?? typed.files.length) - MAX_DISPLAY_FILES;
  const displayedAdded = displayFiles.filter((f) => f.status === "A").length;
  const displayedModified = displayFiles.filter((f) => f.status === "M").length;
  const displayedDeleted = displayFiles.filter((f) => f.status === "D").length;
  const remAdded = Math.max(0, (typed.addedCount ?? 0) - displayedAdded);
  const remChanged = Math.max(0, (typed.modifiedCount ?? 0) - displayedModified);
  const remDeleted = Math.max(0, (typed.deletedCount ?? 0) - displayedDeleted);
  const remParts: string[] = [];
  if (remAdded > 0) remParts.push(`${remAdded} new`);
  if (remChanged > 0) remParts.push(`${remChanged} changed`);
  if (remDeleted > 0) remParts.push(`${remDeleted} deleted`);
  const remDesc = remParts.length > 0 ? ` (${remParts.join(", ")})` : "";
  return `... and ${remaining} more${remDesc}`;
}

function renderGitSummary(
  message: { content: string },
  theme: { fg: (color: ThemeColor, text: string) => string },
): Text {
  try {
    const parsed: unknown = JSON.parse(message.content);

    if (!isGitSummaryPayload(parsed)) {
      return new Text("\u26a0 Invalid git summary payload", 0, 0);
    }

    const files = parsed.files;
    const totalFiles = parsed.totalFiles ?? files.length;
    const totalIns =
      parsed.totalInsertions ??
      files.reduce((sum, f) => sum + (f.insertions > 0 ? f.insertions : 0), 0);
    const totalDel =
      parsed.totalDeletions ??
      files.reduce((sum, f) => sum + (f.deletions > 0 ? f.deletions : 0), 0);

    // Build header line
    const headerParts: string[] = [];
    headerParts.push(theme.fg("muted", `${totalFiles} file${totalFiles !== 1 ? "s" : ""} changed`));
    const headerCounts = formatCounts(totalIns, totalDel).map((c) =>
      c.startsWith("+") ? theme.fg("success", c) : theme.fg("error", c),
    );
    if (headerCounts.length > 0) {
      headerParts.push(headerCounts.join(" "));
    }

    const displayFiles = files.slice(0, MAX_DISPLAY_FILES);
    const lines = displayFiles.map((f) => renderFileLine(f, theme));

    if (totalFiles > MAX_DISPLAY_FILES) {
      lines.push(theme.fg("dim", renderOverflowSummary(parsed, displayFiles)));
    }

    return new Text([headerParts.join("  "), ...lines].join("\n"), 0, 0);
  } catch {
    return new Text("\u26a0 Git summary could not be rendered", 0, 0);
  }
}

function handleSessionChange(ctx: ExtensionContext) {
  if (!safeUpdateCtx(ctx)) {
    return;
  }
  clearGitState();
  stopWatcher();
  startWatcher(ctx.cwd, () => {
    debouncedRefreshGitStatus();
  }).catch(() => {});
  void refreshGitStatus();
}

export default function (pi: ExtensionAPI): void {
  setApi(pi);

  pi.registerMessageRenderer("pi-git-summary", (message, _opts, theme) => {
    return renderGitSummary({ content: message.content as string }, theme);
  });

  pi.on("session_start", (_event, ctx) => {
    handleSessionChange(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    handleSessionChange(ctx);
  });

  pi.on("session_shutdown", () => {
    stopWatcher();
    clearGitState();
    resetState();
  });

  /** Tools that are not built-in but can mutate files. */
  const EXT_MUTATING_TOOLS = new Set(["delegate_to_subagents"]);

  function isFileMutatingToolResult(event: ToolResultEvent): boolean {
    return (
      isWriteToolResult(event) ||
      isEditToolResult(event) ||
      isBashToolResult(event) ||
      EXT_MUTATING_TOOLS.has(event.toolName)
    );
  }

  pi.on("tool_result", (event, ctx) => {
    if (!safeUpdateCtx(ctx)) {
      return;
    }
    if (isFileMutatingToolResult(event)) {
      debouncedRefreshGitStatus();
    }
  });

  pi.on("turn_end", (_event, ctx) => {
    if (!safeUpdateCtx(ctx)) {
      return;
    }
    debouncedRefreshGitStatus();
  });

  pi.on("agent_end", async () => {
    // Force a fresh read before reading gitStatus to avoid stale data
    // from the debounced refresh triggered by turn_end.
    await refreshGitStatus();
    if (!getSafeCtx()) {
      return;
    }
    const status = gitStatus;
    if (!status || status.files.length === 0) {
      return;
    }

    const filesToSend = status.files.slice(0, MAX_SEND_FILES);

    pi.sendMessage(
      {
        customType: "pi-git-summary",
        content: JSON.stringify({
          files: filesToSend,
          totalFiles: status.files.length,
          totalInsertions: status.totalInsertions,
          totalDeletions: status.totalDeletions,
          addedCount: status.addedCount,
          modifiedCount: status.modifiedCount,
          deletedCount: status.deletedCount,
        }),
        display: true,
      },
      { triggerTurn: false },
    );
  });
}
