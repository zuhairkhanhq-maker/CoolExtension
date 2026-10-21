const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const ROOT = path.resolve(__dirname, "..");
const results = [];
let browser;

async function popup(options = {}) {
  const page = await browser.newPage({ viewport: { width: 376, height: 600 } });
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
  await page.addInitScript((options) => {
    const defaults = {
      paused: false,
      cookies: true,
      video: true,
      skipIntro: false,
      skipRecap: false,
      autoNext: false,
    };
    const listeners = [];
    const host = options.host || "netflix.com";
    const state = {
      ["site:" + host]: { ...defaults, ...options.settings },
      banners_vaporized: 1,
    };
    const emit = (values) => {
      const changes = Object.fromEntries(
        Object.entries(values).map(([key, newValue]) => [key, { newValue }]),
      );
      Object.assign(state, values);
      listeners.forEach((listener) => listener(changes, "local"));
    };
    globalThis.__emit = emit;
    globalThis.chrome = {
      tabs: {
        query: async () => [
          { id: 1, url: options.url || `https://${host}/watch/1` },
        ],
        sendMessage: async () =>
          options.malformed
            ? { unexpected: true }
            : {
                settings: state["site:" + host],
                active: ["cookies"],
                activity: { banners_vaporized: 1 },
              },
      },
      runtime: {
        sendMessage: async (message) => {
          if (options.saveFailure) return { ok: false };
          const key = "site:" + message.host;
          emit({ [key]: { ...state[key], [message.key]: message.value } });
          if (options.newerChoice) {
            emit({ [key]: { ...state[key], paused: true } });
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return { ok: true };
        },
      },
      storage: {
        local: {
          get: async () => {
            if (options.loadFailure) throw new Error("storage unavailable");
            const snapshot = structuredClone(state);
            if (options.initialRace) {
              setTimeout(
                () =>
                  emit({
                    ["site:" + host]: { ...defaults, paused: true },
                    banners_vaporized: 7,
                  }),
                30,
              );
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            return snapshot;
          },
        },
        onChanged: { addListener: (listener) => listeners.push(listener) },
      },
    };
  }, options);
  await page.route("**/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
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
  await page.goto("https://popup.fixture/popup.html");
  await page.waitForFunction(
    () =>
      !["Checking", "Loading…"].includes(
        document.querySelector("#state").textContent,
      ),
  );
  return page;
}

async function test(name, run) {
  try {
    await run();
    results.push({ name, status: "PASS" });
    console.log("PASS", name);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.stack });
    console.error("FAIL", name, error.message);
  }
}

(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  await test("Popup loading race preserves newer settings and counters", async () => {
    const p = await popup({ initialRace: true });
    assert.equal(await p.locator("#enabled").isChecked(), false);
    assert.equal(await p.locator("#state").innerText(), "Off");
    assert.equal(await p.locator("#banners").textContent(), "7");
    await p.close();
  });
  await test("Failed settings write restores the saved choice and reports the failure", async () => {
    const p = await popup({ saveFailure: true });
    await p.locator("#enabled").click();
    await p.waitForFunction(() =>
      document.querySelector("#feedback").classList.contains("error"),
    );
    assert.equal(await p.locator("#enabled").isChecked(), true);
    assert.equal(await p.locator("#state").innerText(), "On");
    assert.equal(p.errors.length, 0);
    await p.close();
  });
  await test("Late write acknowledgement cannot overwrite a newer saved OFF choice", async () => {
    const p = await popup({ newerChoice: true });
    await p.locator("#cookies").uncheck();
    await p.waitForFunction(
      () => document.querySelector("#state").textContent === "Off",
    );
    assert.equal(await p.locator("#enabled").isChecked(), false);
    await p.close();
  });
  await test("Storage failure leaves controls disabled with a useful recovery message", async () => {
    const p = await popup({ loadFailure: true });
    assert.equal(await p.locator("#enabled").isDisabled(), true);
    assert.equal(await p.locator("#share").isDisabled(), true);
    assert.match(await p.locator("#feedback").innerText(), /Reopen Bypass/);
    assert.equal(p.errors.length, 0);
    await p.close();
  });
  await test("Malformed page status fails safely without render errors or fake activity", async () => {
    const p = await popup({ malformed: true });
    assert.equal(await p.locator("#state").innerText(), "Reload tab");
    assert.match(await p.locator("#page-activity").innerText(), /Refresh/);
    assert.equal(p.errors.length, 0);
    await p.close();
  });
  await test("Page activity excludes zero counters and uses singular wording", async () => {
    const p = await popup();
    assert.equal(
      await p.locator("#page-activity").innerText(),
      "This page: 1 banner hidden.",
    );
    await p.close();
  });
  await test("Keyboard users can toggle the master and expand streaming options", async () => {
    const p = await popup();
    await p.locator("#enabled").focus();
    await p.keyboard.press("Space");
    await p.waitForFunction(
      () => document.querySelector("#state").textContent === "Off",
    );
    await p.locator("#enabled").focus();
    await p.keyboard.press("Space");
    await p.waitForFunction(
      () => document.querySelector("#state").textContent === "On",
    );
    await p.locator(".streaming-options summary").focus();
    await p.keyboard.press("Enter");
    assert.equal(await p.locator("#skipRecap").isVisible(), true);
    await p.close();
  });
  await test("Existing controls meet 24px target minimum and text can enlarge without horizontal overflow", async () => {
    const p = await popup();
    await p.locator(".streaming-options summary").click();
    const sizes = await p
      .locator("input, button, summary")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => n.checkVisibility())
          .map((n) => ({
            width: n.getBoundingClientRect().width,
            height: n.getBoundingClientRect().height,
          })),
      );
    assert.ok(sizes.every((s) => s.width >= 24 && s.height >= 24));
    await p.evaluate(() => {
      const nodes = [...document.body.querySelectorAll("*")];
      const sizes = nodes.map((n) => parseFloat(getComputedStyle(n).fontSize));
      nodes.forEach((n, i) => (n.style.fontSize = `${sizes[i] * 2}px`));
    });
    assert.equal(await p.evaluate(() => document.body.scrollWidth), 376);
    await p.close();
  });
  await test("Axe WCAG A/AA checks pass on ordinary and streaming popup states", async () => {
    const axePath =
      process.env.AXE_MODULE || require.resolve("axe-core/axe.min.js");
    let rules = 0;
    for (const host of ["example.com", "netflix.com"]) {
      const p = await popup({ host });
      await p.evaluate(() =>
        document.querySelectorAll("details").forEach((d) => (d.open = true)),
      );
      await p.addScriptTag({ path: axePath });
      const report = await p.evaluate(async () =>
        axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
          },
        }),
      );
      assert.deepEqual(
        report.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        })),
        [],
      );
      rules += report.passes.length;
      await p.close();
    }
    console.log("Axe passed rule evaluations:", rules);
  });
  await test("Unsupported browser pages clearly disable site controls", async () => {
    const p = await popup({ url: "chrome://extensions/" });
    assert.equal(await p.locator("#state").innerText(), "Unavailable");
    assert.equal(await p.locator("#enabled").isDisabled(), true);
    assert.equal(await p.locator("#streaming-controls").isVisible(), true);
    assert.equal(await p.locator("#skipIntro").isDisabled(), true);
    assert.match(
      await p.locator("#streaming-note").innerText(),
      /Netflix, Prime Video & Disney\+/,
    );
    await p.close();
  });
  fs.writeFileSync(
    path.join(__dirname, "popup-quality-results.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        environment:
          "Real headless Chromium DOM with mocked popup Chrome APIs; axe-core 4.10.3. Heuristic and automated checks, not user retention research or a complete accessibility certification.",
        results,
      },
      null,
      2,
    ),
  );
  await browser.close();
  if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
