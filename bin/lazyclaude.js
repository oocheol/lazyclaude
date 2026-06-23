#!/usr/bin/env node
/**
 * lazyclaude installer CLI
 * Usage: npx lazyclaude install [--no-tui]
 */
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const REPO = "https://github.com/oocheol/lazyclaude.git";
const PLUGIN_NAME = "lazyclaude";

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function pluginDir() {
  return path.join(claudeConfigDir(), "plugins", PLUGIN_NAME);
}

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, stdio: "inherit", ...opts });
}

function install() {
  const dest = pluginDir();

  if (fs.existsSync(dest)) {
    console.log(`lazyclaude already installed at ${dest}`);
    console.log("Run 'npx lazyclaude update' to update.");
    return;
  }

  console.log("Installing lazyclaude...");
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const result = run(`git clone --depth=1 ${REPO} "${dest}"`);
  if (result.status !== 0) {
    console.error("Clone failed. Check your internet connection.");
    process.exit(1);
  }

  // Run setup
  const setupScript = path.join(dest, "setup", "setup.sh");
  if (fs.existsSync(setupScript)) {
    run(`bash "${setupScript}"`);
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
  console.log("Updating lazyclaude...");
  run(`git -C "${dest}" pull --ff-only`);
  console.log("✓ Updated. Restart Claude Code to apply.");
}

function uninstall() {
  const dest = pluginDir();
  if (!fs.existsSync(dest)) {
    console.log("lazyclaude not installed.");
    return;
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

  const configPath = path.join(claudeConfigDir(), "settings.json");
  const hasConfig = fs.existsSync(configPath);
  console.log(`settings.json: ${hasConfig ? "✓ exists" : "✗ missing"}`);
}

const cmd = process.argv[2] || "help";
switch (cmd) {
  case "install": install(); break;
  case "update":  update();  break;
  case "uninstall": uninstall(); break;
  case "doctor":  doctor();  break;
  default:
    console.log("Usage: npx lazyclaude <install|update|uninstall|doctor>");
}
