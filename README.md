# Bypass

A free, local browser extension for website cleanup, YouTube ad assistance, supported streaming controls and personal browsing rules.

All features are available without an account, subscription or backend. Working source is in `Bypass-Extension`.

## Install for testing

1. Download the latest repository ZIP and extract it.
2. Open `chrome://extensions` and enable Developer mode.
3. Click **Load unpacked** and select `Bypass-Extension`.
4. Refresh any websites that were already open.

For an existing unpacked installation, replace its files in the same folder and click **Reload**. Keeping the same extension ID preserves local settings and counters.

## Development

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run test:package
npm run test:unit
npm run test:free
npm run test:popup
npm run test:autopilot
npm run build -- --zip
```

The build contains runtime files only. GitHub Actions produces an installable ZIP and browser test evidence. Build output must use a fresh directory to avoid carrying stale files into the package.

Browser tests cover simulated site markup and real Chromium extension flows. Live YouTube and subscription streaming sites still require manual compatibility checks. See `Bypass-Extension/README.md` for feature behavior and test steps.
