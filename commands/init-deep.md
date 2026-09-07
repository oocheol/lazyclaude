---
description: Generate hierarchical CLAUDE.md project memory across the most complex directories.
---

# /init-deep

Generate hierarchical project memory through CLAUDE.md files. Gives future agents landmarks before they edit.

## Usage

```
/init-deep
```

No arguments. Operates on the current working directory.

## Behavior

1. Skip generated and vendor directories: `node_modules/`, `.git/`, `dist/`, `build/`, `out/`, `coverage/`, `.next/`, `__pycache__/`, `vendor/`, and `target/`. Score each remaining directory with at least 3 source files as `file count × (1 + average nesting depth) × language-diversity factor`.
2. For the top 8 directories by score (or only the root when fewer than 3 qualify):
   - Read representative source files
   - If a `CLAUDE.md` already exists, read it first and preserve its authored instructions. Update it only with clearly stale or missing factual context; otherwise leave it unchanged and report it as preserved. Write a new `CLAUDE.md` only where none exists.
   - A new or safely updated `CLAUDE.md` explains:
     - Purpose of the directory
     - Key files and what they do
     - Patterns and conventions specific to this area
     - Common pitfalls
3. For the root `CLAUDE.md`, apply the same read-first, preserve-authored-content rule; never replace a human-authored file wholesale.
   - Project overview
   - Architecture summary
   - Entry points
   - How to run / test / build
4. Print a summary of files written

## Output structure

```
./CLAUDE.md                    ← project overview
./src/api/CLAUDE.md            ← API layer context
./src/db/CLAUDE.md             ← database layer context
./tests/CLAUDE.md              ← test conventions
```

## When to run

- First time setting up a new codebase
- After major refactoring
- When agents keep making wrong assumptions about the project

## Model

Uses `opus` for analysis. Parallelizes directory scoring with `haiku`.
