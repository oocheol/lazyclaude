"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CLI = path.resolve(__dirname, "..", "bin", "lazyclaude.js");

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

function commit(repo, message) {
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["-c", "user.name=Installer Test", "-c", "user.email=test@example.invalid", "commit", "-m", message]);
}

function makeRepo(root, { manifest = { name: "lazyclaude", version: "1.0.0" } } = {}) {
  const repo = path.join(root, "source repo");
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ["init"]);
  write(path.join(repo, ".claude-plugin", "plugin.json"),
    typeof manifest === "string" ? manifest : `${JSON.stringify(manifest)}\n`);
  write(path.join(repo, "commands", "managed.md"), "managed v1\n");
  write(path.join(repo, "commands", "retired.md"), "retired v1\n");
  write(path.join(repo, "commands", "keep.md"), "upstream keep\n");
  write(path.join(repo, "setup", "setup.sh"),
    "#!/usr/bin/env bash\nprintf setup-ran > \"$CLAUDE_CONFIG_DIR/setup-ran\"\n");
  commit(repo, "initial fixture");
  return repo;
}

function fixture(t, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lazyclaude-installer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, "claude config & untouched");
  const home = path.join(root, "isolated home");
  const repo = makeRepo(root, options);
  return { root, config, home, repo };
}

function runCli(ctx, args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ctx.root,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: ctx.config,
      LAZYCLAUDE_REPO: ctx.repo,
      HOME: ctx.home,
      USERPROFILE: ctx.home,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.autocrlf",
      GIT_CONFIG_VALUE_0: "false",
      ...env,
    },
  });
}

function output(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}

test("install, update, doctor, and uninstall preserve user files and track only owned aliases", t => {
  const ctx = fixture(t);
  const commands = path.join(ctx.config, "commands");
  write(path.join(commands, "keep.md"), "user keep\n");

  const installed = runCli(ctx, ["install"]);
  assert.equal(installed.status, 0, output(installed));
  assert.match(output(installed), /lazyclaude run --/);
  assert.doesNotMatch(output(installed), /Restart Claude Code to activate/i);
  assert.equal(fs.readFileSync(path.join(commands, "managed.md"), "utf8"), "managed v1\n");
  assert.equal(fs.readFileSync(path.join(commands, "keep.md"), "utf8"), "user keep\n");
  assert.equal(fs.existsSync(path.join(ctx.config, "setup-ran")), false, "setup.sh must not run");

  const statePath = path.join(ctx.config, ".lazyclaude-installer.json");
  const initialState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.deepEqual(Object.keys(initialState.commands).sort(), ["managed.md", "retired.md"]);

  write(path.join(ctx.repo, "commands", "managed.md"), "managed v2\n");
  fs.rmSync(path.join(ctx.repo, "commands", "retired.md"));
  write(path.join(ctx.repo, "commands", "added.md"), "added v1\n");
  commit(ctx.repo, "update fixture");

  const updated = runCli(ctx, ["update"]);
  assert.equal(updated.status, 0, output(updated));
  assert.equal(fs.readFileSync(path.join(commands, "managed.md"), "utf8"), "managed v2\n");
  assert.equal(fs.readFileSync(path.join(commands, "keep.md"), "utf8"), "user keep\n");
  assert.equal(fs.existsSync(path.join(commands, "retired.md")), false);
  assert.equal(fs.readFileSync(path.join(commands, "added.md"), "utf8"), "added v1\n");
  const updatedState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.deepEqual(Object.keys(updatedState.commands).sort(), ["added.md", "managed.md"]);

  write(path.join(commands, "managed.md"), "user edited managed\n");
  write(path.join(ctx.repo, "commands", "managed.md"), "managed v3\n");
  commit(ctx.repo, "change user-edited command upstream");
  const preservedUpdate = runCli(ctx, ["update"]);
  assert.equal(preservedUpdate.status, 0, output(preservedUpdate));
  assert.equal(fs.readFileSync(path.join(commands, "managed.md"), "utf8"), "user edited managed\n");
  const preservedState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.deepEqual(Object.keys(preservedState.commands), ["added.md"]);

  const doctor = runCli(ctx, ["doctor"]);
  assert.equal(doctor.status, 0, output(doctor));
  assert.match(output(doctor), /Manifest: .*valid/);
  assert.match(output(doctor), /user-owned or modified, preserved/);
  assert.doesNotMatch(output(doctor), /update.*fix/i);

  const removed = runCli(ctx, ["uninstall"]);
  assert.equal(removed.status, 0, output(removed));
  assert.equal(fs.existsSync(path.join(ctx.config, "plugins", "lazyclaude")), false);
  assert.equal(fs.existsSync(path.join(commands, "added.md")), false);
  assert.equal(fs.readFileSync(path.join(commands, "managed.md"), "utf8"), "user edited managed\n");
  assert.equal(fs.readFileSync(path.join(commands, "keep.md"), "utf8"), "user keep\n");
  assert.equal(fs.existsSync(statePath), false);
});

test("update never copies through a command alias symlink", t => {
  const ctx = fixture(t);
  const installed = runCli(ctx, ["install"]);
  assert.equal(installed.status, 0, output(installed));

  const alias = path.join(ctx.config, "commands", "managed.md");
  const target = path.join(ctx.root, "user target.md");
  write(target, "do not change\n");
  fs.rmSync(alias);
  try {
    fs.symlinkSync(target, alias, "file");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip(`file symlinks are not available: ${error.code}`);
      return;
    }
    throw error;
  }

  write(path.join(ctx.repo, "commands", "managed.md"), "upstream changed\n");
  commit(ctx.repo, "change linked command");
  const updated = runCli(ctx, ["update"]);
  assert.equal(updated.status, 0, output(updated));
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, "utf8"), "do not change\n");
  const state = JSON.parse(fs.readFileSync(path.join(ctx.config, ".lazyclaude-installer.json"), "utf8"));
  assert.equal(Object.hasOwn(state.commands, "managed.md"), false);
});

test("an invalid cloned manifest is rejected and staging is cleaned", t => {
  const ctx = fixture(t, { manifest: "{ definitely not json\n" });
  const result = runCli(ctx, ["install"]);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /valid lazyclaude plugin/i);
  const plugins = path.join(ctx.config, "plugins");
  assert.equal(fs.existsSync(path.join(plugins, "lazyclaude")), false);
  assert.deepEqual(fs.existsSync(plugins) ? fs.readdirSync(plugins) : [], []);
  assert.equal(fs.existsSync(path.join(ctx.config, ".lazyclaude-installer.lock")), false);
});

test("install does not report success over an existing invalid path", t => {
  const ctx = fixture(t);
  const destination = path.join(ctx.config, "plugins", "lazyclaude");
  write(destination, "user-owned file\n");
  const result = runCli(ctx, ["install"]);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /existing invalid path/);
  assert.equal(fs.readFileSync(destination, "utf8"), "user-owned file\n");

  const doctor = runCli(ctx, ["doctor"]);
  assert.equal(doctor.status, 1, output(doctor));
  assert.match(output(doctor), /Manifest: .*invalid/);

  const removed = runCli(ctx, ["uninstall"]);
  assert.equal(removed.status, 1, output(removed));
  assert.match(output(removed), /Refusing to remove/);
  assert.equal(fs.readFileSync(destination, "utf8"), "user-owned file\n");
});

for (const [label, ledger] of [
  ["null", "null\n"],
  ["array", "[]\n"],
  ["primitive", "42\n"],
]) {
  test(`a structurally invalid ${label} ownership ledger fails safe`, t => {
    const ctx = fixture(t);
    const installed = runCli(ctx, ["install"]);
    assert.equal(installed.status, 0, output(installed));
    const alias = path.join(ctx.config, "commands", "managed.md");
    write(alias, "user value after ledger damage\n");
    write(path.join(ctx.config, ".lazyclaude-installer.json"), ledger);
    write(path.join(ctx.repo, "commands", "managed.md"), "upstream changed\n");
    commit(ctx.repo, `ledger ${label}`);

    const updated = runCli(ctx, ["update"]);
    assert.equal(updated.status, 0, output(updated));
    assert.equal(fs.readFileSync(alias, "utf8"), "user value after ledger damage\n");
  });
}

test("doctor and run reject a corrupted installed manifest", t => {
  const ctx = fixture(t);
  const installed = runCli(ctx, ["install"]);
  assert.equal(installed.status, 0, output(installed));
  write(path.join(ctx.config, "plugins", "lazyclaude", ".claude-plugin", "plugin.json"), "[\n");

  const doctor = runCli(ctx, ["doctor"]);
  assert.equal(doctor.status, 1, output(doctor));
  assert.match(output(doctor), /Manifest: .*invalid/);
  assert.match(output(doctor), /not valid JSON/);

  const launched = runCli(ctx, ["run", "--", "--print", "must-not-run"], {
    LAZYCLAUDE_CLAUDE_BIN: path.join(ctx.root, "does-not-exist"),
  });
  assert.equal(launched.status, 1, output(launched));
  assert.match(output(launched), /Cannot launch Claude Code: invalid lazyclaude plugin/);
  assert.doesNotMatch(output(launched), /Could not start Claude Code/);
});

test("an update with an invalid manifest does not touch command aliases", t => {
  const ctx = fixture(t);
  const installed = runCli(ctx, ["install"]);
  assert.equal(installed.status, 0, output(installed));
  const alias = path.join(ctx.config, "commands", "managed.md");
  assert.equal(fs.readFileSync(alias, "utf8"), "managed v1\n");

  write(path.join(ctx.repo, ".claude-plugin", "plugin.json"), "null\n");
  write(path.join(ctx.repo, "commands", "managed.md"), "must not be copied\n");
  commit(ctx.repo, "invalid plugin update");
  const updated = runCli(ctx, ["update"]);
  assert.equal(updated.status, 1, output(updated));
  assert.match(output(updated), /Update produced an invalid plugin/);
  assert.match(output(updated), /aliases were left unchanged/);
  assert.equal(fs.readFileSync(alias, "utf8"), "managed v1\n");
});

test("an installer lock prevents concurrent mutation", t => {
  const ctx = fixture(t);
  fs.mkdirSync(ctx.config, { recursive: true });
  const lock = path.join(ctx.config, ".lazyclaude-installer.lock");
  write(lock, "99999\n");
  const result = runCli(ctx, ["install"]);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /already running/);
  assert.equal(fs.readFileSync(lock, "utf8"), "99999\n");
  assert.equal(fs.existsSync(path.join(ctx.config, "plugins", "lazyclaude")), false);
});
