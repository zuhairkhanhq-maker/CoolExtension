/* Development only. No test dependency is loaded by the extension. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const ROOT = path.resolve(__dirname, "..");
const scripts = [
  "core/streaming-sites.js",
  "core/runtime.js",
  "content-scripts/dom-purger.js",
  "content-scripts/distraction-cleaner.js",
  "content-scripts/video-interceptor.js",
  "content-scripts/streaming-skipper.js",
];
const results = [];
const state = {};
const pages = new Set();
let messageListener;
let browser;
const clone = (value) => JSON.parse(JSON.stringify(value));
const get = (keys) =>
  Object.fromEntries(
    (typeof keys === "string" ? [keys] : keys)
      .filter((k) => Object.hasOwn(state, k))
      .map((k) => [k, clone(state[k])]),
  );
let storageWrites = 0;
async function set(values) {
  storageWrites++;
  const changes = {};
  for (const [key, value] of Object.entries(values)) {
    changes[key] = { oldValue: state[key], newValue: clone(value) };
    state[key] = clone(value);
  }
  await Promise.all(
    [...pages]
      .filter((p) => !p.isClosed())
      .map((p) =>
        p
          .evaluate((changes) => globalThis.__storageChange?.(changes), changes)
          .catch(() => {}),
      ),
  );
}
const chrome = {
  runtime: {
    id: "bypass-test",
    getURL: (p) => `chrome-extension://bypass-test/${p}`,
    onMessage: { addListener: (fn) => (messageListener = fn) },
    onInstalled: { addListener: () => {} },
  },
  storage: { local: { get: async (keys) => get(keys), set } },
};
const workerContext = vm.createContext({
  chrome,
  console,
  URL,
  setTimeout,
  clearTimeout,
});
vm.runInContext(
  fs.readFileSync(path.join(ROOT, "background/service-worker.js"), "utf8"),
  workerContext,
);
async function settled() {
  vm.runInContext("flushMetrics()", workerContext);
  await vm.runInContext("writes", workerContext);
}
function dispatch(
  message,
  sender = { id: "bypass-test", tab: { id: 1 }, url: "https://fixture.test/" },
) {
  return new Promise((resolve, reject) => {
    const accepted = messageListener(message, sender, resolve);
    if (accepted !== true) resolve(null);
  });
}
async function test(name, fn) {
  if (process.env.TEST_FILTER && !name.includes(process.env.TEST_FILTER))
    return;
  const start = Date.now();
  try {
    await settled();
    const detail = await fn();
    await settled();
    results.push({
      name,
      status: "PASS",
      ms: Date.now() - start,
      ...(detail ? { detail } : {}),
    });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, status: "FAIL", error: e.stack });
    console.error("FAIL", name, e.message);
  }
}
async function fixture(html, host = "fixture.test", extra = "", options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 800 },
  });
  pages.add(page);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.exposeBinding("__bridge", async (source, request) => {
    if (request.kind === "get") {
      const snapshot = get(request.keys);
      if (options.getDelay)
        await new Promise((r) => setTimeout(r, options.getDelay));
      return snapshot;
    }
    if (request.kind === "send")
      return dispatch(request.message, {
        id: "bypass-test",
        tab: { id: 1 },
        url: source.page.url(),
      });
  });
  await page.addInitScript(() => {
    const listeners = [];
    globalThis.__storageChange = (changes) =>
      listeners.forEach((fn) => fn(changes, "local"));
    globalThis.chrome = {
      runtime: {
        id: "bypass-test",
        onMessage: {
          addListener: (fn) =>
            (globalThis.__pageStatus = () =>
              new Promise((resolve) =>
                fn({ type: "page-status" }, { id: "bypass-test" }, resolve),
              )),
        },
        lastError: null,
        sendMessage(message, callback) {
          const p = __bridge({ kind: "send", message });
          if (callback) p.then(callback);
          return p;
        },
      },
      storage: {
        local: {
          get(keys, callback) {
            const p = __bridge({ kind: "get", keys });
            if (callback) p.then(callback);
            return p;
          },
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    };
  });
  if (extra) await page.addInitScript(extra);
  for (const file of scripts)
    await page.addInitScript({ path: path.join(ROOT, file) });
  await page.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><style>body{min-height:1600px} .cookie-banner,#onetrust-banner-sdk,#CybotCookiebotDialog,#didomi-notice{padding:20px;background:#ddd}video{width:320px;height:180px}button{padding:10px}</style></head><body>${html}</body></html>`,
    }),
  );
  await page.goto(`${options.scheme || "https"}://${host}/fixture`);
  return page;
}
async function waitFor(page, fn, arg) {
  await page.waitForFunction(fn, arg, { timeout: 7000 });
}
async function setting(host, key, value) {
  const r = await dispatch(
    { type: "setting", host, key, value },
    { id: "bypass-test", url: "chrome-extension://bypass-test/ui/popup.html" },
  );
  assert.equal(r.ok, true);
}
const banner =
  '<div id="onetrust-banner-sdk"><p>We use cookies</p><button id="onetrust-reject-all-handler" onclick="window.rejects=(window.rejects||0)+1">Reject all</button></div>';
const videoSetup = `document.addEventListener('DOMContentLoaded',()=>{for(const v of document.querySelectorAll('video')){Object.defineProperties(v,{paused:{get:()=>false,configurable:true},readyState:{get:()=>4,configurable:true}});v.playbackRate=1.5;}});`;
(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const version = browser.version();
  await test("Known consent banner: suppress, dispatch reject, and count once", async () => {
    const base = state.banners_vaporized || 0,
      p = await fixture(banner);
    await waitFor(p, () => window.rejects === 1);
    assert.equal(
      await p
        .locator("#onetrust-banner-sdk")
        .evaluate((e) => getComputedStyle(e).display),
      "none",
    );
    await p.waitForTimeout(250);
    await settled();
    assert.equal(state.banners_vaporized, base + 1);
    assert.equal(p.errors.length, 0);
    await p.close();
  });
  await test("Hidden template is not counted or clicked", async () => {
    const base = state.banners_vaporized || 0,
      p = await fixture(
        banner.replace(
          'id="onetrust-banner-sdk"',
          'id="onetrust-banner-sdk" hidden',
        ),
      );
    await p.waitForTimeout(450);
    assert.equal(state.banners_vaporized, base);
    assert.equal(await p.evaluate(() => window.rejects || 0), 0);
    await p.close();
  });
  await test("Generic cookie banner requires clear rejection control", async () => {
    const p = await fixture(
      '<div class="cookie-banner">We use cookies <button onclick="window.rejected=true">Essential only</button></div><div id="unrelated" class="cookie-banner">Manage project <button>Decline invitation</button></div>',
    );
    await waitFor(p, () => window.rejected === true);
    assert.equal(
      await p
        .locator("#unrelated")
        .evaluate((e) => getComputedStyle(e).display),
      "block",
    );
    await p.close();
  });
  await test("OneTrust, Cookiebot, and Didomi adapters", async () => {
    const p = await fixture(
      '<div id="CybotCookiebotDialog">Cookies<button id="CybotCookiebotDialogBodyButtonDecline" onclick="window.c=true">Decline</button></div><div id="didomi-notice">Cookies<button id="didomi-notice-disagree-button" onclick="window.d=true">Disagree</button></div>',
    );
    await waitFor(p, () => window.c && window.d);
    await p.close();
  });
  await test("Scroll lock restored; pause restores prior overflow and banner", async () => {
    const p = await fixture(
      banner +
        '<script>document.body.classList.add("ot-overflow-hidden");document.body.style.overflow="hidden"</script>',
      "scroll.test",
    );
    await waitFor(p, () => document.body.style.overflowY === "auto");
    await setting("scroll.test", "paused", true);
    await waitFor(
      p,
      () =>
        document.body.style.overflow === "hidden" &&
        getComputedStyle(document.querySelector("#onetrust-banner-sdk"))
          .display !== "none",
    );
    await p.close();
  });
  await test("Legitimate visible modal preserves scroll lock", async () => {
    const p = await fixture(
      banner +
        '<div role="dialog" aria-modal="true" id="checkout">Checkout</div><script>document.body.style.overflow="hidden"</script>',
    );
    await waitFor(p, () => window.rejects === 1);
    assert.equal(
      await p.evaluate(() => document.body.style.overflow),
      "hidden",
    );
    assert.equal(
      await p.locator("#checkout").evaluate((e) => getComputedStyle(e).display),
      "block",
    );
    await p.close();
  });
  await test("Fixed-body scrolling pattern left untouched", async () => {
    const p = await fixture(
      banner +
        '<script>document.body.style.cssText="position:fixed;overflow:hidden;top:-100px"</script>',
    );
    await waitFor(p, () => window.rejects === 1);
    assert.equal(await p.evaluate(() => document.body.style.top), "-100px");
    assert.equal(
      await p.evaluate(() => document.body.style.overflow),
      "hidden",
    );
    await p.close();
  });
  await test("Nested open shadow roots: cookie discovery and reversal", async () => {
    const p = await fixture(
      '<div id="host"></div><script>const a=document.querySelector("#host").attachShadow({mode:"open"});a.innerHTML="<div id=inner></div>";const b=a.querySelector("#inner").attachShadow({mode:"open"});b.innerHTML=`<div class="cookie-banner">Cookies<button onclick="window.shadowReject=true">Reject all</button></div>`;</script>',
      "shadow.test",
    );
    await waitFor(p, () => window.shadowReject === true);
    assert.equal(
      await p
        .locator(".cookie-banner")
        .evaluate((e) => getComputedStyle(e).display),
      "none",
    );
    await setting("shadow.test", "cookies", false);
    assert.notEqual(
      await p
        .locator(".cookie-banner")
        .evaluate((e) => getComputedStyle(e).display),
      "none",
    );
    await p.close();
  });
  await test("Disabled site starts without suppression or telemetry", async () => {
    await setting("paused.test", "paused", true);
    const base = state.banners_vaporized || 0,
      p = await fixture(banner, "paused.test");
    await p.waitForTimeout(400);
    assert.equal(state.banners_vaporized, base);
    assert.equal(await p.evaluate(() => window.rejects || 0), 0);
    await setting("paused.test", "paused", false);
    await waitFor(p, () => window.rejects === 1);
    await p.close();
  });
  await test("Lifecycle suspend/resume: reversibility and no duplicate banner count", async () => {
    const base = state.banners_vaporized || 0,
      p = await fixture(banner);
    await waitFor(p, () => window.rejects === 1);
    await p.evaluate(() =>
      dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
    );
    assert.notEqual(
      await p
        .locator("#onetrust-banner-sdk")
        .evaluate((e) => getComputedStyle(e).display),
      "none",
    );
    await p.evaluate(() =>
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    );
    await waitFor(
      p,
      () =>
        getComputedStyle(document.querySelector("#onetrust-banner-sdk"))
          .display === "none",
    );
    await settled();
    assert.equal(state.banners_vaporized, base + 1);
    assert.equal(await p.evaluate(() => window.rejects), 1);
    await p.close();
  });
  await test("YouTube ad transition restores custom speed and unmuted state", async () => {
    const base = state.ads_skipped || 0,
      p = await fixture(
        '<div class="html5-video-player ad-showing"><video></video></div>',
        "www.youtube.com",
        videoSetup,
      );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    assert.equal(await p.locator("video").evaluate((v) => v.muted), true);
    await p
      .locator(".html5-video-player")
      .evaluate((e) => e.classList.remove("ad-showing"));
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    await p.waitForTimeout(100);
    assert.equal(state.ads_skipped, base + 1);
    await p.close();
  });
  await test("Already-muted user preference is preserved", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video muted></video></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p
      .locator(".html5-video-player")
      .evaluate((e) => e.classList.remove("ad-showing"));
    await waitFor(
      p,
      () => document.querySelector("video").playbackRate === 1.5,
    );
    assert.equal(await p.locator("video").evaluate((v) => v.muted), true);
    await p.close();
  });
  await test("User speed/mute changes during an ad are respected", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video><div class="ytp-settings-menu"><button id="user-rate" onclick="document.querySelector(\'video\').playbackRate=2">2x</button></div><button class="ytp-mute-button" onclick="document.querySelector(\'video\').muted=false">Unmute</button></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.locator("#user-rate").click();
    await p.locator(".ytp-mute-button").click();
    await p.waitForTimeout(200);
    assert.equal(await p.locator("video").evaluate((v) => v.playbackRate), 2);
    await p
      .locator(".html5-video-player")
      .evaluate((e) => e.classList.remove("ad-showing"));
    await p.waitForTimeout(100);
    assert.equal(await p.locator("video").evaluate((v) => v.playbackRate), 2);
    assert.equal(await p.locator("video").evaluate((v) => v.muted), false);
    await p.close();
  });
  await test("YouTube next-ad mute does not overwrite the original sound preference after a user click", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video><button class="ytp-mute-button" onclick="document.querySelector(\'video\').muted=false">Unmute</button></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.locator(".ytp-mute-button").click();
    await p.waitForTimeout(50);
    assert.equal(
      await p.locator("video").evaluate((video) => video.muted),
      false,
    );
    await p.locator("video").evaluate((video) => {
      video.playbackRate = 1;
      video.dispatchEvent(new Event("loadstart"));
    });
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 16 &&
        document.querySelector("video").muted,
    );
    await p
      .locator(".html5-video-player")
      .evaluate((player) => player.classList.remove("ad-showing"));
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    await p.close();
  });
  await test("YouTube global keyboard speed and mute choices are respected during ads", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video></div>',
      "www.youtube.com",
      videoSetup +
        `document.addEventListener('keydown',event=>{if(event.key==='>')document.querySelector('video').playbackRate=2;if(event.key==='m')document.querySelector('video').muted=false;});`,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.keyboard.press("Shift+Period");
    await p.keyboard.press("m");
    await p.waitForTimeout(400);
    assert.equal(
      await p.locator("video").evaluate((video) => video.playbackRate),
      2,
    );
    assert.equal(
      await p.locator("video").evaluate((video) => video.muted),
      false,
    );
    await p
      .locator(".html5-video-player")
      .evaluate((player) => player.classList.remove("ad-showing"));
    await p.waitForTimeout(150);
    assert.equal(
      await p.locator("video").evaluate((video) => video.playbackRate),
      2,
    );
    await p.close();
  });
  await test("Disabling video assistance restores playback immediately", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await setting("www.youtube.com", "video", false);
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    await p.close();
    await setting("www.youtube.com", "video", true);
  });
  await test("Native skip button receives one normal untrusted click", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video><button class="ytp-skip-ad-button" onclick="window.clicks=(window.clicks||0)+1;window.trusted=event.isTrusted;this.parentElement.classList.remove(\'ad-showing\')">Skip</button></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => window.clicks === 1);
    assert.equal(await p.evaluate(() => window.trusted), false);
    await p.waitForTimeout(150);
    assert.equal(await p.evaluate(() => window.clicks), 1);
    await p.close();
  });
  await test("Unknown video platform untouched", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video></div>',
      "unknown.test",
      videoSetup,
    );
    await p.waitForTimeout(450);
    assert.equal(await p.locator("video").evaluate((v) => v.playbackRate), 1.5);
    assert.equal(await p.locator("video").evaluate((v) => v.muted), false);
    await p.close();
  });
  await test("Nested shadow video and replacement video restore correctly", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing" id="player"></div><script>let root=document.querySelector("#player").attachShadow({mode:"open"});root.innerHTML="<div></div>";root=root.querySelector("div").attachShadow({mode:"open"});root.innerHTML="<video></video>";window.media=root.querySelector("video");Object.defineProperties(media,{paused:{get:()=>false},readyState:{get:()=>4}});media.playbackRate=1.25;</script>',
      "www.youtube.com",
    );
    await waitFor(p, () => window.media.playbackRate === 16);
    await p.evaluate(() => {
      window.old = media;
      const next = document.createElement("video");
      Object.defineProperties(next, {
        paused: { get: () => false },
        readyState: { get: () => 4 },
      });
      next.playbackRate = 1.75;
      media.replaceWith(next);
      window.media = next;
    });
    await waitFor(
      p,
      () =>
        window.media.playbackRate === 16 && window.old.playbackRate === 1.25,
    );
    await p
      .locator("#player")
      .evaluate((e) => e.classList.remove("ad-showing"));
    await waitFor(p, () => window.media.playbackRate === 1.75);
    await p.close();
  });
  await test("Concurrent counter writes and duplicate retry IDs", async () => {
    const base = state.ads_skipped || 0,
      before = storageWrites;
    const messages = Array.from({ length: 100 }, () => ({
      type: "metric",
      key: "ads_skipped",
      id: require("node:crypto").randomUUID(),
    }));
    await Promise.all(messages.map((m) => dispatch(m)));
    await dispatch(messages[0]);
    assert.equal(state.ads_skipped, base + 100);
    assert.ok(storageWrites - before <= 2, "burst should use a bounded batch");
  });
  await test("Invalid metric and page-origin setting requests rejected", async () => {
    assert.equal(
      await dispatch({ type: "metric", key: "bogus", id: "bad" }),
      null,
    );
    assert.equal(
      await dispatch({
        type: "setting",
        host: "fixture.test",
        key: "paused",
        value: true,
      }),
      null,
    );
  });
  await test("Busy page: 12,000 nodes, mutation burst, eventual banner handling", async () => {
    const p = await fixture('<main id="busy"></main>', "busy.test");
    await p.evaluate(() => {
      window.longTasks = [];
      new PerformanceObserver((l) =>
        longTasks.push(...l.getEntries().map((e) => e.duration)),
      ).observe({ type: "longtask", buffered: true });
    });
    await p.evaluate(() => {
      let fragment = document.createDocumentFragment();
      for (let i = 0; i < 12000; i++) {
        let e = document.createElement("div");
        e.textContent = "Row " + i;
        fragment.append(e);
      }
      document.querySelector("#busy").append(fragment);
      for (let i = 0; i < 600; i++)
        document.querySelector("#busy").children[i].className = "updated";
    });
    await p.evaluate(
      (html) => document.body.insertAdjacentHTML("beforeend", html),
      banner,
    );
    await waitFor(p, () => window.rejects === 1);
    assert.equal(p.errors.length, 0);
    const detail = await p.evaluate(() => ({
      longTasksObserved: longTasks.length,
      maxLongTaskMs: Math.max(0, ...longTasks),
    }));
    await p.close();
    return detail;
  });

  await test("Late reject control is found without duplicate banner telemetry", async () => {
    const base = state.banners_vaporized || 0,
      p = await fixture('<div id="onetrust-banner-sdk">Cookies</div>');
    await waitFor(
      p,
      () =>
        document.querySelector("#onetrust-banner-sdk").dataset.bypassHidden ===
        "1",
    );
    await p
      .locator("#onetrust-banner-sdk")
      .evaluate((e) =>
        e.insertAdjacentHTML(
          "beforeend",
          '<button id="onetrust-reject-all-handler" onclick="window.lateReject=true">Reject all</button>',
        ),
      );
    await waitFor(p, () => window.lateReject === true);
    await settled();
    assert.equal(state.banners_vaporized, base + 1);
    await p.close();
  });
  await test("Consecutive ad episodes restore between transitions", async () => {
    const base = state.ads_skipped || 0,
      p = await fixture(
        '<div class="html5-video-player ad-showing"><video></video></div>',
        "www.youtube.com",
        videoSetup,
      );
    for (let i = 0; i < 2; i++) {
      await waitFor(
        p,
        () => document.querySelector("video").playbackRate === 16,
      );
      await p
        .locator(".html5-video-player")
        .evaluate((e) => e.classList.remove("ad-showing"));
      await waitFor(
        p,
        () => document.querySelector("video").playbackRate === 1.5,
      );
      if (i === 0)
        await p
          .locator(".html5-video-player")
          .evaluate((e) => e.classList.add("ad-showing"));
    }
    await p.waitForTimeout(100);
    assert.equal(state.ads_skipped, base + 2);
    await p.close();
  });
  await test("Player rejecting acceleration retains original mute setting", async () => {
    const extra =
      videoSetup +
      `document.addEventListener('DOMContentLoaded',()=>{Object.defineProperty(document.querySelector('video'),'playbackRate',{get:()=>1.5,set:()=>{throw new Error('unsupported rate')}})});`;
    const base = state.ads_skipped || 0,
      p = await fixture(
        '<div class="html5-video-player ad-showing"><video></video></div>',
        "www.youtube.com",
        extra,
      );
    await p.waitForTimeout(400);
    assert.equal(await p.locator("video").evaluate((v) => v.muted), false);
    await p
      .locator(".html5-video-player")
      .evaluate((e) => e.classList.remove("ad-showing"));
    await p.waitForTimeout(100);
    assert.equal(state.ads_skipped, base);
    assert.equal(p.errors.length, 0);
    await p.close();
  });

  await test("YouTube silent speed resets across consecutive ads recover without any load event", async () => {
    const base = state.ads_skipped || 0;
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    for (let index = 0; index < 4; index++) {
      await p.locator("video").evaluate((video) => {
        video.playbackRate = 1;
        video.muted = false;
      });
      await waitFor(
        p,
        () =>
          document.querySelector("video").playbackRate === 16 &&
          document.querySelector("video").muted,
      );
    }
    await p
      .locator(".html5-video-player")
      .evaluate((player) => player.classList.remove("ad-showing"));
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    await p.waitForTimeout(100);
    assert.equal(state.ads_skipped, base + 1);
    await p.locator("video").evaluate((video) => {
      video.playbackRate = 2;
    });
    await p.waitForTimeout(350);
    assert.equal(
      await p.locator("video").evaluate((video) => video.playbackRate),
      2,
    );
    await p.close();
  });
  await test("YouTube silently reset second ad still auto-clicks a newly enabled Skip Ad", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video><button class="ytp-skip-ad-button" hidden disabled onclick="window.skips=(window.skips||0)+1;this.parentElement.classList.remove(\'ad-showing\')">Skip ad</button></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.locator("video").evaluate((video) => {
      video.playbackRate = 1;
      video.muted = false;
    });
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.locator("button").evaluate((button) => {
      button.hidden = false;
      button.disabled = false;
    });
    await waitFor(p, () => window.skips === 1);
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    assert.equal(p.errors.length, 0);
    await p.close();
  });
  await test("YouTube recovers from temporary playback-rate rejection with bounded retries", async () => {
    const extra =
      videoSetup +
      `document.addEventListener('DOMContentLoaded',()=>{const video=document.querySelector('video'),native=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'playbackRate');window.rateAttempts=0;Object.defineProperty(video,'playbackRate',{get:()=>native.get.call(video),set:value=>{if(value===16&&++window.rateAttempts<=2)throw Error('Not ready');native.set.call(video,value);}});});`;
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video></div>',
      "www.youtube.com",
      extra,
    );
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => window.rateAttempts), 1);
    assert.equal(
      await p.locator("video").evaluate((video) => video.muted),
      false,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    assert.equal(await p.evaluate(() => window.rateAttempts), 3);
    await p
      .locator(".html5-video-player")
      .evaluate((player) => player.classList.remove("ad-showing"));
    await waitFor(
      p,
      () => document.querySelector("video").playbackRate === 1.5,
    );
    assert.equal(p.errors.length, 0);
    await p.close();
  });
  await test("YouTube skips the native button inside a skip container only when its parent is visible", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video><div class="ytp-ad-skip-button-container" style="opacity:0"><button onclick="window.skips=(window.skips||0)+1;this.closest(\'.html5-video-player\').classList.remove(\'ad-showing\')">Skip ad</button></div></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.waitForTimeout(250);
    assert.equal(await p.evaluate(() => window.skips || 0), 0);
    await p.locator(".ytp-ad-skip-button-container").evaluate((container) => {
      container.style.opacity = "1";
    });
    await waitFor(p, () => window.skips === 1);
    await waitFor(
      p,
      () => document.querySelector("video").playbackRate === 1.5,
    );
    await p.close();
  });
  await test("YouTube disabling assistance during a silent reset stops all reapplication", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.locator("video").evaluate((video) => {
      video.playbackRate = 1;
    });
    await setting("www.youtube.com", "video", false);
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    await p.locator("video").evaluate((video) => {
      video.playbackRate = 1;
      video.dispatchEvent(new Event("playing"));
    });
    await p.waitForTimeout(400);
    assert.equal(
      await p.locator("video").evaluate((video) => video.playbackRate),
      1,
    );
    await p.close();
    await setting("www.youtube.com", "video", true);
  });
  await test("YouTube ad pod reuses media without a class transition or toggle reset", async () => {
    const base = state.ads_skipped || 0;
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    for (let i = 0; i < 3; i++) {
      await p.locator("video").evaluate((v) => {
        v.dispatchEvent(new Event("loadstart"));
        v.playbackRate = 1;
        v.muted = false;
        v.dispatchEvent(new Event("loadedmetadata"));
        // YouTube may reset playback again after metadata, before playback resumes.
        v.playbackRate = 1;
        v.muted = false;
        v.dispatchEvent(new Event("playing"));
      });
      await waitFor(
        p,
        () =>
          document.querySelector("video").playbackRate === 16 &&
          document.querySelector("video").muted,
      );
    }
    await p
      .locator(".html5-video-player")
      .evaluate((e) => e.classList.remove("ad-showing"));
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    await p.waitForTimeout(100);
    assert.equal(
      state.ads_skipped,
      base + 1,
      "one counter per contiguous assisted ad episode",
    );
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await test("YouTube reuses its skip button for the next ad in the same pod", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video><button class="ytp-skip-ad-button" onclick="window.clicks=(window.clicks||0)+1;if(window.clicks===2)this.parentElement.classList.remove(\'ad-showing\')">Skip ad</button></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => window.clicks === 1);
    await p.locator("video").evaluate((v) => {
      v.playbackRate = 1;
      v.dispatchEvent(new Event("loadstart"));
      v.dispatchEvent(new Event("playing"));
    });
    await waitFor(p, () => window.clicks === 2);
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    await p.waitForTimeout(250);
    assert.equal(await p.evaluate(() => window.clicks), 2);
    await p.close();
  });
  await test("YouTube clicks a delayed visible enabled skip button only during an ad", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video><button hidden disabled class="ytp-ad-skip-button-modern" onclick="window.clicks=(window.clicks||0)+1;this.parentElement.classList.remove(\'ad-showing\')">Skip ad</button></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => window.clicks || 0), 0);
    await p.locator("button").evaluate((b) => {
      b.hidden = false;
    });
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => window.clicks || 0), 0);
    await p.locator("button").evaluate((b) => {
      b.disabled = false;
    });
    await waitFor(p, () => window.clicks === 1);
    await p.locator("button").evaluate((b) => {
      b.hidden = true;
      b.hidden = false;
    });
    await p.waitForTimeout(250);
    assert.equal(await p.evaluate(() => window.clicks), 1);
    await p.close();
  });
  await test("YouTube MSE timeline reset rearms assistance without media load events", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video></div>',
      "www.youtube.com",
      videoSetup +
        `document.addEventListener('DOMContentLoaded',()=>{window.adTime=12;Object.defineProperty(document.querySelector('video'),'currentTime',{get:()=>window.adTime});});`,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.locator("video").evaluate((v) => {
      window.adTime = 0;
      v.playbackRate = 1;
      v.muted = false;
    });
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 16 &&
        document.querySelector("video").muted,
    );
    await p
      .locator(".html5-video-player")
      .evaluate((e) => e.classList.remove("ad-showing"));
    await waitFor(
      p,
      () =>
        document.querySelector("video").playbackRate === 1.5 &&
        !document.querySelector("video").muted,
    );
    await p.close();
  });
  await test("YouTube retries an ignored skip click with a bounded cooldown", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video><button class="ytp-skip-ad-button" onclick="window.clicks=(window.clicks||0)+1">Skip ad</button></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => window.clicks === 1);
    await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => window.clicks), 1);
    await waitFor(p, () => window.clicks === 3);
    await p.waitForTimeout(1200);
    assert.equal(await p.evaluate(() => window.clicks), 3);
    await p.close();
  });
  await test("YouTube unloaded next ad waits for playback and disabling removes media listeners", async () => {
    const p = await fixture(
      '<div class="html5-video-player ad-showing"><video></video></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await p.locator("video").evaluate((v) => {
      Object.defineProperty(v, "readyState", {
        get: () => 0,
        configurable: true,
      });
      v.dispatchEvent(new Event("emptied"));
      v.playbackRate = 1;
    });
    await p.waitForTimeout(200);
    assert.equal(await p.locator("video").evaluate((v) => v.playbackRate), 1);
    await p.locator("video").evaluate((v) => {
      Object.defineProperty(v, "readyState", {
        get: () => 4,
        configurable: true,
      });
      v.dispatchEvent(new Event("playing"));
    });
    await waitFor(p, () => document.querySelector("video").playbackRate === 16);
    await setting("www.youtube.com", "video", false);
    await waitFor(
      p,
      () => document.querySelector("video").playbackRate === 1.5,
    );
    await p.locator("video").evaluate((v) => {
      v.dispatchEvent(new Event("loadstart"));
      v.dispatchEvent(new Event("loadedmetadata"));
      v.dispatchEvent(new Event("playing"));
    });
    await p.waitForTimeout(200);
    assert.equal(await p.locator("video").evaluate((v) => v.playbackRate), 1.5);
    assert.equal(await p.locator("video").evaluate((v) => v.muted), false);
    await p.close();
    await setting("www.youtube.com", "video", true);
  });

  await test("Visibility-only changes reveal banners promptly", async () => {
    for (const attr of ["hidden", "style", "aria-hidden"]) {
      const p = await fixture(
        `<section ${attr === "hidden" ? "hidden" : attr === "style" ? 'style="display:none"' : 'aria-hidden="true"'}>${banner}</section>`,
      );
      await p.waitForTimeout(500);
      assert.equal(await p.evaluate(() => window.rejects || 0), 0);
      await p.locator("section").evaluate((e, a) => e.removeAttribute(a), attr);
      await p.waitForFunction(() => window.rejects === 1, null, {
        timeout: 2500,
      });
      await p.close();
    }
  });
  await test("Unattributed scroll lock remains owned by the page", async () => {
    const p = await fixture(
      banner + '<script>document.body.style.overflow="hidden"</script>',
    );
    await waitFor(p, () => window.rejects === 1);
    assert.equal(
      await p.evaluate(() => getComputedStyle(document.body).overflowY),
      "hidden",
    );
    assert.notEqual(
      await p
        .locator("#onetrust-banner-sdk")
        .evaluate((e) => getComputedStyle(e).display),
      "none",
    );
    await p.close();
  });
  await test("Unrelated shadow dialog prevents attributed scroll override", async () => {
    const p = await fixture(
      banner +
        `<div id="host"></div><script>document.body.className='ot-overflow-hidden';document.body.style.overflow='hidden';document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<div aria-modal="true">Checkout</div>';</script>`,
    );
    await waitFor(p, () => window.rejects === 1);
    assert.equal(
      await p.evaluate(() => getComputedStyle(document.body).overflowY),
      "hidden",
    );
    await p.close();
  });
  await test("Removing CMP lock releases override without restoring stale lock", async () => {
    const p = await fixture(
      banner +
        `<style>.ot-overflow-hidden{overflow:hidden}</style><script>document.body.className='ot-overflow-hidden'</script>`,
      "release.test",
    );
    await waitFor(p, () => document.body.style.overflowY === "auto");
    await p.evaluate(() =>
      document.body.classList.remove("ot-overflow-hidden"),
    );
    await waitFor(p, () => document.body.style.overflowY === "");
    await setting("release.test", "paused", true);
    assert.notEqual(
      await p.evaluate(() => getComputedStyle(document.body).overflowY),
      "hidden",
    );
    await p.close();
  });
  await test("Page counters are independent from all-time totals", async () => {
    const a = await fixture(banner),
      b = await fixture("<p>No banners</p>");
    await waitFor(a, () => window.rejects === 1);
    const sa = await a.evaluate(() => __pageStatus()),
      sb = await b.evaluate(() => __pageStatus());
    assert.equal(sa.activity.banners_vaporized, 1);
    assert.equal(sb.activity.banners_vaporized, 0);
    await a.close();
    await b.close();
  });
  await test("Detached idle player is pruned on maintenance", async () => {
    const p = await fixture(
      '<div class="html5-video-player"><video></video></div>',
      "www.youtube.com",
      videoSetup,
    );
    await waitFor(p, () =>
      __pageStatus().then((s) => s.diagnostics.videoPlayers === 1),
    );
    await p.locator(".html5-video-player").evaluate((e) => e.remove());
    await p.waitForFunction(
      () => __pageStatus().then((s) => s.diagnostics.videoPlayers === 0),
      null,
      { timeout: 17000 },
    );
    await p.close();
  });

  await test("Site display overwrite is suppressed without duplicate telemetry", async () => {
    const p = await fixture(banner);
    await waitFor(p, () => window.rejects === 1);
    await p
      .locator("#onetrust-banner-sdk")
      .evaluate((e) => e.style.setProperty("display", "block", "important"));
    await waitFor(
      p,
      () =>
        getComputedStyle(document.querySelector("#onetrust-banner-sdk"))
          .display === "none",
    );
    assert.equal(
      (await p.evaluate(() => __pageStatus())).activity.banners_vaporized,
      1,
    );
    await p.close();
  });
  await test("CSS-hidden rejection controls are not clicked", async () => {
    const p = await fixture(
      '<div id="onetrust-banner-sdk">Cookies<button style="display:none" id="onetrust-reject-all-handler" onclick="window.badClick=true">Reject all</button></div>',
    );
    await waitFor(
      p,
      () =>
        document.querySelector("#onetrust-banner-sdk").dataset.bypassHidden ===
        "1",
    );
    assert.equal(await p.evaluate(() => Boolean(window.badClick)), false);
    await p.close();
  });

  await test("Newsletter modal uses native close and releases site scroll lock", async () => {
    const p = await fixture(
      `<div class="newsletter-popup" role="dialog" aria-modal="true" style="position:fixed;inset:50px;background:white">Subscribe to our newsletter<button type="button" aria-label="Close" onclick="document.body.style.overflow='';this.parentElement.remove();window.closedNewsletter=true">×</button></div><script>document.body.style.overflow='hidden'</script>`,
    );
    await waitFor(p, () => window.closedNewsletter === true);
    await waitFor(p, () =>
      __pageStatus().then((s) => s.activity.distractions_hidden === 1),
    );
    assert.notEqual(
      await p.evaluate(() => getComputedStyle(document.body).overflowY),
      "hidden",
    );
    await p.close();
  });
  await test("Nonmodal newsletter hides reversibly with master switch", async () => {
    const p = await fixture(
      '<div class="newsletter-popup" style="position:fixed;bottom:20px;right:20px;width:250px;height:100px">Join our newsletter</div>',
      "newsletter.test",
    );
    await waitFor(
      p,
      () =>
        getComputedStyle(document.querySelector(".newsletter-popup"))
          .display === "none",
    );
    await setting("newsletter.test", "paused", true);
    await waitFor(
      p,
      () =>
        getComputedStyle(document.querySelector(".newsletter-popup"))
          .display !== "none",
    );
    await setting("newsletter.test", "paused", false);
    await waitFor(
      p,
      () =>
        getComputedStyle(document.querySelector(".newsletter-popup"))
          .display === "none",
    );
    assert.equal(
      (await p.evaluate(() => __pageStatus())).activity.distractions_hidden,
      1,
    );
    await p.close();
  });
  await test("Support nudge hides but support launcher stays available", async () => {
    const p = await fixture(
      '<button id="support-launcher">Get help</button><div class="chat-nudge" style="position:fixed;bottom:20px;right:20px;width:220px;height:80px">Need help?</div>',
    );
    await waitFor(
      p,
      () =>
        getComputedStyle(document.querySelector(".chat-nudge")).display ===
        "none",
    );
    assert.equal(await p.locator("#support-launcher").isVisible(), true);
    await p.close();
  });
  await test("Sticky labeled top and bottom ad slots hide; navigation stays", async () => {
    const p = await fixture(
      '<header style="position:sticky;top:0">Navigation</header><div class="sticky-ad" id="top" style="position:fixed;top:0;width:100%;height:60px">Advertisement</div><div class="anchor-ad" id="bottom" style="position:fixed;bottom:0;width:100%;height:60px">Sponsored</div>',
    );
    await waitFor(p, () =>
      __pageStatus().then((s) => s.activity.distractions_hidden === 2),
    );
    assert.equal(await p.locator("header").isVisible(), true);
    await p.close();
  });
  await test("Inline newsletters and unlabeled sticky content remain", async () => {
    const p = await fixture(
      '<div class="newsletter">Subscribe to our newsletter</div><div class="sticky-ad" style="position:fixed;bottom:0;width:100%;height:60px">Your order total</div>',
    );
    await p.waitForTimeout(600);
    assert.equal(await p.locator(".newsletter").isVisible(), true);
    assert.equal(await p.locator(".sticky-ad").isVisible(), true);
    await p.close();
  });
  await test("Age gates and security dialogs are not clicked or hidden", async () => {
    const p = await fixture(
      '<div class="newsletter-popup age-gate" style="position:fixed;top:10px">Verify your age before joining our newsletter<button type="button" onclick="window.bad=true">Close</button></div><div class="support-popup" style="position:fixed;bottom:10px">Need help? Verify your identity<button type="button" onclick="window.bad=true">Close</button></div>',
    );
    await p.waitForTimeout(600);
    assert.equal(await p.locator(".age-gate").isVisible(), true);
    assert.equal(await p.locator(".support-popup").isVisible(), true);
    assert.equal(await p.evaluate(() => !!window.bad), false);
    await p.close();
  });
  await test("Active support input and iframe widgets remain", async () => {
    const p = await fixture(
      '<div class="support-popup" style="position:fixed;right:0">Need help?<textarea>My question</textarea></div><div class="chat-nudge" style="position:fixed;bottom:0">Need help?<iframe src="about:blank"></iframe></div>',
    );
    await p.waitForTimeout(600);
    assert.equal(await p.locator(".support-popup").isVisible(), true);
    assert.equal(await p.locator(".chat-nudge").isVisible(), true);
    await p.close();
  });
  await test("Uncloseable modal remains visible without fake success", async () => {
    const p = await fixture(
      '<div class="newsletter-popup" role="dialog" aria-modal="true" style="position:fixed;top:20px">Join our newsletter<button type="button">Close</button></div>',
    );
    await p.waitForTimeout(700);
    assert.equal(await p.locator(".newsletter-popup").isVisible(), true);
    assert.equal(
      (await p.evaluate(() => __pageStatus())).activity.distractions_hidden,
      0,
    );
    await p.close();
  });
  await test("Never submit newsletter form via mislabeled close button", async () => {
    const p = await fixture(
      '<div class="newsletter-popup" role="dialog" aria-modal="true" style="position:fixed;top:20px">Join our newsletter<form onsubmit="event.preventDefault();window.bad=true"><button>Close</button></form></div>',
    );
    await p.waitForTimeout(700);
    assert.equal(await p.evaluate(() => !!window.bad), false);
    assert.equal(await p.locator(".newsletter-popup").isVisible(), true);
    await p.close();
  });
  await test("User-triggered newsletter stays open", async () => {
    const p = await fixture('<button id="open">Newsletter</button>');
    await p.waitForTimeout(300);
    await p.locator("#open").click();
    await p.evaluate(() =>
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div class="newsletter-popup" style="position:fixed;bottom:0;width:200px;height:100px">Join our newsletter</div>',
      ),
    );
    await p.waitForTimeout(700);
    assert.equal(await p.locator(".newsletter-popup").isVisible(), true);
    await p.close();
  });
  await test("Nested open shadow support teaser is reversible", async () => {
    const p = await fixture(
      `<div id="shadow"></div><script>const r=document.querySelector("#shadow").attachShadow({mode:"open"});r.innerHTML='<div class="support-teaser" style="position:fixed;bottom:0;width:200px;height:80px">Can we help?</div>'</script>`,
      "shadow-prompt.test",
    );
    await waitFor(p, () =>
      __pageStatus().then((s) => s.activity.distractions_hidden === 1),
    );
    await setting("shadow-prompt.test", "cookies", false);
    assert.equal(await p.locator(".support-teaser").isVisible(), true);
    await p.close();
  });
  await test("Distraction cleanup disabled by existing cookie preference", async () => {
    await setting("disabled-prompt.test", "cookies", false);
    const p = await fixture(
      '<div class="chat-nudge" style="position:fixed;bottom:0;width:200px;height:100px">Need help?</div>',
      "disabled-prompt.test",
    );
    await p.waitForTimeout(600);
    assert.equal(await p.locator(".chat-nudge").isVisible(), true);
    assert.equal(
      (await p.evaluate(() => __pageStatus())).activity.distractions_hidden,
      0,
    );
    await p.close();
  });

  await test("Empty chat composer and contenteditable chat remain", async () => {
    const p = await fixture(
      '<div class="support-popup" style="position:fixed;top:0">Need help?<input placeholder="Type a message"></div><div class="chat-nudge" style="position:fixed;bottom:0">Need help?<div contenteditable>Write a message</div></div>',
    );
    await p.waitForTimeout(600);
    assert.equal(await p.locator(".support-popup").isVisible(), true);
    assert.equal(await p.locator(".chat-nudge").isVisible(), true);
    await p.close();
  });
  await test("Popup: counters, live site switch, sharing, and visual capture", async () => {
    const content = await fixture(banner, "popup-target.test");
    await waitFor(content, () => window.rejects === 1);
    const p = await browser.newPage({ viewport: { width: 376, height: 780 } });
    pages.add(p);
    await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await p.exposeBinding("__bridge", async (source, req) =>
      req.kind === "status"
        ? content.evaluate(() => globalThis.__pageStatus())
        : req.kind === "get"
          ? get(req.keys)
          : dispatch(req.message, {
              id: "bypass-test",
              url: "chrome-extension://bypass-test/ui/popup.html",
            }),
    );
    await p.addInitScript(() => {
      const listeners = [];
      globalThis.__storageChange = (c) =>
        listeners.forEach((fn) => fn(c, "local"));
      globalThis.chrome = {
        tabs: {
          query: async () => [{ id: 1, url: "https://popup-target.test/" }],
          sendMessage: () => __bridge({ kind: "status" }),
        },
        runtime: { sendMessage: (m) => __bridge({ kind: "send", message: m }) },
        storage: {
          local: { get: (keys) => __bridge({ kind: "get", keys }) },
          onChanged: { addListener: (fn) => listeners.push(fn) },
        },
      };
    });
    await p.route("**/*", (route) => {
      const name =
        new URL(route.request().url()).pathname.split("/").pop() ||
        "popup.html";
      if (
        !["popup.html", "popup.css", "popup.js", "streaming-sites.js"].includes(
          name,
        )
      )
        return route.abort();
      return route.fulfill({
        contentType: name.endsWith(".css")
          ? "text/css"
          : name.endsWith(".js")
            ? "text/javascript"
            : "text/html",
        body: fs.readFileSync(
          path.join(ROOT, name === "streaming-sites.js" ? "core" : "ui", name),
        ),
      });
    });
    await p.goto("https://popup.fixture/popup.html");
    await waitFor(p, () => !document.querySelector("#enabled").disabled);
    await p.locator(".activity-details > summary").first().click();
    assert.equal(
      await p.locator("#banners").innerText(),
      new Intl.NumberFormat("en-US").format(state.banners_vaporized),
    );
    await p.locator("#enabled").uncheck();
    await waitFor(
      p,
      () => document.querySelector("#state").textContent === "Off",
    );
    await waitFor(
      content,
      () =>
        getComputedStyle(document.querySelector("#onetrust-banner-sdk"))
          .display !== "none",
    );
    assert.equal(await p.locator("#cookies").isDisabled(), true);
    assert.equal(await p.locator("#cookies").isChecked(), false);
    await p.locator("#enabled").check();
    await waitFor(
      p,
      () => document.querySelector("#state").textContent === "On",
    );
    await waitFor(
      content,
      () =>
        getComputedStyle(document.querySelector("#onetrust-banner-sdk"))
          .display === "none",
    );
    assert.equal(await p.locator("#cookies").isEnabled(), true);
    assert.equal(await p.locator("#cookies").isChecked(), true);
    assert.equal(await p.locator("#video").isDisabled(), true);
    assert.equal(await p.locator("#streaming-controls").isVisible(), true);
    assert.equal(await p.locator("#skipIntro").isDisabled(), true);
    assert.match(
      await p.locator("#streaming-note").innerText(),
      /Netflix, Prime Video & Disney\+/,
    );
    assert.equal(await p.locator("#streaming-preview").isVisible(), true);
    assert.equal(await p.locator("#streaming-options").isVisible(), false);
    assert.match(
      await p.locator("#page-activity").innerText(),
      /This page: 1 banner hidden/,
    );
    await p.locator("#share").click();
    assert.match(
      await p.evaluate(() => navigator.clipboard.readText()),
      /My Bypass activity/,
    );
    await p.locator(".activity-details > summary").first().click();
    await p.locator("#cookies").uncheck();
    await waitFor(
      p,
      () => document.querySelector("#state").textContent === "No features on",
    );
    await p.locator("#cookies").check();
    await waitFor(
      p,
      () => document.querySelector("#state").textContent === "On",
    );
    await p.screenshot({
      path: path.join(__dirname, "popup-preview.png"),
      fullPage: true,
    });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth),
      376,
    );
    await content.close();
    await p.close();
  });

  const streamSetup = `document.addEventListener('DOMContentLoaded',()=>{window.streamPaused=false;window.streamTime=60;window.streamEnded=false;window.streamReady=4;for(const v of document.querySelectorAll('video'))Object.defineProperties(v,{paused:{get:()=>window.streamPaused},duration:{get:()=>1200},currentTime:{get:()=>window.streamTime},ended:{get:()=>window.streamEnded},readyState:{get:()=>window.streamReady}});});`;
  const streamHTML = (
    button = '<button id="skip" data-uia="player-skip-intro" onclick="window.skips=(window.skips||0)+1">Skip Intro</button>',
    player = "watch-video",
  ) => `<div class="${player}"><video></video>${button}</div>`;
  async function streamSettings(host, values = {}) {
    for (const [key, value] of Object.entries({
      paused: false,
      cookies: false,
      video: false,
      skipIntro: false,
      skipRecap: false,
      autoNext: false,
      ...values,
    }))
      await setting(host, key, value);
  }
  await test("Streaming defaults OFF; no clicks or streaming engine", async () => {
    const p = await fixture(streamHTML(), "netflix.com", streamSetup);
    await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => window.skips || 0), 0);
    assert.equal(
      await p.evaluate(async () =>
        (await __pageStatus()).active.includes("streaming"),
      ),
      false,
    );
    await p.close();
  });
  await test("Netflix intro opt-in: native click attempt, honest count, no repeated clicks", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const base = state.streaming_clicks || 0;
    const p = await fixture(streamHTML(), "netflix.com", streamSetup);
    await waitFor(p, () => window.skips === 1);
    await p.evaluate(() => {
      document.querySelector("#skip").classList.add("changed");
      document.querySelector("video").dispatchEvent(new Event("timeupdate"));
    });
    await p.waitForTimeout(400);
    await settled();
    assert.equal(await p.evaluate(() => window.skips), 1);
    assert.equal(state.streaming_clicks, base + 1);
    assert.equal(await p.locator("video").evaluate((v) => v.playbackRate), 1);
    assert.equal(await p.locator("video").evaluate((v) => v.muted), false);
    await p.close();
  });
  await test("OFF cancels pending work and preserves episode deduplication on resume", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(streamHTML(), "netflix.com", streamSetup);
    await waitFor(p, () => window.skips === 1);
    await setting("netflix.com", "paused", true);
    await setting("netflix.com", "paused", false);
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => window.skips), 1);
    await setting("netflix.com", "skipIntro", false);
    await p.evaluate(() => {
      history.pushState({}, "", "/watch/new");
      document.querySelector("#skip").classList.add("again");
    });
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => window.skips), 1);
    await setting("netflix.com", "skipIntro", true);
    await waitFor(p, () => window.skips === 2);
    await p.close();
  });
  await test("Recaps remain untouched until separately enabled", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(
      streamHTML(
        '<button id="skip" data-uia="player-skip-recap" onclick="window.skips=(window.skips||0)+1">Skip Recap</button>',
      ),
      "netflix.com",
      streamSetup,
    );
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => window.skips || 0), 0);
    await setting("netflix.com", "skipRecap", true);
    await waitFor(p, () => window.skips === 1);
    await p.close();
  });
  await test("Hidden, disabled and occluded streaming buttons are not clicked", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(
      streamHTML(
        '<button id="skip" hidden disabled data-uia="player-skip-intro" onclick="window.skips=(window.skips||0)+1">Skip Intro</button>',
      ) +
        '<div id="cover" style="position:fixed;inset:0;background:white;z-index:100"></div>',
      "netflix.com",
      streamSetup,
    );
    await p.waitForTimeout(250);
    assert.equal(await p.evaluate(() => window.skips || 0), 0);
    await p.evaluate(() => {
      const b = document.querySelector("#skip");
      b.hidden = false;
      b.disabled = false;
    });
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => window.skips || 0), 0);
    await p.evaluate(() => {
      document.querySelector("#cover").remove();
      document.querySelector("video").dispatchEvent(new Event("timeupdate"));
    });
    await waitFor(p, () => window.skips === 1);
    await p.close();
  });
  await test("Paused streaming stays untouched; resumes through media event", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(
      streamHTML(),
      "netflix.com",
      streamSetup +
        `document.addEventListener('DOMContentLoaded',()=>window.streamPaused=true);`,
    );
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => window.skips || 0), 0);
    await p.evaluate(() => {
      streamPaused = false;
      document.querySelector("video").dispatchEvent(new Event("playing"));
    });
    await waitFor(p, () => window.skips === 1);
    await p.close();
  });
  await test("Prime Video exact labels and text-node updates; unrelated buttons ignored", async () => {
    await streamSettings("www.primevideo.com", { skipIntro: true });
    const p = await fixture(
      streamHTML(
        '<button id="skip" onclick="window.skips=(window.skips||0)+1">Loading</button><button onclick="window.bad=true">Skip Ad</button><button onclick="window.bad=true">Skip Introduction Settings</button>',
        "webPlayerSDKContainer",
      ),
      "www.primevideo.com",
      streamSetup,
    );
    await p.waitForTimeout(250);
    await p.evaluate(
      () => (document.querySelector("#skip").firstChild.data = "Skip Intro"),
    );
    await waitFor(p, () => window.skips === 1);
    assert.equal(await p.evaluate(() => !!window.bad), false);
    await p.close();
  });
  await test("Disney intro adapter supports exact localized labels", async () => {
    await streamSettings("www.disneyplus.com", { skipIntro: true });
    const p = await fixture(
      streamHTML(
        '<button onclick="window.skips=1">Omitir intro</button>',
        "btm-media-client-element",
      ),
      "www.disneyplus.com",
      streamSetup,
    );
    await waitFor(p, () => window.skips === 1);
    await p.close();
  });
  await test("Next episode requires opt-in and final 15 seconds, never mid-episode", async () => {
    await streamSettings("netflix.com", { autoNext: true });
    const p = await fixture(
      streamHTML(
        '<button data-uia="next-episode-seamless-button" onclick="window.skips=(window.skips||0)+1">Next Episode</button>',
      ),
      "netflix.com",
      streamSetup,
    );
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => window.skips || 0), 0);
    await p.evaluate(() => {
      streamTime = 1190;
      document.querySelector("video").dispatchEvent(new Event("timeupdate"));
    });
    await waitFor(p, () => window.skips === 1);
    await p.close();
  });
  await test("Persistent toolbar Next and generic Watch Next remain untouched at end", async () => {
    await streamSettings("www.primevideo.com", { autoNext: true });
    const p = await fixture(
      streamHTML(
        '<button onclick="window.bad=true">Next Episode</button><button onclick="window.bad=true">Watch Next</button>',
        "webPlayerSDKContainer",
      ),
      "www.primevideo.com",
      streamSetup +
        `document.addEventListener('DOMContentLoaded',()=>{streamTime=1200;streamEnded=true;streamPaused=true;});`,
    );
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => !!window.bad), false);
    await p.close();
  });
  await test("Disney end-card next episode works after ended playback", async () => {
    await streamSettings("www.disneyplus.com", { autoNext: true });
    const p = await fixture(
      streamHTML(
        '<button data-testid="up-next-play-button" onclick="window.skips=1">Next Episode</button>',
        "btm-media-client-element",
      ),
      "www.disneyplus.com",
      streamSetup +
        `document.addEventListener('DOMContentLoaded',()=>{streamTime=1200;streamEnded=true;streamPaused=true;});`,
    );
    await waitFor(p, () => window.skips === 1);
    await p.close();
  });
  await test("SPA episode transitions and metadata allow the next intro", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(streamHTML(), "netflix.com", streamSetup);
    await waitFor(p, () => window.skips === 1);
    await p.evaluate(() => {
      history.pushState({}, "", "/watch/episode2");
      document
        .querySelector("video")
        .dispatchEvent(new Event("loadedmetadata"));
    });
    await waitFor(p, () => window.skips === 2);
    await p.close();
  });
  await test("Unsupported host, lookalike domain and buttons outside player are protected", async () => {
    for (const host of ["streaming.test", "netflix.com.evil.test"]) {
      await streamSettings(host, { skipIntro: true });
      const p = await fixture(streamHTML(), host, streamSetup);
      await p.waitForTimeout(250);
      assert.equal(await p.evaluate(() => window.skips || 0), 0);
      await p.close();
    }
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(
      '<video></video><button data-uia="player-skip-intro" onclick="window.bad=true">Skip Intro</button>',
      "netflix.com",
      streamSetup,
    );
    await p.waitForTimeout(250);
    assert.equal(await p.evaluate(() => !!window.bad), false);
    await p.close();
  });
  await test("Multiple videos and focused forms fail open without unwanted clicks", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(
      streamHTML().replace("<video></video>", "<video></video><video></video>"),
      "netflix.com",
      streamSetup,
    );
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => window.skips || 0), 0);
    await p.close();
    const q = await fixture(
      "<input autofocus>" + streamHTML(),
      "netflix.com",
      streamSetup,
    );
    await q.waitForTimeout(300);
    assert.equal(await q.evaluate(() => window.skips || 0), 0);
    await q.close();
  });
  await test("Streaming BFCache suspension stops and restores without duplicated actions", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(streamHTML(), "netflix.com", streamSetup);
    await waitFor(p, () => window.skips === 1);
    await p.evaluate(() =>
      dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
    );
    assert.equal(
      await p.evaluate(async () =>
        (await __pageStatus()).active.includes("streaming"),
      ),
      false,
    );
    await p.evaluate(() =>
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    );
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => window.skips), 1);
    assert.equal(p.errors.length, 0);
    await p.close();
  });

  await test("Streaming popup: compact controls, persisted opt-ins, master OFF and counters", async () => {
    await streamSettings("netflix.com");
    const content = await fixture(streamHTML(), "netflix.com", streamSetup);
    const p = await browser.newPage({ viewport: { width: 376, height: 600 } });
    pages.add(p);
    await p.exposeBinding("__bridge", async (source, req) =>
      req.kind === "status"
        ? content.evaluate(() => __pageStatus())
        : req.kind === "get"
          ? get(req.keys)
          : dispatch(req.message, {
              id: "bypass-test",
              url: "chrome-extension://bypass-test/ui/popup.html",
            }),
    );
    await p.addInitScript(() => {
      const listeners = [];
      globalThis.__storageChange = (c) =>
        listeners.forEach((fn) => fn(c, "local"));
      globalThis.chrome = {
        tabs: {
          query: async () => [{ id: 1, url: "https://netflix.com/watch/1" }],
          sendMessage: () => __bridge({ kind: "status" }),
        },
        runtime: { sendMessage: (m) => __bridge({ kind: "send", message: m }) },
        storage: {
          local: { get: (keys) => __bridge({ kind: "get", keys }) },
          onChanged: { addListener: (fn) => listeners.push(fn) },
        },
      };
    });
    await p.route("**/*", (route) => {
      const name =
        new URL(route.request().url()).pathname.split("/").pop() ||
        "popup.html";
      if (
        !["popup.html", "popup.css", "popup.js", "streaming-sites.js"].includes(
          name,
        )
      )
        return route.abort();
      return route.fulfill({
        contentType: name.endsWith(".css")
          ? "text/css"
          : name.endsWith(".js")
            ? "text/javascript"
            : "text/html",
        body: fs.readFileSync(
          path.join(ROOT, name === "streaming-sites.js" ? "core" : "ui", name),
        ),
      });
    });
    await p.goto("https://popup.fixture/popup.html");
    await waitFor(p, () => !document.querySelector("#enabled").disabled);
    assert.equal(await p.locator("#streaming-controls").isVisible(), true);
    assert.equal(await p.locator("#skipIntro").isChecked(), false);
    assert.equal(await p.locator("#skipRecap").isVisible(), false);
    assert.equal(await p.locator("#state").innerText(), "No features on");
    await p.locator("#skipIntro").check();
    await waitFor(content, () => window.skips === 1);
    await waitFor(
      p,
      () => document.querySelector("#state").textContent === "On",
    );
    assert.equal(state["site:netflix.com"].skipIntro, true);
    assert.equal(state["site:netflix.com"].skipRecap, false);
    await p.locator(".streaming-options summary").click();
    assert.equal(await p.locator("#autoNext").isChecked(), false);
    await p.locator("#skipRecap").check();
    await waitFor(p, () => !document.querySelector("#skipRecap").disabled);
    await p.locator("#enabled").uncheck();
    await waitFor(
      p,
      () => document.querySelector("#state").textContent === "Off",
    );
    for (const id of ["skipIntro", "skipRecap", "autoNext"]) {
      assert.equal(await p.locator("#" + id).isDisabled(), true);
      assert.equal(await p.locator("#" + id).isChecked(), false);
    }
    await p.locator("#enabled").check();
    await waitFor(
      p,
      () => document.querySelector("#state").textContent === "On",
    );
    assert.equal(await p.locator("#skipIntro").isChecked(), true);
    assert.equal(await p.locator("#skipRecap").isChecked(), true);
    await waitFor(p, () =>
      document
        .querySelector("#page-activity")
        .textContent.includes("1 streaming click attempted"),
    );
    await p.locator(".streaming-options summary").click();
    await p.screenshot({
      path: path.join(__dirname, "streaming-popup.png"),
      fullPage: true,
    });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth),
      376,
    );
    await content.close();
    await p.close();
  });

  await test("Disney generic movie recommendation is never treated as next episode", async () => {
    await streamSettings("www.disneyplus.com", { autoNext: true });
    const p = await fixture(
      streamHTML(
        '<button data-testid="up-next-play-button" onclick="window.bad=true">Watch Next</button>',
        "btm-media-client-element",
      ),
      "www.disneyplus.com",
      streamSetup +
        `document.addEventListener('DOMContentLoaded',()=>{streamTime=1200;streamEnded=true;streamPaused=true;});`,
    );
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => !!window.bad), false);
    await p.close();
  });
  await test("Manual skip is respected; automatic click does not follow the user click", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(
      streamHTML(),
      "netflix.com",
      streamSetup +
        `document.addEventListener('DOMContentLoaded',()=>window.streamPaused=true);`,
    );
    await p.waitForTimeout(250);
    await p.locator("#skip").click();
    await p.evaluate(() => {
      streamPaused = false;
      document.querySelector("video").dispatchEvent(new Event("playing"));
    });
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => window.skips), 1);
    await p.close();
  });

  await test("HTTP pages persist metrics without crypto.randomUUID", async () => {
    const base = state.banners_vaporized || 0;
    const p = await fixture(banner, "insecure.test", "", { scheme: "http" });
    assert.equal(await p.evaluate(() => isSecureContext), false);
    await waitFor(p, () => window.rejects === 1);
    await p.waitForTimeout(100);
    await settled();
    assert.equal(state.banners_vaporized, base + 1);
    assert.equal(p.errors.length, 0);
    await p.close();
  });
  await test("A delayed initial settings read cannot override a newer site OFF choice", async () => {
    const p = await fixture(banner, "settings-race.test", "", {
      getDelay: 350,
    });
    await setting("settings-race.test", "paused", true);
    await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => window.rejects || 0), 0);
    assert.equal(
      (await p.evaluate(() => __pageStatus())).settings.paused,
      true,
    );
    await p.close();
  });
  await test("Detached consent nodes restore owned styles before reuse", async () => {
    const p = await fixture(banner, "detached-cookie.test");
    await waitFor(p, () => window.rejects === 1);
    await p.evaluate(() => {
      window.savedBanner = document.querySelector("#onetrust-banner-sdk");
      savedBanner.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div id="didomi-notice">Cookies</div>',
      );
    });
    await waitFor(
      p,
      () =>
        savedBanner.style.display !== "none" &&
        !savedBanner.hasAttribute("data-bypass-hidden"),
    );
    await setting("detached-cookie.test", "cookies", false);
    await p.evaluate(() => document.body.append(savedBanner));
    assert.equal(await p.locator("#onetrust-banner-sdk").isVisible(), true);
    await p.close();
  });
  await test("Consent reject control inside a CSS-hidden wrapper is not clicked", async () => {
    const p = await fixture(
      '<div id="onetrust-banner-sdk">Cookies<div style="display:none"><button id="onetrust-reject-all-handler" onclick="window.bad=true">Reject all</button></div></div>',
    );
    await waitFor(
      p,
      () =>
        document.querySelector("#onetrust-banner-sdk").dataset.bypassHidden ===
        "1",
    );
    assert.equal(await p.evaluate(() => !!window.bad), false);
    await p.close();
  });
  await test("Restoring scroll leaves horizontal overflow changes owned by the website", async () => {
    const p = await fixture(
      banner +
        '<script>document.body.classList.add("ot-overflow-hidden");document.body.style.cssText="overflow-x:scroll;overflow-y:hidden";</script>',
      "horizontal-scroll.test",
    );
    await waitFor(p, () => document.body.style.overflowY === "auto");
    await p.evaluate(() =>
      document.body.style.setProperty("overflow-x", "auto", "important"),
    );
    await setting("horizontal-scroll.test", "paused", true);
    assert.equal(
      await p.evaluate(() =>
        document.body.style.getPropertyValue("overflow-x"),
      ),
      "auto",
    );
    assert.equal(
      await p.evaluate(() =>
        document.body.style.getPropertyPriority("overflow-x"),
      ),
      "important",
    );
    await p.close();
  });
  await test("Late removal of attributed cookie lock releases the extension override", async () => {
    const p = await fixture(
      "<style>.ot-overflow-hidden{overflow:hidden}</style>" +
        banner +
        '<script>document.body.classList.add("ot-overflow-hidden")</script>',
      "late-lock.test",
    );
    await waitFor(p, () => document.body.style.overflowY === "auto");
    await p.waitForTimeout(1150);
    await p.evaluate(() =>
      document.body.classList.remove("ot-overflow-hidden"),
    );
    await waitFor(p, () => document.body.style.overflowY === "");
    await p.close();
  });
  await test("Repeated metadata for the same streaming source cannot repeat an intro click", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(streamHTML(), "netflix.com", streamSetup);
    await waitFor(p, () => window.skips === 1);
    await p.evaluate(() =>
      document
        .querySelector("video")
        .dispatchEvent(new Event("loadedmetadata")),
    );
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => window.skips), 1);
    await p.close();
  });
  await test("Streaming never submits an externally associated form", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(
      '<form id="outside" onsubmit="event.preventDefault();window.bad=true"></form>' +
        streamHTML(
          '<button form="outside" data-uia="player-skip-intro" onclick="window.clicked=true">Skip Intro</button>',
        ),
      "netflix.com",
      streamSetup,
    );
    await p.waitForTimeout(350);
    assert.equal(
      await p.evaluate(() => !!window.bad || !!window.clicked),
      false,
    );
    await p.close();
  });
  await test("Streaming respects an active editable field inside an open shadow root", async () => {
    await streamSettings("netflix.com", { skipIntro: true });
    const p = await fixture(
      '<div id="editor"></div>' +
        streamHTML() +
        '<script>const r=document.querySelector("#editor").attachShadow({mode:"open"});r.innerHTML="<div contenteditable>Type here</div>";r.firstElementChild.focus();</script>',
      "netflix.com",
      streamSetup,
    );
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => window.skips || 0), 0);
    await p.close();
  });
  await test("Metric retry deduplicates the oldest of all 512 retained event IDs", async () => {
    const old = state.recent_events,
      ids = Array.from(
        { length: 512 },
        (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
      ),
      base = state.streaming_clicks || 0;
    await set({ recent_events: ids });
    const result = await dispatch({
      type: "metric",
      key: "streaming_clicks",
      id: ids[0],
    });
    assert.equal(result.ok, true);
    assert.equal(state.streaming_clicks || 0, base);
    await set({ recent_events: old });
  });

  await test("Package wiring and no remote runtime code", async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"),
    );
    const packageVersion = JSON.parse(
      fs.readFileSync(path.join(ROOT, "../package.json"), "utf8"),
    ).version;
    assert.equal(manifest.version, packageVersion);
    assert.equal(manifest.content_scripts[0].run_at, "document_start");
    assert.deepEqual(manifest.content_scripts[0].js, scripts);
    for (const file of [
      ...scripts,
      manifest.background.service_worker,
      manifest.action.default_popup,
    ])
      assert.ok(fs.existsSync(path.join(ROOT, file)));
    for (const file of scripts)
      assert.doesNotMatch(
        fs.readFileSync(path.join(ROOT, file), "utf8"),
        /\bfetch\s*\(|XMLHttpRequest|\beval\s*\(/,
      );
  });
  const report = {
    date: new Date().toISOString(),
    browser: version,
    environment:
      "Real headless Chromium DOM; Chrome extension APIs bridged to the actual service-worker source in a Node VM. Streaming media paused, readyState, duration, currentTime and ended are simulated. YouTube playbackRate/muted use native properties. No signed-in streaming service or native MV3 extension installation was tested.",
    results,
  };
  fs.writeFileSync(
    path.join(__dirname, "results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  if (results.some((x) => x.status === "FAIL")) process.exitCode = 1;
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
