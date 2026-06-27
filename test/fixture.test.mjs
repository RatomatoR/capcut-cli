import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnCli } from "./helpers/spawn-cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANONICAL = join(__dirname, "draft_content.json");

// Build a project dir from the canonical fixture, then inject PII into a string
// field so the redactor has something to scrub. Returns { projDir, cleanup }.
function projectWithPii() {
  const dir = mkdtempSync(join(tmpdir(), "capcut-fixture-"));
  const projDir = join(dir, "proj");
  mkdirSync(projDir);
  const dst = join(projDir, "draft_content.json");
  copyFileSync(CANONICAL, dst);
  const draft = JSON.parse(readFileSync(dst, "utf-8"));
  draft.name = "/home/secretuser/Movies/clip.mp4 — contact secretuser@gmail.com";
  writeFileSync(dst, JSON.stringify(draft), "utf-8");
  // a sibling media file that must NOT be bundled
  mkdirSync(join(projDir, "assets", "video"), { recursive: true });
  writeFileSync(join(projDir, "assets", "video", "clip.mp4"), "binary-media");
  return { projDir, outDir: join(dir, "out"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("capcut fixture", () => {
  it("writes a redacted, media-free bundle", (t) => {
    const { projDir, outDir, cleanup } = projectWithPii();
    t.after(cleanup);

    const r = spawnCli(["fixture", projDir, "--out", outDir]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.ok(r.json.files.length >= 1, "should bundle at least one timeline file");
    assert.equal(r.json.media_excluded, true);

    const bundled = readFileSync(join(outDir, "draft_content.json"), "utf-8");
    assert.ok(!bundled.includes("secretuser"), "username must be redacted from path and email");
    assert.ok(bundled.includes("/home/USER/"), "home path should be normalized");
    assert.ok(bundled.includes("redacted@example.com"), "email should be redacted");
  });

  it("counts redactions and never copies assets/", (t) => {
    const { projDir, outDir, cleanup } = projectWithPii();
    t.after(cleanup);

    const r = spawnCli(["fixture", projDir, "--out", outDir]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok((r.json.redaction_kinds.linux_user ?? 0) >= 1, "should record a linux_user redaction");
    assert.ok((r.json.redaction_kinds.email ?? 0) >= 1, "should record an email redaction");
    assert.ok(existsSync(join(outDir, "SANITIZE_REPORT.json")), "should write the sanitize report");
    assert.ok(existsSync(join(outDir, "README.md")), "should write a reporter README");
    assert.ok(!existsSync(join(outDir, "assets")), "must not copy media assets");
  });

  it("requires --out", (t) => {
    const { projDir, cleanup } = projectWithPii();
    t.after(cleanup);
    const r = spawnCli(["fixture", projDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--out/);
  });
});
