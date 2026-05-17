/**
 * Replace $HOME prefix with ~/ for display.
 */
export function shortenPath(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}
