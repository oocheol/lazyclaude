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
- `--strategy=reset` — discard the previous *approach* and reconsider from the current working tree (default). It never deletes files, resets Git, or discards user changes.
- `--strategy=continue` — resume from last checkpoint on failure

## Model Routing

모델은 desktop에서 선택한 모델과 무관하게 Agent 툴로 강제 지정됩니다.

| Role | Model | Reason |
|------|-------|--------|
| Executor (Hephaestus) | `opus` | Complex code changes |
| Verifier (Oracle) | `opus` | Reliable verification |
| Parallel subtasks | `haiku` | Fast, cheap parallel work |

## Example

```
/ulw-loop "migrate all tests from Jest to Vitest" --completion-promise="vitest run exits 0, no jest imports remain"
```

## Implementation

When invoked, execute the following loop (max 100 iterations):

**Step 1 — Read state**

Before deriving a key, resolve `completion-promise` to a concrete, verifiable condition.
If it was omitted, derive it from the task when the condition is unambiguous; otherwise
ask only the material clarification needed. Do not hash, save, or execute with an empty
or undefined promise. Validation errors stop safely and do not require repeated approval
to continue once corrected.

Use a task-specific state file, never a shared file. Derive `task-key` as an ASCII slug
(lowercase `[a-z0-9-]`, maximum 48 characters) from the task, followed by the first 16
hex characters of SHA-256 over UTF-8 encoded `JSON.stringify([task, completionPromise])`.
Use `plans/.ulw-state-<task-key>.json`; including the promise prevents two promises for
the same task from sharing state.

Resolve the real path of `plans/`. For an existing state file, resolve its real target
and proceed only if it remains inside that real `plans/` directory; do not follow a
state-file symlink that escapes it. For a new file, construct only the generated safe
filename directly under that resolved directory. Before starting, do not run another invocation with the same
task key concurrently: check available execution/session information for an active run
and, if one exists, report `ULW RUN ALREADY ACTIVE` and stop. This is a cooperative
check, not a claim of an atomic runtime lock; when activity cannot be determined, tell
the caller not to start concurrent same-key runs.

For an existing state file, require valid JSON and exact stored `task` and
`completionPromise`. Every state save includes `task`, `completionPromise`, and
`strategy`. Its state schema is: `active` requires integer `nextIteration` from 1
through 100 and a string `failureReason`; `complete` requires integer `finalIteration`
from 1 through 100 and verdict `VERIFIED`; `capped` requires `finalIteration: 100` and
a string `failureReason`. `active` resumes at its `nextIteration`. `complete` and
`capped` are historical outcomes only: report the prior outcome without claiming the
current working tree is verified, then begin a new iteration 1 with fresh executor
evidence and a fresh Oracle verdict; never reuse historical evidence. A mismatched or
malformed state is not resumable: report it and begin at iteration 1. Do not overwrite
that malformed file until a later explicit state save is required by this invocation.

**Step 2 — Spawn Hephaestus (executor)**

Use the Agent tool with model override:

```
Agent(
  model: "opus",
  description: "Hephaestus executor — iteration {n}",
  prompt: |
    You are Hephaestus, the executor. Your only job is to complete the task below.
    Implement the task and run the targeted verification needed to produce usable raw
    evidence. Do not make the completion verdict; Oracle makes that verdict.

    Task: {task}
    Completion promise: {promise}
    Previous failure reason (if any): {failure_reason}
    Strategy: {strategy}

    After completing, output:
    CHANGES: <brief summary of what you did>
    EVIDENCE: <verbatim command output, test results, or diff facts that support the promise>
    STATUS: DONE | BLOCKED <reason>
)
```

**Step 3 — Collect evidence**

Gather only concrete evidence from Hephaestus output: commands and their raw results,
lint/type-check results, and relevant diff facts. Missing, truncated, or asserted-only
evidence remains missing; do not invent it.

**Step 4 — Spawn Oracle (verifier)**

Use the Agent tool with model override:

```
Agent(
  model: "opus",
  description: "Oracle verifier — iteration {n}",
  prompt: |
    You are Oracle, a strict completion verifier.

    Task: {task}
    Completion promise: {promise}
    Evidence: {evidence}

    Reply with exactly one of these two machine-readable lines:
    VERIFIED
    NOT_VERIFIED: <specific gap>

    If the input is missing, ambiguous, or malformed, reply `NOT_VERIFIED: insufficient or malformed evidence`.
    Do not suggest fixes. Do not explain beyond the one verdict line.
)
```

**Step 5 — Branch on verdict**

- Accept `VERIFIED` only as an exact, trimmed line. Also accept an exact single line matching `NOT_VERIFIED: <non-empty reason>`; preserve that reason. Treat only all other responses (including extra prose or an empty reason) as `NOT_VERIFIED: malformed verifier response`.
- `VERIFIED` → save `task`, `completionPromise`, `strategy`, `status: complete`, `finalIteration` (1–100), and verdict; print `ULTRAWORK COMPLETE ✓` and exit.
- `NOT_VERIFIED: <reason>` at iteration 100 → save `task`, `completionPromise`, `strategy`, `status: capped`, `finalIteration: 100`, and `failureReason`; print `ITERATION CAP REACHED` and exit. Otherwise save `task`, `completionPromise`, `strategy`, `nextIteration: n + 1`, `failureReason`, and `status: active`, then go to Step 2.
- If `strategy=reset` and iteration > 3: ask Hephaestus to use a materially different approach, preserving the current working tree and all user changes.
