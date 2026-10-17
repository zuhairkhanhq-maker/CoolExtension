# Historical V0.6.1 Pro UI Preview validation

For the current 0.7.0 internal alpha, see PRO-QA-REPORT.md. The following results do not validate the newly added Pro processing or UI.

Date: 2026-10-16

## Scope

This version changes the popup visual identity, information architecture and Pro discovery flow only. Existing
cleanup, video assistance, streaming behavior, permissions, storage behavior and supported sites
are unchanged.

The new interface separates the product into two clear destinations:

- **Clean** contains every currently working Free control.
- **Autopilot Pro** explains the planned Study, Work and Relax experience, personal cleanup,
  schedules and private progress without presenting those systems as operational.

The trial offer is a design preview. It clearly states that entitlement and billing are not
connected. Selecting a plan changes only the visible pricing choice and does not create a trial,
charge the user or unlock Pro.

## Current validation

- All nine runtime JavaScript files pass `node --check`.
- Popup HTML contains 43 unique IDs with zero duplicate IDs.
- Every `aria-labelledby`, `aria-describedby` and `aria-controls` reference resolves.
- Eleven interactive buttons are explicitly typed.
- CSS structure is balanced across 106 rule blocks.
- Manifest version and fixture contract agree on `0.6.1`.
- The original v0.5.2 runtime files were compared byte-for-byte with this package; only the popup,
  documentation, manifest version and UI-focused tests changed.

## Preserved baseline

The previous v0.5.2 package passed 74/74 engine and integration fixtures, 10/10 popup-quality
checks and 2/2 popup sizing checks. Those historical artifacts are retained under
`tests/baseline-v0.5.2/` and are not presented as current v0.6.0 browser results.

## Browser validation gate

Current browser-driven test files now include checks for:

- Clean and Autopilot tab separation.
- Locked Pro actions opening a reversible value-first offer.
- Monthly and annual selection semantics.
- Focus restoration when the offer closes.
- WCAG A/AA automated checks for both the Autopilot preview and open offer.
- Existing loading, storage failure, malformed response, keyboard, text scaling and sizing cases.

The current environment did not contain a compatible Chromium binary, and its browser download
endpoint was unavailable. Therefore the updated Playwright and Axe checks are included but are not
claimed as executed here. Run the documented developer commands before treating this preview as a
release candidate.

## Deliberately not implemented

- Authentication or accounts.
- Trial entitlement.
- Subscription billing.
- Pro mode execution.
- Personal cleanup rules.
- Scheduling, website limits or Pro progress calculations.

These remain the next engineering phase after the interface is approved.
