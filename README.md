# pi-git

Rich git status tracking for the [pi coding agent](https://pi.dev). Provides a live, color-coded git status footer label and an agent-end summary of changed files — kept up to date in real time via filesystem watching.

Works with [pi-powerline](https://github.com/harms-haus/pi-powerline) to display the enriched status in the footer.

## Installation

```bash
pi install git:github.com/harms-haus/pi-git
```

Then restart pi or run `/reload`.

## Features

### Live Footer Label

Replaces the built-in cwd / branch / diff-stats section in the pi-powerline footer with an enriched label:

```
~/project (main) • +142 -38 • 2 new, 5 changed, 1 deleted
```

- **`+N -N`** — total lines added (green) and deleted (red) across all changed files
- **File counts** — new (green), changed (yellow), deleted (red); zero-count categories are hidden
- **Bullet separators** (`•`) for clear visual grouping

Updated automatically via:
- **Filesystem watcher** — recursive `fs.watch` with 500 ms debounce detects file changes in real time
- **Tool results** — triggers a debounced refresh whenever the agent writes, edits, or runs bash commands
- **Turn end** — refreshes after each agent turn completes

### Agent End Summary

When the agent finishes a task, pi-git displays a per-file breakdown of all changes in the repo:

```
4 files changed  +67 -12
+ src/new-feature.ts  +42
~ src/index.ts        +15 -8
~ src/utils.ts        +10 -4
- src/deprecated.ts   -12
```

Each line shows:
- An icon indicating the change type: `+` added, `~` modified, `-` deleted, `?` untracked
- The file path
- Per-file line counts (`+N` in green, `-N` in red)

Large changesets are capped at 20 files with an overflow summary:

```
20 files changed  +1,240 -380
... and 47 more (12 new, 30 changed, 5 deleted)
```

### Performance

- **Parallel git commands** — runs `git diff --numstat`, `git diff --name-status`, `git status --porcelain`, and `git rev-parse` concurrently via `Promise.all`
- **Unified debounce** — all refresh triggers (filesystem watcher, tool results, turn end) share a single 500 ms debounce timer
- **Smart ignore list** — skips events from `.git`, `node_modules`, `.cache`, `dist`, `coverage` (including nested paths)

## Compatibility

Designed to work with [pi-powerline](https://github.com/harms-haus/pi-powerline), which reads the `pi-git` extension status and renders it in the footer. When pi-powerline is not installed, the footer label is still set via `ctx.ui.setStatus()` but won't be rendered in the built-in footer.

The footer gracefully falls back to pi-powerline's built-in rendering when:
- pi-git is not installed or loaded
- The working directory is not a git repository
- The git status payload is invalid

## Related Extensions

- [pi-powerline](https://github.com/harms-haus/pi-powerline) — Unified status bar (footer + above-widget)
- [pi-til-done](https://github.com/harms-haus/pi-til-done) — Todo list with auto-continue until done
- [pi-cwd](https://github.com/harms-haus/pi-cwd) — Working directory management
