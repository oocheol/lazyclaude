---
description: Execute a plan until every checkbox is done. Prints ORCHESTRATION COMPLETE on success.
argument-hint: "[plan-name]"
---

# /start-work

Execute a plan until every checkbox is done. Prints **ORCHESTRATION COMPLETE** on success.

## Usage

```
/start-work [plan-name]
```

- `plan-name` — filename stem in `plans/` (e.g. `add-rate-limiting`). Accepts with or without `.md` extension. Omit to auto-select: sort `plans/*.md` by modification time descending, then pick the first non-terminal plan (`Status: pending` or `Status: in-progress`) with at least one unchecked `- [ ]` box.

## Behavior

1. Resolve the plan only inside `plans/`: reject absolute paths, `..`, path separators, and names other than a filename stem with an optional `.md`. Resolve the real path of `plans/`, then the selected existing candidate, and require the candidate's real path to remain inside that real directory; reject a symlink or junction that escapes it. If no argument is supplied, select only a real candidate matching the documented non-terminal/unchecked rule. If no candidate exists, stop and report `NO PENDING PLAN`.
2. Confirm the selected file exists and can be read. If it declares `Status: complete`, report `PLAN ALREADY COMPLETE` and do not edit it. Require a `## Steps` section containing at least one checkbox and a `## Definition of Done` section containing at least one checkbox; otherwise stop and report `INVALID PLAN: <specific gap>` without editing it.
3. Change the plan status to `in-progress` before the first executor is launched and save it. For each unchecked step:
   a. Spawn Hephaestus (executor) with the step + full plan context
   b. After execution, run verification (tests, lint, type-check as appropriate)
   c. If verification passes: mark step `[x]`, save plan
   d. If verification fails: attempt fix (up to 3 retries), then pause and report
4. After all steps: run full Definition of Done checklist
5. Mark a step or DoD item complete only after its corresponding verification has concrete passing output. If the executor reports failure or evidence is missing, do not mark it complete.
6. If all DoD items pass: change the plan status to `complete`, save it, and print `ORCHESTRATION COMPLETE ✓`; otherwise leave it `in-progress` and pause with the unmet item and evidence gap.

## Progress tracking

Checkboxes in the plan file are the source of truth. Interrupted runs resume from the first unchecked step.

## Model routing

| Task | Model |
|------|-------|
| Complex code changes / DoD verification | `opus` |
| Normal implementation | `sonnet` |
| Quick lookups | `haiku` |

## Example

```
/start-work add-rate-limiting
```
