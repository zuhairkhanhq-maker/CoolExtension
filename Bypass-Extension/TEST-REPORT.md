# Bypass 0.9.0 test coverage

The current extension is fully free. Historical trial and billing test suites were retired with the payment implementation; their earlier results do not describe this release.

## Automated suites

| Suite | Coverage |
| --- | --- |
| Package | Runtime-only distribution, local assets, JavaScript syntax, no network clients, binary icon integrity, stale-output rejection |
| Worker/model | Legacy migration, unrestricted access, sender authorization, concurrent revisions, batched counters, focused usage, schedules, clock boundaries, malformed storage |
| Browser fixtures | Cookie/distraction cleanup, forms and checkout safety, scroll restoration, consecutive YouTube ads, delayed/reused Skip Ad buttons, playback restoration, supported streaming controls, shadow DOM and mutation bursts |
| Popup | Loading/storage races, failed saves, keyboard controls, unsupported pages, counter wording, enlarged text and automated accessibility rules |
| Installed extension | Fresh free access, real settings UI, safe personal hiding and restoration, element picker, schedules and reminders, YouTube presets, busy pages, custom media safety, expired legacy records and offline use |

GitHub Actions runs all suites and uploads the free ZIP only when they pass. Its separate evidence artifact contains detailed results and screenshots. See the repository's latest **Extension QA** run for the tested commit and results.

## Manual acceptance

Follow the checklist in README.md on your own browser and supported live sites before public launch. Automated ad/player fixtures cannot prove compatibility with every account, experiment, language or future website version. Automated accessibility checks are not a complete accessibility certification.
