(() => {
  "use strict";
  const api = globalThis.Bypass;
  if (
    !api ||
    !/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(location.hostname)
  )
    return;
  const PLAYER = ".html5-video-player";
  const SKIP =
    ".ytp-skip-ad-button,.ytp-ad-skip-button,.ytp-ad-skip-button-modern";
  const RATE = 16;
  const MEDIA_EVENTS = ["loadstart", "emptied", "loadedmetadata", "playing"];
  api.register("video", () => {
    const players = new Map();
    let alive = true,
      tick = 0;
    function owner(element) {
      let node = element;
      for (
        let depth = 0;
        node && depth < 128;
        depth++, node = api.composedParent(node)
      ) {
        if (node.matches(PLAYER)) return node;
      }
      return null;
    }
    function ad(player) {
      return (
        player.classList.contains("ad-showing") ||
        player.classList.contains("ad-interrupting")
      );
    }
    function restore(video, snapshot) {
      video.removeEventListener("ratechange", snapshot.onRate);
      video.removeEventListener("volumechange", snapshot.onVolume);
      try {
        if (snapshot.rateOwned && video.playbackRate === RATE)
          video.playbackRate = snapshot.rate;
      } catch {}
      try {
        if (snapshot.muteOwned && video.muted) video.muted = snapshot.muted;
      } catch {}
    }
    function finish(state, count) {
      for (const [video, snapshot] of state.modified) restore(video, snapshot);
      if (count && state.helped) void api.metric("ads_skipped");
      state.modified.clear();
      state.clicked = new WeakMap();
      state.active = false;
      state.helped = false;
      report();
    }
    function report() {
      api.diagnostic({
        videoPlayers: players.size,
        adActive: [...players.values()].some((s) => s.active),
      });
    }
    function prune() {
      for (const [player, state] of players) {
        if (!player.isConnected) {
          remove(player, state);
          continue;
        }
        for (const video of state.videos)
          if (!video.isConnected || owner(video) !== player) {
            forgetVideo(video, state);
          }
        for (const button of state.buttons)
          if (!button.isConnected || owner(button) !== player)
            state.buttons.delete(button);
      }
      report();
    }
    const unmaintain = api.maintain(prune);
    function remove(player, state) {
      finish(state, false);
      for (const video of state.videos) forgetVideo(video, state);
      state.observer.disconnect();
      players.delete(player);
      report();
    }
    function forgetVideo(video, state) {
      const snapshot = state.modified.get(video);
      if (snapshot) restore(video, snapshot);
      const listener = state.mediaListeners.get(video);
      for (const event of MEDIA_EVENTS)
        video.removeEventListener(event, listener);
      state.mediaListeners.delete(video);
      state.modified.delete(video);
      state.videos.delete(video);
    }
    function trackVideo(video, player, state) {
      if (state.videos.has(video) || state.videos.size >= 16) return;
      state.videos.add(video);
      const listener = (event) => {
        if (!alive || owner(video) !== player) return;
        const snapshot = state.modified.get(video);
        if (event.type !== "playing") {
          if (snapshot) {
            snapshot.pending = true;
            snapshot.loading = true;
          }
          state.clicked = new WeakMap();
          state.started = performance.now();
          state.timedOut = false;
        } else if (snapshot?.loading) {
          snapshot.pending = true;
          snapshot.loading = false;
        }
        check(player, state);
      };
      state.mediaListeners.set(video, listener);
      for (const event of MEDIA_EVENTS) video.addEventListener(event, listener);
    }
    function accelerate(video, state) {
      if (video.paused || video.ended || video.readyState === 0) return;
      let snapshot = state.modified.get(video);
      if (snapshot) {
        if (
          video.currentSrc !== snapshot.source ||
          video.currentTime < snapshot.time - 1
        ) {
          snapshot.pending = true;
          state.clicked = new WeakMap();
          state.started = performance.now();
        }
        snapshot.source = video.currentSrc;
        snapshot.time = video.currentTime;
      }
      if (snapshot && !snapshot.pending) return;
      if (!snapshot) {
        snapshot = {
          rate: video.playbackRate,
          muted: video.muted,
          rateOwned: false,
          muteOwned: false,
          onRate: null,
          onVolume: null,
          pending: true,
          loading: video.readyState < 3,
          source: video.currentSrc,
          time: video.currentTime,
        };
        snapshot.onRate = () => {
          if (video.playbackRate !== RATE) snapshot.rateOwned = false;
        };
        snapshot.onVolume = () => {
          if (!video.muted) snapshot.muteOwned = false;
        };
        state.modified.set(video, snapshot);
        video.addEventListener("ratechange", snapshot.onRate);
        video.addEventListener("volumechange", snapshot.onVolume);
      }
      snapshot.pending = false;
      try {
        if (video.playbackRate !== RATE) {
          video.playbackRate = RATE;
          snapshot.rateOwned = video.playbackRate === RATE;
        }
        if (video.playbackRate !== RATE) return;
        if (!video.muted) {
          video.muted = true;
          snapshot.muteOwned = video.muted;
        }
        state.helped = true;
      } catch {
        // Retry only on the next media load, never on every polling tick.
      }
    }
    function skip(player, state) {
      for (const button of state.buttons) {
        if (!button.isConnected || owner(button) !== player) {
          state.buttons.delete(button);
          continue;
        }
        if (
          button.matches(":disabled") ||
          button.getAttribute("aria-disabled") === "true" ||
          button.closest('[hidden],[inert],[aria-hidden="true"]')
        ) {
          state.clicked.delete(button);
          continue;
        }
        const rect = button.getBoundingClientRect(),
          style = getComputedStyle(button);
        if (
          !rect.width ||
          !rect.height ||
          style.visibility !== "visible" ||
          style.display === "none" ||
          Number(style.opacity) === 0
        ) {
          state.clicked.delete(button);
          continue;
        }
        const attempt = state.clicked.get(button),
          now = performance.now();
        if (attempt && (attempt.count >= 3 || now - attempt.at < 1000))
          continue;
        state.clicked.set(button, {
          at: now,
          count: (attempt?.count || 0) + 1,
        });
        try {
          button.click();
          state.helped = true;
        } catch {}
        break;
      }
    }
    function check(player, state) {
      if (!alive) return;
      if (!player.isConnected) {
        remove(player, state);
        return;
      }
      if (!ad(player)) {
        if (state.active) finish(state, true);
        state.timedOut = false;
        return;
      }
      if (state.timedOut) return;
      if (!state.active) {
        state.active = true;
        report();
        state.started = performance.now();
      }
      if (performance.now() - state.started > 180000) {
        finish(state, false);
        state.timedOut = true;
        return;
      }
      for (const video of state.videos) {
        if (!video.isConnected || owner(video) !== player) {
          forgetVideo(video, state);
          continue;
        }
        accelerate(video, state);
      }
      skip(player, state);
      if (!ad(player)) finish(state, true);
      schedule();
    }
    function schedule() {
      if (
        tick ||
        !alive ||
        ![...players.values()].some((state) => state.active)
      )
        return;
      tick = setTimeout(() => {
        tick = 0;
        for (const [player, state] of players)
          if (state.active || !player.isConnected) check(player, state);
        schedule();
      }, 100);
    }
    function register(player) {
      if (players.has(player)) return players.get(player);
      for (const [old, state] of players)
        if (!old.isConnected) remove(old, state);
      if (players.size >= 8) return null;
      const state = {
        videos: new Set(),
        mediaListeners: new Map(),
        buttons: new Set(),
        modified: new Map(),
        clicked: new WeakMap(),
        active: false,
        helped: false,
        timedOut: false,
        started: 0,
        observer: null,
      };
      state.observer = new MutationObserver(() => check(player, state));
      state.observer.observe(player, {
        attributes: true,
        attributeFilter: ["class"],
      });
      players.set(player, state);
      report();
      return state;
    }
    const unsubscribe = api.subscribe((element) => {
      const video = element instanceof HTMLVideoElement,
        button = element.matches(SKIP);
      if (!video && !button && !element.matches(PLAYER)) return;
      const player = owner(element);
      if (!player) return;
      prune();
      const state = register(player);
      if (!state) return;
      if (video) trackVideo(element, player, state);
      if (button && state.buttons.size < 16) state.buttons.add(element);
      check(player, state);
    });
    return () => {
      alive = false;
      clearTimeout(tick);
      unsubscribe();
      unmaintain();
      for (const [player, state] of players) remove(player, state);
    };
  });
})();
