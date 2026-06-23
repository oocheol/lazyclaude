<div align="center">
  <h1>LazyClaude</h1>
  <p><strong>The one and only agent harness for complex codebases.</strong><br />
  Project memory, planning, execution, and verified completion inside Claude Code.</p>
  <img src="assets/hero.svg" alt="LazyClaude architecture — agent loop and insane-search pipeline" width="100%" />
  <p>
    <a href="https://github.com/oocheol/lazyclaude">GitHub</a> ·
    <a href="#insane-search-web-bypass-engine">insane-search</a> ·
    <a href="#commands">Commands</a> ·
    <a href="#skills">Skills</a>
  </p>
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

모델은 desktop에서 선택한 모델과 **무관하게** Agent 툴의 `model` 파라미터로 강제 지정됩니다. Sonnet으로 실행해도 내부에서 Opus/Haiku가 실제 호출됩니다.

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

---

## insane-search: Web Bypass Engine

> Bundled from [fivetaku/insane-search](https://github.com/fivetaku/insane-search) — auto-bypass for blocked websites inside Claude Code.

Claude Code의 기본 WebFetch가 차단되거나 403/CAPTCHA를 만나면, `insane-search`가 자동으로 개입해 공개 콘텐츠를 우회 취득합니다.

### 작동 방식

```
WebFetch 실패 → insane-search 개입
       │
       ▼
  Phase 0: 공식 API / RSS / oEmbed
       │ 실패
       ▼
  Phase 1: Jina Reader · curl_cffi TLS 위장
       │ 실패
       ▼
  Phase 2: 완전한 브라우저 신원 스푸핑 (TLS fingerprint + cookie)
       │ 실패
       ▼
  Phase 3: Playwright 헤드리스 브라우저 → 내부 JSON API 역추적
```

![insane-search pipeline](https://raw.githubusercontent.com/fivetaku/insane-search/main/assets/pipeline.png)

### 지원 플랫폼

| 카테고리 | 사이트 |
|----------|--------|
| 소셜 | X/Twitter, Reddit, Bluesky, Mastodon, Threads |
| 동영상 | YouTube (yt-dlp, 1,858개 사이트) |
| 개발 | GitHub, Stack Overflow, Hacker News, arXiv |
| 블로그 | Medium, Substack |
| 한국 | Naver, Coupang, DCInside, FMKorea, yozm |
| 비즈니스 | LinkedIn |
| 기타 | RSS/Atom 피드가 있는 모든 사이트 |

### 사용법

별도 설정 없이 차단된 URL을 언급하면 Claude가 자동으로 engine을 호출합니다.

```bash
# 직접 실행
python3 -m skills/insane-search/engine "<URL>" [--selector "<CSS>"] [--device auto|desktop|mobile]
```

### 경계

- **공개 콘텐츠만** — 로그인 월, 페이월은 시도하지 않음
- **의존성 자동 설치** — `curl_cffi`, `yt-dlp` 최초 실행 시 자동 설치
- **API 키 불필요** — 외부 설정 없이 동작

---

## Architecture

```
lazyclaude/
├── .claude-plugin/plugin.json   ← Claude Code plugin manifest
├── commands/                    ← /ulw-loop, /ulw-plan, /start-work, /init-deep
├── skills/
│   ├── programming/             ← 구현 품질 스킬
│   ├── review-work/             ← 코드 리뷰 스킬
│   ├── init-deep/               ← 프로젝트 메모리 생성
│   └── insane-search/           ← WAF 우회 웹 접근 엔진 ← NEW
│       ├── SKILL.md
│       ├── engine/              ← Python 엔진 (phase0~3, TLS, Playwright)
│       └── references/          ← 플랫폼별 전략 문서
├── agents/                      ← hephaestus, oracle, explorer
├── setup/setup.sh               ← first-run idempotent setup
├── bin/lazyclaude.js            ← npx installer
└── package.json
```

## License

MIT
