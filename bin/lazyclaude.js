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
const BUNDLED_REPOS = [
  {
    name: "insane-search",
    repo: "https://github.com/fivetaku/insane-search.git",
    sparsePath: "skills/insane-search",
    destSubdir: "skills/insane-search",
  },
];
const PLUGIN_NAME = "lazyclaude";
const PKG_VERSION = require("../package.json").version;

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
    fs.rmSync(dest, { recursive: true, force: true });
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

  linkCommands(dest);

  console.log("\n✓ lazyclaude installed.");
  console.log("Restart Claude Code to activate. Commands available:");
  console.log("  /ulw-loop   — verified completion loop");
  console.log("  /ulw-plan   — write a plan before coding");
  console.log("  /start-work — execute a plan");
  console.log("  /init-deep  — generate project memory");
}

function claudeCommandsDir() {
  return path.join(claudeConfigDir(), "commands");
}

function isSafeFilename(name) {
  // Allow only plain filenames — no path separators or traversal sequences.
  return name === path.basename(name) && !name.includes("..") && name.length > 0;
}

function linkCommands(pluginDest) {
  const srcDir = path.join(pluginDest, "commands");
  if (!fs.existsSync(srcDir)) return;
  const cmdDir = claudeCommandsDir();
  fs.mkdirSync(cmdDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith(".md") || !isSafeFilename(file)) continue;
    const dest = path.join(cmdDir, file);
    if (fs.existsSync(dest)) continue;
    fs.copyFileSync(path.join(srcDir, file), dest);
  }
}

function unlinkCommands(pluginDest) {
  const srcDir = path.join(pluginDest, "commands");
  if (!fs.existsSync(srcDir)) return;
  const cmdDir = claudeCommandsDir();
  for (const file of fs.readdirSync(srcDir)) {
    if (!isSafeFilename(file)) continue;
    const target = path.join(cmdDir, file);
    if (path.resolve(target).startsWith(path.resolve(cmdDir) + path.sep) && fs.existsSync(target)) {
      fs.rmSync(target);
    }
  }
}

function updateBundled(pluginDest) {
  for (const bundle of BUNDLED_REPOS) {
    console.log(`Updating bundled: ${bundle.name}...`);
    const tmpDir = path.join(os.tmpdir(), `lazyclaude-${bundle.name}-${Date.now()}`);
    try {
      const clone = run("git", ["clone", "--depth=1", "--filter=blob:none", "--sparse", bundle.repo, tmpDir]);
      if (clone.error || clone.status !== 0) {
        console.warn(`  Warning: could not update ${bundle.name} (clone failed). Skipping.`);
        continue;
      }
      const checkout = run("git", ["-C", tmpDir, "sparse-checkout", "set", bundle.sparsePath]);
      if (checkout.error || checkout.status !== 0) {
        console.warn(`  Warning: could not update ${bundle.name} (sparse-checkout failed). Skipping.`);
        continue;
      }
      const srcPath = path.join(tmpDir, bundle.sparsePath);
      const destPath = path.resolve(pluginDest, bundle.destSubdir);
      if (!destPath.startsWith(path.resolve(pluginDest) + path.sep)) {
        console.warn(`  Warning: refusing unsafe destSubdir for ${bundle.name}. Skipping.`);
        continue;
      }
      if (!fs.existsSync(srcPath)) {
        console.warn(`  Warning: ${bundle.sparsePath} not found in ${bundle.name}. Skipping.`);
        continue;
      }
      fs.rmSync(destPath, { recursive: true, force: true });
      fs.cpSync(srcPath, destPath, { recursive: true });
      console.log(`  ✓ ${bundle.name} updated.`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
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
  const before = run("git", ["-C", dest, "rev-parse", "HEAD"], { stdio: "pipe" });
  const beforeHash = before.stdout ? before.stdout.toString().trim() : "";

  const result = run("git", ["-C", dest, "pull", "--ff-only"]);
  if (result.error || result.status !== 0) {
    console.error("Update failed. If branches have diverged, reinstall: npx lazyclaude uninstall && npx lazyclaude install");
    process.exit(1);
  }

  const after = run("git", ["-C", dest, "rev-parse", "HEAD"], { stdio: "pipe" });
  const afterHash = after.stdout ? after.stdout.toString().trim() : "";

  if (beforeHash && afterHash && beforeHash === afterHash) {
    console.log("✓ Already up to date.");
  } else {
    console.log("✓ Updated. Restart Claude Code to apply.");
    if (beforeHash && afterHash) {
      run("git", ["-C", dest, "log", "--oneline", `${beforeHash}..${afterHash}`]);
    }
  }

  unlinkCommands(dest);
  linkCommands(dest);
  updateBundled(dest);
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
  unlinkCommands(dest);
  fs.rmSync(dest, { recursive: true, force: true });
  console.log("✓ lazyclaude uninstalled.");
}

function stripMd(name) {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function doctor() {
  const dest = pluginDir();
  console.log(`lazyclaude v${PKG_VERSION} — doctor\n`);
  console.log(`Plugin dir: ${dest} — ${fs.existsSync(dest) ? "✓ exists" : "✗ missing"}`);

  const commandsDir = path.join(dest, "commands");
  const commands = fs.existsSync(commandsDir)
    ? fs.readdirSync(commandsDir).map(stripMd)
    : [];
  console.log(`Commands: ${commands.length ? commands.map(c => "/" + c).join(", ") : "none"}`);

  const skillsDir = path.join(dest, "skills");
  const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : [];
  console.log(`Skills: ${skills.length ? skills.join(", ") : "none"}`);

  const agentsDir = path.join(dest, "agents");
  const agents = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).map(stripMd)
    : [];
  console.log(`Agents: ${agents.length ? agents.join(", ") : "none"}`);

  console.log(`git: ${hasGit() ? "✓ available" : "✗ not found"}`);

  // Show installed plugin version if available
  const manifest = path.join(dest, ".claude-plugin", "plugin.json");
  if (fs.existsSync(manifest)) {
    try {
      const v = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
      if (v) console.log(`Plugin version: ${v}`);
    } catch {}
  }
}

function help() {
  console.log(`lazyclaude v${PKG_VERSION}`);
  console.log("Usage: npx lazyclaude <install|update|uninstall|doctor>");
  console.log("");
  console.log("Commands:");
  console.log("  install    Clone plugin into ~/.claude/plugins/lazyclaude");
  console.log("  update     Pull latest changes (shows changelog)");
  console.log("  uninstall  Remove the plugin");
  console.log("  doctor     Health check — plugin, commands, agents, git");
}

const cmd = process.argv[2] || "help";
switch (cmd) {
  case "install":   install();   break;
  case "update":    update();    break;
  case "uninstall": uninstall(); break;
  case "doctor":    doctor();    break;
  case "help":
  case "--help":
  case "-h":        help();      break;
  case "--version":
  case "-v":        console.log(`lazyclaude v${PKG_VERSION}`); break;
  default:
    console.error(`Unknown command: ${cmd}`);
    help();
    process.exit(1);
}
