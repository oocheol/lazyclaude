"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

test("package metadata and plugin manifest stay in sync", () => {
  const pkg = readJson("package.json");
  const manifest = readJson(".claude-plugin/plugin.json");
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
});

test("published package includes license notice and README artwork", () => {
  const pkg = readJson("package.json");
  for (const entry of ["LICENSE", "NOTICE", "README.md", "assets/"]) {
    assert.ok(pkg.files.includes(entry), `${entry} must be included in npm files`);
  }
  assert.ok(fs.existsSync(path.join(root, "NOTICE")));
  assert.ok(fs.existsSync(path.join(root, "assets", "hero.svg")));
});

test("npm package does not publish Python caches", () => {
  // npm.cmd cannot be spawned with shell:false on Windows. npm exposes its
  // real CLI path to lifecycle scripts, so invoke it through this Node.
  const npmCli = process.env.npm_execpath ||
    (process.platform === "win32"
      ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
      : "npm");
  const command = npmCli === "npm" ? npmCli : process.execPath;
  const args = npmCli === "npm" ? ["pack", "--dry-run", "--json"] : [npmCli, "pack", "--dry-run", "--json"];
  const output = execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const files = JSON.parse(output)[0].files.map((entry) => entry.path);
  assert.equal(files.some((file) => /(?:^|\/)(__pycache__|\.pytest_cache)(?:\/|$)|\.py[cod]$/.test(file)), false,
    "Python caches must be excluded from npm package");
});

test("README documents explicit plugin loading and portable engine launch", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /claude --plugin-dir/);
  assert.match(readme, /cd skills\/insane-search/);
  assert.match(readme, /python -m engine/);
  assert.match(readme, /bare clone[\s\S]*not automatically loaded/i);
  assert.match(readme, /\/lazyclaude:ulw-loop/);
});

test("Python CI installs the locked offline-test dependencies before running them", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const requirements = fs.readFileSync(path.join(root, "requirements-test.txt"), "utf8");
  for (const dependency of [
    "PyYAML==6.0.3",
    "beautifulsoup4==4.15.0",
    "soupsieve==2.8.4",
    "typing_extensions==4.15.0",
  ]) {
    assert.match(requirements, new RegExp(`^${dependency}$`, "m"));
  }
  const install = "python -m pip install --disable-pip-version-check -r requirements-test.txt";
  assert.ok(workflow.includes(install), "Python CI must install requirements-test.txt");
  assert.ok(workflow.indexOf(install) < workflow.indexOf("npm run test:python"),
    "Python CI must install test requirements before running the offline suite");
});

test("README distinguishes networked test setup from offline test execution", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /python -m pip install -r requirements-test\.txt/);
  assert.match(readme, /requires network access once/i);
  assert.match(readme, /offline suite itself does not\s+make network requests/i);
});
