(() => {
  'use strict';
  const site = globalThis.BypassStreaming?.site(location.hostname);
  if (!site || !globalThis.Bypass) return;
  const BUTTON = 'button, [role="button"]';
  const labels = {
    skipIntro:
      /^(skip intro|skip introduction|skip opening|omitir intro|saltar intro|intro überspringen|passer l’introduction|passer l'introduction|ignorer l’introduction|ignorer l'introduction|pular introdução)$/iu,
    skipRecap:
      /^(skip recap|skip summary|omitir resumen|saltar resumen|rückblick überspringen|passer le récapitulatif|ignorer le récapitulatif|pular resumo)$/iu,
    autoNext:
      /^(next episode|play next episode|watch next episode|episodio siguiente|siguiente episodio|nächste folge|épisode suivant|próximo episódio)$/iu,
  };

  const sessions = new WeakMap();
  function kind(button) {
    if (site.intro && button.matches(site.intro)) return 'skipIntro';
    if (site.recap && button.matches(site.recap)) return 'skipRecap';

    if (site.id === 'netflix' && site.next && button.matches(site.next)) return 'autoNext';
    const raw = button.getAttribute('aria-label') || button.textContent || '';
    if (raw.length > 100) return null;
    const text = raw.replace(/\s+/g, ' ').trim();
    return Object.keys(labels).find((k) => labels[k].test(text)) || null;
  }
  function visible(element) {
    if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]'))
      return false;
    if (
      element.checkVisibility &&
      !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    )
      return false;
    const r = element.getBoundingClientRect();
    return (
      r.width > 1 &&
      r.height > 1 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < innerHeight &&
      r.left < innerWidth
    );
  }
  Bypass.register('streaming', (settings) => {
    let stopped = false,
      timer = 0,
      lastTick = -Infinity;
    const candidates = new Set(),
      players = new Map(),
      videos = new Map();
    const pending = new Set();
    function schedule(button) {
      if (stopped || pending.size >= 64) return;
      if (button) pending.add(button);
      if (!timer) timer = setTimeout(flush, 80);
    }
    function session(video) {
      const key = `${location.pathname}|${video.currentSrc}`;
      let value = sessions.get(video);
      if (!value || value.key !== key) {
        value = { key, fired: new Set(), lastAction: -Infinity };
        sessions.set(video, value);
      }
      return value;
    }
    function tick() {
      if (stopped || document.hidden || performance.now() - lastTick < 250) return;
      lastTick = performance.now();
      for (const button of candidates) {
        if (!button.isConnected) candidates.delete(button);
        else schedule(button);
      }
      prune();
    }
    function attachVideo(video) {
      if (videos.has(video) || videos.size >= 4) return;
      const metadata = () => {
        lastTick = -Infinity;
        tick();
      };
      for (const event of ['timeupdate', 'playing', 'ended']) video.addEventListener(event, tick);
      video.addEventListener('loadedmetadata', metadata);
      videos.set(video, () => {
        for (const event of ['timeupdate', 'playing', 'ended'])
          video.removeEventListener(event, tick);
        video.removeEventListener('loadedmetadata', metadata);
      });
    }
    function check(button) {
      if (stopped || document.hidden || !button.isConnected) return;
      const action = kind(button);
      if (
        !action ||
        !settings[action] ||
        button.matches(':disabled, [aria-disabled="true"]') ||
        button.closest('[aria-disabled="true"], form') ||
        !visible(button)
      )
        return;
      if (button instanceof HTMLButtonElement && button.form && button.type === 'submit') return;
      const player = button.closest(site.player);
      if (!player || !players.has(player)) return;
      const media = player.querySelectorAll('video');

      if (media.length !== 1) return;
      const video = media[0];
      if (
        !visible(video) ||
        video.readyState < 2 ||
        video.seeking ||
        !Number.isFinite(video.duration) ||
        video.duration < 120 ||
        (video.paused && !(action === 'autoNext' && video.ended))
      )
        return;
      if (action === 'autoNext') {
        if (!video.ended && video.duration - video.currentTime > 15) return;
        const exact = site.next && button.matches(site.next);
        if (
          !exact &&
          !button.closest('[data-testid="up-next"], .up-next, .upnext, .atvwebplayersdk-nextupcard')
        )
          return;
      }
      let focus = document.activeElement;
      for (let depth = 0; focus?.shadowRoot?.activeElement && depth < 32; depth++)
        focus = focus.shadowRoot.activeElement;
      if (focus?.matches('input, textarea, select, [role="textbox"]') || focus?.isContentEditable)
        return;
      const rect = button.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const hit = button.getRootNode().elementFromPoint?.(x, y);
      if (!hit || (hit !== button && !button.contains(hit))) return;
      const state = session(video);
      if (state.fired.has(action) || performance.now() - state.lastAction < 1500) return;

      state.fired.add(action);
      state.lastAction = performance.now();
      try {
        button.click();
        void Bypass.metric('streaming_clicks');
      } catch {}
    }
    function flush() {
      timer = 0;
      if (stopped) return;
      const until = performance.now() + 2;
      let budget = 4;
      while (pending.size && budget-- > 0 && performance.now() < until) {
        const button = pending.values().next().value;
        pending.delete(button);
        try {
          check(button);
        } catch {}
      }
      if (pending.size) timer = setTimeout(flush, 16);
    }
    function discover(element) {
      if (stopped) return;
      if (element.matches(site.player) && !players.has(element) && players.size < 4) {
        const observer = new MutationObserver((records) => {
          for (const record of records.slice(0, 128)) {
            const target =
              record.target.nodeType === 1 ? record.target : record.target.parentElement;
            const button = target?.closest(BUTTON);
            if (button) discover(button);
          }
        });
        observer.observe(element, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: [
            'aria-label',
            'aria-disabled',
            'disabled',
            'data-uia',
            'data-testid',
            'hidden',
            'style',
            'class',
          ],
        });
        players.set(element, observer);
      }
      if (element.matches('video') && element.closest(site.player)) attachVideo(element);
      if (!element.matches(BUTTON) || !element.closest(site.player) || !kind(element)) return;
      if (candidates.size >= 64) prune();
      if (candidates.size < 64 || candidates.has(element)) {
        candidates.add(element);
        schedule(element);
      }
    }
    function prune() {
      for (const [player, observer] of players)
        if (!player.isConnected || !player.matches(site.player)) {
          observer.disconnect();
          players.delete(player);
        }
      for (const [video, remove] of videos)
        if (!video.isConnected || !video.closest(site.player)) {
          remove();
          videos.delete(video);
        }
      for (const button of candidates)
        if (!button.isConnected || !button.closest(site.player) || !kind(button)) {
          candidates.delete(button);
          pending.delete(button);
        }
    }
    function manualClick(event) {
      if (!event.isTrusted) return;
      const button = event.target instanceof Element ? event.target.closest(BUTTON) : null;
      const player = button?.closest(site.player),
        action = button && kind(button);
      if (!player || !action) return;
      const media = player.querySelectorAll('video');
      if (media.length === 1) session(media[0]).fired.add(action);
    }
    const unsubscribe = Bypass.subscribe(discover);
    const unmaintain = Bypass.maintain(prune);
    document.addEventListener('visibilitychange', tick);
    document.addEventListener('click', manualClick, true);
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      unmaintain();
      document.removeEventListener('visibilitychange', tick);
      document.removeEventListener('click', manualClick, true);
      for (const observer of players.values()) observer.disconnect();
      for (const remove of videos.values()) remove();
      pending.clear();
      candidates.clear();
      players.clear();
      videos.clear();
    };
  });
})();
