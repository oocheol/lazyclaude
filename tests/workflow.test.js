"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("ulw-loop specifies safe identity, bounded state, and historical reset", () => {
  const text = read("commands/ulw-loop.md");
  assert.match(text, /JSON\.stringify\(\[task, completionPromise\]\)/);
  assert.match(text, /first 16[\s\S]*hex characters of SHA-256/);
  assert.match(text, /active.*nextIteration.*1.*100/s);
  assert.match(text, /complete.*finalIteration.*VERIFIED/s);
  assert.match(text, /capped.*finalIteration: 100/s);
  assert.match(text, /historical outcomes only/);
  assert.match(text, /fresh executor[\s\S]*fresh Oracle verdict/);
  assert.match(text, /ULW RUN ALREADY ACTIVE/);
  assert.match(text, /NOT_VERIFIED: <non-empty reason>/);
  assert.match(text, /exact, trimmed line/);
  assert.match(text, /never deletes files, resets Git, or discards user changes/);
});

test("start-work constrains plans and records terminal status only with evidence", () => {
  const text = read("commands/start-work.md");
  assert.match(text, /only inside `plans\/`/);
  assert.match(text, /real path.*remain inside/);
  assert.match(text, /Status: complete.*PLAN ALREADY COMPLETE/s);
  assert.match(text, /concrete passing output/);
  assert.match(text, /leave it `in-progress`/);
  assert.match(text, /ORCHESTRATION COMPLETE/);
});

test("init-deep documents top-N scoring and authored-file preservation", () => {
  const text = read("skills/init-deep/SKILL.md");
  assert.match(text, /top 8/);
  assert.match(text, /minimum 3 source files/);
  assert.match(text, /file_count × \(1 \+ avg_nesting_depth\) × language_diversity_factor/);
  assert.match(text, /preserve authored instructions/);
  assert.match(text, /read-first preservation rule/);
});
