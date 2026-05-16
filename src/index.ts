/**
 * pi-git Extension — Entry point
 *
 * Registers message renderer and wires up event handlers for git status tracking.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	isBashToolResult,
	isEditToolResult,
	isWriteToolResult,
	type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { setApi, safeUpdateCtx, resetState } from "./state";
import {
	refreshGitStatus,
	debouncedRefreshGitStatus,
	clearGitState,
	gitStatus,
} from "./git";
import { startWatcher, stopWatcher } from "./watcher";

const MAX_SEND_FILES = 20;

export default function (pi: ExtensionAPI): void {
	setApi(pi);

	pi.registerMessageRenderer("pi-git-summary", (message, _opts, theme) => {
		try {
			const parsed = JSON.parse(message.content as string) as {
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
			};

			const MAX_FILES = 20;
			const files = parsed.files;
			const totalFiles = parsed.totalFiles ?? files.length;
			const totalIns = parsed.totalInsertions ?? files.reduce((sum, f) => sum + (f.insertions > 0 ? f.insertions : 0), 0);
			const totalDel = parsed.totalDeletions ?? files.reduce((sum, f) => sum + (f.deletions > 0 ? f.deletions : 0), 0);

			// Build header line
			const headerParts: string[] = [];
			headerParts.push(theme.fg("muted", `${totalFiles} file${totalFiles !== 1 ? "s" : ""} changed`));
			const headerCounts: string[] = [];
			if (totalIns > 0) headerCounts.push(theme.fg("success", `+${totalIns}`));
			if (totalDel > 0) headerCounts.push(theme.fg("error", `-${totalDel}`));
			if (headerCounts.length > 0) headerParts.push(headerCounts.join(" "));

			const displayFiles = files.slice(0, MAX_FILES);
			const lines = displayFiles.map((f) => {
				let icon: string;
				let iconColor: ThemeColor;
				switch (f.status) {
					case "A":
						icon = "+";
						iconColor = "success";
						break;
					case "D":
						icon = "-";
						iconColor = "error";
						break;
					default: // "M"
						icon = "~";
						iconColor = "warning";
						break;
				}

				const parts: string[] = [
					theme.fg(iconColor, icon),
					" ",
					theme.fg("dim", f.file),
				];

				const countParts: string[] = [];
				if (f.insertions > 0) {
					countParts.push(theme.fg("success", `+${f.insertions}`));
				}
				if (f.deletions > 0) {
					countParts.push(theme.fg("error", `-${f.deletions}`));
				}
				if (countParts.length > 0) {
					parts.push("  ");
					parts.push(...countParts);
				}

				return parts.join("");
			});

			if (totalFiles > MAX_FILES) {
				const remaining = totalFiles - MAX_FILES;
				const displayedAdded = displayFiles.filter(f => f.status === "A").length;
				const displayedModified = displayFiles.filter(f => f.status === "M").length;
				const displayedDeleted = displayFiles.filter(f => f.status === "D").length;
				const remAdded = Math.max(0, (parsed.addedCount ?? 0) - displayedAdded);
				const remChanged = Math.max(0, (parsed.modifiedCount ?? 0) - displayedModified);
				const remDeleted = Math.max(0, (parsed.deletedCount ?? 0) - displayedDeleted);
				const remParts: string[] = [];
				if (remAdded > 0) remParts.push(`${remAdded} new`);
				if (remChanged > 0) remParts.push(`${remChanged} changed`);
				if (remDeleted > 0) remParts.push(`${remDeleted} deleted`);
				const remDesc = remParts.length > 0 ? ` (${remParts.join(", ")})` : "";
				lines.push(theme.fg("dim", `... and ${remaining} more${remDesc}`));
			}

			return new Text([headerParts.join("  "), ...lines].join("\n"), 0, 0);
		} catch {
			return new Text("\u26a0 Git summary could not be rendered", 0, 0);
		}
	});

	pi.on("session_start", (_event, ctx) => {
		if (!safeUpdateCtx(ctx)) return;
		clearGitState();
		stopWatcher();
		startWatcher(ctx.cwd, () => debouncedRefreshGitStatus());
		refreshGitStatus();
	});

	pi.on("session_tree", (_event, ctx) => {
		if (!safeUpdateCtx(ctx)) return;
		clearGitState();
		stopWatcher();
		startWatcher(ctx.cwd, () => debouncedRefreshGitStatus());
		refreshGitStatus();
	});

	pi.on("session_shutdown", () => {
		stopWatcher();
		clearGitState();
		resetState();
	});

	/** Tools that are not built-in but can mutate files. */
	const EXT_MUTATING_TOOLS = new Set([
		"delegate_to_subagents",
	]);

	function isFileMutatingToolResult(event: ToolResultEvent): boolean {
		return (
			isWriteToolResult(event) ||
			isEditToolResult(event) ||
			isBashToolResult(event) ||
			EXT_MUTATING_TOOLS.has(event.toolName)
		);
	}

	pi.on("tool_result", (event, ctx) => {
		if (!safeUpdateCtx(ctx)) return;
		if (isFileMutatingToolResult(event)) {
			debouncedRefreshGitStatus();
		}
	});

	pi.on("turn_end", (_event, ctx) => {
		if (!safeUpdateCtx(ctx)) return;
		debouncedRefreshGitStatus();
	});

	pi.on("agent_end", async () => {
		// Force a fresh read before reading gitStatus to avoid stale data
		// from the debounced refresh triggered by turn_end.
		await refreshGitStatus();
		const status = gitStatus;
		if (!status || status.files.length === 0) return;

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
				excludeFromContext: true,
			},
			{ triggerTurn: false },
		);
	});
}
