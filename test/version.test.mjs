import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";

describe("capcut version", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  it("detects CapCut + version + os from platform block", () => {
    const r = spawnCli(["version", fix.path]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.json, "stdout should be valid JSON");
    assert.equal(r.json.app, "CapCut");
    assert.equal(r.json.app_source, "cc");
    assert.equal(typeof r.json.app_version, "string");
    assert.equal(typeof r.json.os, "string");
  });

  it("reports schema flags (mask_field, text-ranges, audio_fades)", () => {
    const r = spawnCli(["version", fix.path]);
    assert.equal(r.status, 0);
    assert.ok(r.json.schema);
    assert.ok(["mask", "common_masks", "both", "none"].includes(r.json.schema.mask_field));
    assert.equal(typeof r.json.schema.has_text_ranges, "boolean");
    assert.equal(typeof r.json.schema.has_audio_fades, "boolean");
  });

  it("emits a support assessment with status and notes array", () => {
    const r = spawnCli(["version", fix.path]);
    assert.equal(r.status, 0);
    assert.ok(["supported", "untested", "known-broken"].includes(r.json.support.status));
    assert.ok(Array.isArray(r.json.support.notes));
    assert.ok(r.json.support.notes.length > 0);
  });

  it("renders a human-readable layout with -H", () => {
    const r = spawnCli(["version", fix.path, "-H"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /App:/);
    assert.match(r.stdout, /Version:/);
    assert.match(r.stdout, /Support:/);
    assert.match(r.stdout, /Mask field:/);
  });
});
