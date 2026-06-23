---
description: Self-referential loop that runs a task until Oracle-verified completion (cap 100 iterations).
argument-hint: "\"task\" [--completion-promise=TEXT] [--strategy=reset|continue]"
---

# /ulw-loop

Run a task in a self-referential loop until Oracle-verified completion.

## Usage

```
/ulw-loop "task description" [--completion-promise=TEXT] [--strategy=reset|continue]
```

## Arguments

- `task` — what to accomplish (required)
- `--completion-promise` — explicit condition that proves completion (e.g. "all tests pass, no type errors")
- `--strategy=reset` — restart from scratch on failure (default)
- `--strategy=continue` — resume from last checkpoint on failure

## Behavior

1. **Hephaestus** (executor agent, model: claude-opus-4-8) carries out the task
2. **Oracle** (verifier agent, model: claude-opus-4-8 with extended thinking) judges completion against the completion promise
3. Loop continues until Oracle returns `VERIFIED` or iteration cap (100) is reached
4. Progress saved to `plans/.ulw-state.json` between iterations

## Model Routing

| Role | Model | Reason |
|------|-------|--------|
| Executor (Hephaestus) | `claude-opus-4-8` | Complex code changes |
| Verifier (Oracle) | `claude-opus-4-8` + thinking | Reliable verification |
| Subtasks | `claude-haiku-4-5` | Fast, cheap parallel work |

## Example

```
/ulw-loop "migrate all tests from Jest to Vitest" --completion-promise="vitest run exits 0, no jest imports remain"
```

## Implementation

When invoked:

1. Read `plans/.ulw-state.json` if it exists (resume mode)
2. Spawn Hephaestus with the task + iteration context
3. After each execution, spawn Oracle with:
   - The task description
   - The completion promise (or derive one from the task)
   - Evidence: test output, lint output, git diff summary
4. If Oracle says `VERIFIED`: print `ULTRAWORK COMPLETE ✓` and exit
5. If Oracle says `NOT_VERIFIED <reason>`: increment iteration, update state, loop
6. If strategy=reset and iteration > 3: clear working state before next attempt

Oracle prompt template:
```
You are Oracle, a strict completion verifier. Given:
- Task: {task}
- Completion promise: {promise}
- Evidence: {evidence}

Reply with exactly one of:
VERIFIED
NOT_VERIFIED: <specific gap>

Do not suggest. Do not explain beyond the verdict.
```
