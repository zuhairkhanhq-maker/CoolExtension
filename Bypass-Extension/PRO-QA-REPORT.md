# Pro alpha QA — 2026-10-17 UTC

## Completed checks

- All JavaScript sources passed Node syntax parsing.
- 12/12 dependency-free worker/model tests passed. See `tests/pro-worker-results.json`. Three additional pure-model checks passed in the browser suite before its browser launch was blocked.
- Tested sender restrictions, trial concurrency, invalid-config rejection, hostname binding, duplicate-rule avoidance, 100-event batching without dropped increments, foreground usage checks, sleep-gap caps, service-worker state recovery, midnight usage reset, overnight/overlapping schedules, trial expiry, clock rollback, and retention of free settings.
- The four existing free content engines are byte-for-byte unchanged from the materialized 0.6.1 archive.

## Not verified

- Real browser integration and visual/accessibility QA: BLOCKED. Chromium is not installed. Attempts to fetch matching Playwright Chromium yielded invalid/empty archives. A browser fixture suite is included but has not passed here.
- Live YouTube/Netflix/Prime/Disney behavior and real websites: not tested in this turn.
- Under-2ms total execution on arbitrary pages: not established. The original scanner uses cooperative time slices; this is not a hard real-time guarantee.
- Paid billing and subscription entitlement lifecycle: not implemented; provider/account configuration is required.

## Release verdict

Suitable only for a developer-controlled internal alpha with the above limitations. Not approved for paid production, public growth campaigns or a claim that all Pro features are complete. Local website rules, mode presets, schedules, soft usage limits, custom media targeting, trial access and progress processing are implemented; browser execution remains to be confirmed.
