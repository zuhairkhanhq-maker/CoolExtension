# Bypass – Elite Web Optimizer · V0.7.0 internal Pro alpha

Current status: local Pro processing is implemented, but browser integration/visual QA is blocked and paid billing is not configured. Read PRO-ALPHA-README.md and PRO-QA-REPORT.md first. The 0.6.1 notes below describe historical baseline work, not validation of 0.7.0.

## V0.6.1 visual identity polish

The temporary arrow and pastel glyphs were replaced with a custom geometric Bypass monogram and
a consistent premium line-icon system. Toolbar icons now use the same scalable identity at 16,
48 and 128 pixels. Mode cards use restrained dark tiles, clear Pro locks and unified spacing while
preserving the approved Clean and Autopilot structure.

## V0.6.0 Pro interface preview

The popup now separates the working free experience into **Clean** and presents the planned
**Personal Internet Autopilot** inside a clear Pro preview. Free users can understand Study, Work
and Relax modes, personal cleanup, schedules and private progress before opening the seven-day
trial offer. The trial and pricing flow is intentionally non-operational until entitlement and
billing engineering are approved. Existing cleanup and video behavior is unchanged.

Local-only vanilla JavaScript browser extension. No account, backend, remote runtime code, AI inference, analytics, or production libraries. This is a tested release candidate; live-site and native extension validation remain necessary.

## V0.5.2 discovery update

Existing features only. No new permissions, supported platforms, backend, tracking, monetization, or runtime dependencies.

- **Auto-skip intros is now visible on every website** so users can discover it. On unsupported pages its switch remains disabled and the popup says it works on Netflix, Prime Video and Disney+.
- On a supported platform the message changes to **Ready on [platform]**, the intro switch becomes available, and the existing recap/next-episode options appear.
- Visibility in the popup does not mean universal video support. Streaming behavior, defaults and site adapters are unchanged.

- Standardized readable source formatting and removed narrative runtime comments. Functional identifiers, match labels and user-facing language remain intact. Maintenance rationale lives in this documentation and TEST-REPORT.md.
- Consolidated popup CSS and improved text size, contrast, focus styles, target size, accessible names and status wording. Existing disclosures, switches and sharing remain in place. Activity now omits zero-valued categories and uses singular/plural wording.
- Fixed settings initialization races and safe failure behavior, ordinary HTTP counter persistence, the 512-event deduplication boundary, detached cookie node restoration, hidden reject-button wrappers and scroll-style ownership.
- Hardened existing streaming controls against repeated metadata, externally associated submit buttons and focused editable content inside shadow roots.
- The architecture remains local and per-device. There is no shared traffic-dependent backend. Bounded engine queues, batched serialized writes and cooperative discovery remain; this is not proof of universal performance or a massive-user launch.

## Install / update
1. Back up your existing unpacked folder.
2. Replace its contents with this ZIP's Bypass-Extension contents, including core/streaming-sites.js, content-scripts/streaming-skipper.js, the popup files and manifest.
3. Open chrome://extensions or edge://extensions and click Reload on Bypass.
4. Refresh your website tabs. Keep only one Bypass copy enabled.

Use the same installed folder to preserve extension identity and counters. Existing settings are preserved. Loading another folder may create a separate extension.

## Simple controls
- **Enable Bypass on this site:** master ON/OFF for the exact hostname.
- **Reduce distractions:** supported cookie banners, newsletter prompts, unsolicited support nudges, and labeled sticky advertising slots. This replaces the previous Hide cookie banners label. Your existing choice is retained.
- **Speed up YouTube ads:** independent supported-player assistance on YouTube. Other sites show this unavailable.
- **Auto-skip intros (Beta):** always visible for discovery and initially OFF. It becomes configurable on recognized Netflix, Prime Video and Disney+ domains.
- **More streaming options:** separate Skip recaps and Start next episode toggles, initially OFF. Choices are saved per exact hostname.
- **Activity on this device:** expandable all-time counters; the line above the controls is this document's activity only.
- **What does this clean?:** explains coverage and restoration limits.

You can close the popup and keep browsing. Turning the master off disables all feature controls and restores cosmetic changes Bypass still owns. Turning it back on restores your saved preferences. Native close/reject actions already submitted to a site cannot be undone by Bypass.

## Streaming beta — read before testing

This build adds local button automation for recognized **Netflix, Prime Video and Disney+ web players**. The adapters are covered by browser fixtures, not certified against signed-in live services. Platform DOM changes, language variants and actual playback behavior may prevent assistance. Streaming controls show only on recognized domains; Amazon storefronts may show the controls, but automation requires a recognized video player.

- Intro and recap: only exact supported labels or unambiguous Netflix action attributes; never a generic “Skip” or “Skip Ad” match. English and a small set of Spanish, German, French and Portuguese labels are included; this is not full multilingual support.
- Next episode: separate opt-in; at most 15 seconds before the end or after ended playback; requires a recognized end card or specific episode control. Generic “Watch Next” recommendations and persistent toolbar Next controls stay manual. A Disney movie recommendation is not treated as an episode.
- Controls must be visible, enabled, unobstructed, outside forms, and inside a recognized player with exactly one visible, ready video and a finite duration of at least two minutes. Intro/recap automation waits while paused. Focused form fields prevent clicking.
- One attempt per action per video/episode identity; ignored clicks do not loop. Route/media source changes start a new identity. Repeated metadata for the same identity does not reset click protection. Turning OFF/ON or a simulated BFCache restoration alone does not re-click an existing episode. A manual trusted click is respected.
- Uses ordinary HTMLElement.click(). Synthetic events cannot be forged into trusted human input. Sites can ignore them. No network interception, playback speed changes, DRM interference, age assertions or automatic “Still watching?” dismissal.
- No inference-server cost, remote dependencies, account requirement or new browser permissions. The new engine subscribes to shared discovery only when opted in on a recognized site. It uses bounded candidate sets, scoped player observers and throttled media events, with no constant polling interval. Cooperative work slices target responsiveness; they do not guarantee two-millisecond execution.
- This release does **not** support arbitrary anime sites, iframe-hosted players, native streaming apps, mobile apps or smart TVs. Player controls separated from their media by shadow boundaries are also left alone. Those need separately verified adapters.

### Your live test — desktop Chrome / Edge
1. Update the same installed extension folder, reload Bypass, then refresh the streaming tab.
2. Open a series episode with a native Skip Intro button. Open Bypass and turn on **Auto-skip intros**. Close the popup and watch normally.
3. Expect one intro skip when the visible control appears. Normal playback speed and sound must remain unchanged. A local “Streaming clicks attempted” count is an attempt, not proof that playback skipped.
4. Test at least three consecutive episodes. Test pause/resume, fullscreen, a new episode without page reload, and returning from another tab. Automation intentionally waits while the document is hidden.
5. Turn **Auto-skip intros OFF** before the next intro: it must remain manual. Turn the site master OFF: all automation must stop. Turn it back ON: saved choices must return.
6. In **More streaming options**, enable recaps only if wanted. Test it separately. Enable next episode only if wanted; it must not advance in the middle of an episode or start an unrelated movie recommendation.
7. Repeat on each advertised service/browser/OS and with multiple users. Record the service, browser/OS, interface language, action, expected result, actual result, and a screenshot of the visible button. Do not include credentials or payment details.

If nothing happens, use the site's native control. Do not broaden selectors to all matching text across the web. First obtain the actual failing player markup and add a narrow regression fixture. Keep Beta labeling until real-site tests pass.

## Distraction coverage
| Type | Conditions / action |
|---|---|
| Cookie banners | Existing OneTrust, Cookiebot, Didomi and conservative generic consent handling. |
| Newsletter popups | Newsletter signature plus relevant text and floating/modal geometry. Prefer an explicit safe close control. |
| Support prompts | Recognized unsolicited nudge/teaser signature plus help text. Preserve launcher, input fields, editable chats and iframe widgets. |
| Sticky top/bottom ads | Ad-slot signature plus Advertisement/Sponsored labeling, fixed/sticky position, edge geometry and bounded height. Hide only the slot. |
| Unknown distractions | Left unchanged until an adapter or reliable detection evidence is available. |

The additional engine reads at most 180 descendant nodes / 4 KB of sampled text per candidate. Queues, suppression maps and processing slices are bounded. These limits target responsiveness, not a guarantee of under-2-ms execution.

## Preservation rules
Age/identity verification, account/security prompts, navigation, checkout, active chats and user-interacted prompts are protected by conservative checks. The extension does not state an age, forge trusted events, fill birth dates, bypass access controls, or click affirmative age confirmation buttons.

Modal dialogs are closed through a recognized close control so the site can release focus traps, inert content, backdrops and scroll locks. A non-working close button is not a reason to blindly remove the dialog. Unknown scroll locks and large/ambiguous structures are left alone. Never assume every site follows accessible modal conventions.

No broad removal of every header, footer, iframe, or element marked aria-modal. Hiding an element is not network ad blocking, cookie rejection confirmation, or tracking prevention.

## What is counted
- banners_vaporized: recognized cookie banners cosmetically suppressed.
- consent_actions: attempted reject clicks, not verified stored preferences.
- ads_skipped: assisted ad-state episodes observed returning to normal; not independently verified ad skips or measured time saved.
- streaming_clicks: native streaming button click attempts, including attempts a site may ignore. No claimed successful skip or time saving.
- distractions_hidden: recognized extra distractions hidden by Bypass or observed disappearing within 200 ms after a close attempt; not proof of permanent dismissal or causal attribution.

Cookie/distraction counts deduplicate per element/document; a site's replacement element may count again. Whole-page navigation resets tab-load counts; SPA route changes do not. All-time totals are stored locally. Background batches wait up to 25 ms or 128 messages and acknowledge after persistence; last 512 event IDs deduplicate retries. Abrupt crashes or repeated storage failure can still lose events.

## Known limits
- Only top-level matched HTTP/HTTPS pages are injected. Browser internal pages, closed shadow roots and cross-origin iframe contents are not covered.
- No guarantee of pre-paint hiding. Settings and bounded asynchronous discovery run first.
- A silently attached open shadow root can wait for the 15-second visible-page audit.
- English generic phrases plus explicit signatures: no universal multilingual classifier.
- User input within the previous two seconds conservatively exempts newly discovered prompts for that document. This avoids closing a popup the user requested, but can leave unsolicited prompts visible too.
- Non-modal cosmetic hiding does not control site scripts; a site that rewrites display can show the element again. No endless style fight.
- Native support iframe internals remain untouched. Normal headers/footers and unlabeled sticky boxes remain.
- DOM signatures, real playback constraints and site logic vary. Existing YouTube support is unchanged; future site changes can require updates.
- No promise of universal zero-breakage, zero input lag, or store approval.

## Developer tests
Install Node.js and Playwright for development, install its Chromium, and run:

    npm install --no-save playwright
    npx playwright install chromium
    node tests/browser-fixtures.cjs
    node tests/popup-sizing.cjs
    npm install --no-save axe-core@4.10.3
    node tests/popup-quality.cjs

Optional environment variables PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE select local tools. No test dependencies are included in runtime files. See TEST-REPORT.md for final results and unverified native/live-site gates.

## Research informing the streaming design
- Browser event trust: https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
- Public selector evidence (Netflix action attributes and Prime skip class): https://gist.github.com/acarlson99/b8dcf505fab7ec1b69becdb0310e3f7f
- Public Disney end-card hook evidence: https://gist.github.com/auipga/cf1bfe94968c8fa45f1341745f41a63f
- Existing service-adapter design and maintenance context: https://github.com/Meowsbot/auto-skip

These references informed narrow detection and constraints. The implementation is original. They do not prove the selectors work in your current account, region or device.

## Research informing the distraction design
- W3C modal dialog pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- W3C native dialog technique: https://www.w3.org/WAI/WCAG22/Techniques/html/H102
- Intercom Messenger visibility: https://www.intercom.com/help/en/articles/189-hide-the-messenger
- Chrome content script isolation: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

These references explain browser/UI constraints; they do not certify Bypass compatibility with those services.
