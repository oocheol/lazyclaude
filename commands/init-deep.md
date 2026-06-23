# /init-deep

Generate hierarchical project memory through CLAUDE.md files. Gives future agents landmarks before they edit.

## Usage

```
/init-deep
```

No arguments. Operates on the current working directory.

## Behavior

1. Score directories by complexity (file count × avg depth × language diversity)
2. For the top-N most complex directories (N = min(10, dirs > threshold)):
   - Read representative source files
   - Write a `CLAUDE.md` in that directory explaining:
     - Purpose of the directory
     - Key files and what they do
     - Patterns and conventions specific to this area
     - Common pitfalls
3. Update or create the root `CLAUDE.md` with:
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

Uses `claude-opus-4-8` for analysis. Parallelizes directory scoring with `claude-haiku-4-5`.
