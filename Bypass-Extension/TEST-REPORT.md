# Bypass 0.9.1 verification

GitHub Actions runs the following suites for the current commit. Its downloadable extension artifact is created only when all required suites pass.

- Distribution: no Autopilot or payment files, valid local assets, runtime syntax, no network clients and intact icons.
- Worker: sender authorization, per-site defaults, concurrent settings, batched counters, duplicate retries and failed writes.
- DOM fixtures: cleanup and scroll restoration, forms/checkout protection, shadow roots, mutation bursts and supported streaming buttons.
- YouTube regression: silent speed resets with no media event, consecutive ads, delayed Skip Ad availability, reused controls, temporary rate rejection, explicit user changes and restoration.
- Popup: failed storage, loading races, keyboard controls, accessibility and enlarged text.
- Installed extension: popup UI with fixture tab selection, real decoded video playback, site settings, five consecutive silent resets, automatic Skip Ad, popup closure, protection toggles, media replacement, opt-in streaming and persistence across browser restart.

YouTube and streaming test markup is simulated. Live account/site compatibility still needs the manual checklist in README.md. No former paid feature is included in the current distribution.
