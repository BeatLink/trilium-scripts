# CLAUDE.md

Guidance for Claude Code working in this repo. This is an index — rules live in `.claude/rules/`.

## What this repo is

Widgets, themes, and scripts for TriliumNext Notes, distributed via a custom addon manager, **TAM**
(`addons/trilium-addon-manager@beatlink/` — see its README for the full manifest schema). Each
addon lives at `addons/{name}@{author}/_tam_manifest_.json`, installed by TAM directly from this
repo (no build step).

## Rules

- [commands.md](.claude/rules/commands.md) — dev/test commands, `nix-shell`/`nix develop` usage
- [tam-gotchas.md](.claude/rules/tam-gotchas.md) — non-obvious TAM/addon behavior that will bite you
- [addon-workflow.md](.claude/rules/addon-workflow.md) — how to add/edit an addon
- [approach.md](.claude/rules/approach.md) — general working style (conciseness, verification, tone)

## Maintaining this file

Keep this index and the linked rule files up to date: when a task reveals a convention, gotcha, or
workflow not already captured, add or update it in the relevant file in the same session.
