(() => {
  'use strict';
  const api = globalThis.Bypass;
  if (!api) return;
  const counted = new WeakSet();
  const attempted = new WeakSet();
  const KNOWN = '#onetrust-banner-sdk,#CybotCookiebotDialog,#didomi-notice';
  const GENERIC =
    '[class~="cookie-banner" i],[id="cookie-banner" i],[class~="cookie-consent-banner" i]';
  const SELECTOR = `${KNOWN},${GENERIC}`;
  const REJECT =
    /^(reject all(?: cookies)?|decline(?: all)?(?: cookies)?|(?:essential|necessary)(?: cookies)? only|only (?:essential|necessary)(?: cookies)?|continue without accepting)$/i;
  const BUTTONS =
    '#onetrust-reject-all-handler,#CybotCookiebotDialogBodyButtonDecline,#didomi-notice-disagree-button';
  api.register('cookies', () => {
    const hidden = new Map(),
      locks = new Map(),
      queue = new Set();
    const lockObservers = new Map();
    let timer = 0,
      alive = true,
      rootWatch = null;
    const style = document.createElement('style');
    style.dataset.bypassOwned = 'consent';

    style.textContent = '[data-bypass-hidden="1"]{display:none!important}';
    function installStyle() {
      if (document.documentElement && !style.isConnected) document.documentElement.append(style);
    }
    installStyle();
    if (!style.isConnected) {
      rootWatch = new MutationObserver(() => {
        installStyle();
        if (style.isConnected) {
          rootWatch.disconnect();
          rootWatch = null;
        }
      });
      rootWatch.observe(document, { childList: true });
    }
    function shown(element) {
      if (!element.isConnected || element.closest('[hidden],[aria-hidden="true"],[inert]'))
        return false;
      const s = getComputedStyle(element);
      return (
        s.display !== 'none' && s.visibility === 'visible' && element.getClientRects().length > 0
      );
    }

    function attributed(container, node) {
      return (
        container.id === 'onetrust-banner-sdk' && node.classList.contains('ot-overflow-hidden')
      );
    }
    function otherDialog(container) {
      const pending = [document];
      let budget = 2000;
      while (pending.length) {
        const walker = document.createTreeWalker(pending.pop(), NodeFilter.SHOW_ELEMENT);
        let element;
        while ((element = walker.nextNode())) {
          if (--budget < 0) return true;
          if (element.shadowRoot) pending.push(element.shadowRoot);
          if (
            element !== container &&
            !container.contains(element) &&
            element.matches('dialog[open],[aria-modal="true"]') &&
            shown(element)
          )
            return true;
        }
      }
      return false;
    }
    function releaseLock(node) {
      const old = locks.get(node);
      if (!old) return;
      for (const property of ['overflow-y']) {
        if (
          node.style.getPropertyValue(property) !== 'auto' ||
          node.style.getPropertyPriority(property) !== 'important'
        )
          continue;
        const previous = old[property];
        if (previous.value) node.style.setProperty(property, previous.value, previous.priority);
        else node.style.removeProperty(property);
      }
      locks.delete(node);
    }
    function unlock(container) {
      if (!alive) return;
      const blocked = otherDialog(container);
      for (const node of [document.documentElement, document.body]) {
        if (!node) continue;
        if (blocked || !attributed(container, node)) {
          releaseLock(node);
          continue;
        }
        const computed = getComputedStyle(node);
        if (computed.position === 'fixed' || !/^(hidden|clip)$/.test(computed.overflowY)) continue;
        if (!locks.has(node))
          locks.set(
            node,
            Object.fromEntries(
              ['overflow-y'].map((property) => [
                property,
                {
                  value: node.style.getPropertyValue(property),
                  priority: node.style.getPropertyPriority(property),
                },
              ])
            )
          );
        node.style.setProperty('overflow-y', 'auto', 'important');
      }
    }
    function watchLock(node, container) {
      if (!node || lockObservers.has(node)) return;
      const observer = new MutationObserver(() => unlock(container));
      observer.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
      const expiry = setTimeout(() => {
        observer.disconnect();
        lockObservers.delete(node);
      }, 1000);
      lockObservers.set(node, { observer, expiry });
    }
    function rejection(container) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
      for (let i = 0; i < 160; i++) {
        const button = walker.nextNode();
        if (!button) break;
        if (!button.matches('button,[role="button"],input[type="button"]')) continue;
        if (
          getComputedStyle(button).display === 'none' ||
          getComputedStyle(button).visibility !== 'visible' ||
          button.closest('[aria-hidden="true"]')
        )
          continue;
        if (
          button.matches(':disabled') ||
          button.getAttribute('aria-disabled') === 'true' ||
          button.closest('[inert],[hidden]')
        )
          continue;
        let ancestor = button.parentElement,
          concealed = false;
        for (; ancestor && ancestor !== container; ancestor = ancestor.parentElement) {
          const computed = getComputedStyle(ancestor);
          if (
            computed.display === 'none' ||
            computed.visibility !== 'visible' ||
            Number(computed.opacity) === 0
          ) {
            concealed = true;
            break;
          }
        }
        if (concealed) continue;
        const text = (button.getAttribute('aria-label') || button.value || button.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (button.matches(BUTTONS) || (text.length <= 100 && REJECT.test(text))) return button;
      }
      return null;
    }
    function cookieContext(container) {
      const text = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      for (let i = 0; i < 64; i++) {
        const node = text.nextNode();
        if (!node) break;
        if (/\bcookies?\b/i.test(node.textContent.slice(0, 512))) return true;
      }
      return false;
    }
    function reject(button) {
      if (!button || attempted.has(button)) return;
      attempted.add(button);
      try {
        button.click();
        void api.metric('consent_actions');
      } catch {}
    }
    function process(container) {
      if (!container.isConnected) return;
      const alreadyHidden = hidden.has(container);
      if (!alreadyHidden && !shown(container)) return;
      const button = rejection(container);

      if (!container.matches(KNOWN) && (!button || !cookieContext(container))) return;
      if (!alreadyHidden) {
        if (hidden.size >= 64) return;
        const lockedNodes = [document.documentElement, document.body].filter(
          (node) => node && /^(hidden|clip)$/.test(getComputedStyle(node).overflowY)
        );
        const hadLock = lockedNodes.length > 0;
        if (
          lockedNodes.some(
            (node) => !attributed(container, node) || getComputedStyle(node).position === 'fixed'
          )
        ) {
          reject(button);
          return;
        }
        hidden.set(container, {
          display: container.style.getPropertyValue('display'),
          priority: container.style.getPropertyPriority('display'),
          marker: container.getAttribute('data-bypass-hidden'),
        });
        container.setAttribute('data-bypass-hidden', '1');
        container.style.setProperty('display', 'none', 'important');
        if (!counted.has(container)) {
          counted.add(container);
          void api.metric('banners_vaporized');
        }
        if (hadLock) {
          unlock(container);
          watchLock(document.documentElement, container);
          watchLock(document.body, container);
        }
      }
      if (alreadyHidden && container.style.getPropertyValue('display') !== 'none') {
        container.style.setProperty('display', 'none', 'important');
      }
      reject(button);
    }
    function restoreContainer(node, old) {
      if (node.getAttribute('data-bypass-hidden') === '1') {
        if (old.marker === null) node.removeAttribute('data-bypass-hidden');
        else node.setAttribute('data-bypass-hidden', old.marker);
      }
      if (
        node.style.getPropertyValue('display') === 'none' &&
        node.style.getPropertyPriority('display') === 'important'
      ) {
        if (old.display) node.style.setProperty('display', old.display, old.priority);
        else node.style.removeProperty('display');
      }
    }
    function prune() {
      for (const [container, old] of hidden)
        if (!container.isConnected) {
          restoreContainer(container, old);
          hidden.delete(container);
          for (const node of locks.keys()) releaseLock(node);
        }
    }
    function flush() {
      timer = 0;
      if (!alive) return;
      prune();
      const deadline = performance.now() + 2;
      let budget = 4;
      while (queue.size && budget-- && performance.now() < deadline) {
        const node = queue.values().next().value;
        queue.delete(node);
        try {
          process(node);
        } catch {}
      }
      if (queue.size) timer = setTimeout(flush, 16);
    }
    const unsubscribe = api.subscribe((element) => {
      if (
        locks.size &&
        (element === document.body ||
          element === document.documentElement ||
          element.matches('dialog[open],[aria-modal="true"]') ||
          element.shadowRoot)
      ) {
        for (const banner of hidden.keys()) unlock(banner);
      }
      const container = element.closest(SELECTOR);
      if (container && queue.size < 64) {
        queue.add(container);
        if (!timer) timer = setTimeout(flush, 0);
      }
    });
    const unmaintain = api.maintain(prune);
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
      unmaintain();
      rootWatch?.disconnect();
      style.remove();
      for (const { observer, expiry } of lockObservers.values()) {
        observer.disconnect();
        clearTimeout(expiry);
      }
      for (const [node, old] of hidden) {
        restoreContainer(node, old);
      }
      for (const node of locks.keys()) releaseLock(node);
      hidden.clear();
      locks.clear();
      queue.clear();
    };
  });
})();
