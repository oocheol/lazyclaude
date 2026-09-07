# Quality review

## Scope and architecture

Reviewed the Node.js installer, Claude Code command/agent/skill definitions,
vendored Python fetch engine, package metadata, and test/distribution paths.
This is a local CLI/plugin, not a web application: there is no application
frontend, database, authentication service, or hosted API to redesign.

The existing dependency-free installer, Markdown workflows, and vendored engine
remain in place. No provider integration, framework migration, release, or
remote publication is part of this change.

## Priorities and decisions

| Priority | Finding | Decision |
| --- | --- | --- |
| P0 | Update/uninstall removed same-named command files without proving ownership. | Track installed content hashes; preserve unowned, edited, and symlinked aliases. Test lifecycle with isolated local Git fixtures. |
| P0 | Phase-0 HTTP and session warmup followed redirects outside the URL guard. | Reuse guarded redirects, fail closed on unresolved/invalid destinations, and cover internal-address redirects offline. This is not complete SSRF containment; see below. |
| P1 | Cloning into the plugins folder was incorrectly presented as full activation. | Add an explicit `run --` launcher and document `claude --plugin-dir` and namespaced commands. |
| P1 | Shared loop state, ambiguous verdict parsing, and stale completion could misreport progress. | Bind state to task and promise; validate status/iteration fields; require fresh evidence on a new run. Protect plan paths and authored project memory. |
| P2 | Updating the vendored engine independently replaced the reviewed project copy. | Update only through the LazyClaude repository, keeping the bundled engine tied to that revision. |
| P2 | Shared HTTP sessions and learning-cache writes raced within a process. | Serialize shared state and use unique temporary files with atomic cache replacement. |
| P2 | Tests relied on Bash on Windows; package versions disagreed and cache files entered npm artifacts. | Add portable test gates/CI, align metadata, and inspect the actual npm pack file list. |

Implementation ownership was separated by component: Sol for installer/engine,
Terra for workflow instructions, Luna for documentation and test/distribution
plumbing. Root review independently checks changes and reruns validation.

## Important remaining limits

- The URL guard is a preflight check, not a network sandbox. DNS is not pinned
  between validation and connection. Browser and yt-dlp requests/subresources
  are not comprehensively constrained by the Python HTTP guard. Do not expose
  this engine as an untrusted-URL service on a privileged/internal network;
  network-level egress isolation is the next security priority.
- Learning-cache updates are serialized within a process. Separate processes
  remain last-writer-wins; the cache is optional performance data, not a durable
  transaction store.
- Workflow definitions are instructions interpreted by Claude, not an executable
  state-machine runtime. Content tests do not prove real model routing,
  subagent behavior, completion judgments, or atomic same-task exclusion.
- Windows `.cmd`/`.bat` Claude shims are deliberately not passed arbitrary
  arguments through a shell by the launcher. Use a native executable or invoke
  `claude --plugin-dir <path>` directly from your own shell.
- Existing pre-ledger aliases are deliberately treated as user-owned. They are
  not silently adopted or overwritten; namespaced plugin commands use the
  installed plugin content.
- If a Git update delivers an invalid manifest, aliases remain unchanged and
  launch/diagnostics reject the plugin. The pulled checkout is not automatically
  rolled back; repair it before launching. Automatic destructive rollback would
  risk local changes.
- Live website/browser workflows and paid Claude/OrcaRouter inference need
  separate integration testing. No such calls are made by the offline suite.

## Reproducible validation

Run `npm test`, `npm run test:python`, `claude plugin validate .`, and
`npm pack --dry-run --json`. There is no build/transpilation or TypeScript
type-check step. CI configuration is not evidence that remote CI has run.

Root rerun results on Windows (Node.js 24.15.0, Python 3.12.14):

- Node suite: 21 tests passed, zero failures/skips, including local-Git
  install/update/uninstall integration, launcher argument forwarding, workflow
  content contracts, and real npm package-file inspection.
- Python: 45 behavioral checks passed (U1: 12, U5: 17, U7: 16), plus a clean
  site-specific-logic check, in a pre-provisioned environment. That historical
  result did not prove a bare Python installation could run the suite: its
  required test packages were already installed. CI now installs the pinned
  `requirements-test.txt` set before the offline runner performs its explicit
  dependency preflight. The engine's production fallbacks remain available;
  they are not accepted as regression-test substitutes. Four original scripts
  run with DNS/socket access disabled.
- Claude Code 2.1.217: `claude plugin validate .` passed.
- Installer JavaScript syntax, Git Bash setup syntax, and `git diff --check`
  passed. The npm dry-run includes NOTICE and artwork without Python caches.
- Cross-platform CI was added, but remote GitHub CI and live inference/browser
  integration were not run. No commit, push, or publication was performed.
