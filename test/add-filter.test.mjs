import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadDraft } from "./helpers/load-fixture.mjs";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";

describe("capcut add-filter", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  it("creates a filter track + video_effects material with type=filter", () => {
    const r = spawnCli(["add-filter", fix.path, "vintage", "0s", "5s"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.name, "Vintage");

    const draft = loadDraft(fix.path);
    const track = draft.tracks.find((t) => t.id === r.json.trackId);
    assert.ok(track, "filter track exists");
    assert.equal(track.type, "filter");
    const mat = draft.materials.video_effects.find((m) => m.id === r.json.materialId);
    assert.ok(mat, "filter material exists");
    assert.equal(mat.type, "filter");
    assert.equal(mat.effect_id, "7028463716732079117");
  });

  it("rejects unknown slugs with a helpful hint", () => {
    const r = spawnCli(["add-filter", fix.path, "definitely-not-a-filter", "0s", "5s"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Unknown filter slug|enums --filters/i);
  });
});

describe("capcut enums --filters", () => {
  it("returns the capcut starter catalogue", () => {
    const r = spawnCli(["enums", "--filters"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(Array.isArray(r.json));
    const slugs = r.json.map((e) => e.slug);
    for (const expected of [
      "vintage",
      "warm",
      "cool",
      "bw",
      "sepia",
      "vivid",
      "contrast",
      "faded",
      "dramatic",
      "soft",
    ]) {
      assert.ok(slugs.includes(expected), `missing ${expected}`);
    }
  });

  it("returns the JianYing catalogue with --jianying", () => {
    const r = spawnCli(["enums", "--filters", "--jianying"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(Array.isArray(r.json));
    assert.ok(r.json.length > 100, "JY filters > 100 entries");
  });
});
