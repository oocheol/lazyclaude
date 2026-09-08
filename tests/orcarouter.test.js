"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  launchClaude,
  orcaRouterChildEnv,
  parseRunArguments,
} = require("../bin/lazyclaude.js");

function validPlugin(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lazyclaude-orcarouter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plugin = path.join(root, "plugins", "lazyclaude");
  fs.mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "lazyclaude" }));
  return plugin;
}

function configuredEnv(extra = {}) {
  return {
    PATH: process.env.PATH || "",
    LAZYCLAUDE_CLAUDE_BIN: "claude-native",
    ORCAROUTER_API_KEY: "sk-orca-test-secret",
    ORCAROUTER_OPUS_MODEL: "vendor/opus-id",
    ORCAROUTER_SONNET_MODEL: "vendor/sonnet-id",
    ORCAROUTER_HAIKU_MODEL: "vendor/haiku-id",
    ...extra,
  };
}

test("run parsing preserves the legacy form and accepts only the bounded provider form", () => {
  assert.deepEqual(parseRunArguments(["--", "--model", "custom/model"]), {
    claudeArgs: ["--model", "custom/model"],
  });
  assert.deepEqual(parseRunArguments(["--provider", "orcarouter", "--", "-p", "hello"]), {
    provider: "orcarouter",
    claudeArgs: ["-p", "hello"],
  });

  for (const args of [
    [],
    ["--provider"],
    ["--provider", "orcarouter"],
    ["--provider=orcarouter", "--"],
    ["--model", "x", "--"],
  ]) assert.ok(parseRunArguments(args).error, JSON.stringify(args));
  assert.match(parseRunArguments(["--provider", "other", "--"]).error, /Unknown provider/);
});

test("default launcher remains isolated from OrcaRouter behavior and keeps exact environment reference", t => {
  const plugin = validPlugin(t);
  const env = { LAZYCLAUDE_CLAUDE_BIN: "claude-native", ANTHROPIC_API_KEY: "direct-key" };
  let call;
  const status = launchClaude(["--model", "unchanged"], {
    pluginDest: plugin,
    env,
    platform: "linux",
    spawnSync(file, args, options) {
      call = { file, args, options };
      return { status: 19 };
    },
  });
  assert.equal(status, 19);
  assert.equal(call.options.env, env);
  assert.deepEqual(call.args.slice(-2), ["--model", "unchanged"]);
});

test("opt-in launch maps configured models, forwards --model, and returns child status", t => {
  const plugin = validPlugin(t);
  const env = configuredEnv({ HTTPS_PROXY: "http://proxy.test", NODE_EXTRA_CA_CERTS: "cert.pem" });
  const original = { ...env };
  let call;
  const status = launchClaude(["--model", "another/provider-model", "--print", "hi"], {
    pluginDest: plugin,
    env,
    platform: "linux",
    provider: "orcarouter",
    spawnSync(file, args, options) {
      call = { file, args, options };
      return { status: 37 };
    },
  });

  assert.equal(status, 37);
  assert.deepEqual(env, original);
  assert.notEqual(call.options.env, env);
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.args.slice(-4), ["--model", "another/provider-model", "--print", "hi"]);
  assert.equal(call.options.env.ANTHROPIC_BASE_URL, "https://api.orcarouter.ai");
  assert.equal(call.options.env.ANTHROPIC_AUTH_TOKEN, "sk-orca-test-secret");
  assert.equal(call.options.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "vendor/opus-id");
  assert.equal(call.options.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "vendor/sonnet-id");
  assert.equal(call.options.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "vendor/haiku-id");
  assert.equal(call.options.env.ANTHROPIC_MODEL, "vendor/sonnet-id");
  assert.equal(call.options.env.ANTHROPIC_SMALL_FAST_MODEL, "vendor/haiku-id");
  assert.equal(call.options.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  assert.equal(call.options.env.HTTPS_PROXY, "http://proxy.test");
  assert.equal(call.options.env.NODE_EXTRA_CA_CERTS, "cert.pem");
  assert.equal(call.options.env.ORCAROUTER_API_KEY, undefined);
});

test("provider environment rejects missing or malformed configuration without exposing secret values", () => {
  for (const missing of [
    "ORCAROUTER_API_KEY",
    "ORCAROUTER_OPUS_MODEL",
    "ORCAROUTER_SONNET_MODEL",
    "ORCAROUTER_HAIKU_MODEL",
  ]) {
    const env = configuredEnv();
    delete env[missing];
    const result = orcaRouterChildEnv(env, "linux");
    assert.match(result.error, new RegExp(missing));
  }

  for (const invalid of ["secret value", "secret\nvalue", "secret\u0000value"]) {
    const result = orcaRouterChildEnv(configuredEnv({ ORCAROUTER_API_KEY: invalid }), "linux");
    assert.match(result.error, /ORCAROUTER_API_KEY/);
    assert.doesNotMatch(result.error, /secret/);
  }
  for (const invalid of ["sonnet", "vendor/model extra", "vendor/model\n"]) {
    const result = orcaRouterChildEnv(configuredEnv({ ORCAROUTER_SONNET_MODEL: invalid }), "linux");
    assert.match(result.error, /provider\/model ID/);
    assert.doesNotMatch(result.error, /sonnet|vendor/);
  }
});

test("invalid provider configuration aborts before spawn and never logs its value", t => {
  const plugin = validPlugin(t);
  const secret = "secret value that must not be logged";
  const errors = [];
  let spawned = false;
  const originalError = console.error;
  console.error = message => errors.push(String(message));
  t.after(() => { console.error = originalError; });

  const status = launchClaude([], {
    pluginDest: plugin,
    env: configuredEnv({ ORCAROUTER_API_KEY: secret }),
    platform: "linux",
    provider: "orcarouter",
    spawnSync() {
      spawned = true;
      return { status: 0 };
    },
  });
  assert.equal(status, 1);
  assert.equal(spawned, false);
  assert.match(errors.join("\n"), /ORCAROUTER_API_KEY/);
  assert.doesNotMatch(errors.join("\n"), new RegExp(secret));
});

test("provider child drops conflicting auth, model mappings, headers, and provider switches", () => {
  const conflicts = {
    ANTHROPIC_API_KEY: "direct",
    ANTHROPIC_OAUTH_TOKEN: "oauth",
    ANTHROPIC_CUSTOM_HEADERS: "x-secret: value",
    ANTHROPIC_DEFAULT_MODEL: "old/default",
    ANTHROPIC_DEFAULT_FABLE_MODEL: "old/fable",
    ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "old name",
    ANTHROPIC_CUSTOM_MODEL_OPTION: "old/custom",
    CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth",
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "9",
    CLAUDE_CODE_SUBAGENT_MODEL: "old/subagent",
    CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_MANTLE: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
    CLAUDE_CODE_USE_FOUNDRY: "1",
    CLAUDE_CODE_USE_ANTHROPIC_AWS: "1",
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "desktop",
  };
  const result = orcaRouterChildEnv(configuredEnv(conflicts), "linux");
  assert.ok(result.env);
  for (const name of Object.keys(conflicts)) assert.equal(result.env[name], undefined, name);
});

test("Windows environment handling is case-insensitive and emits unambiguous canonical keys", () => {
  const env = {
    Path: "C:\\bin",
    orcarouter_api_key: "mixed-key",
    OrcaRouter_Opus_Model: "mixed/opus",
    ORCAROUTER_SONNET_MODEL: "mixed/sonnet",
    orcarouter_haiku_model: "mixed/haiku",
    anthropic_auth_token: "stale-token",
    Anthropic_Default_Sonnet_Model: "stale/sonnet",
    Claude_Code_Oauth_Token: "stale-oauth",
    claude_code_use_bedrock: "1",
    claude_code_disable_nonessential_traffic: "0",
  };
  const result = orcaRouterChildEnv(env, "win32");
  assert.equal(result.env.ANTHROPIC_AUTH_TOKEN, "mixed-key");
  assert.equal(result.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "mixed/sonnet");
  assert.equal(result.env.Path, "C:\\bin");
  assert.equal(Object.keys(result.env).filter(name => name.toUpperCase() === "ANTHROPIC_AUTH_TOKEN").length, 1);
  assert.equal(Object.keys(result.env).filter(name => name.toUpperCase() === "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC").length, 1);
  assert.equal(result.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  assert.equal(Object.keys(result.env).some(name => name.toUpperCase() === "CLAUDE_CODE_OAUTH_TOKEN"), false);
  assert.equal(Object.keys(result.env).some(name => name.toUpperCase() === "CLAUDE_CODE_USE_BEDROCK"), false);
});
