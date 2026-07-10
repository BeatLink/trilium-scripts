# Approach

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
