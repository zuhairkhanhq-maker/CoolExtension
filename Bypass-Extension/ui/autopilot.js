"use strict";
(() => {
  const root = document.getElementById("autopilot-panel");
  root.innerHTML = `
    <section class="hero compact-hero"><p class="eyebrow">PERSONAL CONTROLS</p><h1>Your internet, your rules.</h1><p class="sub">Every feature is free. Your choices stay on this device.</p></section>
    <section class="site"><h2 id="autopilot-status">Loading your controls…</h2>
      <button id="autopilot-manage" class="secondary-button" type="button">Open controls in a full tab</button>
    </section>
    <fieldset id="autopilot-controls" disabled>
      <section class="site"><h2>Choose a mode</h2><p class="fine">Study hides YouTube feeds, Shorts, recommendations and comments. Work hides feeds and Shorts. Relax restores them. Other sites use your personal rules. Schedules override this choice while active.</p>
        <div class="mode-row" role="group" aria-label="Browsing mode"><button type="button" data-mode="off">Off</button><button type="button" data-mode="study">Study</button><button type="button" data-mode="work">Work</button><button type="button" data-mode="relax">Relax</button></div>
        <p id="autopilot-mode-status" role="status" class="fine"></p>
      </section>
      <section class="site"><h2>Personal website cleanup</h2><p class="fine">Select one distraction on the current website. Main content, forms, navigation and video players are protected. Some large elements cannot be hidden.</p>
        <button id="autopilot-pick-hide" class="primary-button" type="button">Choose something to hide</button>
        <details><summary>Custom media button</summary><p class="fine">Select a visible player button. Only matching English Skip Intro, Skip Recap or Next Episode labels can be attempted. No guaranteed support across every player.</p><label class="autopilot-field">Action<select id="autopilot-action"><option value="intro">Skip intro</option><option value="recap">Skip recap</option><option value="next">Next episode</option></select></label><button id="autopilot-pick-skip" class="secondary-button" type="button">Choose a media button</button></details>
        <ul id="autopilot-rules" class="autopilot-list"></ul>
      </section>
      <section class="site"><h2>Automatic schedules</h2><p class="fine">Uses this computer’s local clock. Overnight schedules are supported. Last matching schedule wins. Outside a schedule your manual mode returns.</p>
        <form id="autopilot-schedule-form"><label class="autopilot-field">Mode<select id="autopilot-schedule-mode"><option value="study">Study</option><option value="work">Work</option><option value="relax">Relax</option></select></label><label class="autopilot-field">Days<select id="autopilot-days"><option value="weekdays">Monday–Friday</option><option value="daily">Every day</option><option value="weekend">Saturday–Sunday</option></select></label><div class="autopilot-grid"><label class="autopilot-field">Start<input id="autopilot-start" type="time" value="09:00" required></label><label class="autopilot-field">End<input id="autopilot-end" type="time" value="17:00" required></label></div><button class="secondary-button" type="submit">Add schedule</button></form>
        <ul id="autopilot-schedules" class="autopilot-list"></ul>
      </section>
      <section class="site"><h2>Daily website limits</h2><p class="fine">Counts approximate foreground use, not background tabs. Resets at local midnight. Shows a reminder with a 10-minute continue option; never blocks checkout.</p>
        <form id="autopilot-limit-form"><label class="autopilot-field">Exact website hostname<input id="autopilot-limit-host" placeholder="www.youtube.com" maxlength="253" required></label><label class="autopilot-field">Minutes per day<input id="autopilot-limit-minutes" type="number" value="30" min="1" max="1440" required></label><button class="secondary-button" type="submit">Save daily limit</button></form><ul id="autopilot-limits" class="autopilot-list"></ul>
      </section>
    </fieldset>
    <section class="site"><h2>Private progress</h2><p id="autopilot-progress" class="fine">No activity yet.</p><p class="fine">Focus time is approximate foreground time in Study or Work. Activity stays on this device.</p></section>
    <p id="autopilot-feedback" role="status" aria-live="polite"></p>`;
  const $ = (id) => document.getElementById(id);
  let state = null,
    busy = false;
  const tell = (text, error = false) => {
    $("autopilot-feedback").textContent = text;
    $("autopilot-feedback").classList.toggle("error", error);
  };
  async function request(type, values = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...values });
    if (!result?.ok)
      throw Error(
        result?.error ||
          "Could not connect. Reload the extension and try again.",
      );
    return result.state;
  }
  function item(list, text, remove) {
    const li = document.createElement("li"),
      label = document.createElement("span"),
      button = document.createElement("button");
    label.textContent = text;
    button.textContent = "Remove";
    button.type = "button";
    button.setAttribute("aria-label", `Remove ${text}`);
    button.addEventListener("click", () => void run(remove));
    li.append(label, button);
    $(list).append(li);
  }
  const time = (minutes) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  function render() {
    if (!state) return;
    $("autopilot-status").textContent = "Ready to personalize";
    $("autopilot-controls").disabled = busy;
    $("autopilot-mode-status").textContent =
      `Active mode: ${state.mode}. Personal rules work in every mode. Turning off protection on a website pauses all changes there.`;
    for (const button of root.querySelectorAll("[data-mode]"))
      button.setAttribute(
        "aria-pressed",
        String(state.config.mode === button.dataset.mode),
      );
    for (const id of [
      "autopilot-rules",
      "autopilot-schedules",
      "autopilot-limits",
    ])
      $(id).replaceChildren();
    state.config.rules.forEach((rule, index) =>
      item(
        "autopilot-rules",
        `${rule.host} · ${rule.kind === "hide" ? "Hide" : rule.action} · ${rule.selector}`,
        () =>
          save(
            { rules: state.config.rules.filter((_, i) => i !== index) },
            "Rule removed. Its elements are restored.",
          ),
      ),
    );
    state.config.schedules.forEach((s, index) =>
      item(
        "autopilot-schedules",
        `${s.mode} · ${time(s.start)}–${time(s.end)} · ${s.days.length === 7 ? "Every day" : s.days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")}`,
        () =>
          save(
            { schedules: state.config.schedules.filter((_, i) => i !== index) },
            "Schedule removed.",
          ),
      ),
    );
    state.config.limits.forEach((l, index) =>
      item(
        "autopilot-limits",
        `${l.host} · ${l.minutes} min/day · ${Math.floor((state.usage[l.host] || 0) / 60)} min today`,
        () =>
          save(
            { limits: state.config.limits.filter((_, i) => i !== index) },
            "Limit removed.",
          ),
      ),
    );
    if (!state.config.rules.length) {
      const empty = document.createElement("li");
      empty.textContent = "No personal rules yet.";
      $("autopilot-rules").append(empty);
    }
    $("autopilot-progress").textContent =
      `${state.progress.hidden || 0} personal distractions hidden · ${state.progress.skipAttempts || 0} media clicks attempted · ${Math.floor((state.progress.focusSeconds || 0) / 60)} focus minutes.`;
    $("footer-version").textContent =
      `V${chrome.runtime.getManifest?.().version || "0.9.0"}`;
  }
  async function run(task) {
    if (busy) return;
    busy = true;
    render();
    try {
      await task();
    } catch (error) {
      tell(error.message, true);
      try {
        state = await request("autopilot-get");
      } catch {}
    } finally {
      busy = false;
      render();
    }
  }
  async function save(change, message = "Saved. Changes apply automatically.") {
    state = await request("autopilot-save", {
      config: { ...state.config, ...change },
      revision: state.revision,
    });
    tell(message);
  }
  for (const button of root.querySelectorAll("[data-mode]"))
    button.addEventListener(
      "click",
      () => void run(() => save({ mode: button.dataset.mode })),
    );
  $("autopilot-manage").addEventListener("click", () =>
    chrome.tabs.create({
      url: chrome.runtime.getURL("ui/popup.html?autopilot=1"),
    }),
  );
  async function pick(kind) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!/^https?:/.test(tab?.url || ""))
      throw Error(
        "Open the website first, then choose this action from the Bypass toolbar popup.",
      );
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "autopilot-pick",
      kind,
      action: $("autopilot-action").value,
    });
    if (!result?.ok)
      throw Error(result?.error || "Refresh this website and try again.");
    window.close();
  }
  $("autopilot-pick-hide").addEventListener(
    "click",
    () => void run(() => pick("hide")),
  );
  $("autopilot-pick-skip").addEventListener(
    "click",
    () => void run(() => pick("skip")),
  );
  $("autopilot-schedule-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      const minutes = (id) => {
        const [h, m] = $(id).value.split(":").map(Number);
        return h * 60 + m;
      };
      const days =
        $("autopilot-days").value === "daily"
          ? [0, 1, 2, 3, 4, 5, 6]
          : $("autopilot-days").value === "weekdays"
            ? [1, 2, 3, 4, 5]
            : [0, 6];
      await save(
        {
          schedules: [
            ...state.config.schedules,
            {
              mode: $("autopilot-schedule-mode").value,
              start: minutes("autopilot-start"),
              end: minutes("autopilot-end"),
              days,
            },
          ],
        },
        "Schedule saved.",
      );
    });
  });
  $("autopilot-limit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      const host = $("autopilot-limit-host").value.trim().toLowerCase();
      await save(
        {
          limits: [
            ...state.config.limits.filter((l) => l.host !== host),
            { host, minutes: Number($("autopilot-limit-minutes").value) },
          ],
        },
        "Daily limit saved.",
      );
    });
  });
  if (
    new URL(location.href).searchParams.has("autopilot") ||
    new URL(location.href).searchParams.has("pro")
  ) {
    document.documentElement.classList.add("full-page");
    document.getElementById("autopilot-tab").click();
  }
  void run(async () => {
    state = await request("autopilot-get");
  });
  addEventListener("focus", () => {
    if (!busy)
      void run(async () => {
        state = await request("autopilot-get");
      });
  });
})();
