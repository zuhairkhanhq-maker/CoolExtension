# Bypass

A free local browser extension for website distraction cleanup, YouTube ad assistance and supported streaming intro skipping. No account or backend is required.

## Install

Extract the tested ZIP, open chrome://extensions, enable Developer mode, and select **Load unpacked**. Choose the extracted folder containing manifest.json. For an existing installation, update the same folder and click **Reload** to preserve the extension ID and local settings. Refresh open websites after updating.

## Development

Run npm ci --ignore-scripts, then npx playwright install chromium.

- npm run test:package
- npm run test:unit
- npm run test:free
- npm run test:popup
- npm run test:installed
- npm run build -- --zip

GitHub Actions tests the installed extension and DOM fixtures, then produces a runtime-only ZIP. Test evidence includes results and a real installed-popup screenshot. Autopilot and all former paid tools are removed.

Live-site verification is still required; player markup and behavior vary between accounts and website versions. See Bypass-Extension/README.md for behavior and manual checks.
