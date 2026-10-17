'use strict';
(() => {
  const M = BypassProModel;
  let queue = Promise.resolve();
  let eventTimer = 0, eventBatch = [];
  const serialize = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  async function snapshot() {
    const data = await chrome.storage.local.get(['proConfig', 'proLicense', 'proUsage', 'proProgress', 'proRevision']);
    const now = Date.now();
    const config = M.normalize(data.proConfig);
    const count = value => Number.isFinite(value) && value >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, value) : 0;
    const progress = Object.fromEntries(['hidden', 'skipAttempts', 'focusSeconds'].map(key => [key, count(data.proProgress?.[key])]));
    return { config, revision: Number.isSafeInteger(data.proRevision) ? data.proRevision : 0, active: M.access(data.proLicense, now), expiresAt: data.proLicense?.startedAt ? data.proLicense.startedAt + 604800000 : null,
      trialUsed: !!data.proLicense, mode: M.effectiveMode(config),
      usage: data.proUsage?.day === M.dayKey() ? data.proUsage.hosts || {} : {}, progress, billingReady: false };
  }
  async function broadcast() {
    const state = await snapshot();
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(t => chrome.tabs.sendMessage(t.id, { type: 'pro-state', state }).catch(() => {})));
  }
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !msg?.type?.startsWith('pro-')) return;
    const internal = sender.url?.startsWith(chrome.runtime.getURL('ui/'));
    const content = !!sender.tab && sender.frameId === 0 && /^https?:/.test(sender.url || '');
    if (!internal && !content) return;
    if (!['pro-get', ...(internal ? ['pro-trial', 'pro-save'] : ['pro-tick', 'pro-event', 'pro-add-rule'])].includes(msg.type)) return;
    if (msg.type === 'pro-event') {
      if (!['hidden', 'skipAttempts'].includes(msg.key)) return;
      eventBatch.push({ key: msg.key, respond });
      if (!eventTimer) eventTimer = setTimeout(() => {
        const entries = eventBatch; eventBatch = []; eventTimer = 0;
        void serialize(async () => {
          const current = await snapshot();
          if (!current.active) throw Error('Pro is not active.');
          for (const event of entries) current.progress[event.key] = Math.min(Number.MAX_SAFE_INTEGER, current.progress[event.key] + 1);
          await chrome.storage.local.set({ proProgress: current.progress });
        }).then(() => entries.forEach(e => e.respond({ok:true})), () => entries.forEach(e => e.respond({ok:false})));
      }, 25);
      return true;
    }
    const operation = serialize(async () => {
      let state = await snapshot();
      if (msg.type === 'pro-get') return state;
      if (msg.type === 'pro-trial') {
        if (state.trialUsed) throw Error('Your trial has already been used on this installation.');
        const now = Date.now();
        await chrome.storage.local.set({ proLicense: { kind: 'local-trial', startedAt: now, lastSeen: now } });
      } else {
        if (!state.active) throw Error('Your Pro trial is not active. Free protection is still available.');
        if (msg.type === 'pro-save') {
          if (msg.revision !== state.revision) throw Error('Settings changed in another window. Controls were refreshed; try again.');
          const config = M.validate(msg.config);
          await chrome.storage.local.set({ proConfig: config, proRevision: state.revision + 1 });
        } else if (msg.type === 'pro-add-rule') {
          const hostname = new URL(sender.url).hostname;
          const rule = { ...msg.rule, host: hostname };
          const config = M.validate({ ...state.config, rules: [...state.config.rules, rule] });
          if (!state.config.rules.some(r => r.host === hostname && r.selector === rule.selector && r.kind === rule.kind)) await chrome.storage.local.set({ proConfig: config, proRevision: state.revision + 1 });
        } else if (msg.type === 'pro-tick') {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          const win = tab && await chrome.windows.get(tab.windowId);
          if (!tab || tab.id !== sender.tab.id || !win?.focused || msg.visible !== true) return { ok: true };
          const hostname = new URL(sender.url).hostname, now = Date.now();
          const session = await chrome.storage.session.get('proTick');
          const previous = session.proTick;
          await chrome.storage.session.set({ proTick: { tab: tab.id, host: hostname, at: now } });
          const seconds = previous?.tab === tab.id && previous.host === hostname ? Math.max(0, Math.min(20, (now - previous.at) / 1000)) : 0;
          const hosts = state.usage;
          if (state.config.limits.some(l => l.host === hostname)) hosts[hostname] = (hosts[hostname] || 0) + seconds;
          if (['study', 'work'].includes(state.mode)) state.progress.focusSeconds += seconds;
          const data = await chrome.storage.local.get('proLicense');
          await chrome.storage.local.set({ proUsage: { day: M.dayKey(), hosts }, proProgress: state.progress,
            proLicense: { ...data.proLicense, lastSeen: Math.max(now, data.proLicense.lastSeen) } });
          state = await snapshot();
          return state;
        }
      }
      await broadcast();
      return snapshot();
    });
    operation.then(value => respond({ ok: true, state: value }), error => respond({ ok: false, error: error.message || 'Could not save. Try again.' }));
    return true;
  });
  const ensureAlarm = async () => {
    if (!(await chrome.alarms.get('pro-reconcile'))) await chrome.alarms.create('pro-reconcile', { periodInMinutes: 1 });
  };
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'pro-reconcile') void serialize(broadcast).catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => { void ensureAlarm().catch(() => {}); void serialize(broadcast).catch(() => {}); });
  chrome.runtime.onInstalled.addListener(() => { void ensureAlarm().catch(() => {}); });
  void ensureAlarm().catch(() => {});
})();
