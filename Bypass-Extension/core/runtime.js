(() => {
  'use strict';
  if (globalThis.Bypass) return;
  const siteKey = `site:${location.hostname}`;
  const defaults = Object.freeze({
    paused: false,
    cookies: true,
    video: true,
    skipIntro: false,
    skipRecap: false,
    autoNext: false,
  });
  const engines = new Map();
  const active = new Map();
  const listeners = new Set();
  const roots = new Map();
  const pending = new Map();
  let streamingSignature = '',
    settings = null,
    settingsRevision = 0,
    suspended = false,
    stopped = false;
  let timer = 0,
    audit = 0,
    walker = null,
    walkRoot = null;
  const activity = {
    banners_vaporized: 0,
    consent_actions: 0,
    ads_skipped: 0,
    distractions_hidden: 0,
    streaming_clicks: 0,
  };
  const maintenance = new Set();
  const diagnostics = { adActive: false, videoPlayers: 0 };
  chrome.runtime.onMessage?.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'page-status') return;
    respond({
      activity: { ...activity },
      settings,
      active: [...active.keys()],
      diagnostics: { ...diagnostics },
    });
  });

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          resolve(error ? null : response);
        });
      } catch {
        resolve(null);
      }
    });
  }
  async function metric(key) {
    if (!Object.hasOwn(activity, key)) return;
    activity[key] = Math.min(Number.MAX_SAFE_INTEGER, activity[key] + 1);
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const message = { type: 'metric', key, id };
    const result = await send(message);
    if (!result?.ok && !stopped) {
      setTimeout(() => {
        if (!stopped) void send(message);
      }, 1000);
    }
  }
  function enqueue(node, deep = true) {
    if (!listeners.size || suspended || stopped || !node) return;
    if (pending.size >= 256) {
      pending.clear();
      pending.set(document, true);
    } else {
      let parent = node;
      for (let depth = 0; parent && depth < 32; depth++) {
        if (pending.get(parent) === true) return;
        parent = parent.parentNode;
      }
      pending.set(node, deep || pending.get(node) === true);
    }
    if (!timer) timer = setTimeout(scan, 150);
  }
  function observe(root) {
    if (roots.has(root)) return;
    const observer = new MutationObserver((records) => {
      if (records.length > 128) {
        enqueue(root);
        return;
      }
      let added = 0;
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          record.attributeName === 'style' &&
          record.target.getAttribute('data-bypass-hidden') === '1' &&
          record.target.style.getPropertyValue('display') === 'none'
        )
          continue;
        enqueue(record.target, record.type === 'attributes');
        for (const node of record.addedNodes || []) {
          if (++added > 128) {
            enqueue(root);
            return;
          }
          if (node.nodeType === 1) enqueue(node);
        }
      }
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['id', 'class', 'hidden', 'aria-hidden', 'inert', 'style', 'open'],
    });
    roots.set(root, observer);
  }
  function visit(element) {
    if (!(element instanceof Element)) return;
    if (element.shadowRoot && !roots.has(element.shadowRoot)) {
      observe(element.shadowRoot);
      enqueue(element.shadowRoot);
    }
    for (const listener of listeners) {
      try {
        listener(element);
      } catch {}
    }
  }
  function scan() {
    timer = 0;
    if (suspended || stopped || !listeners.size) return;
    const until = performance.now() + 2;
    let budget = 100;
    while (budget-- > 0 && performance.now() < until) {
      if (!walker) {
        const next = pending.entries().next();
        if (next.done) break;
        const [node, deep] = next.value;
        pending.delete(node);
        if (node !== document && !node.isConnected) continue;
        if (deep) {
          walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
          walkRoot = node;
        }
        visit(node);
        continue;
      }
      if (walkRoot !== document && !walkRoot.isConnected) {
        walker = null;
        walkRoot = null;
        continue;
      }
      const node = walker.nextNode();
      if (node) visit(node);
      else {
        walker = null;
        walkRoot = null;
      }
    }
    if (walker || pending.size) timer = setTimeout(scan, 16);
  }
  function stopDiscovery() {
    clearTimeout(timer);
    clearInterval(audit);
    timer = audit = 0;
    for (const observer of roots.values()) observer.disconnect();
    roots.clear();
    pending.clear();
    walker = walkRoot = null;
  }
  function subscribe(listener) {
    listeners.add(listener);
    if (listeners.size === 1) {
      observe(document);

      audit = setInterval(() => {
        for (const callback of maintenance) {
          try {
            callback();
          } catch {}
        }
        if (document.hidden || walker || pending.size) return;
        for (const [root, observer] of roots) {
          if (root instanceof ShadowRoot && !root.host.isConnected) {
            observer.disconnect();
            roots.delete(root);
          }
        }
        enqueue(document);
      }, 15000);
    }
    enqueue(document);
    clearTimeout(timer);
    timer = setTimeout(scan, 0);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) stopDiscovery();
    };
  }
  function reconcile() {
    const streamKeys = globalThis.BypassStreaming?.keys || [];
    const signature = streamKeys.map((k) => !!settings?.[k]).join(',');
    for (const [name, factory] of engines) {
      const featureOn =
        name === 'streaming'
          ? streamKeys.some((k) => settings?.[k])
          : settings?.[name === 'distractions' ? 'cookies' : name];
      const enabled = settings && !settings.paused && featureOn && !suspended && !stopped;
      if (name === 'streaming' && active.has(name) && signature !== streamingSignature) {
        try {
          active.get(name)();
        } catch {}
        active.delete(name);
      }
      if (name === 'streaming') streamingSignature = signature;
      if (!enabled && active.has(name)) {
        try {
          active.get(name)();
        } catch {}
        active.delete(name);
      } else if (enabled && !active.has(name)) {
        try {
          active.set(name, factory({ ...settings }) || (() => {}));
        } catch {}
      }
    }
  }
  function normalize(value) {
    return Object.fromEntries(
      Object.keys(defaults).map((key) => [
        key,
        typeof value?.[key] === 'boolean' ? value[key] : defaults[key],
      ])
    );
  }
  globalThis.Bypass = Object.freeze({
    subscribe,
    metric,
    maintain(callback) {
      maintenance.add(callback);
      return () => maintenance.delete(callback);
    },
    diagnostic(values) {
      Object.assign(diagnostics, values);
    },
    register(name, factory) {
      engines.set(name, factory);
      reconcile();
    },
    composedParent(element) {
      return (
        element.parentElement ||
        (element.getRootNode() instanceof ShadowRoot ? element.getRootNode().host : null)
      );
    },
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[siteKey]) {
      settingsRevision++;
      settings = normalize(changes[siteKey].newValue);
      reconcile();
    }
  });
  try {
    const revision = settingsRevision;
    chrome.storage.local.get(siteKey, (value) => {
      if (chrome.runtime.lastError || revision !== settingsRevision) return;
      settings = normalize(value[siteKey]);
      reconcile();
    });
  } catch {}
  addEventListener('pagehide', (event) => {
    suspended = true;
    if (!event.persisted) stopped = true;
    reconcile();
    stopDiscovery();
  });
  addEventListener('pageshow', (event) => {
    if (event.persisted && !stopped) {
      suspended = false;
      reconcile();
    }
  });
})();
