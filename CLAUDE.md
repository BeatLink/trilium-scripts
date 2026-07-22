# CLAUDE.md

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.

## Token/context management

- Use `Read` with `offset`/`limit` to scope reads instead of pulling whole large files when only a
  section is needed.
- Prefer `grep`/glob-style targeted search over dumping whole directories for context.
- Prefer direct tools (`grep`, `find`, `Read`) over spawning a subagent.
- Do not spawn subagents for tasks doable in one or two direct tool calls. Reserve subagents for
  genuinely open-ended exploration (5+ searches with no clear target) or real parallelism.
- Keep this file and the other `.claude/rules/` files lean — they're loaded every turn, so bloat
  costs tokens on every message, not just once. Prune stale entries when found.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## What this repo is

Widgets, themes, and scripts for TriliumNext Notes, distributed via a custom addon manager, **TAM**
(`addons/trilium-addon-manager@beatlink/` — see its README for the full manifest schema). Each
addon lives at `addons/{name}@{author}/_tam_manifest_.json`, installed by TAM directly from this
repo (no build step).

## Commands

Inside `nix-shell nix/`:

```bash
validate                       # lint all manifests — closest thing to a test suite; run after any manifest/source edit
tam_to_zip <manifest-dir>      # manifest -> Trilium-importable ZIP
zip_to_tam <zip>                # Trilium export ZIP -> starting manifest + source files
generate_pages                 # rebuild docs/ (incl. catalog.json)
generate_readme                # regenerate README.md's addon table
```

## Adding/editing an addon

* Make Changes
* Use Validate
* Update Readme and documentation
* Bump versions

## Trilium scripting reference

* Scripts overview: https://docs.triliumnotes.org/user-guide/scripts

- Script API intro (frontend vs backend `api`): https://docs.triliumnotes.org/user-guide/scripts/script-api
- Frontend `Api` reference: https://docs.triliumnotes.org/script-api/frontend/interfaces/Api
- Backend `Api` reference: https://docs.triliumnotes.org/script-api/backend/interfaces/Api
- Source: https://github.com/TriliumNext/Trilium (search `frontend_script_api` / `backend_script_api`
  for the API implementations)
