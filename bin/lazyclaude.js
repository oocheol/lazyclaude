#!/usr/bin/env node
/**
 * lazyclaude installer CLI
 * Usage: npx lazyclaude <install|update|uninstall|doctor|run>
 *
 * Security: every external process is spawned with shell:false and an explicit
 * argv array, so no path or env value is ever interpreted by a shell. This
 * removes command-injection risk even if CLAUDE_CONFIG_DIR contains shell
 * metacharacters or spaces.
 */
"use strict";

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

// The override is intentionally undocumented; it makes the installer testable
// against a local repository without contacting or mutating a real account.
const REPO = process.env.LAZYCLAUDE_REPO || "https://github.com/oocheol/lazyclaude.git";
const PLUGIN_NAME = "lazyclaude";
const PKG_VERSION = require("../package.json").version;
const STATE_VERSION = 1;

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function pluginsRoot() {
  return path.join(claudeConfigDir(), "plugins");
}

function pluginDir() {
  return path.join(pluginsRoot(), PLUGIN_NAME);
}

function installerStatePath() {
  return path.join(claudeConfigDir(), ".lazyclaude-installer.json");
}

function pluginManifest(pluginDest) {
  const manifestPath = path.join(pluginDest, ".claude-plugin", "plugin.json");
  try {
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile()) {
      return { ok: false, error: `${manifestPath} is not a regular file` };
    }
    const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: `${manifestPath} must contain a JSON object` };
    }
    if (value.name !== PLUGIN_NAME) {
      return { ok: false, error: `${manifestPath} must declare name \"${PLUGIN_NAME}\"` };
    }
    if (value.version !== undefined && typeof value.version !== "string") {
      return { ok: false, error: `${manifestPath} has a non-string version` };
    }
    return { ok: true, value, path: manifestPath };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ok: false, error: `${manifestPath} is missing` };
    }
    if (error instanceof SyntaxError) {
      return { ok: false, error: `${manifestPath} is not valid JSON: ${error.message}` };
    }
    return { ok: false, error: `Could not read ${manifestPath}: ${error.message}` };
  }
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

  if (pathExists(dest)) {
    const manifest = pluginManifest(dest);
    if (!manifest.ok) {
      console.error(`Cannot install over an existing invalid path at ${dest}: ${manifest.error}`);
      console.error("Move or remove that path explicitly, then retry.");
      process.exit(1);
    }
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

  // Clone out of sight and publish with a single rename. In particular, never
  // delete `dest` after a failed clone: another installer may have won the race.
  const staging = fs.mkdtempSync(path.join(pluginsRoot(), `.${PLUGIN_NAME}-install-`));
  const result = run("git", ["clone", "--depth=1", REPO, staging]);
  if (result.error || result.status !== 0) {
    fs.rmSync(staging, { recursive: true, force: true });
    console.error("Clone failed. Check your internet connection and that git is installed.");
    process.exit(1);
  }

  const manifest = pluginManifest(staging);
  if (!manifest.ok) {
    fs.rmSync(staging, { recursive: true, force: true });
    console.error(`Clone did not contain a valid lazyclaude plugin: ${manifest.error}`);
    process.exit(1);
  }
  try {
    fs.renameSync(staging, dest);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (pathExists(dest)) {
      console.error(`Install stopped because another installation appeared at ${dest}.`);
    } else {
      console.error(`Could not publish the installation: ${error.message}`);
    }
    process.exit(1);
  }

  linkCommands(dest);

  console.log("\n✓ lazyclaude installed.");
  console.log("Plugin files and command aliases are ready. Launch Claude Code with:");
  console.log("  lazyclaude run -- [claude arguments]");
  console.log("This explicitly loads the installed plugin. Commands included:");
  console.log("  /ulw-loop   — verified completion loop");
  console.log("  /ulw-plan   — write a plan before coding");
  console.log("  /start-work — execute a plan");
  console.log("  /init-deep  — generate project memory");
  if (process.platform === "win32") {
    console.log(`If Claude is installed only as claude.cmd, run it directly with --plugin-dir "${path.resolve(dest)}".`);
  }
}

function claudeCommandsDir() {
  return path.join(claudeConfigDir(), "commands");
}

function isSafeFilename(name) {
  // Allow only plain filenames — no path separators or traversal sequences.
  return name === path.basename(name) && !name.includes("..") && name.length > 0;
}

function withInstallerLock(action) {
  fs.mkdirSync(claudeConfigDir(), { recursive: true });
  const lockPath = path.join(claudeConfigDir(), ".lazyclaude-installer.lock");
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${process.pid}\n`);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
      try { fs.rmSync(lockPath); } catch {}
    }
    if (error.code === "EEXIST") {
      console.error(`Another lazyclaude install, update, or uninstall is already running (${lockPath}).`);
      console.error("If no installer is running, remove this stale lock file and retry.");
      return false;
    }
    throw error;
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(lockPath); } catch {}
  };
  process.once("exit", release);
  try {
    action();
    return true;
  } finally {
    release();
    process.removeListener("exit", release);
  }
}

function pathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function regularFileHash(file) {
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

function loadInstallerState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(installerStatePath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        parsed.version !== STATE_VERSION || !parsed.commands ||
        typeof parsed.commands !== "object" || Array.isArray(parsed.commands)) {
      return { version: STATE_VERSION, commands: {} };
    }
    const commands = {};
    for (const [name, hash] of Object.entries(parsed.commands)) {
      if (isSafeFilename(name) && name.endsWith(".md") && /^[a-f0-9]{64}$/.test(hash)) {
        commands[name] = hash;
      }
    }
    return { version: STATE_VERSION, commands };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return { version: STATE_VERSION, commands: {} };
    }
    throw error;
  }
}

function saveInstallerState(state) {
  const statePath = installerStatePath();
  const names = Object.keys(state.commands);
  if (names.length === 0) {
    fs.rmSync(statePath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, statePath);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function commandFiles(pluginDest) {
  const srcDir = path.join(pluginDest, "commands");
  if (!pathExists(srcDir)) return [];
  if (!fs.lstatSync(srcDir).isDirectory()) return [];
  return fs.readdirSync(srcDir).filter(file =>
    file.endsWith(".md") && isSafeFilename(file) && regularFileHash(path.join(srcDir, file))
  );
}

function linkCommands(pluginDest) {
  const cmdDir = claudeCommandsDir();
  fs.mkdirSync(cmdDir, { recursive: true });
  const state = loadInstallerState();
  for (const file of commandFiles(pluginDest)) {
    const src = path.join(pluginDest, "commands", file);
    const dest = path.join(cmdDir, file);
    if (pathExists(dest)) continue;
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    state.commands[file] = regularFileHash(src);
  }
  saveInstallerState(state);
}

function syncCommands(pluginDest) {
  const cmdDir = claudeCommandsDir();
  fs.mkdirSync(cmdDir, { recursive: true });
  const state = loadInstallerState();
  const sources = new Set(commandFiles(pluginDest));

  for (const [file, installedHash] of Object.entries(state.commands)) {
    const target = path.join(cmdDir, file);
    const targetExists = pathExists(target);
    const targetHash = regularFileHash(target);
    if (targetExists && targetHash !== installedHash) {
      // The user edited/replaced it, or made it a symlink/directory. Preserve
      // it and relinquish ownership; copying to a symlink would alter its target.
      delete state.commands[file];
      continue;
    }
    if (!sources.has(file)) {
      if (targetHash === installedHash) fs.rmSync(target);
      delete state.commands[file];
      continue;
    }
    const src = path.join(pluginDest, "commands", file);
    fs.copyFileSync(src, target);
    state.commands[file] = regularFileHash(src);
    sources.delete(file);
  }

  // Newly introduced commands are installed only where no user file exists.
  for (const file of sources) {
    const target = path.join(cmdDir, file);
    if (pathExists(target)) continue;
    const src = path.join(pluginDest, "commands", file);
    fs.copyFileSync(src, target, fs.constants.COPYFILE_EXCL);
    state.commands[file] = regularFileHash(src);
  }
  saveInstallerState(state);
}

function unlinkCommands() {
  const cmdDir = claudeCommandsDir();
  const state = loadInstallerState();
  for (const [file, installedHash] of Object.entries(state.commands)) {
    const target = path.join(cmdDir, file);
    if (regularFileHash(target) === installedHash) {
      fs.rmSync(target);
    }
  }
  saveInstallerState({ version: STATE_VERSION, commands: {} });
}

function update() {
  const dest = pluginDir();
  if (!pathExists(dest)) {
    console.log("lazyclaude not installed. Run: npx lazyclaude install");
    process.exit(1);
  }
  const destStat = fs.lstatSync(dest);
  if (!destStat.isDirectory() || destStat.isSymbolicLink()) {
    console.error(`Refusing to update a non-directory or symlinked installation: ${dest}`);
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

  const manifest = pluginManifest(dest);
  if (!manifest.ok) {
    console.error(`Update produced an invalid plugin: ${manifest.error}`);
    console.error("Command aliases were left unchanged.");
    process.exit(1);
  }

  const after = run("git", ["-C", dest, "rev-parse", "HEAD"], { stdio: "pipe" });
  const afterHash = after.stdout ? after.stdout.toString().trim() : "";

  if (beforeHash && afterHash && beforeHash === afterHash) {
    console.log("✓ Already up to date.");
  } else {
    console.log("✓ Updated. New sessions started with 'lazyclaude run --' will use it.");
    if (beforeHash && afterHash) {
      run("git", ["-C", dest, "log", "--oneline", `${beforeHash}..${afterHash}`]);
    }
  }

  syncCommands(dest);
}

function uninstall() {
  const dest = pluginDir();
  if (!pathExists(dest)) {
    unlinkCommands();
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
  const destStat = fs.lstatSync(dest);
  if (!destStat.isDirectory() || destStat.isSymbolicLink()) {
    console.error(`Refusing to remove a non-directory or symlinked installation: ${dest}`);
    process.exit(1);
  }
  unlinkCommands();
  fs.rmSync(dest, { recursive: true, force: true });
  console.log("✓ lazyclaude uninstalled.");
}

function stripMd(name) {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function doctor() {
  const dest = pluginDir();
  console.log(`lazyclaude v${PKG_VERSION} — doctor\n`);
  const destExists = pathExists(dest);
  console.log(`Plugin dir: ${dest} — ${destExists ? "✓ exists" : "✗ missing"}`);

  const manifest = pluginManifest(dest);
  if (manifest.ok) {
    const version = manifest.value.version ? ` (version ${manifest.value.version})` : "";
    console.log(`Manifest: ✓ valid${version}`);
  } else {
    console.log(`Manifest: ✗ invalid — ${manifest.error}`);
  }

  const commandsDir = path.join(dest, "commands");
  const commands = pathExists(commandsDir) ? commandFiles(dest).map(stripMd) : [];
  console.log(`Commands (plugin): ${commands.length ? commands.map(c => "/" + c).join(", ") : "none"}`);

  const installedCmdDir = claudeCommandsDir();
  const state = loadInstallerState();
  const managedCmds = commands.filter(c => {
    const file = c + ".md";
    return state.commands[file] && regularFileHash(path.join(installedCmdDir, file)) === state.commands[file];
  });
  const preservedCmds = commands.filter(c => {
    const file = c + ".md";
    return !managedCmds.includes(c) && pathExists(path.join(installedCmdDir, file));
  });
  const missingCmds = commands.filter(c => !managedCmds.includes(c) && !preservedCmds.includes(c));
  console.log(`Command aliases (managed): ${managedCmds.length ? managedCmds.map(c => "/" + c).join(", ") : "none"}`);
  if (preservedCmds.length) {
    console.log(`Command aliases (user-owned or modified, preserved): ${preservedCmds.map(c => "/" + c).join(", ")}`);
  }
  if (missingCmds.length) {
    console.log(`Command aliases (missing): ${missingCmds.map(c => "/" + c).join(", ")}`);
    console.log(`  Run 'npx lazyclaude update' to add only aliases whose paths remain unused.`);
  }

  const skillsDir = path.join(dest, "skills");
  const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : [];
  console.log(`Skills: ${skills.length ? skills.join(", ") : "none"}`);

  const agentsDir = path.join(dest, "agents");
  const agents = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).map(stripMd)
    : [];
  console.log(`Agents: ${agents.length ? agents.join(", ") : "none"}`);

  const gitAvailable = hasGit();
  console.log(`git: ${gitAvailable ? "✓ available" : "✗ not found"}`);

  console.log("Activation: use 'lazyclaude run -- [claude arguments]' to load this plugin explicitly.");

  if (!destExists || !manifest.ok || commands.length === 0 || missingCmds.length || !gitAvailable) {
    process.exitCode = 1;
  }
}

function windowsPathEntries(env) {
  const pathValue = env.Path || env.PATH || "";
  return pathValue.split(";").filter(Boolean);
}

function resolveClaudeExecutable({ env = process.env, platform = process.platform } = {}) {
  const configured = env.LAZYCLAUDE_CLAUDE_BIN;
  if (configured) {
    if (platform === "win32" && /\.(?:cmd|bat)$/i.test(configured)) {
      return {
        error: `LAZYCLAUDE_CLAUDE_BIN points to ${configured}. Windows .cmd/.bat shims require a shell, so lazyclaude will not pass arbitrary arguments to one. Configure LAZYCLAUDE_CLAUDE_BIN to a native claude.exe instead.`,
      };
    }
    return { file: configured };
  }

  if (platform !== "win32") return { file: "claude" };

  let shim = null;
  for (const dir of windowsPathEntries(env)) {
    for (const extension of [".exe", ".com", ".cmd", ".bat"]) {
      const candidate = path.join(dir, `claude${extension}`);
      if (!pathExists(candidate)) continue;
      if (extension === ".exe" || extension === ".com") return { file: candidate };
      shim = shim || candidate;
    }
  }
  if (shim) {
    return {
      error: `Found Claude Code only as the Windows shim ${shim}. This launcher does not use a command shell for arbitrary arguments. Set LAZYCLAUDE_CLAUDE_BIN to a native claude.exe, or invoke Claude directly with --plugin-dir \"${path.resolve(pluginDir())}\".`,
    };
  }
  return { file: "claude" };
}

const ORCAROUTER_BASE_URL = "https://api.orcarouter.ai";
const ORCAROUTER_CONFIG = [
  ["ORCAROUTER_API_KEY", "key"],
  ["ORCAROUTER_OPUS_MODEL", "model"],
  ["ORCAROUTER_SONNET_MODEL", "model"],
  ["ORCAROUTER_HAIKU_MODEL", "model"],
];

function envValue(env, name, platform) {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find(candidate => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function invalidOrcaRouterValue(value, kind) {
  if (typeof value !== "string" || value.length === 0 || /[\s\x00-\x1f\x7f]/u.test(value)) {
    return true;
  }
  if (kind === "model" && !/^[^/]+\/[^/]+$/u.test(value)) return true;
  return false;
}

function isOrcaRouterConflict(name) {
  const upper = name.toUpperCase();
  if ([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_OAUTH_TOKEN",
    "ANTHROPIC_CUSTOM_HEADERS",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "ANTHROPIC_DEFAULT_MODEL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  ].includes(upper)) return true;
  if (/^ANTHROPIC_DEFAULT_(?:FABLE|OPUS|SONNET|HAIKU)_MODEL(?:_|$)/u.test(upper)) return true;
  if (/^ANTHROPIC_CUSTOM_MODEL_OPTION(?:_|$)/u.test(upper)) return true;
  return ORCAROUTER_CONFIG.some(([configName]) => upper === configName);
}

/**
 * Construct the environment for one opted-in OrcaRouter child process. The
 * source object is never changed, and errors identify only variable names so a
 * malformed credential cannot be copied into logs.
 */
function orcaRouterChildEnv(sourceEnv, platform = process.platform) {
  const configured = {};
  for (const [name, kind] of ORCAROUTER_CONFIG) {
    const value = envValue(sourceEnv, name, platform);
    if (invalidOrcaRouterValue(value, kind)) {
      return { error: `${name} must be a nonempty ${kind === "model" ? "provider/model ID" : "value"} without whitespace or control characters.` };
    }
    configured[name] = value;
  }

  const childEnv = {};
  for (const [name, value] of Object.entries(sourceEnv)) {
    if (!isOrcaRouterConflict(name)) childEnv[name] = value;
  }
  childEnv.ANTHROPIC_BASE_URL = ORCAROUTER_BASE_URL;
  childEnv.ANTHROPIC_AUTH_TOKEN = configured.ORCAROUTER_API_KEY;
  childEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = configured.ORCAROUTER_OPUS_MODEL;
  childEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = configured.ORCAROUTER_SONNET_MODEL;
  childEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = configured.ORCAROUTER_HAIKU_MODEL;
  childEnv.ANTHROPIC_MODEL = configured.ORCAROUTER_SONNET_MODEL;
  childEnv.ANTHROPIC_SMALL_FAST_MODEL = configured.ORCAROUTER_HAIKU_MODEL;
  childEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return { env: childEnv };
}

function parseRunArguments(args) {
  if (args[0] === "--") {
    return { claudeArgs: args.slice(1) };
  }
  if (args[0] !== "--provider") {
    return { error: "Usage: lazyclaude run [--provider orcarouter] -- <claude arguments>" };
  }
  if (args.length < 3 || args[2] !== "--") {
    return { error: "Usage: lazyclaude run --provider orcarouter -- <claude arguments>" };
  }
  if (args[1] !== "orcarouter") {
    return { error: `Unknown provider: ${args[1] || "(missing)"}` };
  }
  return { provider: "orcarouter", claudeArgs: args.slice(3) };
}

function launchClaude(claudeArgs, options = {}) {
  const pluginDest = path.resolve(options.pluginDest || pluginDir());
  const manifest = pluginManifest(pluginDest);
  if (!manifest.ok) {
    console.error(`Cannot launch Claude Code: invalid lazyclaude plugin: ${manifest.error}`);
    console.error("Run 'lazyclaude doctor' for details, then reinstall or repair the plugin.");
    return 1;
  }

  const executable = resolveClaudeExecutable({
    env: options.env || process.env,
    platform: options.platform || process.platform,
  });
  if (executable.error) {
    console.error(executable.error);
    return 1;
  }

  const sourceEnv = options.env || process.env;
  let childEnv = sourceEnv;
  if (options.provider === "orcarouter") {
    const configured = orcaRouterChildEnv(sourceEnv, options.platform || process.platform);
    if (configured.error) {
      console.error(`Cannot launch OrcaRouter: ${configured.error}`);
      return 1;
    }
    childEnv = configured.env;
  } else if (options.provider !== undefined) {
    console.error(`Cannot launch Claude Code: unknown provider ${options.provider}.`);
    return 1;
  }

  const spawn = options.spawnSync || spawnSync;
  const result = spawn(executable.file, ["--plugin-dir", pluginDest, ...claudeArgs], {
    stdio: "inherit",
    shell: false,
    cwd: options.cwd || process.cwd(),
    env: childEnv,
  });
  if (result.error) {
    console.error(`Could not start Claude Code (${executable.file}): ${result.error.message}`);
    if (process.platform === "win32") {
      console.error("If Claude is installed as claude.cmd, configure LAZYCLAUDE_CLAUDE_BIN to a native claude.exe.");
    }
    return 1;
  }
  if (typeof result.status === "number") return result.status;
  console.error(`Claude Code exited without a status${result.signal ? ` (signal ${result.signal})` : ""}.`);
  return 1;
}

function help() {
  console.log(`lazyclaude v${PKG_VERSION}`);
  console.log("Usage: npx lazyclaude <install|update|uninstall|doctor|run>");
  console.log("");
  console.log("Commands:");
  console.log("  install    Clone plugin into ~/.claude/plugins/lazyclaude");
  console.log("  update     Pull latest changes (shows changelog)");
  console.log("  uninstall  Remove the plugin");
  console.log("  doctor     Health check — plugin, commands, agents, git");
  console.log("  run -- ... Launch Claude Code with this plugin explicitly loaded");
  console.log("  run --provider orcarouter -- ... Launch with child-only OrcaRouter environment overrides");
}

if (require.main === module) {
  const cmd = process.argv[2] || "help";
  switch (cmd) {
    case "install":
      if (!withInstallerLock(install)) process.exitCode = 1;
      break;
    case "update":
      if (!withInstallerLock(update)) process.exitCode = 1;
      break;
    case "uninstall":
      if (!withInstallerLock(uninstall)) process.exitCode = 1;
      break;
    case "doctor":    doctor();    break;
    case "run": {
      const parsed = parseRunArguments(process.argv.slice(3));
      if (parsed.error) {
        console.error(parsed.error);
        process.exitCode = 1;
      } else {
        process.exitCode = launchClaude(parsed.claudeArgs, { provider: parsed.provider });
      }
      break;
    }
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
}

module.exports = {
  launchClaude,
  orcaRouterChildEnv,
  parseRunArguments,
  pluginManifest,
  resolveClaudeExecutable,
};
