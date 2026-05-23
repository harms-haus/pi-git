/**
 * Replace $HOME prefix with ~/ for display.
 */
export function shortenPath(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && path.startsWith(home)) {
    const rest = path.slice(home.length);
    if (rest === "" || rest[0] === "/" || rest[0] === "\\") {
      return `~${rest}`;
    }
  }
  return path;
}
