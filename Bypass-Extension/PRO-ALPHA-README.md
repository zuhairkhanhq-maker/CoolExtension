# Bypass 0.7.0 — internal Pro alpha

This is a working local-engine alpha, not a paid production release. The 0.6.1 free engines are unchanged. No account, payment processor, remote licensing service, analytics, or sync is configured.

## Try it

1. Extract the ZIP. In `chrome://extensions`, enable Developer mode and use Load unpacked to select the enclosed `Bypass-Extension` directory. Disable the older unpacked copy to prevent duplicate processing. Keep its files for rollback.
2. Open a regular website, then the Bypass toolbar popup. Choose Autopilot and start the 7-day local trial. There is no card or automatic payment.
3. On YouTube, select Study. Homepage feeds, Shorts, recommendations and comments are eligible for reversible hiding; Work hides homepage feeds and Shorts. Relax or Off restores these mode-specific elements. Other websites use your personal cleanup rules, not universal mode heuristics.
4. Choose something to hide. The popup closes intentionally so you can select the page element. Click a small distraction, confirm the action, or press Escape to cancel. Main content, navigation, forms and players are protected. Some selections will be rejected. Use Remove next to its rule to restore it.
5. Custom media: choose an action, then select a visible supported button. Bypass only attempts exact English intro/recap/next labels alongside a playing video. Next Episode is restricted to the final 90 seconds. Synthetic DOM clicks are not trusted physical input; sites may refuse them. No universal-player guarantee is made.
6. Add a schedule. Times use your local clock; overnight periods are supported. Schedules override the manual mode while active, then return to it. Last matching schedule wins. Updates normally arrive within a minute, and foreground tabs reconcile on resume.
7. Add a daily limit using the exact hostname, including `www` when present. Approximate foreground time is counted every 15 seconds. A dismissible reminder appears after the limit; this is not a hard website blocker. Checkout/login paths are excluded from reminders and personal cleanup.
8. Turn Protect this website off in Clean. Both free and Pro processing should stop here and eligible Pro changes restore. Turn it on again to resume.
9. Use Open controls in a full tab for schedules and rule management without the toolbar popup closing. For element selection, return to the target website and use its toolbar popup.

## What runs locally

- Personal rules, schedules, website budgets and counters use `chrome.storage.local`.
- The service worker serializes configuration writes. Activity bursts batch into one write. Alarm listeners survive worker restarts; missing alarms are recreated at startup.
- Pro reuses the existing shared MutationObserver discovery queue; it adds no second full-page observer. Hidden elements are restored on deactivation. Working sets have bounds. These choices do not prove a universal under-2ms execution ceiling.
- Focus minutes are approximate foreground time, not verified productivity or time saved. Media counters record attempts, not confirmed successful skips. There is no browsing history export, external telemetry, or cloud sync.

## Deliberate limits

- The trial is local convenience access, not tamper-proof licensing. Clearing storage/reinstalling can reset it. Paid Pro must not launch on this mechanism.
- Billing, signed server-issued entitlements, renewal/refund/cancellation synchronization and offline grace require a chosen billing provider and hosted verification service. Never put billing secrets in this extension. The alpha does not simulate these systems.
- Mode presets currently target supported YouTube DOM structures, not every social platform. Personal selectors can stop matching after website redesigns. Closed shadow roots and inaccessible cross-origin player frames are unsupported.
- Limits are soft reminders, not parental controls. Tracking is approximate and intentionally pauses in hidden/unfocused windows. A tab's first 15 seconds may not count.
- No claim of 100% website compatibility, zero churn, guaranteed virality or production readiness is made.

## Validation

Run `node tests/pro-worker.cjs` for dependency-free model/worker checks. Run `node tests/pro-alpha.cjs` with Playwright and Chromium installed for real extension/browser fixtures. GitHub Actions now runs these suites successfully; see PRO-QA-REPORT.md for the exact evidence and boundaries. Do not interpret fixture success as universal live-platform compatibility or paid billing readiness.

Before charging: run real Chrome integration/visual QA, authenticated streaming tests, a multi-day sleep/restart/SPA soak, accessibility checks, performance profiles on low-end devices, and billing lifecycle tests against the chosen provider's sandbox. Recruit a small beta cohort before promotion.
