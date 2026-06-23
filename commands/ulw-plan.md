# /ulw-plan

Strategic planner. Writes a decision-complete plan before any code is touched.

## Usage

```
/ulw-plan "what to build"
```

## Behavior

1. Reads current codebase structure (CLAUDE.md files, key source files)
2. Produces a plan at `plans/<slug>.md` with:
   - Problem statement
   - Constraints and risks
   - Ordered implementation steps as checkboxes
   - Definition of done (verifiable conditions)
3. **Never writes product code** — planning only

## Plan format

```markdown
# Plan: <title>
_Created: <date> | Status: pending_

## Problem
<1-3 sentences on what and why>

## Constraints
- <technical or scope constraint>

## Steps
- [ ] Step 1: <specific, atomic action>
- [ ] Step 2: ...

## Definition of Done
- [ ] <verifiable condition>
- [ ] <verifiable condition>
```

## Model

Uses `claude-opus-4-8` with thinking enabled for deep analysis before writing the plan.

## Example

```
/ulw-plan "add rate limiting to the API endpoints"
```

Produces `plans/add-rate-limiting-to-api-endpoints.md`.

After planning, run `/start-work` to execute.
