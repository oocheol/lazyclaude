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

## Model Routing

모델은 desktop에서 선택한 모델과 무관하게 Agent 툴로 강제 지정됩니다.

| Role | Model | Reason |
|------|-------|--------|
| Executor (Hephaestus) | `claude-opus-4-8` | Complex code changes |
| Verifier (Oracle) | `claude-opus-4-8` | Reliable verification |
| Parallel subtasks | `claude-haiku-4-5` | Fast, cheap parallel work |

## Example

```
/ulw-loop "migrate all tests from Jest to Vitest" --completion-promise="vitest run exits 0, no jest imports remain"
```

## Implementation

When invoked, execute the following loop (max 100 iterations):

**Step 1 — Read state**

Check if `plans/.ulw-state.json` exists. If so, load iteration count and previous failure reason.

**Step 2 — Spawn Hephaestus (executor)**

Use the Agent tool with model override:

```
Agent(
  model: "opus",
  description: "Hephaestus executor — iteration {n}",
  prompt: |
    You are Hephaestus, the executor. Your only job is to complete the task below.
    Do not verify. Do not summarize. Just do the work and report what you changed.

    Task: {task}
    Completion promise: {promise}
    Previous failure reason (if any): {failure_reason}
    Strategy: {strategy}

    After completing, output:
    CHANGES: <brief summary of what you did>
    EVIDENCE: <command output, test results, or diff that proves the work>
)
```

**Step 3 — Collect evidence**

Gather verification evidence from Hephaestus output: test results, lint output, git diff.

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

    Reply with exactly one of:
    VERIFIED
    NOT_VERIFIED: <specific gap>

    Do not suggest. Do not explain beyond the verdict.
)
```

**Step 5 — Branch on verdict**

- `VERIFIED` → print `ULTRAWORK COMPLETE ✓` and exit
- `NOT_VERIFIED: <reason>` → save state to `plans/.ulw-state.json`, increment iteration, go to Step 2
- If `strategy=reset` and iteration > 3: prompt Hephaestus to reconsider approach from scratch
- If iteration reaches 100: print `ITERATION CAP REACHED` and exit
