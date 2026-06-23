# /start-work

Execute a plan until every checkbox is done. Prints **ORCHESTRATION COMPLETE** on success.

## Usage

```
/start-work [plan-name]
```

- `plan-name` — filename stem in `plans/` (e.g. `add-rate-limiting`). Omit to pick the most recent pending plan.

## Behavior

1. Read the plan file from `plans/<plan-name>.md`
2. For each unchecked step:
   a. Spawn Hephaestus (executor) with the step + full plan context
   b. After execution, run verification (tests, lint, type-check as appropriate)
   c. If verification passes: mark step `[x]`, save plan
   d. If verification fails: attempt fix (up to 3 retries), then pause and report
3. After all steps: run full Definition of Done checklist
4. If all DoD items pass: print `ORCHESTRATION COMPLETE ✓`

## Progress tracking

Checkboxes in the plan file are the source of truth. Interrupted runs resume from the first unchecked step.

## Model routing

| Task | Model |
|------|-------|
| Code changes | `claude-opus-4-8` |
| Quick lookups | `claude-haiku-4-5` |
| DoD verification | `claude-opus-4-8` |

## Example

```
/start-work add-rate-limiting
```
