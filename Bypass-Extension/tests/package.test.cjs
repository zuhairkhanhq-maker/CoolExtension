"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const repository = path.resolve(root, "..");

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

test("Manifest and popup assets resolve without retired payment files", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const html = fs.readFileSync(path.join(root, "ui/popup.html"), "utf8");
  for (const script of [
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    manifest.background.service_worker,
  ]) {
    assert.ok(fs.existsSync(path.join(root, script)), script);
  }
  for (const [, asset] of html.matchAll(
    /(?:src|href)="([^"#]+\.(?:js|css|svg))"/g,
  ))
    assert.ok(fs.existsSync(path.resolve(root, "ui", asset)), asset);
  assert.doesNotMatch(html, /autopilot|billing|paywall|trial|data-plan|\$\d/i);
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /autopilot|pro-worker|pro-engine/,
  );
  assert.doesNotMatch(
    manifest.permissions.join(" "),
    /identity|cookies|webRequest/,
  );
});

test("Distribution contains only local runtime files and preserves binary icons", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "bypass-free-build-"),
  );
  const output = path.join(temporary, "extension");
  const built = spawnSync(
    process.execPath,
    [path.join(repository, "scripts/build.cjs"), "--output", output],
    { encoding: "utf8" },
  );
  assert.equal(built.status, 0, built.stderr);
  const shipped = files(output);
  assert.ok(shipped.length > 12);
  for (const file of shipped) {
    assert.doesNotMatch(
      path.relative(output, file),
      /(?:^|\/)(?:tests|node_modules|billing)(?:\/|$)|\.env|autopilot|billing|pro-(?:model|worker|engine|ui)/i,
    );
    if (!/\.(?:js|html)$/.test(file)) continue;
    const code = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      code,
      /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|sendBeacon\s*\(|Paddle\.Initialize/,
    );
    if (file.endsWith(".js")) {
      const checked = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
      });
      assert.equal(checked.status, 0, checked.stderr);
    }
  }
  for (const size of [16, 48, 128])
    assert.deepEqual(
      fs.readFileSync(path.join(output, `assets/icon-${size}.png`)),
      fs.readFileSync(path.join(root, `assets/icon-${size}.png`)),
    );
  const again = spawnSync(
    process.execPath,
    [path.join(repository, "scripts/build.cjs"), "--output", output],
    { encoding: "utf8" },
  );
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists/);
});
