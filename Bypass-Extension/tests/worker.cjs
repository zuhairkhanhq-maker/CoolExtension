"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const source = fs.readFileSync(
  path.join(__dirname, "../background/service-worker.js"),
  "utf8",
);
const data = {};
const results = [];
let listener,
  installed,
  writes = 0,
  rejectWrite = false;

function boot() {
  const chrome = {
    runtime: {
      id: "test",
      getURL: (name) => `chrome-extension://test/${name}`,
      onMessage: {
        addListener: (fn) => {
          listener = fn;
        },
      },
      onInstalled: {
        addListener: (fn) => {
          installed = fn;
        },
      },
    },
    storage: {
      local: {
        get: async (keys) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => Object.hasOwn(data, key))
              .map((key) => [key, structuredClone(data[key])]),
          ),
        set: async (values) => {
          if (rejectWrite) {
            rejectWrite = false;
            throw Error("Storage unavailable");
          }
          writes++;
          Object.assign(data, structuredClone(values));
        },
      },
    },
  };
  vm.runInNewContext(source, { chrome, setTimeout, clearTimeout, console });
}

boot();
const ui = { id: "test", url: "chrome-extension://test/ui/popup.html" };
const content = {
  id: "test",
  url: "https://www.youtube.com/watch?v=fixture",
  tab: { id: 1 },
};
function send(message, sender = ui) {
  return new Promise((resolve) => {
    if (listener(message, sender, resolve) !== true) resolve(undefined);
  });
}
const setting = (key, value) =>
  send({ type: "setting", host: "www.youtube.com", key, value });
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log("PASS", name);
  } catch (error) {
    results.push({ name, pass: false, error: error.stack });
    console.error("FAIL", name, error.message);
  }
}

(async () => {
  await test("Only extension UI may change site controls", async () => {
    const message = {
      type: "setting",
      host: "www.youtube.com",
      key: "video",
      value: false,
    };
    assert.equal(await send(message, content), undefined);
    assert.equal(await send(message, { ...ui, id: "other" }), undefined);
    assert.equal(await send({ ...message, value: "true" }), undefined);
    assert.equal(
      await send({ ...message, host: "https://evil.test" }),
      undefined,
    );
  });
  await test("Saved controls keep defaults and concurrent choices", async () => {
    const responses = await Promise.all([
      setting("cookies", false),
      setting("video", false),
    ]);
    assert.ok(responses.every((result) => result.ok));
    assert.equal(data["site:www.youtube.com"].cookies, false);
    assert.equal(data["site:www.youtube.com"].video, false);
    assert.equal(data["site:www.youtube.com"].paused, false);
    assert.equal(data["site:www.youtube.com"].skipIntro, false);
  });
  await test("Site pause preserves feature choices", async () => {
    await setting("paused", true);
    await setting("paused", false);
    assert.equal(data["site:www.youtube.com"].video, false);
    assert.equal(data["site:www.youtube.com"].cookies, false);
  });
  await test("Counters batch concurrent events and deduplicate retries", async () => {
    const before = writes;
    const events = Array.from({ length: 100 }, () => ({
      type: "metric",
      key: "ads_skipped",
      id: randomUUID(),
    }));
    assert.ok(
      (await Promise.all(events.map((event) => send(event, content)))).every(
        (result) => result.ok,
      ),
    );
    await send(events[0], content);
    assert.equal(data.ads_skipped, 100);
    assert.equal(writes - before, 1);
  });
  await test("Failed writes report failure and a retry counts exactly once", async () => {
    const event = { type: "metric", key: "ads_skipped", id: randomUUID() };
    rejectWrite = true;
    assert.equal((await send(event, content)).ok, false);
    assert.equal(data.ads_skipped, 100);
    assert.equal((await send(event, content)).ok, true);
    assert.equal(data.ads_skipped, 101);
  });
  await test("Invalid metric keys and event IDs cannot alter counters", async () => {
    assert.equal(
      await send(
        { type: "metric", key: "ads_skipped", id: "invalid" },
        content,
      ),
      undefined,
    );
    assert.equal(
      await send(
        { type: "metric", key: "unrelated", id: randomUUID() },
        content,
      ),
      undefined,
    );
    assert.equal(data.ads_skipped, 101);
  });
  await test("Worker restart retains settings and counters without account data", async () => {
    boot();
    await setting("video", true);
    assert.equal(data.ads_skipped, 101);
    assert.equal(data["site:www.youtube.com"].cookies, false);
    assert.equal(data["site:www.youtube.com"].video, true);
    assert.equal(await send({ type: "autopilot-get" }), undefined);
    assert.equal(await send({ type: "billing-status" }), undefined);
  });
  fs.writeFileSync(
    path.join(__dirname, "worker-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `${results.filter((result) => result.pass).length}/${results.length} passed`,
  );
  if (results.some((result) => !result.pass)) process.exitCode = 1;
})();
