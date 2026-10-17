# Bypass extension — internal QA

Working source is in `Bypass-Extension`. This is an internal alpha, not a paid production release. See its Pro documentation for scope and known limitations.

Run `npm install --ignore-scripts`, `npx playwright install chromium`, then `npm run test:unit`, `npm run test:free`, `npm run test:popup` and `npm run test:pro`.

GitHub Actions runs unit/model checks, real Chromium DOM fixtures for the free engines, popup behavior checks, and an unpacked Manifest V3 installation flow for Pro. Fixtures simulate ad and streaming player states; they are not authenticated live-platform compatibility evidence. Test artifacts are retained for seven days. Billing is not connected and must not be inferred from a green test run.
