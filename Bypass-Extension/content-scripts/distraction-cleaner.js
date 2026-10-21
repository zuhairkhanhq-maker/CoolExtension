(() => {
  "use strict";
  const api = globalThis.Bypass;
  if (!api) return;
  const SELECTOR =
    '[class*="newsletter" i],[id*="newsletter" i],[class*="subscribe-popup" i],[id*="subscribe-popup" i],[class*="subscription-modal" i],[class*="chat-nudge" i],[class*="support-popup" i],[class*="support-teaser" i],.intercom-lightweight-app-notifications,[class*="sticky-ad" i],[id*="sticky-ad" i],[class*="ad-sticky" i],[class*="anchor-ad" i],[id*="anchor-ad" i],[class*="ad-banner" i],[role="dialog"],dialog';
  const PROTECTED =
    'html,body,main,header,footer,nav,[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"],#onetrust-banner-sdk,#CybotCookiebotDialog,#didomi-notice,[class*="cookie" i],[id*="cookie" i],[class*="age-gate" i],[id*="age-gate" i],[class*="age-verif" i],[id*="age-verif" i],[class*="checkout" i],[id*="checkout" i],[class*="login" i],[id*="login" i],[class*="captcha" i],[id*="captcha" i]';
  const SENSITIVE =
    /\b(age verification|age restriction|verify your age|confirm your age|date of birth|birth date|legal drinking age|adult content|you must be (?:18|21)|are you (?:over|at least)|18\+|21\+|sign in|log in|checkout|payment|password|security check|verify your identity|two.factor|captcha|delete account|unsaved changes)\b/i;
  const counted = new WeakSet(),
    touched = new WeakSet(),
    attempted = new WeakSet();
  api.register("distractions", () => {
    const hidden = new Map(),
      queue = new Set(),
      timers = new Set();
    let live = true,
      timer = 0,
      lastIntent = -Infinity;
    const later = (fn, ms) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (live) fn();
      }, ms);
      timers.add(id);
    };
    function visible(node) {
      if (
        !node.isConnected ||
        node.closest('[hidden],[inert],[aria-hidden="true"]')
      )
        return false;
      const style = getComputedStyle(node);
      return (
        style.display !== "none" &&
        style.visibility === "visible" &&
        Number(style.opacity) !== 0 &&
        node.getClientRects().length > 0
      );
    }
    function intent(event) {
      if (!event.isTrusted) return;
      lastIntent = performance.now();
      for (const node of event.composedPath())
        if (node instanceof Element) {
          const container = node.closest(SELECTOR);
          if (container) touched.add(container);
        }
    }
    document.addEventListener("pointerdown", intent, true);
    document.addEventListener("keydown", intent, true);
    document.addEventListener("input", intent, true);
    function inspect(container) {
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      );
      let node,
        budget = 180,
        text = "",
        close = null,
        unsafe = false,
        hasInput = false;
      while ((node = walker.nextNode())) {
        if (--budget < 0 || text.length > 4096) return null;
        if (node.nodeType === 3) {
          text += " " + node.textContent.slice(0, 512);
          continue;
        }
        if (node.matches('input,form,[role="textbox"],[role="log"]'))
          hasInput = true;
        if (
          node.matches(
            'iframe,object,embed,textarea,[contenteditable]:not([contenteditable="false"]),input[type="password"],input[autocomplete^="cc-"],input[type="date"],input[name*="birth" i],input[name*="age" i]',
          ) ||
          node.shadowRoot
        )
          unsafe = true;
        if (
          node.matches("input") &&
          (node.value || node === node.getRootNode().activeElement)
        )
          unsafe = true;
        if (
          !close &&
          node.matches('button,[role="button"]') &&
          !node.matches(":disabled") &&
          node.getAttribute("aria-disabled") !== "true" &&
          visible(node)
        ) {
          if (
            node instanceof HTMLButtonElement &&
            node.form &&
            node.type === "submit"
          )
            continue;
          const label = (
            node.getAttribute("aria-label") ||
            node.getAttribute("title") ||
            node.textContent ||
            ""
          ).trim();
          if (
            /^(close(?: (?:window|dialog|popup|newsletter))?|dismiss|no thanks|not now|×|✕|✖)$/i.test(
              label,
            )
          )
            close = node;
        }
      }
      return unsafe || SENSITIVE.test(text) ? null : { text, close, hasInput };
    }
    function locked() {
      return [document.documentElement, document.body].some(
        (node) =>
          node &&
          (/^(hidden|clip)$/.test(getComputedStyle(node).overflowY) ||
            getComputedStyle(node).position === "fixed"),
      );
    }
    function count(node) {
      if (!counted.has(node)) {
        counted.add(node);
        void api.metric("distractions_hidden");
      }
    }
    function hide(node) {
      if (hidden.size >= 48) return;
      if (!hidden.has(node))
        hidden.set(node, {
          value: node.style.getPropertyValue("display"),
          priority: node.style.getPropertyPriority("display"),
        });
      node.style.setProperty("display", "none", "important");
      count(node);
    }
    function process(node) {
      if (!node.isConnected || touched.has(node)) return;
      if (hidden.has(node)) return;
      if (
        /age[-_ ]?(?:gate|verification|check)|verify[-_ ]?age/i.test(
          node.id + " " + node.className,
        )
      )
        return;
      if (
        node.matches(PROTECTED) ||
        node.closest('form,[data-bypass-hidden="1"]') ||
        !visible(node)
      )
        return;

      let parent = api.composedParent(node);
      for (
        let depth = 0;
        parent && parent !== document.body && depth < 24;
        depth++, parent = api.composedParent(parent)
      ) {
        if (
          parent.matches(PROTECTED) &&
          !parent.matches(
            'main,header,footer,nav,[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"]',
          )
        )
          return;
      }
      if (performance.now() - lastIntent < 2000) {
        touched.add(node);
        return;
      }
      const info = inspect(node);
      if (!info) return;
      const style = getComputedStyle(node),
        rect = node.getBoundingClientRect();
      const floating = ["fixed", "sticky", "absolute"].includes(style.position);
      const modal = node.matches('dialog[open],[aria-modal="true"]');
      if (!floating && !modal) return;
      const signature = (node.id + " " + node.className).toLowerCase();
      const newsletter =
        (/newsletter|subscribe-popup|subscription-modal/.test(signature) &&
          /newsletter|subscribe|sign up|join our|inbox/i.test(info.text)) ||
        (modal &&
          /newsletter|subscribe to (?:our|the)|join our mailing list/i.test(
            info.text,
          ));
      const support =
        /chat-nudge|support-popup|support-teaser|intercom-lightweight-app-notifications/.test(
          signature,
        ) &&
        /need help|can we help|can i help|chat with us|questions/i.test(
          info.text,
        );
      const ad =
        /sticky-ad|ad-sticky|anchor-ad|ad-banner/.test(signature) &&
        /\badvertisement\b|\bsponsored\b/i.test(
          info.text + " " + (node.getAttribute("aria-label") || ""),
        ) &&
        ["fixed", "sticky"].includes(style.position) &&
        rect.height <= innerHeight * 0.3 &&
        rect.width >= innerWidth * 0.35 &&
        (rect.top <= 48 || rect.bottom >= innerHeight - 48);
      if (!newsletter && !support && !ad) return;
      if (support && info.hasInput) return;
      if (info.close && !attempted.has(info.close)) {
        attempted.add(info.close);
        try {
          info.close.click();
        } catch {
          return;
        }
        later(() => {
          if (!visible(node)) count(node);
        }, 200);
        return;
      }

      if (modal || node.matches('[role="dialog"]') || locked()) return;
      if (rect.width * rect.height > innerWidth * innerHeight * 0.45) return;
      if (node.contains(document.activeElement)) return;
      hide(node);
    }
    function flush() {
      timer = 0;
      const deadline = performance.now() + 2;
      for (const [node, old] of hidden)
        if (!node.isConnected) {
          if (
            node.style.getPropertyValue("display") === "none" &&
            node.style.getPropertyPriority("display") === "important"
          ) {
            if (old.value)
              node.style.setProperty("display", old.value, old.priority);
            else node.style.removeProperty("display");
          }
          hidden.delete(node);
        }
      let budget = 4;
      while (live && queue.size && budget-- && performance.now() < deadline) {
        const node = queue.values().next().value;
        queue.delete(node);
        try {
          process(node);
        } catch {}
      }
      if (live && queue.size) timer = setTimeout(flush, 16);
    }
    const unsubscribe = api.subscribe((element) => {
      const node = element.closest(SELECTOR);
      if (node && queue.size < 64) {
        queue.add(node);
        if (!timer) timer = setTimeout(flush, 0);
      }
    });
    return () => {
      live = false;
      clearTimeout(timer);
      for (const id of timers) clearTimeout(id);
      unsubscribe();
      queue.clear();
      document.removeEventListener("pointerdown", intent, true);
      document.removeEventListener("keydown", intent, true);
      document.removeEventListener("input", intent, true);
      for (const [node, old] of hidden)
        if (
          node.style.getPropertyValue("display") === "none" &&
          node.style.getPropertyPriority("display") === "important"
        ) {
          if (old.value)
            node.style.setProperty("display", old.value, old.priority);
          else node.style.removeProperty("display");
        }
      hidden.clear();
    };
  });
})();
