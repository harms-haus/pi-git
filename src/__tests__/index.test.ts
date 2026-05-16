import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { GitStatus } from "../types";

// --- Mutable mock state ---
let mockGitStatus: GitStatus | null = null;

// --- Mock: @earendil-works/pi-coding-agent ---
vi.mock("@earendil-works/pi-coding-agent", () => ({
	isBashToolResult: vi.fn(),
	isEditToolResult: vi.fn(),
	isWriteToolResult: vi.fn(),
}));

// --- Mock: @earendil-works/pi-tui ---
vi.mock("@earendil-works/pi-tui", () => ({
	Text: vi.fn((...args: unknown[]) => ({ _args: args })),
}));

// --- Mock: ../state ---
vi.mock("../state", () => ({
	setApi: vi.fn(),
	safeUpdateCtx: vi.fn(() => true),
	resetState: vi.fn(),
}));

// --- Mock: ../git ---
vi.mock("../git", () => ({
	refreshGitStatus: vi.fn(),
	debouncedRefreshGitStatus: vi.fn(),
	clearGitState: vi.fn(),
	get gitStatus() {
		return mockGitStatus;
	},
}));

// --- Mock: ../watcher ---
vi.mock("../watcher", () => ({
	startWatcher: vi.fn(),
	stopWatcher: vi.fn(),
}));

// --- Import SUT AFTER all mocks ---
import extension from "../index";
import {
	isBashToolResult,
	isEditToolResult,
	isWriteToolResult,
} from "@earendil-works/pi-coding-agent";
import { setApi, resetState } from "../state";
import {
	refreshGitStatus,
	debouncedRefreshGitStatus,
	clearGitState,
} from "../git";
import { startWatcher, stopWatcher } from "../watcher";

// --- Helpers to build mock pi ---
function makeMockPi() {
	return {
		on: vi.fn(),
		registerMessageRenderer: vi.fn(),
		sendMessage: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
describe("pi-git extension", () => {
	let mockPi: ReturnType<typeof makeMockPi>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGitStatus = null;
		mockPi = makeMockPi();

		// Invoke the extension entry point
		extension(mockPi as unknown as Parameters<typeof extension>[0]);
	});

	// ---- Registration tests ------------------------------------------------

	it("registers event handlers for all required events", () => {
		const events = mockPi.on.mock.calls.map((c: unknown[]) => c[0]);
		expect(events).toContain("session_start");
		expect(events).toContain("session_tree");
		expect(events).toContain("session_shutdown");
		expect(events).toContain("tool_result");
		expect(events).toContain("turn_end");
		expect(events).toContain("agent_end");
	});

	it("registers message renderer for pi-git-summary", () => {
		expect(mockPi.registerMessageRenderer).toHaveBeenCalledWith(
			"pi-git-summary",
			expect.any(Function),
		);
	});

	it("calls setApi with pi", () => {
		expect(setApi).toHaveBeenCalledWith(mockPi);
	});

	// ---- session_start handler ---------------------------------------------

	it("session_start starts watcher and triggers refresh", () => {
		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "session_start",
		)![1] as Mock;
		const ctx = { cwd: "/tmp/repo" };
		handler({}, ctx);

		expect(stopWatcher).toHaveBeenCalled();
		expect(startWatcher).toHaveBeenCalledWith(
			"/tmp/repo",
			expect.any(Function),
		);
		expect(refreshGitStatus).toHaveBeenCalled();
	});

	// ---- session_tree handler ----------------------------------------------

	it("session_tree starts watcher and triggers refresh", () => {
		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "session_tree",
		)![1] as Mock;
		const ctx = { cwd: "/tmp/repo" };
		handler({}, ctx);

		expect(stopWatcher).toHaveBeenCalled();
		expect(startWatcher).toHaveBeenCalledWith(
			"/tmp/repo",
			expect.any(Function),
		);
		expect(refreshGitStatus).toHaveBeenCalled();
	});

	// ---- session_shutdown handler ------------------------------------------

	it("session_shutdown stops watcher and resets state", () => {
		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "session_shutdown",
		)![1] as Mock;
		handler();

		expect(stopWatcher).toHaveBeenCalled();
		expect(clearGitState).toHaveBeenCalled();
		expect(resetState).toHaveBeenCalled();
	});

	// ---- tool_result handler -----------------------------------------------

	it("tool_result triggers debounced refresh for write/edit/bash tools", () => {
		(isWriteToolResult as unknown as Mock).mockReturnValue(true);
		(isEditToolResult as unknown as Mock).mockReturnValue(false);
		(isBashToolResult as unknown as Mock).mockReturnValue(false);

		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "tool_result",
		)![1] as Mock;
		const ctx = { cwd: "/tmp/repo" };
		handler({ toolName: "write" }, ctx);

		expect(debouncedRefreshGitStatus).toHaveBeenCalled();
	});

	it("tool_result triggers debounced refresh for delegate_to_subagents", () => {
		(isWriteToolResult as unknown as Mock).mockReturnValue(false);
		(isEditToolResult as unknown as Mock).mockReturnValue(false);
		(isBashToolResult as unknown as Mock).mockReturnValue(false);

		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "tool_result",
		)![1] as Mock;
		const ctx = { cwd: "/tmp/repo" };
		handler({ toolName: "delegate_to_subagents" }, ctx);

		expect(debouncedRefreshGitStatus).toHaveBeenCalled();
	});

	it("tool_result does not refresh for other tools", () => {
		(isWriteToolResult as unknown as Mock).mockReturnValue(false);
		(isEditToolResult as unknown as Mock).mockReturnValue(false);
		(isBashToolResult as unknown as Mock).mockReturnValue(false);

		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "tool_result",
		)![1] as Mock;
		const ctx = { cwd: "/tmp/repo" };
		handler({ toolName: "read" }, ctx);

		expect(debouncedRefreshGitStatus).not.toHaveBeenCalled();
	});

	// ---- turn_end handler --------------------------------------------------

	it("turn_end triggers debounced refresh", () => {
		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "turn_end",
		)![1] as Mock;
		const ctx = { cwd: "/tmp/repo" };
		handler({}, ctx);

		expect(debouncedRefreshGitStatus).toHaveBeenCalled();
	});

	// ---- agent_end handler -------------------------------------------------

	it("agent_end sends message when gitStatus has files", async () => {
		mockGitStatus = {
			branch: "main",
			totalInsertions: 5,
			totalDeletions: 2,
			addedCount: 1,
			modifiedCount: 0,
			deletedCount: 0,
			files: [
				{
					file: "src/foo.ts",
					status: "A",
					insertions: 5,
					deletions: 0,
				},
			],
		};

		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "agent_end",
		)![1] as Mock;
		await handler();

		expect(mockPi.sendMessage).toHaveBeenCalledWith(
			{
				customType: "pi-git-summary",
				content: JSON.stringify({
					files: mockGitStatus!.files,
					totalFiles: mockGitStatus!.files.length,
					totalInsertions: mockGitStatus!.totalInsertions,
					totalDeletions: mockGitStatus!.totalDeletions,
					addedCount: mockGitStatus!.addedCount,
					modifiedCount: mockGitStatus!.modifiedCount,
					deletedCount: mockGitStatus!.deletedCount,
				}),
				display: true,
				excludeFromContext: true,
			},
			{ triggerTurn: false },
		);
	});

	it("agent_end does nothing when gitStatus is null", async () => {
		mockGitStatus = null;

		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "agent_end",
		)![1] as Mock;
		await handler();

		expect(mockPi.sendMessage).not.toHaveBeenCalled();
		expect(refreshGitStatus).toHaveBeenCalled();
	});

	it("agent_end does nothing when gitStatus has no files", async () => {
		mockGitStatus = {
			branch: "main",
			totalInsertions: 0,
			totalDeletions: 0,
			addedCount: 0,
			modifiedCount: 0,
			deletedCount: 0,
			files: [],
		};

		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "agent_end",
		)![1] as Mock;
		await handler();

		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});

	it("agent_end truncates files to 20 when 60+ files exist", async () => {
		mockGitStatus = {
			branch: "main",
			totalInsertions: 60,
			totalDeletions: 0,
			addedCount: 0,
			modifiedCount: 60,
			deletedCount: 0,
			files: Array.from({ length: 60 }, (_, i) => ({
				file: `src/file${i}.ts`,
				status: "M" as const,
				insertions: 1,
				deletions: 0,
			})),
		};

		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "agent_end",
		)![1] as Mock;
		await handler();

		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);

		const sendArg = mockPi.sendMessage.mock.calls[0][0] as {
			content: string;
		};
		const parsed = JSON.parse(sendArg.content);
		expect(parsed.files).toHaveLength(20);
		expect(parsed.totalFiles).toBe(60);
		expect(parsed.totalInsertions).toBe(60);
		expect(parsed.totalDeletions).toBe(0);
		expect(parsed.addedCount).toBe(0);
		expect(parsed.modifiedCount).toBe(60);
		expect(parsed.deletedCount).toBe(0);
	});

	it("agent_end truncates to 20 when exactly 50 files exist", async () => {
		mockGitStatus = {
			branch: "main",
			totalInsertions: 50,
			totalDeletions: 0,
			addedCount: 0,
			modifiedCount: 50,
			deletedCount: 0,
			files: Array.from({ length: 50 }, (_, i) => ({
				file: `src/file${i}.ts`,
				status: "M" as const,
				insertions: 1,
				deletions: 0,
			})),
		};

		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "agent_end",
		)![1] as Mock;
		await handler();

		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);

		const sendArg = mockPi.sendMessage.mock.calls[0][0] as {
			content: string;
		};
		const parsed = JSON.parse(sendArg.content);
		expect(parsed.files).toHaveLength(20);
		expect(parsed.totalFiles).toBe(50);
		expect(parsed.addedCount).toBe(0);
		expect(parsed.modifiedCount).toBe(50);
		expect(parsed.deletedCount).toBe(0);
	});

	it("agent_end truncates to 20 when exactly 51 files exist", async () => {
		mockGitStatus = {
			branch: "main",
			totalInsertions: 51,
			totalDeletions: 0,
			addedCount: 0,
			modifiedCount: 51,
			deletedCount: 0,
			files: Array.from({ length: 51 }, (_, i) => ({
				file: `src/file${i}.ts`,
				status: "M" as const,
				insertions: 1,
				deletions: 0,
			})),
		};

		const handler = mockPi.on.mock.calls.find(
			(c: unknown[]) => c[0] === "agent_end",
		)![1] as Mock;
		await handler();

		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);

		const sendArg = mockPi.sendMessage.mock.calls[0][0] as {
			content: string;
		};
		const parsed = JSON.parse(sendArg.content);
		expect(parsed.files).toHaveLength(20);
		expect(parsed.totalFiles).toBe(51);
		expect(parsed.addedCount).toBe(0);
		expect(parsed.modifiedCount).toBe(51);
		expect(parsed.deletedCount).toBe(0);
	});
});
