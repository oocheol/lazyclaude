#!/usr/bin/env node
/**
 * lazyclaude installer CLI
 * Usage: npx lazyclaude <install|update|uninstall|doctor>
 *
 * Security: every external process is spawned with shell:false and an explicit
 * argv array, so no path or env value is ever interpreted by a shell. This
 * removes command-injection risk even if CLAUDE_CONFIG_DIR contains shell
 * metacharacters or spaces.
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const REPO = "https://github.com/oocheol/lazyclaude.git";
const PLUGIN_NAME = "lazyclaude";

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function pluginsRoot() {
  return path.join(claudeConfigDir(), "plugins");
}

function pluginDir() {
  return path.join(pluginsRoot(), PLUGIN_NAME);
}

/**
 * Run a command with NO shell. `args` is an explicit argv array — never a
 * concatenated string — so user-controlled paths cannot inject commands.
 * Returns the spawnSync result; callers inspect `.status` and `.error`.
 */
function run(file, args, opts = {}) {
  return spawnSync(file, args, { stdio: "inherit", shell: false, ...opts });
}

function hasGit() {
  const probe = spawnSync("git", ["--version"], { stdio: "ignore", shell: false });
  return !probe.error && probe.status === 0;
}

function install() {
  const dest = pluginDir();

  if (fs.existsSync(dest)) {
    console.log(`lazyclaude already installed at ${dest}`);
    console.log("Run 'npx lazyclaude update' to update.");
    return;
  }

  if (!hasGit()) {
    console.error("git is required but was not found on PATH. Install git and retry.");
    process.exit(1);
  }

  console.log("Installing lazyclaude...");
  fs.mkdirSync(pluginsRoot(), { recursive: true });

  const result = run("git", ["clone", "--depth=1", REPO, dest]);
  if (result.error || result.status !== 0) {
    console.error("Clone failed. Check your internet connection and that git is installed.");
    process.exit(1);
  }

  // Run first-run setup, if present. Skip silently when bash is unavailable
  // (e.g. a Windows host without Git Bash) — setup is non-essential.
  const setupScript = path.join(dest, "setup", "setup.sh");
  if (fs.existsSync(setupScript)) {
    const setup = run("bash", [setupScript]);
    if (setup.error) {
      console.warn("Note: skipped setup.sh (bash not available). Plugin still works.");
    }
  }

  console.log("\n✓ lazyclaude installed.");
  console.log("Restart Claude Code to activate. Commands available:");
  console.log("  /ulw-loop   — verified completion loop");
  console.log("  /ulw-plan   — write a plan before coding");
  console.log("  /start-work — execute a plan");
  console.log("  /init-deep  — generate project memory");
}

function update() {
  const dest = pluginDir();
  if (!fs.existsSync(dest)) {
    console.log("lazyclaude not installed. Run: npx lazyclaude install");
    process.exit(1);
  }
  if (!hasGit()) {
    console.error("git is required but was not found on PATH.");
    process.exit(1);
  }
  console.log("Updating lazyclaude...");
  const result = run("git", ["-C", dest, "pull", "--ff-only"]);
  if (result.error || result.status !== 0) {
    console.error("Update failed.");
    process.exit(1);
  }
  console.log("✓ Updated. Restart Claude Code to apply.");
}

function uninstall() {
  const dest = pluginDir();
  if (!fs.existsSync(dest)) {
    console.log("lazyclaude not installed.");
    return;
  }
  // Safety guard: only ever remove the exact plugin directory. Refuse if the
  // resolved path does not sit directly under <config>/plugins/lazyclaude.
  const expected = path.resolve(pluginsRoot(), PLUGIN_NAME);
  if (path.resolve(dest) !== expected) {
    console.error(`Refusing to remove unexpected path: ${dest}`);
    process.exit(1);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  console.log("✓ lazyclaude uninstalled.");
}

function doctor() {
  const dest = pluginDir();
  console.log("lazyclaude doctor\n");
  console.log(`Plugin dir: ${dest} — ${fs.existsSync(dest) ? "✓ exists" : "✗ missing"}`);

  const commandsDir = path.join(dest, "commands");
  const commands = fs.existsSync(commandsDir) ? fs.readdirSync(commandsDir) : [];
  console.log(`Commands: ${commands.length ? commands.join(", ") : "none"}`);

  const skillsDir = path.join(dest, "skills");
  const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : [];
  console.log(`Skills: ${skills.length ? skills.join(", ") : "none"}`);

  const agentsDir = path.join(dest, "agents");
  const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir) : [];
  console.log(`Agents: ${agents.length ? agents.join(", ") : "none"}`);

  console.log(`git: ${hasGit() ? "✓ available" : "✗ not found"}`);
}

function help() {
  console.log("Usage: npx lazyclaude <install|update|uninstall|doctor>");
}

const cmd = process.argv[2] || "help";
switch (cmd) {
  case "install": install(); break;
  case "update": update(); break;
  case "uninstall": uninstall(); break;
  case "doctor": doctor(); break;
  case "help":
  case "--help":
  case "-h": help(); break;
  default:
    console.error(`Unknown command: ${cmd}`);
    help();
    process.exit(1);
}
