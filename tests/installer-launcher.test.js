"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  launchClaude,
  pluginManifest,
  resolveClaudeExecutable,
} = require("../bin/lazyclaude.js");

function validPlugin(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lazyclaude-launcher-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plugin = path.join(root, "plugins", "lazyclaude");
  fs.mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "lazyclaude", version: "test" }));
  return { root, plugin };
}

test("launcher forwards exact argv, cwd, environment, and child exit status without a shell", t => {
  const { root, plugin } = validPlugin(t);
  const cwd = path.join(root, "working directory");
  fs.mkdirSync(cwd);
  const env = { PATH: process.env.PATH || "", LAZYCLAUDE_CLAUDE_BIN: "claude-native" };
  let call;
  const status = launchClaude(["--print", "a & b", "$(not-a-command)"], {
    pluginDest: plugin,
    cwd,
    env,
    platform: "linux",
    spawnSync(file, args, options) {
      call = { file, args, options };
      return { status: 23 };
    },
  });

  assert.equal(status, 23);
  assert.equal(call.file, "claude-native");
  assert.deepEqual(call.args, ["--plugin-dir", path.resolve(plugin), "--print", "a & b", "$(not-a-command)"]);
  assert.equal(call.options.cwd, cwd);
  assert.equal(call.options.env, env);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.stdio, "inherit");
});

test("Windows command shims fail explicitly instead of receiving arbitrary shell arguments", t => {
  const { root } = validPlugin(t);
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const shim = path.join(bin, "claude.cmd");
  fs.writeFileSync(shim, "@echo off\r\n");

  const resolved = resolveClaudeExecutable({ platform: "win32", env: { Path: bin } });
  assert.match(resolved.error, /Windows shim/);
  assert.match(resolved.error, /does not use a command shell/);

  const configured = resolveClaudeExecutable({
    platform: "win32",
    env: { LAZYCLAUDE_CLAUDE_BIN: shim },
  });
  assert.match(configured.error, /\.cmd\/\.bat shims require a shell/);
});

test("a native Windows executable is preferred over a command shim", t => {
  const { root } = validPlugin(t);
  const shimDir = path.join(root, "shim");
  const nativeDir = path.join(root, "native");
  fs.mkdirSync(shimDir);
  fs.mkdirSync(nativeDir);
  fs.writeFileSync(path.join(shimDir, "claude.cmd"), "@echo off\r\n");
  fs.writeFileSync(path.join(nativeDir, "claude.exe"), "fixture");

  const result = resolveClaudeExecutable({
    platform: "win32",
    env: { Path: `${shimDir};${nativeDir}` },
  });
  assert.equal(result.file, path.join(nativeDir, "claude.exe"));
});

test("manifest validation requires a regular JSON object named lazyclaude", t => {
  const { plugin } = validPlugin(t);
  assert.equal(pluginManifest(plugin).ok, true);

  fs.writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "other" }));
  const result = pluginManifest(plugin);
  assert.equal(result.ok, false);
  assert.match(result.error, /must declare name/);
});
