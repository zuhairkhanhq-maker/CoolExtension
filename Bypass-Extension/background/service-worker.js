"use strict";

if (typeof importScripts === "function") {
  importScripts("../core/autopilot-model.js", "autopilot-worker.js");
}

let writes = Promise.resolve();
const counters = new Set([
  "banners_vaporized",
  "consent_actions",
  "ads_skipped",
  "distractions_hidden",
  "streaming_clicks",
]);
const integer = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;
let batch = [],
  batchTimer = 0;
function flushMetrics() {
  clearTimeout(batchTimer);
  batchTimer = 0;
  const entries = batch;
  batch = [];
  if (!entries.length) return;
  const write = writes.then(async () => {
    const data = await chrome.storage.local.get([...counters, "recent_events"]);
    const recent = Array.isArray(data.recent_events)
      ? data.recent_events.slice(-512)
      : [];
    const seen = new Set(recent),
      changes = {};
    for (const { message } of entries) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      recent.push(message.id);
      changes[message.key] = Math.min(
        Number.MAX_SAFE_INTEGER,
        integer(changes[message.key] ?? data[message.key]) + 1,
      );
    }
    if (Object.keys(changes).length)
      await chrome.storage.local.set({
        ...changes,
        recent_events: recent.slice(-512),
      });
  });
  writes = write.catch(() => {});
  void write.then(
    () => {
      for (const e of entries) e.respond({ ok: true });
    },
    () => {
      for (const e of entries) e.respond({ ok: false });
    },
  );
}
const defaults = {
  paused: false,
  cookies: true,
  video: true,
  skipIntro: false,
  skipRecap: false,
  autoNext: false,
};
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const internal = sender.url?.startsWith(chrome.runtime.getURL("ui/"));
  const metric =
    message?.type === "metric" &&
    sender.tab &&
    counters.has(message.key) &&
    typeof message.id === "string" &&
    /^[0-9a-f-]{36}$/i.test(message.id);
  const setting =
    message?.type === "setting" &&
    internal &&
    typeof message.host === "string" &&
    /^[a-z0-9.:[\]-]{1,253}$/i.test(message.host) &&
    Object.hasOwn(defaults, message.key) &&
    typeof message.value === "boolean";
  if (!metric && !setting) return;
  if (metric) {
    batch.push({ message, respond });
    if (batch.length >= 128) flushMetrics();
    else if (!batchTimer) batchTimer = setTimeout(flushMetrics, 25);
    return true;
  }
  flushMetrics();
  const operation = writes.then(async () => {
    const key = `site:${message.host}`;
    const data = await chrome.storage.local.get(key);
    const current = Object.fromEntries(
      Object.keys(defaults).map((k) => [
        k,
        typeof data[key]?.[k] === "boolean" ? data[key][k] : defaults[k],
      ]),
    );
    await chrome.storage.local.set({
      [key]: { ...current, [message.key]: message.value },
    });
  });
  writes = operation.catch(() => {});
  void operation.then(
    () => respond({ ok: true }),
    () => respond({ ok: false }),
  );
  return true;
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local
    .get("installedAt")
    .then((data) => {
      if (!data.installedAt)
        return chrome.storage.local.set({ installedAt: Date.now() });
    })
    .catch(() => {});
});
