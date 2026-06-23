---
name: review-work
description: >
  Multi-angle post-implementation review. Use after completing a task to catch
  issues before they reach a PR. Triggers on: "review what I just did",
  "check my changes", "is this ready to merge", or at the end of /start-work.
---

# Review Work

## Review Angles

Run all four angles. Report findings grouped by angle, severity first.

### 1. Correctness
- Do the changes actually solve the stated problem?
- Are there off-by-one errors, race conditions, or missed edge cases?
- Does error handling cover all failure modes at system boundaries?

### 2. Regression Risk
- What existing behavior could break?
- Are there callers of changed APIs that weren't updated?
- Do tests cover the changed paths?

### 3. Security
- User input validated and sanitized?
- No secrets or credentials in code or logs?
- SQL/command injection surfaces?
- Dependency changes introduce known CVEs?

### 4. Simplicity
- Is there a simpler way to express the same logic?
- Dead code introduced?
- Duplication that should be extracted?

## Output Format

```
## Review: <task description>

### Correctness
- ✓ ...
- ⚠ ...  (warning — should fix)
- ✗ ...  (blocker — must fix)

### Regression Risk
...

### Security
...

### Simplicity
...

## Verdict
READY | NEEDS_FIXES | BLOCKED
```

`BLOCKED` requires at least one ✗. `NEEDS_FIXES` requires at least one ⚠. `READY` means all clear.
