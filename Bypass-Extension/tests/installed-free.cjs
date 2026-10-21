"use strict";

const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bypass-core-"));
const results = [];
const errors = [];
let context;

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
async function launch() {
  const browser = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      "--no-sandbox",
    ],
  });
  browser.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  const worker =
    browser.serviceWorkers()[0] ||
    (await browser.waitForEvent("serviceworker"));
  return { browser, worker };
}
async function popup(worker, id) {
  const ready = context.waitForEvent("page");
  await worker.evaluate(
    (url) => chrome.tabs.create({ url, active: false }),
    `chrome-extension://${id}/ui/popup.html`,
  );
  const page = await ready;
  await page.waitForFunction(
    () => document.getElementById("state")?.textContent === "On",
  );
  return page;
}

(async () => {
  let started = await launch();
  context = started.browser;
  let worker = started.worker;
  const id = new URL(worker.url()).host;
  const html = `<!doctype html><html><head><title>YouTube fixture</title><style>body{min-height:1200px}video{width:320px;height:180px}#onetrust-banner-sdk{padding:20px}button{padding:10px}</style></head><body><main><h1>Video page</h1><div class="html5-video-player ad-showing"><video></video><button class="ytp-skip-ad-button" hidden disabled onclick="window.skips=(window.skips||0)+1;this.parentElement.classList.remove('ad-showing')">Skip Ad</button></div><form><input id="email"></form></main><div id="onetrust-banner-sdk"><p>We use cookies</p><button id="onetrust-reject-all-handler" onclick="window.rejects=(window.rejects||0)+1">Reject all</button></div><script>window.prepare=video=>{Object.defineProperties(video,{paused:{get:()=>false},readyState:{get:()=>4}});video.playbackRate=1.5;};prepare(document.querySelector('video'));</script></body></html>`;
  await context.route("https://www.youtube.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/watch?v=fixture");
  let ui;
  await test("Installed Free build cleans banners and protects ordinary forms", async () => {
    await page.waitForFunction(() => window.rejects === 1);
    assert.equal(await page.locator("#onetrust-banner-sdk").isVisible(), false);
    await page.locator("#email").fill("qa@example.test");
    assert.equal(await page.locator("#email").inputValue(), "qa@example.test");
  });
  await test("Installed Free popup has no Autopilot, paid controls or missing logo", async () => {
    ui = await popup(worker, id);
    await ui.setViewportSize({ width: 376, height: 650 });
    assert.equal(await ui.locator("nav,dialog,#autopilot-panel").count(), 0);
    assert.doesNotMatch(
      await ui.locator("body").innerText(),
      /autopilot|\btrial\b|\bupgrade\b|\$\d/i,
    );
    assert.equal(await ui.locator("#video").isChecked(), true);
    assert.equal(
      await ui
        .locator(".mark img")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
      true,
    );
    await ui.screenshot({
      path: path.join(__dirname, "installed-free-preview.png"),
      fullPage: true,
    });
  });
  await test("Installed assistance handles five silent ad speed resets without toggles", async () => {
    await page.waitForFunction(
      () => document.querySelector("video").playbackRate === 16,
    );
    for (let index = 0; index < 5; index++) {
      await page.locator("video").evaluate((video) => {
        video.playbackRate = 1;
        video.muted = false;
      });
      await page.waitForFunction(
        () =>
          document.querySelector("video").playbackRate === 16 &&
          document.querySelector("video").muted,
      );
    }
  });
  await test("Installed assistance clicks Skip Ad automatically and restores the main video", async () => {
    await page.locator(".ytp-skip-ad-button").evaluate((button) => {
      button.hidden = false;
      button.disabled = false;
    });
    await page.waitForFunction(() => window.skips === 1);
    await page.waitForFunction(
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
  });
  await test("Popup switch disables and re-enables the actual installed video engine", async () => {
    await page.locator(".ytp-skip-ad-button").evaluate((button) => {
      button.hidden = true;
      button.disabled = true;
    });
    await page
      .locator(".html5-video-player")
      .evaluate((player) => player.classList.add("ad-showing"));
    await page.waitForFunction(
      () => document.querySelector("video").playbackRate === 16,
    );
    await ui.locator("#video").uncheck();
    await page.waitForFunction(
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    await ui.locator("#video").check();
    await page.waitForFunction(
      () => document.querySelector("video").playbackRate === 16,
    );
  });
  await test("Closing the popup does not stop consecutive ad assistance", async () => {
    await ui.close();
    await page.locator("video").evaluate((video) => {
      video.playbackRate = 1;
      video.muted = false;
    });
    await page.waitForFunction(
      () =>
        document.querySelector("video").playbackRate === 16 &&
        document.querySelector("video").muted,
    );
    await page.bringToFront();
    ui = await popup(worker, id);
  });
  await test("Site protection off restores both playback and banner; on resumes cleanup", async () => {
    await ui.locator("#enabled").uncheck();
    await page.waitForFunction(
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    assert.equal(await page.locator("#onetrust-banner-sdk").isVisible(), true);
    await ui.locator("#enabled").check();
    await page.waitForFunction(
      () => document.querySelector("video").playbackRate === 16,
    );
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector("#onetrust-banner-sdk"))
          .display === "none",
    );
  });
  await test("Installed player replacement restores old video and assists the new one", async () => {
    await page.evaluate(() => {
      const old = document.querySelector("video");
      const next = document.createElement("video");
      prepare(next);
      window.oldVideo = old;
      old.replaceWith(next);
    });
    await page.waitForFunction(
      () =>
        oldVideo.playbackRate === 1.5 &&
        document.querySelector("video").playbackRate === 16,
    );
    await page
      .locator(".html5-video-player")
      .evaluate((player) => player.classList.remove("ad-showing"));
    await page.waitForFunction(
      () => document.querySelector("video").playbackRate === 1.5,
    );
  });
  await test("Installed streaming intro control remains opt-in and works without Autopilot", async () => {
    await context.route("https://www.netflix.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><title>Streaming fixture</title><style>video{width:320px;height:180px}button{padding:10px}</style></head><body><div class="watch-video"><video></video><button data-uia="player-skip-intro" onclick="window.intros=(window.intros||0)+1;this.hidden=true">Skip Intro</button></div><script>const video=document.querySelector('video');Object.defineProperties(video,{paused:{get:()=>false},readyState:{get:()=>4},duration:{get:()=>1200},currentTime:{get:()=>60}});</script></body></html>`,
      }),
    );
    const stream = await context.newPage();
    await stream.goto("https://www.netflix.com/watch/123");
    await stream.waitForTimeout(400);
    assert.equal(await stream.evaluate(() => window.intros || 0), 0);
    await worker.evaluate(() =>
      chrome.storage.local.set({ "site:www.netflix.com": { skipIntro: true } }),
    );
    await stream.waitForFunction(() => window.intros === 1);
    await stream.close();
  });
  await test("Installed Free settings and activity survive a browser restart", async () => {
    await context.close();
    started = await launch();
    context = started.browser;
    worker = started.worker;
    const saved = await worker.evaluate(() =>
      chrome.storage.local.get([
        "site:www.youtube.com",
        "site:www.netflix.com",
        "ads_skipped",
        "banners_vaporized",
      ]),
    );
    assert.equal(saved["site:www.youtube.com"].video, true);
    assert.equal(saved["site:www.youtube.com"].paused, false);
    assert.equal(saved["site:www.netflix.com"].skipIntro, true);
    assert.ok(saved.ads_skipped >= 2);
    assert.ok(saved.banners_vaporized >= 1);
  });
  await test("Installed Free flow has no uncaught page errors", () =>
    assert.deepEqual(errors, []));
  await context.close();
  fs.writeFileSync(
    path.join(__dirname, "installed-free-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `${results.filter((result) => result.pass).length}/${results.length} passed`,
  );
  if (results.some((result) => !result.pass)) process.exitCode = 1;
})().catch(async (error) => {
  console.error(error);
  await context?.close();
  process.exitCode = 1;
});
