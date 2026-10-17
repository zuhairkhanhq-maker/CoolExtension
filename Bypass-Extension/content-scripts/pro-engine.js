(() => {
  'use strict';
  if (window.top !== window || !globalThis.Bypass) return;
  const M = BypassProModel, hostname = location.hostname;
  let state = null, unsubscribe = null, maintenance = null, hidden = new Map(), clicked = new Map();
  let panel = null, picker = null, sitePaused = false, siteSettings = {}, generation = 0, tickBusy = false;
  let deadline = 0, limitSnoozeUntil = 0;
  const send = async msg => { try { return await chrome.runtime.sendMessage(msg); } catch { return null; } };
  const protectedSelector = 'html,body,main,header,nav,footer,form,input,textarea,select,[contenteditable="true"],[role="main"],[role="navigation"]';
  const sensitive = /(^|\/)(checkout|cart|basket|buy|order|orders|payment|payments|billing|login|signin|sign-in|account|auth|oauth)(\/|$)/i;
  function safe(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected || element.matches(protectedSelector) || element.closest('form,[contenteditable="true"]')) return false;
    if (element.querySelector('main,form,input,textarea,select,[contenteditable="true"],video')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height < innerWidth * innerHeight * .7;
  }
  function restore() {
    for (const [element, previous] of hidden) {
      if (element.style.getPropertyValue('display') === 'none' && element.style.getPropertyPriority('display') === 'important') {
        if (previous.value) element.style.setProperty('display', previous.value, previous.priority);
        else element.style.removeProperty('display');
      }
    }
    hidden.clear();
  }
  function hide(element, metric = true) {
    if (hidden.size >= 512 || hidden.has(element) || !safe(element) || !element.getClientRects().length) return;
    hidden.set(element, { value: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display') });
    element.style.setProperty('display', 'none', 'important');
    if (metric) void send({ type: 'pro-event', key: 'hidden' });
  }
  function permitted() { return state?.active && Date.now() < deadline && !sitePaused && !document.hidden; }
  function isMatch(element, selector) { try { return element.matches(selector); } catch { return false; } }
  function mediaSkip(element, rule) {
    if (document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return;
    const builtInKey = { intro: 'skipIntro', recap: 'skipRecap', next: 'autoNext' }[rule.action];
    if (globalThis.BypassStreaming?.site(hostname) && siteSettings[builtInKey]) return;
    if (!element.matches('button,[role="button"]') || element.closest('form') || element.form || element.hasAttribute('form') || element.getAttribute('aria-disabled') === 'true' || element.disabled) return;
    const labels = { intro: /^(skip intro|skip opening)$/i, recap: /^skip recap$/i, next: /^(next episode|play next episode)$/i };
    const label = (element.getAttribute('aria-label') || element.textContent || '').trim();
    if (!labels[rule.action]?.test(label)) return;
    const video = [...document.querySelectorAll('video')].find(v => v.getClientRects().length && !v.paused && !v.seeking && Number.isFinite(v.duration) && v.duration > 60);
    if (!video || (rule.action === 'next' && video.duration - video.currentTime > 90)) return;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth || style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) { clicked.delete(element); return; }
    const previous = clicked.get(element);
    if (previous && previous.source === video.currentSrc && video.currentTime >= previous.time - 30) return;
    const top = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2)));
    if (!top || !(top === element || element.contains(top))) return;
    if (clicked.size >= 128) return;
    clicked.set(element, { source: video.currentSrc, time: video.currentTime });
    element.click();
    void send({ type: 'pro-event', key: 'skipAttempts' });
  }
  function scan(element) {
    if (!permitted() || !(element instanceof HTMLElement) || panel?.contains(element) || picker?.contains(element)) return;
    if (sensitive.test(location.pathname)) return;
    if (hostname === 'www.youtube.com' || hostname === 'youtube.com') {
      const mode = state.mode;
      const selector = mode === 'study'
        ? 'ytd-comments,#secondary,ytd-rich-shelf-renderer[is-shorts],ytd-reel-shelf-renderer,ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'
        : mode === 'work' ? 'ytd-reel-shelf-renderer,ytd-rich-shelf-renderer[is-shorts],ytd-browse[page-subtype="home"] ytd-rich-grid-renderer' : '';
      if (selector && isMatch(element, selector)) hide(element, false);
    }
    for (const rule of state.config.rules) {
      if (rule.host !== hostname || !isMatch(element, rule.selector)) continue;
      if (rule.kind === 'hide') hide(element); else mediaSkip(element, rule);
    }
  }
  function stop() {
    unsubscribe?.(); unsubscribe = null;
    maintenance?.(); maintenance = null;
    restore(); panel?.remove(); panel = null;
    cancelPicker();
  }
  function showLimit() {
    const limit = state?.config.limits.find(l => l.host === hostname);
    const exceeded = permitted() && limit && (state.usage[hostname] || 0) >= limit.minutes * 60 && Date.now() >= limitSnoozeUntil && !sensitive.test(location.pathname);
    if (!exceeded) { panel?.remove(); panel = null; return; }
    if (panel) return;
    panel = document.createElement('div');
    panel.dataset.bypassPro = 'limit';
    const root = panel.attachShadow({ mode: 'open' });
    const box = document.createElement('section');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Daily website limit reached');
    box.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;padding:24px;max-width:320px;background:#111827;color:#fff;border:1px solid #475569;border-radius:18px;font:16px/1.5 system-ui;box-shadow:0 12px 40px #0008';
    const title = document.createElement('strong'); title.textContent = 'Your daily website limit is reached.';
    const note = document.createElement('p'); note.textContent = `${limit.minutes} minutes today. Take a break, or continue for 10 minutes. This is a reminder, not a hard block.`;
    const button = document.createElement('button'); button.textContent = 'Continue for 10 minutes';
    button.style.cssText = 'padding:12px;border:0;border-radius:9px;cursor:pointer;font:inherit;background:#e4ff99;color:#111';
    button.addEventListener('click', () => { limitSnoozeUntil = Date.now() + 600000; panel.remove(); panel = null; });
    box.append(title, note, button); root.append(box); document.documentElement.append(panel);
  }
  function apply(next) {
    if (!next?.config) return;
    const signature = JSON.stringify([next.active, next.mode, next.config, sitePaused]);
    const changed = signature !== state?._signature;
    state = { ...next, _signature: signature }; deadline = next.expiresAt || 0;
    if (changed || (!unsubscribe && permitted())) {
      stop();
      if (permitted()) {
        unsubscribe = Bypass.subscribe(scan);
        maintenance = Bypass.maintain(() => {
          for (const [element] of hidden) if (!element.isConnected) hidden.delete(element);
          for (const [element] of clicked) if (!element.isConnected || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') clicked.delete(element);
          showLimit();
        });
      }
    }
    if (!permitted()) stop(); else showLimit();
  }
  function selectorFor(element) {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) return `#${CSS.escape(element.id)}`;
    const path = [];
    for (let node = element; node?.parentElement && path.length < 6; node = node.parentElement) {
      const siblings = [...node.parentElement.children].filter(n => n.tagName === node.tagName);
      path.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`);
      const selector = path.join(' > ');
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    return null;
  }
  function cancelPicker() {
    if (!picker) return;
    document.removeEventListener('click', picker.handler, true);
    document.removeEventListener('keydown', picker.escape, true);
    picker.remove(); picker = null;
  }
  function startPicker(kind, action) {
    if (!permitted() || sensitive.test(location.pathname)) throw Error('Enable Pro on a regular, non-sensitive page first.');
    cancelPicker();
    picker = document.createElement('div');
    picker.textContent = kind === 'hide' ? 'Bypass: click one distraction to hide it. Esc cancels.' : 'Bypass: click a Skip Intro / Skip Recap / Next Episode button. Esc cancels.';
    picker.style.cssText = 'position:fixed;top:12px;left:12px;padding:14px;background:#111827;color:#fff;z-index:2147483647;border:1px solid #a3e635;border-radius:12px;font:14px system-ui';
    picker.escape = event => { if (event.key === 'Escape') cancelPicker(); };
    picker.handler = async event => {
      if (!event.isTrusted || picker?.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const element = kind === 'skip' ? event.target.closest('button,[role="button"]') : event.target;
      if (!safe(element)) { picker.textContent = 'Choose a smaller distraction. Forms, navigation and players are protected. Esc cancels.'; return; }
      const selector = selectorFor(element);
      if (!selector) { picker.textContent = 'This element cannot be selected safely. Choose another.'; return; }
      if (!confirm(kind === 'hide' ? 'Hide this element on this website? You can restore it in Autopilot.' : `Automatically attempt ${action} only when this selected button has a recognized media label?`)) return;
      const response = await send({ type: 'pro-add-rule', rule: { kind, action, selector } });
      if (!response?.ok) { if (picker) picker.textContent = response?.error || 'Could not save. Try again.'; return; }
      cancelPicker(); apply(response.state);
    };
    document.documentElement.append(picker);
    document.addEventListener('click', picker.handler, true);
    document.addEventListener('keydown', picker.escape, true);
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'pro-state') apply(message.state);
    if (message.type === 'pro-pick') {
      try { startPicker(message.kind === 'skip' ? 'skip' : 'hide', ['intro', 'recap', 'next'].includes(message.action) ? message.action : 'intro'); respond({ ok: true }); }
      catch (error) { respond({ ok: false, error: error.message }); }
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[`site:${hostname}`]) { siteSettings = changes[`site:${hostname}`].newValue || {}; sitePaused = siteSettings.paused === true; if (state) apply(state); }
  });
  document.addEventListener('click', event => {
    if (!event.isTrusted || !state?.active) return;
    const element = event.target instanceof Element ? event.target.closest('button,[role="button"]') : null;
    if (!element || !state.config.rules.some(r => r.host === hostname && r.kind === 'skip' && isMatch(element, r.selector))) return;
    const video = [...document.querySelectorAll('video')].find(v => !v.paused);
    if (video && clicked.size < 128) clicked.set(element, { source: video.currentSrc, time: video.currentTime });
  }, true);
  async function refresh() {
    const ticket = ++generation;
    const response = await send({ type: 'pro-get' });
    if (ticket === generation && response?.ok) apply(response.state);
  }
  async function tick() {
    if (tickBusy || !permitted()) return;
    tickBusy = true;
    try { const response = await send({ type: 'pro-tick', visible: true }); if (response?.ok && response.state?.config) apply(response.state); }
    finally { tickBusy = false; }
  }
  let interval = 0;
  function resume() { clearInterval(interval); if (!document.hidden) { void refresh(); interval = setInterval(() => { if (Date.now() >= deadline) void refresh(); else void tick(); }, 15000); } else stop(); }
  document.addEventListener('visibilitychange', resume);
  addEventListener('pagehide', () => { clearInterval(interval); stop(); generation++; });
  addEventListener('pageshow', resume);
  chrome.storage.local.get(`site:${hostname}`).then(data => { siteSettings = data[`site:${hostname}`] || {}; sitePaused = siteSettings.paused === true; resume(); }).catch(() => {});
})();
