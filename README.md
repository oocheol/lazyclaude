<div align="center">
  <h1>LazyClaude</h1>
  <p><strong>The one and only agent harness for complex codebases.</strong><br />
  Project memory, planning, execution, and verified completion inside Claude Code.</p>
</div>

---

> Inspired by [LazyCodex](https://github.com/code-yeongyu/lazycodex) / [OmO](https://github.com/code-yeongyu/oh-my-openagent) — ported for Claude Code.
>
> Think LazyVim for Neovim, but for Claude Code.

## Install

**Option 1 — npx (no global install)**
```bash
npx lazyclaude install
```

**Option 2 — global install**
```bash
npm install -g lazyclaude
lazyclaude install
```

**Option 3 — Claude Code plugin (git)**
```bash
git clone https://github.com/oocheol/lazyclaude ~/.claude/plugins/lazyclaude
```

Restart Claude Code. Commands and skills activate automatically.

## Commands

Invoke with `/command-name` in Claude Code.

| Command | What it does |
|---------|-------------|
| `/ulw-loop "task"` | Self-referential loop until Oracle-verified completion (cap: 100 iterations) |
| `/ulw-plan "what to build"` | Decision-complete plan written to `plans/<slug>.md` — never touches product code |
| `/start-work [plan-name]` | Executes a plan step-by-step until every checkbox is done. Prints **ORCHESTRATION COMPLETE** |
| `/init-deep` | Generates hierarchical `CLAUDE.md` project memory across top-N complex directories |

## Skills

Auto-triggered by Claude based on context.

| Skill | Triggers when... |
|-------|-----------------|
| `programming` | User asks for implementation with correctness emphasis |
| `review-work` | "review what I just did", "is this ready to merge" |
| `init-deep` | "create project memory", agents keep making wrong assumptions |

## Agent Roles

Three discipline agents work together:

| Agent | Model | Role |
|-------|-------|------|
| **Hephaestus** | `claude-opus-4-8` | Executor — does the work, verifies output |
| **Oracle** | `claude-opus-4-8` | Verifier — binary VERIFIED / NOT_VERIFIED verdict |
| **Explorer** | `claude-sonnet-4-6` | Read-only mapper — finds things, never edits |

## Model Routing

| Task | Model |
|------|-------|
| Complex code, planning, verification | `claude-opus-4-8` |
| Exploration, quick lookups | `claude-sonnet-4-6` |
| Parallel subtasks, fast ops | `claude-haiku-4-5` |

## How it works

### `/ulw-loop`

```
Hephaestus executes → Oracle judges → loop until VERIFIED
```

Oracle only returns `VERIFIED` when evidence directly proves the completion promise. "Tests pass" without output is not evidence.

### `/ulw-plan`

Reads the codebase, writes a decision-complete plan to `plans/<slug>.md` with ordered checkboxes and an explicit Definition of Done. Never writes product code.

### `/start-work`

Reads a plan, executes each unchecked step via Hephaestus, runs verification after each step, marks checkboxes as it goes. Prints **ORCHESTRATION COMPLETE** when all DoD items pass.

### `/init-deep`

Scores directories by complexity, reads representative files, writes local `CLAUDE.md` files with purpose/conventions/pitfalls. Updates root `CLAUDE.md` with project overview.

## Utilities

```bash
npx lazyclaude doctor    # health check — plugin dir, commands, skills
npx lazyclaude update    # pull latest
npx lazyclaude uninstall # remove plugin
```

## Architecture

```
lazyclaude/
├── .claude-plugin/plugin.json   ← Claude Code plugin manifest
├── commands/                    ← /ulw-loop, /ulw-plan, /start-work, /init-deep
├── skills/                      ← programming, review-work, init-deep
├── agents/                      ← hephaestus, oracle, explorer role definitions
├── setup/setup.sh               ← first-run idempotent setup
├── bin/lazyclaude.js            ← npx installer
└── package.json
```

## License

MIT
