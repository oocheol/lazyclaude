---
name: init-deep
description: >
  Generate hierarchical CLAUDE.md project memory. Use when setting up a new
  codebase, after major refactoring, or when agents keep making wrong
  assumptions. Triggered by: "init-deep", "create project memory",
  "set up CLAUDE.md", "agents keep getting confused about the project".
---

# Init Deep

## Step 0 — Scan
Read the root directory. Identify:
- Language(s) and build system
- Entry points (main file, package.json scripts, Makefile targets)
- Test runner and how to run tests
- Key directories (src, lib, tests, docs, scripts)

## Step 1 — Score directories
Skip: `node_modules/`, `.git/`, `dist/`, `build/`, `out/`, `coverage/`, `.next/`, `__pycache__/`, `vendor/`, `target/` — generated or vendor dirs waste time and produce noise.

For each remaining non-trivial directory, compute a complexity score:
```
score = file_count × (1 + avg_nesting_depth) × language_diversity_factor
```
Pick the **top 8 by score** (minimum 3 source files to qualify). If fewer than 3 directories qualify, only write root CLAUDE.md.

## Step 2 — Write local CLAUDE.md files
For each scored directory, read 3–5 representative files, then write a `CLAUDE.md`:

```markdown
# <Directory Name>

## Purpose
<one paragraph — what this directory does>

## Key Files
- `foo.ts` — <what it does>
- `bar.ts` — <what it does>

## Conventions
- <pattern used here>
- <naming convention>

## Common Pitfalls
- <thing agents get wrong>
```

## Step 3 — Write root CLAUDE.md
Synthesize findings into a root `CLAUDE.md`:

```markdown
# Project: <name>

## What this is
<2-3 sentences>

## How to run
<exact commands>

## How to test
<exact commands>

## Architecture
<diagram or bullet list of layers>

## Entry points
- <file> — <role>
```

## Step 4 — Report
List every `CLAUDE.md` written. Note any directories skipped and why.
