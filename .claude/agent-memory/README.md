# Agent memory

Durable, project-scoped findings that agents should know without
re-deriving them from conversation history. One file per topic, referenced
by name from the relevant agent's `.md` file or from `CLAUDE.md`/skills.

This is **not** a substitute for `docs/` — architecture decisions belong in
`docs/decisions/` (ADRs), open security issues belong in `docs/security/`.
Files here are shorter, more tactical: "here's a trap in this codebase,"
not "here's why we decided X." When a memory file's finding becomes
significant enough to need its own rationale/history, promote it to a real
doc under `docs/` and leave a pointer here.

## Index

- `known-traps.md` — environment/tooling gotchas that look like app bugs
  but aren't (and vice versa), discovered the hard way on 2026-08-06.
- `reward-wheel-flag.md` — pointer to the open compliance issue; every
  agent touching rewards should hit this before touching `WHEEL`/`resolve_run`.

## Convention for adding a new memory

Only add something here if it would have saved real time to know in
advance — a bug that looked like something else, a decision that's easy to
accidentally re-litigate, a file that isn't where its name suggests. Don't
log routine facts derivable by reading the code.
