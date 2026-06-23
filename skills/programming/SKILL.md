---
name: programming
description: >
  Strict programming discipline for TypeScript, Python, Rust, or Go.
  Triggers when the user asks for implementation, refactoring, or code review
  with quality/correctness emphasis. Enforces: no any/unknown escapes, no
  silent error swallowing, no TODO left in shipped code, exhaustive edge-case
  handling, tests alongside new logic.
---

# Programming Discipline

## Language-Specific Rules

### TypeScript
- No `any` or `unknown` without a type guard
- Prefer `Result<T, E>` pattern over throw for recoverable errors
- Strict null checks — never `!` postfix unless the type system genuinely cannot express the invariant
- Zod for runtime validation at system boundaries

### Python
- Type-annotate every public function signature
- Use `dataclasses` or `pydantic` over raw dicts for structured data
- No bare `except:` — catch specific exceptions
- `pathlib.Path` over `os.path`

### Rust
- `unwrap()` / `expect()` only in tests or truly unreachable branches — document why
- Prefer `thiserror` for library errors, `anyhow` for application errors
- No `clone()` in hot paths without a comment explaining why allocation is acceptable

### Go
- Errors are values — check every one, never `_` an error in production paths
- Context propagation in every function that does I/O
- No goroutine leaks — cancel contexts, drain channels

## Universal Rules
- Write the test before or alongside the implementation
- One concern per function — if a function needs a multi-line comment to explain what it does, split it
- No commented-out code in commits
- Meaningful names — if you need a comment to explain a variable name, rename it
