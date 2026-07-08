import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { editorProcesses } from "../dist/store.js";
import { spawnCli } from "./helpers/spawn-cli.mjs";

// The canonical timeline: what the CLI wrote to draft_content.json (issue #35:
// a text track added after the app last mirrored the draft).
function canonicalDraft() {
  return {
    id: "guid-canonical",
    name: "edited-by-cli",
    duration: 1_000_000,
    fps: 30,
    canvas_config: { width: 1080, height: 1920, ratio: "9:16" },
    platform: { app_source: "cc", app_version: "8.7.0", os: "windows" },
    tracks: [{ id: "T1", type: "text", name: "text", attribute: 0, segments: [] }],
    materials: {
      videos: [],
      audios: [],
      texts: [],
      speeds: [],
      material_animations: [],
      audio_fades: [],
      transitions: [],
    },
  };
}

// The stale mirror: the pre-edit timeline (no text track) under a different
// draft GUID — the CapCut pre-open mirror case.
function staleDraft() {
  return { ...canonicalDraft(), id: "guid-mirror-stale", name: "before-cli-edit", tracks: [] };
}

// Drift fixture: draft_content.json is canonical/newer; template-2.tmp (string-
// JSON envelope) and draft_info.json (root envelope) still hold the old timeline.
function driftedFixture() {
  const dir = mkdtempSync(join(tmpdir(), "capcut-sync-"));
  writeFileSync(join(dir, "draft_content.json"), JSON.stringify(canonicalDraft(), null, 2));
  writeFileSync(join(dir, "template-2.tmp"), JSON.stringify({ draft_content: JSON.stringify(staleDraft()) }, null, 2));
  writeFileSync(join(dir, "draft_info.json"), JSON.stringify(staleDraft(), null, 2));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("sync-timelines", () => {
  it("plan (default) reports the drifted mirrors without writing", () => {
    const f = driftedFixture();
    after(f.cleanup);
    const tmpBefore = readFileSync(join(f.dir, "template-2.tmp"), "utf-8");
    const infoBefore = readFileSync(join(f.dir, "draft_info.json"), "utf-8");

    const r = spawnCli(["sync-timelines", f.dir]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.applied, false);
    assert.equal(r.json.in_sync, false);
    assert.equal(r.json.canonical, "draft_content.json");
    assert.deepEqual(r.json.drifted.sort(), ["draft_info.json", "template-2.tmp"]);
    const info = r.json.targets.find((t) => t.file === "draft_info.json");
    assert.equal(info.state, "drifted");
    assert.equal(info.guid_drifted, true, "the pre-open mirror's stale GUID must be flagged");
    assert.match(r.stderr, /--apply/);
    assert.equal(readFileSync(join(f.dir, "template-2.tmp"), "utf-8"), tmpBefore, "plan must not write");
    assert.equal(readFileSync(join(f.dir, "draft_info.json"), "utf-8"), infoBefore, "plan must not write");
  });

  it("--apply reconciles the drifted mirrors from draft_content.json, preserving envelopes", () => {
    const f = driftedFixture();
    after(f.cleanup);

    const r = spawnCli(["sync-timelines", f.dir, "--apply"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.applied, true);
    assert.equal(r.json.in_sync, true);
    assert.deepEqual(r.json.reconciled.sort(), ["draft_info.json", "template-2.tmp"]);

    // template-2.tmp keeps its string-JSON envelope; the timeline inside is the canonical one.
    const envelope = JSON.parse(readFileSync(join(f.dir, "template-2.tmp"), "utf-8"));
    const mirrored = JSON.parse(envelope.draft_content);
    assert.equal(mirrored.name, "edited-by-cli");
    assert.equal(mirrored.tracks.length, 1);

    // draft_info.json: timeline AND GUID reconciled (CapCut pre-open mirror case).
    const info = JSON.parse(readFileSync(join(f.dir, "draft_info.json"), "utf-8"));
    assert.equal(info.id, "guid-canonical", "stale mirror GUID must be reconciled to the canonical draft id");
    assert.equal(info.name, "edited-by-cli");

    // draft_content.json itself still carries the canonical edit.
    assert.equal(JSON.parse(readFileSync(join(f.dir, "draft_content.json"), "utf-8")).name, "edited-by-cli");

    // Backups of the pre-repair mirrors exist.
    assert.ok(readFileSync(join(f.dir, "template-2.tmp.bak"), "utf-8").includes("before-cli-edit"));
    assert.ok(readFileSync(join(f.dir, "draft_info.json.bak"), "utf-8").includes("before-cli-edit"));
  });

  it("no-ops with exit 0 and a clear message when all targets agree", () => {
    const f = driftedFixture();
    after(f.cleanup);
    assert.equal(spawnCli(["sync-timelines", f.dir, "--apply"]).status, 0);

    const r = spawnCli(["sync-timelines", f.dir, "--apply"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.applied, false);
    assert.equal(r.json.in_sync, true);
    assert.match(r.json.message, /already agree/);
    assert.match(r.stderr, /already agree/);
  });

  it("--apply --dry-run previews without writing", () => {
    const f = driftedFixture();
    after(f.cleanup);
    const infoBefore = readFileSync(join(f.dir, "draft_info.json"), "utf-8");

    const r = spawnCli(["sync-timelines", f.dir, "--apply", "--dry-run"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.dryRun, true);
    assert.equal(r.json.applied, false);
    assert.equal(readFileSync(join(f.dir, "draft_info.json"), "utf-8"), infoBefore, "dry-run must not write");
  });

  it("reports an unreadable template-2.tmp as unreconcilable instead of pretending success", () => {
    const f = driftedFixture();
    after(f.cleanup);
    // Modern storage where the mirror is binary/encrypted — the CLI cannot re-embed it.
    writeFileSync(join(f.dir, "template-2.tmp"), "\x00\x01not-json\x02");

    const plan = spawnCli(["sync-timelines", f.dir]);
    assert.equal(plan.status, 0, `stderr: ${plan.stderr}`);
    assert.equal(plan.json.unreconcilable.length, 1);
    assert.equal(plan.json.unreconcilable[0].file, "template-2.tmp");
    assert.match(plan.json.unreconcilable[0].workaround, /fixture.*#35/s);
    assert.match(plan.stderr, /WARNING template-2\.tmp/);

    const r = spawnCli(["sync-timelines", f.dir, "--apply"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.json.reconciled, ["draft_info.json"], "only the readable mirror is repaired");
    assert.equal(r.json.unreconcilable[0].file, "template-2.tmp");
    assert.match(r.stderr, /WARNING template-2\.tmp/);
    assert.equal(
      readFileSync(join(f.dir, "template-2.tmp"), "utf-8"),
      "\x00\x01not-json\x02",
      "binary mirror left untouched",
    );

    // The remaining unreconcilable mirror keeps ok=false honesty on later runs.
    const again = spawnCli(["sync-timelines", f.dir]);
    assert.equal(again.status, 0);
    assert.equal(again.json.in_sync, true);
    assert.equal(again.json.ok, false, "an unreconcilable mirror must not be reported as fully ok");
    assert.match(again.json.message, /cannot be reconciled/);
  });

  it("errors when draft_content.json is missing (no canonical source)", () => {
    const dir = mkdtempSync(join(tmpdir(), "capcut-sync-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "draft_info.json"), JSON.stringify(staleDraft(), null, 2));

    const r = spawnCli(["sync-timelines", dir]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /draft_content\.json/);
  });

  it("refuses --apply while the editor is running unless --force-write", {
    skip: process.platform === "win32",
  }, async () => {
    const f = driftedFixture();
    // Fake a running editor: a copy of `sleep` named CapCut shows up in `ps -axo comm=`.
    const fakeDir = mkdtempSync(join(tmpdir(), "fake-editor-"));
    const fakeBin = join(fakeDir, "CapCut");
    copyFileSync("/bin/sleep", fakeBin);
    chmodSync(fakeBin, 0o755);
    const child = spawn(fakeBin, ["60"], { stdio: "ignore" });
    after(() => {
      child.kill("SIGKILL");
      f.cleanup();
      rmSync(fakeDir, { recursive: true, force: true });
    });

    // Wait until the process table shows the fake editor.
    const deadline = Date.now() + 5_000;
    while (editorProcesses().length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(editorProcesses().length > 0, "fake CapCut process should be detectable");

    const refused = spawnCli(["sync-timelines", f.dir, "--apply"]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /is running/);
    assert.ok(existsSync(join(f.dir, "draft_info.json")));
    assert.equal(
      JSON.parse(readFileSync(join(f.dir, "draft_info.json"), "utf-8")).id,
      "guid-mirror-stale",
      "refusal must not write",
    );

    const forced = spawnCli(["sync-timelines", f.dir, "--apply", "--force-write"]);
    assert.equal(forced.status, 0, `stderr: ${forced.stderr}`);
    assert.equal(JSON.parse(readFileSync(join(f.dir, "draft_info.json"), "utf-8")).id, "guid-canonical");
  });
});
