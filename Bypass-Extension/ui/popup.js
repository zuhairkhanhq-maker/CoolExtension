'use strict';

const $ = (id) => document.getElementById(id);
const defaults = Object.freeze({
  paused: false,
  cookies: true,
  video: true,
  skipIntro: false,
  skipRecap: false,
  autoNext: false,
});
const counterElements = Object.freeze({
  banners_vaporized: 'banners',
  ads_skipped: 'ads',
  consent_actions: 'consent',
  distractions_hidden: 'distractions',
  streaming_clicks: 'streaming-count',
});
const formatter = new Intl.NumberFormat();
const initialChanges = Object.create(null);
const metrics = Object.fromEntries(Object.keys(counterElements).map((key) => [key, 0]));
let tabId = null;
let host = '';
let current = { ...defaults };
let pageStatus = null;
let pendingSetting = null;
let settingsRevision = 0;
let ready = false;
let loadFailed = false;
let polling = false;

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function setText(id, text) {
  if ($(id).textContent !== text) $(id).textContent = text;
}

function feedback(text, error = false) {
  setText('feedback', text);
  $('feedback').classList.toggle('error', error);
}

function normalize(data) {
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [
      key,
      typeof data?.[key] === 'boolean' ? data[key] : defaults[key],
    ])
  );
}

function pageActivity() {
  const descriptions = [
    ['banners_vaporized', 'banner hidden', 'banners hidden'],
    ['distractions_hidden', 'other distraction cleared', 'other distractions cleared'],
    ['ads_skipped', 'ad break assisted', 'ad breaks assisted'],
    ['streaming_clicks', 'streaming click attempted', 'streaming clicks attempted'],
  ];
  const parts = descriptions.flatMap(([key, singular, plural]) => {
    const count = integer(pageStatus?.activity?.[key]);
    return count ? [`${formatter.format(count)} ${count === 1 ? singular : plural}`] : [];
  });
  return parts.length
    ? `This page: ${parts.join(' · ')}.`
    : 'Ready. Nothing cleared on this page yet.';
}

function render() {
  for (const [key, id] of Object.entries(counterElements))
    setText(id, formatter.format(metrics[key]));
  const youtube = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host);
  const streaming = globalThis.BypassStreaming?.site(host);
  const streamKeys = globalThis.BypassStreaming?.keys || [];
  const choices = pendingSetting
    ? { ...current, [pendingSetting.key]: pendingSetting.value }
    : current;
  const enabled = !choices.paused;
  const busy = !!pendingSetting;
  const blocked = !ready || busy || !host;

  $('streaming-preview').hidden = !!streaming;
  $('streaming-options').hidden = !streaming;
  $('video').closest('label').hidden = !!streaming;
  $('enabled').checked = ready && enabled;
  $('enabled').disabled = blocked;
  for (const key of ['cookies', 'video', ...streamKeys]) {
    const supported = key === 'video' ? youtube : streamKeys.includes(key) ? !!streaming : true;
    $(key).checked = ready && enabled && supported && choices[key];
    $(key).disabled = blocked || !enabled || !supported;
  }

  setText(
    'master-note',
    enabled ? 'Your choices below run automatically' : 'Off here. Your choices are saved.'
  );
  setText(
    'cookie-note',
    enabled
      ? 'Cookie banners, newsletter popups and other clutter'
      : 'Turn on Bypass above to use this'
  );
  setText(
    'video-note',
    !youtube
      ? 'Available on YouTube only'
      : !enabled
        ? 'Turn on Bypass above to use this'
        : 'Speeds up ads · Auto-clicks Skip Ad when available'
  );
  setText(
    'streaming-note',
    !streaming
      ? 'Netflix, Prime Video & Disney+ · Open one to turn this on'
      : !enabled
        ? 'Turn on Bypass above to use this'
        : `Ready on ${streaming.name} · supported players only`
  );

  const selected =
    choices.cookies ||
    (youtube && choices.video) ||
    (streaming && streamKeys.some((key) => choices[key]));
  const state = loadFailed
    ? 'Unavailable'
    : !ready
      ? 'Loading…'
      : busy
        ? 'Saving…'
        : !host
          ? 'Unavailable'
          : !enabled
            ? 'Off'
            : !pageStatus
              ? 'Reload tab'
              : !selected
                ? 'No features on'
                : 'On';
  setText('state', state);
  $('state').dataset.state = state === 'On' ? 'on' : state === 'Off' ? 'off' : 'notice';
  setText(
    'page-activity',
    loadFailed
      ? 'Reopen Bypass to try again.'
      : !ready
        ? 'Loading your saved choices…'
        : !host
          ? 'Open a regular website to use Bypass.'
          : !enabled
            ? 'Bypass is not changing this website.'
            : !pageStatus
              ? 'Refresh this webpage once to connect Bypass.'
              : !selected
                ? 'Choose a feature below to start.'
                : pageActivity()
  );
  $('share').disabled = !ready;
}

async function refreshPage() {
  if (!host || tabId == null) return;
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'page-status' }, { frameId: 0 });
    pageStatus =
      response && response.activity && response.settings && Array.isArray(response.active)
        ? response
        : null;
  } catch {
    pageStatus = null;
  }
}

async function init() {
  render();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    const url = new URL(tab?.url || 'about:blank');
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      url.hostname !== 'chromewebstore.google.com' &&
      !(url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))
    )
      host = url.hostname;
    setText('host', host || 'Open a regular website');
    const data = await chrome.storage.local.get([
      ...Object.keys(metrics),
      ...(host ? [`site:${host}`] : []),
    ]);
    await refreshPage();
    Object.assign(data, initialChanges);
    for (const key of Object.keys(metrics)) metrics[key] = integer(data[key]);
    current = normalize(data[`site:${host}`]);
    for (const key of Object.keys(initialChanges)) delete initialChanges[key];
    ready = true;
    if (!host) feedback('Bypass cannot run on this browser page.');
  } catch {
    loadFailed = true;
    feedback('Could not load settings. Reopen Bypass to try again.', true);
  }
  render();
}

for (const key of Object.keys(defaults)) {
  const control = $(key === 'paused' ? 'enabled' : key);
  control.addEventListener('change', async () => {
    if (!ready || pendingSetting || !host || control.disabled) return;
    const value = key === 'paused' ? !control.checked : control.checked;
    const revision = settingsRevision;
    pendingSetting = { key, value };
    render();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'setting', host, key, value });
      if (!result?.ok) throw new Error('setting-write');
      if (revision === settingsRevision) current[key] = value;
      feedback(
        current.paused
          ? 'Off on this site. Your choices are saved.'
          : 'Saved. Bypass works with this popup closed.'
      );
    } catch {
      feedback('Could not save. Your saved choice is unchanged.', true);
    } finally {
      pendingSetting = null;
      render();
    }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!ready) {
    for (const [key, change] of Object.entries(changes)) {
      if (
        Object.hasOwn(metrics, key) ||
        key === `site:${host}` ||
        (!host && key.startsWith('site:') && Object.keys(initialChanges).length < 32)
      )
        initialChanges[key] = change.newValue;
    }
    return;
  }
  let changed = false;
  for (const key of Object.keys(metrics))
    if (changes[key]) {
      metrics[key] = integer(changes[key].newValue);
      changed = true;
    }
  if (changes[`site:${host}`]) {
    current = normalize(changes[`site:${host}`].newValue);
    settingsRevision++;
    changed = true;
  }
  if (changed) render();
});

$('share').addEventListener('click', async () => {
  if (!ready) return;
  const text = `My Bypass activity on this device: ${metrics.banners_vaporized} banners hidden, ${metrics.ads_skipped} ad breaks assisted, ${metrics.distractions_hidden} other distractions cleared, ${metrics.streaming_clicks} streaming clicks attempted. Local-only browser cleanup. No tracking.`;
  try {
    await navigator.clipboard.writeText(text);
    feedback('Activity copied. Share it wherever you like.');
  } catch {
    feedback('Could not copy. Please try again.', true);
  }
});

const workspaceTabs = [...document.querySelectorAll('.workspace-tab')];
let paywallReturnFocus = null;

function showWorkspace(name) {
  for (const tab of workspaceTabs) {
    const selected = tab.dataset.panel === name;
    tab.setAttribute('aria-selected', String(selected));
    $(`${tab.dataset.panel}-panel`).hidden = !selected;
  }
}

for (const tab of workspaceTabs) {
  tab.addEventListener('click', () => showWorkspace(tab.dataset.panel));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = workspaceTabs.find((candidate) => candidate !== tab);
    next.focus();
    showWorkspace(next.dataset.panel);
  });
}

function openPaywall(source) {
  paywallReturnFocus = document.activeElement;
  setText('checkout-note', 'Design preview only. Pro access and billing are not connected yet.');
  $('pro-dialog').dataset.source = source;
  $('pro-dialog').showModal();
  $('close-paywall').focus();
}

function closePaywall() {
  $('pro-dialog').close();
  paywallReturnFocus?.focus();
  paywallReturnFocus = null;
}

for (const trigger of document.querySelectorAll('.pro-trigger'))
  trigger.addEventListener('click', () => openPaywall(trigger.dataset.proSource || 'Bypass Pro'));

$('close-paywall').addEventListener('click', closePaywall);
$('pro-dialog').addEventListener('click', (event) => {
  if (event.target === $('pro-dialog')) closePaywall();
});
$('pro-dialog').addEventListener('close', () => {
  paywallReturnFocus?.focus();
  paywallReturnFocus = null;
});

for (const option of document.querySelectorAll('.plan-option')) {
  option.addEventListener('click', () => {
    for (const candidate of document.querySelectorAll('.plan-option')) {
      const selected = candidate === option;
      candidate.classList.toggle('selected', selected);
      candidate.setAttribute('aria-checked', String(selected));
    }
  });
}

$('start-trial').addEventListener('click', () => {
  setText('checkout-note', 'Ready for the next phase: entitlement and billing are not connected yet.');
});

setInterval(async () => {
  if (!ready || polling || document.hidden) return;
  polling = true;
  try {
    await refreshPage();
    render();
  } finally {
    polling = false;
  }
}, 1000);

void init();
