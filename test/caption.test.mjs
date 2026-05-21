import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { spawnCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";

describe("capcut caption — input validation", () => {
  const fix = tmpDraft();
  after(() => fix.cleanup());

  // The full pipeline needs whisper installed and a real audio file; not
  // something we can mock in CI without a binary. We cover the validation
  // surface that runs before whisper is invoked.

  it("errors when neither --audio nor --from-segment is provided", () => {
    const r = spawnCli(["caption", fix.path]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Missing --audio/);
  });

  it("errors when --audio path doesn't exist", () => {
    const r = spawnCli(["caption", fix.path, "--audio", "/nonexistent/audio.wav"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Audio file not found/);
  });

  it("errors when --from-segment points to a non-audio track", () => {
    const r = spawnCli(["caption", fix.path, "--from-segment", "nonexistent-id"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Segment not found/);
  });
});
