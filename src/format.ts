import type { GitStatus } from "./types";

/**
 * Replace $HOME prefix with ~/ for display.
 */
export function shortenPath(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && path.startsWith(home)) {
    return "~" + path.slice(home.length);
  }
  return path;
}

/**
 * Format the agent_end summary as a plain-text multi-line string.
 * Each file gets one line: icon filepath  +N -M
 * Icons: + for added, ~ for modified, - for deleted, ? for untracked
 * The message renderer will apply theme colors.
 *
 * Returns empty string if no files to display.
 */
export function formatAgentEndSummary(status: GitStatus): string {
  if (status.files.length === 0) return "";

  const lines = status.files.map((f) => {
    let icon: string;
    switch (f.status) {
      case "A":
        icon = "+";
        break;
      case "D":
        icon = "-";
        break;
      case "??":
        icon = "?";
        break;
      default: // "M"
        icon = "~";
        break;
    }

    const countParts: string[] = [];
    if (f.insertions > 0) countParts.push(`+${f.insertions}`);
    if (f.deletions > 0) countParts.push(`-${f.deletions}`);
    const countStr = countParts.length > 0 ? "  " + countParts.join(" ") : "";

    return `${icon} ${f.file}${countStr}`;
  });

  return lines.join("\n");
}
