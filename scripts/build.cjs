"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const source = path.resolve(__dirname, "../Bypass-Extension");
const outputFlag = process.argv.indexOf("--output");
const output = path.resolve(
  outputFlag < 0
    ? path.join(__dirname, "../build/Bypass-Extension")
    : process.argv[outputFlag + 1] || "",
);

if (fs.existsSync(output))
  throw Error("Output already exists. Choose a new output directory.");
fs.mkdirSync(output, { recursive: true });
for (const entry of [
  "manifest.json",
  "assets",
  "background",
  "content-scripts",
  "core",
  "ui",
]) {
  fs.cpSync(path.join(source, entry), path.join(output, entry), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}

if (process.argv.includes("--zip")) {
  const { version } = JSON.parse(
    fs.readFileSync(path.join(output, "manifest.json"), "utf8"),
  );
  const archive = path.join(
    path.dirname(output),
    `Bypass-Free-v${version}.zip`,
  );
  if (fs.existsSync(archive))
    throw Error("Archive already exists. Choose a new output directory.");
  const result = spawnSync("zip", ["-qr", archive, "."], {
    cwd: output,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    throw Error(
      "Could not create ZIP. The unpacked extension is available in the output directory.",
    );
  console.log(archive);
} else {
  console.log(output);
}
