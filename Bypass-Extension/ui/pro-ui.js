'use strict';
(() => {
  const root = document.getElementById('autopilot-panel');
  root.innerHTML = `
    <section class="hero compact-hero"><p class="eyebrow">PERSONAL INTERNET AUTOPILOT · ALPHA</p><h1>Your internet, your rules.</h1><p class="sub">Private controls. Saved on this device. Free protection stays free.</p></section>
    <section class="site"><h2 id="pro-status">Checking Pro…</h2><p id="pro-expires" class="fine"></p>
      <button id="pro-trial" class="primary-button" type="button">Start my 7-day local trial</button>
      <p class="fine">No card. No automatic charge. Trial access is local to this installation; paid billing is not connected in this alpha.</p>
      <button id="pro-manage" class="secondary-button" type="button">Open controls in a full tab</button>
    </section>
    <fieldset id="pro-controls" disabled>
      <section class="site"><h2>Choose a mode</h2><p class="fine">Study hides YouTube feeds, Shorts, recommendations and comments. Work hides feeds and Shorts. Relax restores them. Other sites use your personal rules. Schedules override this choice while active.</p>
        <div class="mode-row" role="group" aria-label="Browsing mode"><button type="button" data-mode="off">Off</button><button type="button" data-mode="study">Study</button><button type="button" data-mode="work">Work</button><button type="button" data-mode="relax">Relax</button></div>
        <p id="pro-mode-status" role="status" class="fine"></p>
      </section>
      <section class="site"><h2>Personal website cleanup</h2><p class="fine">Select one distraction on the current website. Main content, forms, navigation and video players are protected. Some large elements cannot be hidden.</p>
        <button id="pro-pick-hide" class="primary-button" type="button">Choose something to hide</button>
        <details><summary>Custom media button</summary><p class="fine">Select a visible player button. Only matching English Skip Intro, Skip Recap or Next Episode labels can be attempted. No guaranteed support across every player.</p><label class="pro-field">Action<select id="pro-action"><option value="intro">Skip intro</option><option value="recap">Skip recap</option><option value="next">Next episode</option></select></label><button id="pro-pick-skip" class="secondary-button" type="button">Choose a media button</button></details>
        <ul id="pro-rules" class="pro-list"></ul>
      </section>
      <section class="site"><h2>Automatic schedules</h2><p class="fine">Uses this computer’s local clock. Overnight schedules are supported. Last matching schedule wins. Outside a schedule your manual mode returns.</p>
        <form id="pro-schedule-form"><label class="pro-field">Mode<select id="pro-schedule-mode"><option value="study">Study</option><option value="work">Work</option><option value="relax">Relax</option></select></label><label class="pro-field">Days<select id="pro-days"><option value="weekdays">Monday–Friday</option><option value="daily">Every day</option><option value="weekend">Saturday–Sunday</option></select></label><div class="pro-grid"><label class="pro-field">Start<input id="pro-start" type="time" value="09:00" required></label><label class="pro-field">End<input id="pro-end" type="time" value="17:00" required></label></div><button class="secondary-button" type="submit">Add schedule</button></form>
        <ul id="pro-schedules" class="pro-list"></ul>
      </section>
      <section class="site"><h2>Daily website limits</h2><p class="fine">Counts approximate foreground use, not background tabs. Resets at local midnight. Shows a reminder with a 10-minute continue option; never blocks checkout.</p>
        <form id="pro-limit-form"><label class="pro-field">Exact website hostname<input id="pro-limit-host" placeholder="www.youtube.com" maxlength="253" required></label><label class="pro-field">Minutes per day<input id="pro-limit-minutes" type="number" value="30" min="1" max="1440" required></label><button class="secondary-button" type="submit">Save daily limit</button></form><ul id="pro-limits" class="pro-list"></ul>
      </section>
    </fieldset>
    <section class="site"><h2>Private progress</h2><p id="pro-progress" class="fine">No Pro activity yet.</p><p class="fine">Focus time is approximate foreground time in Study or Work. It is not a claim of time saved. Activity stays on this device.</p></section>
    <p id="pro-feedback" role="status" aria-live="polite"></p>`;
  const $ = id => document.getElementById(id);
  let state = null, busy = false;
  const tell = (text, error = false) => { $('pro-feedback').textContent = text; $('pro-feedback').classList.toggle('error', error); };
  async function request(type, values = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...values });
    if (!result?.ok) throw Error(result?.error || 'Could not connect. Reload the extension and try again.');
    return result.state;
  }
  function item(list, text, remove) {
    const li = document.createElement('li'), label = document.createElement('span'), button = document.createElement('button');
    label.textContent = text; button.textContent = 'Remove'; button.type = 'button'; button.setAttribute('aria-label', `Remove ${text}`);
    button.addEventListener('click', () => void run(remove)); li.append(label, button); $(list).append(li);
  }
  const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  function render() {
    if (!state) return;
    $('pro-status').textContent = state.active ? 'Pro trial is active' : state.trialUsed ? 'Trial ended · Free protection is still on' : 'Try Pro on your own websites';
    $('pro-expires').textContent = state.expiresAt ? `Trial ends ${new Date(state.expiresAt).toLocaleString()}.` : 'Explore the working Pro controls for 7 days.';
    $('pro-trial').hidden = state.trialUsed;
    $('pro-controls').disabled = busy || !state.active;
    $('pro-trial').disabled = busy;
    $('pro-mode-status').textContent = `Active mode: ${state.active ? state.mode : 'off'}. Personal rules run in all modes while Pro is active; site pause stops everything.`;
    for (const button of root.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(state.config.mode === button.dataset.mode));
    for (const id of ['pro-rules', 'pro-schedules', 'pro-limits']) $(id).replaceChildren();
    state.config.rules.forEach((rule, index) => item('pro-rules', `${rule.host} · ${rule.kind === 'hide' ? 'Hide' : rule.action} · ${rule.selector}`, () => save({ rules: state.config.rules.filter((_, i) => i !== index) }, 'Rule removed. Its elements are restored.')));
    state.config.schedules.forEach((s, index) => item('pro-schedules', `${s.mode} · ${time(s.start)}–${time(s.end)} · ${s.days.length === 7 ? 'Every day' : s.days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}`, () => save({ schedules: state.config.schedules.filter((_, i) => i !== index) }, 'Schedule removed.')));
    state.config.limits.forEach((l, index) => item('pro-limits', `${l.host} · ${l.minutes} min/day · ${Math.floor((state.usage[l.host] || 0) / 60)} min today`, () => save({ limits: state.config.limits.filter((_, i) => i !== index) }, 'Limit removed.')));
    if (!state.config.rules.length) $('pro-rules').textContent = 'No personal rules yet.';
    $('pro-progress').textContent = `${state.progress.hidden || 0} personal distractions hidden · ${state.progress.skipAttempts || 0} media clicks attempted · ${Math.floor((state.progress.focusSeconds || 0) / 60)} focus minutes.`;
    document.querySelector('footer span:nth-child(2)').textContent = state.active ? 'Plan: Pro trial' : 'Plan: Free';
    document.querySelector('footer span:last-child').textContent = 'V0.7.0 alpha';
  }
  async function run(task) {
    if (busy) return;
    busy = true; render();
    try { await task(); } catch (error) { tell(error.message, true); try { state = await request('pro-get'); } catch {} }
    finally { busy = false; render(); }
  }
  async function save(change, message = 'Saved. Changes apply automatically.') {
    state = await request('pro-save', { config: { ...state.config, ...change }, revision: state.revision }); tell(message);
  }
  $('pro-trial').addEventListener('click', () => void run(async () => { state = await request('pro-trial'); tell('Trial started. Choose a mode or personalize a website.'); }));
  for (const button of root.querySelectorAll('[data-mode]')) button.addEventListener('click', () => void run(() => save({ mode: button.dataset.mode })));
  $('pro-manage').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('ui/popup.html?pro=1') }));
  async function pick(kind) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https?:/.test(tab?.url || '')) throw Error('Open the website first, then choose this action from the Bypass toolbar popup.');
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'pro-pick', kind, action: $('pro-action').value });
    if (!result?.ok) throw Error(result?.error || 'Refresh this website and try again.');
    window.close();
  }
  $('pro-pick-hide').addEventListener('click', () => void run(() => pick('hide')));
  $('pro-pick-skip').addEventListener('click', () => void run(() => pick('skip')));
  $('pro-schedule-form').addEventListener('submit', event => { event.preventDefault(); void run(async () => {
    const minutes = id => { const [h,m] = $(id).value.split(':').map(Number); return h * 60 + m; };
    const days = $('pro-days').value === 'daily' ? [0,1,2,3,4,5,6] : $('pro-days').value === 'weekdays' ? [1,2,3,4,5] : [0,6];
    await save({ schedules: [...state.config.schedules, { mode: $('pro-schedule-mode').value, start: minutes('pro-start'), end: minutes('pro-end'), days }] }, 'Schedule saved.');
  }); });
  $('pro-limit-form').addEventListener('submit', event => { event.preventDefault(); void run(async () => {
    const host = $('pro-limit-host').value.trim().toLowerCase();
    await save({ limits: [...state.config.limits.filter(l => l.host !== host), { host, minutes: Number($('pro-limit-minutes').value) }] }, 'Daily limit saved.');
  }); });
  document.getElementById('start-trial').addEventListener('click', () => {
    document.getElementById('pro-dialog').close();
    document.getElementById('autopilot-tab').click();
    $('pro-trial').focus();
  });
  if (new URL(location.href).searchParams.has('pro')) {
    document.documentElement.classList.add('full-page');
    document.getElementById('autopilot-tab').click();
  }
  void run(async () => { state = await request('pro-get'); });
  addEventListener('focus', () => { if (!busy) void run(async () => { state = await request('pro-get'); }); });
})();
