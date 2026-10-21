"use strict";

(() => {
  const model = BypassAutopilotModel;
  const legacyKeys = {
    proConfig: "autopilotConfig",
    proRevision: "autopilotRevision",
    proUsage: "autopilotUsage",
    proProgress: "autopilotProgress",
  };
  const ready = migrateSettings();
  let queue = Promise.resolve();
  let eventTimer = 0;
  let eventBatch = [];

  async function migrateSettings() {
    const data = await chrome.storage.local.get([
      ...Object.keys(legacyKeys),
      ...Object.values(legacyKeys),
    ]);
    const changes = {};
    for (const [oldKey, newKey] of Object.entries(legacyKeys)) {
      if (data[newKey] === undefined && data[oldKey] !== undefined)
        changes[newKey] = data[oldKey];
    }
    if (Object.keys(changes).length) await chrome.storage.local.set(changes);
    await chrome.storage.local.remove([
      ...Object.keys(legacyKeys),
      "proLicense",
    ]);
  }

  function serialize(task) {
    const result = queue.then(() => ready).then(task);
    queue = result.catch(() => {});
    return result;
  }

  const count = (value) =>
    Number.isFinite(value) && value >= 0
      ? Math.min(Number.MAX_SAFE_INTEGER, value)
      : 0;

  async function snapshot() {
    const data = await chrome.storage.local.get([
      "autopilotConfig",
      "autopilotUsage",
      "autopilotProgress",
      "autopilotRevision",
    ]);
    const config = model.normalize(data.autopilotConfig);
    const progress = Object.fromEntries(
      ["hidden", "skipAttempts", "focusSeconds"].map((key) => [
        key,
        count(data.autopilotProgress?.[key]),
      ]),
    );
    const usage =
      data.autopilotUsage?.day === model.dayKey()
        ? data.autopilotUsage.hosts
        : null;
    return {
      config,
      revision: Number.isSafeInteger(data.autopilotRevision)
        ? data.autopilotRevision
        : 0,
      mode: model.effectiveMode(config),
      usage: Object.fromEntries(
        Object.entries(usage && typeof usage === "object" ? usage : {}).map(
          ([host, seconds]) => [host, count(seconds)],
        ),
      ),
      progress,
    };
  }

  async function broadcast() {
    const state = await snapshot();
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) =>
        chrome.tabs
          .sendMessage(tab.id, { type: "autopilot-state", state })
          .catch(() => {}),
      ),
    );
  }

  function recordEvent(message, respond) {
    if (!["hidden", "skipAttempts"].includes(message.key)) return;
    eventBatch.push({ key: message.key, respond });
    if (!eventTimer)
      eventTimer = setTimeout(() => {
        const entries = eventBatch;
        eventBatch = [];
        eventTimer = 0;
        void serialize(async () => {
          const state = await snapshot();
          for (const entry of entries)
            state.progress[entry.key] = Math.min(
              Number.MAX_SAFE_INTEGER,
              state.progress[entry.key] + 1,
            );
          await chrome.storage.local.set({ autopilotProgress: state.progress });
        }).then(
          () => entries.forEach((entry) => entry.respond({ ok: true })),
          () => entries.forEach((entry) => entry.respond({ ok: false })),
        );
      }, 25);
    return true;
  }

  async function recordUsage(message, sender, state) {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const window = tab && (await chrome.windows.get(tab.windowId));
    if (
      !tab ||
      tab.id !== sender.tab.id ||
      !window?.focused ||
      message.visible !== true
    )
      return { ok: true };
    const hostname = new URL(sender.url).hostname;
    const now = Date.now();
    const { autopilotTick: previous } =
      await chrome.storage.session.get("autopilotTick");
    await chrome.storage.session.set({
      autopilotTick: { tab: tab.id, host: hostname, at: now },
    });
    const seconds =
      previous?.tab === tab.id && previous.host === hostname
        ? Math.max(0, Math.min(20, (now - previous.at) / 1000))
        : 0;
    if (state.config.limits.some((limit) => limit.host === hostname))
      state.usage[hostname] = count((state.usage[hostname] || 0) + seconds);
    if (["study", "work"].includes(state.mode))
      state.progress.focusSeconds = count(
        state.progress.focusSeconds + seconds,
      );
    await chrome.storage.local.set({
      autopilotUsage: { day: model.dayKey(), hosts: state.usage },
      autopilotProgress: state.progress,
    });
    return snapshot();
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      !message?.type?.startsWith("autopilot-")
    )
      return;
    const internal = sender.url?.startsWith(chrome.runtime.getURL("ui/"));
    const content =
      !!sender.tab && sender.frameId === 0 && /^https?:/.test(sender.url || "");
    if (!internal && !content) return;
    const allowed = internal
      ? ["autopilot-get", "autopilot-save"]
      : [
          "autopilot-get",
          "autopilot-tick",
          "autopilot-event",
          "autopilot-add-rule",
        ];
    if (!allowed.includes(message.type)) return;
    if (message.type === "autopilot-event")
      return recordEvent(message, respond);

    const operation = serialize(async () => {
      const state = await snapshot();
      if (message.type === "autopilot-get") return state;
      if (message.type === "autopilot-tick")
        return recordUsage(message, sender, state);
      if (message.type === "autopilot-save") {
        if (message.revision !== state.revision)
          throw Error(
            "Settings changed in another window. Controls were refreshed; try again.",
          );
        const config = model.validate(message.config);
        await chrome.storage.local.set({
          autopilotConfig: config,
          autopilotRevision: state.revision + 1,
        });
      } else if (message.type === "autopilot-add-rule") {
        const rule = { ...message.rule, host: new URL(sender.url).hostname };
        if (
          !state.config.rules.some(
            (existing) =>
              existing.host === rule.host &&
              existing.selector === rule.selector &&
              existing.kind === rule.kind,
          )
        ) {
          const config = model.validate({
            ...state.config,
            rules: [...state.config.rules, rule],
          });
          await chrome.storage.local.set({
            autopilotConfig: config,
            autopilotRevision: state.revision + 1,
          });
        }
      }
      await broadcast();
      return snapshot();
    });
    operation.then(
      (state) => respond({ ok: true, state }),
      (error) =>
        respond({
          ok: false,
          error: error.message || "Could not save. Try again.",
        }),
    );
    return true;
  });

  async function ensureAlarm() {
    if (!(await chrome.alarms.get("autopilot-reconcile")))
      await chrome.alarms.create("autopilot-reconcile", { periodInMinutes: 1 });
  }
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "autopilot-reconcile")
      void serialize(broadcast).catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => {
    void ensureAlarm().catch(() => {});
    void serialize(broadcast).catch(() => {});
  });
  chrome.runtime.onInstalled.addListener(() => {
    void ensureAlarm().catch(() => {});
    void chrome.alarms.clear("billing-refresh");
    void chrome.alarms.clear("pro-reconcile");
    indexedDB.deleteDatabase("bypass-account");
  });
  void ready.catch(() => {});
  void ensureAlarm().catch(() => {});
})();
