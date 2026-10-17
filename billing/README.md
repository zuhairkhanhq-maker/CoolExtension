# Bypass billing — Paddle integration candidate

This implements the account, checkout, subscription and signed-access plumbing. It is not a claim of unlimited capacity or a live billing certification. You still need your own Paddle approval, infrastructure, secrets, domains and a successful sandbox checklist before collecting money.

## What is implemented

- Email-code sign-in: ten-minute codes, five verification attempts, atomic single use, device binding, hashed codes/sessions and shared database rate limits.
- A seven-day, no-card trial per verified account. Paid Paddle prices must have **no additional trial**, to avoid giving two trials. Clearing the extension's storage does not reset the server trial. Multiple aliases/accounts remain an abuse-management issue; this is not proof of one trial per human.
- Monthly/yearly server-selected prices. The client cannot submit arbitrary prices or customer IDs.
- A persistent checkout intent prevents concurrent requests from creating multiple purchases. Uncertain network outcomes are not retried blindly. Reopening a known pending checkout reuses it. Plan changes require discarding the old checkout with provider confirmation. Existing subscribers use the portal rather than buying twice.
- A Paddle-hosted customer portal for cancellation, payment methods and invoices. The backend derives the customer from the authenticated account, never from client input. Plan-change availability is controlled by your Paddle portal/catalog settings.
- Raw-byte HMAC verification, five-second signature timestamp tolerance, event-ID deduplication, durable queued processing, bounded retries, worker leases and a dead-letter state.
- Canonical provider retrieval instead of granting from webhook payloads. Subscription ownership is immutable after binding. Provider update timestamps prevent stale canonical reads from replacing newer state.
- Active/trialing access, bounded failed-payment grace, cancellation at period end, immediate paused/canceled denial, approved full current-period refund denial, chargeback denial and reversal recovery. Partial refunds/credits do not automatically revoke Pro. Changing this refund policy is a product decision, not a payment-provider guarantee.
- Periodic subscription and known-checkout reconciliation. Uncertain checkout outcomes without a transaction ID require a webhook or the recovery command below. This deliberately favors avoiding duplicate billing over silently starting another purchase.
- Device-bound P-256 signed entitlements. The extension pins your public key; the private key stays on the server. Default signed offline access lasts **one hour**, refreshed every fifteen minutes. Refund, logout and revocation delays are bounded by a previously issued offline grant, not instant across disconnected devices. Raising GRANT_SECONDS increases that risk; the hard maximum is 24 hours.
- Opaque account sessions live in the extension service worker's IndexedDB, not chrome.storage.local or website content scripts. Sessions expire after thirty days by default; users sign in again. Sign-out revokes the current session when online and always clears local access.

## Plug-in checklist

1. In Paddle **sandbox**, create one Pro product and two recurring prices: monthly USD 8.99 and annual USD 49.99 if retaining the current pricing. Use quantity one and no Paddle trial; the account trial is handled here. Configure taxes and your cancellation/refund terms in Paddle. Copy both `pri_...` IDs.
2. Prepare PostgreSQL 16+, an HTTPS domain (for example `https://billing.yourdomain.com`), an authenticated SMTP sender, and an API service plus a continuously running worker. Hosting, email and payment-provider fees are not zero-cost guarantees.
3. Run `npm ci` inside this directory. Run `npm run keys` locally once. Keep the private JWK and HMAC secret in your deployment's secret manager. Save only the public JWK to a JSON file. Never commit key-command output or paste private keys into the extension.
4. Copy `.env.example` to an untracked `.env` or add its fields in your host. Set DATABASE_URL, PUBLIC_ORIGIN, CHECKOUT_ORIGIN (same HTTPS origin), SMTP settings, PADDLE_ENV=sandbox, API key, client token, webhook secret, price IDs and signing settings. Client tokens and public JWKs are public; API keys, webhook secret, SMTP password, HMAC secret and signing private key are private.
5. `EXTENSION_IDS` is the comma-separated allowlist of your actual Chrome extension IDs. Obtain the stable store/draft ID before production. An unpacked extension in a different folder may have a different ID. For TLS database connections, use the provider's trusted CA chain; do not disable certificate verification. `DB_SSL=false` is for an isolated local test database only. Configure TRUST_PROXY_HOPS only behind exactly that many trusted proxies, and prevent direct access to the application port.
6. Use an environment loader supplied by your host, or `node --env-file=.env scripts/migrate.js` locally. Run the migration as a deployment step with a migration-capable DB role, then start API and worker separately (`node --env-file=.env src/server.js`, `node --env-file=.env src/worker.js`). Docker defaults to the API; override its command for the worker. Put HTTPS at your ingress. `/health` checks database reachability, not complete Paddle/SMTP readiness.
7. In Paddle, approve/set your default payment page to `https://billing.yourdomain.com/checkout`. This page loads Paddle.js; no remote payment script runs inside the extension. Create an API key with customer read/write, transaction read/write, subscription read, adjustment read and customer-portal session write permissions. The public client token must match sandbox/live. Customers are bound to verified Bypass accounts on the server; this mapping is unique and cannot be selected by the extension.
8. Add notification destination `https://billing.yourdomain.com/webhooks/paddle`; copy its destination secret. Subscribe to subscription.created/updated/activated/trialing/past_due/paused/resumed/canceled, transaction.created/updated/completed/payment_failed/canceled, and adjustment.created/updated. Keep server time NTP-synchronized. Deliver the exact raw body without proxy transformations. Acknowledge only after durable insertion.
9. Build a configured extension: `node scripts/configure-extension.js https://billing.yourdomain.com /absolute/path/public-jwk.json`. Load `../build/Bypass-Extension` for sandbox testing. This build ignores legacy local trials. Do not ship the repository's default unconfigured alpha, which intentionally retains local trials for the existing fixtures.
10. Complete every sandbox scenario below, then repeat configuration with live Paddle IDs/tokens/secrets and the approved live domain. Sandbox and live data are separate. Keep the same signing kid/public key pair unless deliberately rotating keys. During rotation, pin both old and new public keys in the extension before switching the server, and retain old keys until all old grants expire.

## Mandatory sandbox acceptance

- New email → code → verified account → no-card trial → expiry → Free, with rules preserved.
- Monthly and annual purchase, abandoned checkout, duplicate clicks, and a network timeout after transaction creation. Close/reopen checkout; confirm exactly one purchase and correct account binding.
- Successful payment → delayed/duplicate/reordered webhooks → Refresh access → Pro. A checkout success event alone must not unlock.
- Renewal success; failed renewal → recovery grace → successful recovery; grace expiry → Free; card update through the portal.
- Cancel at period end → access until period end; final cancellation/paused state → Free. Confirm the portal actually offers your intended plan/cancellation options.
- Approved full current-period refund and chargeback → access denied after refresh; pending or partial refund policy; chargeback reversal → recovery. Replay original notifications afterward.
- Sign out, session expiry, service-worker/browser restart, offline use before/after grant expiry, API outage, SMTP outage, rate limiting, DB outage, worker crash/lease recovery and a failed/dead job.
- Sign in on a second device; attempt to copy a grant to a different device; verify rejection. Confirm no session/email token is visible to website content scripts or chrome.storage.local.
- Review every displayed price, tax, trial, renewal and cancellation statement against your actual Paddle configuration, terms and privacy disclosures.

## Operations and capacity

API replicas are stateless; sessions, limits, intents and jobs are PostgreSQL-backed. Workers claim jobs using SKIP LOCKED, with four concurrent jobs per process. Use a transaction-mode database pooler, size DB_POOL_MAX against total replica counts, configure ingress/WAF limits, provider quotas and SMTP quotas, and monitor p95/p99 latency and pool saturation. PADDLE_RPM is a shared conservative API budget across replicas; provider 429s still back off safely. Do not increase it beyond your agreed Paddle quota.

Millions of installed free clients are not millions of simultaneous purchases. Capacity depends on paid users, refresh intervals, webhook volume, DB throughput and provider limits. A million-user claim requires a load test on the actual deployment and an agreed Paddle quota; it is not established by fixture tests. The six-hour reconciliation schedule is a target, not an SLA when the provider budget or queue is saturated.

Alert on queue age, dead jobs, provider failures, SMTP failures, webhook signature errors, account auth failures and database latency. Example inspection: `SELECT state,count(*),min(created_at) FROM webhook_jobs GROUP BY state;`. After correcting the underlying cause, requeue a selected dead event with `UPDATE webhook_jobs SET state='pending',attempts=0,next_at=now() WHERE event_id='<exact inspected event id>' AND state='dead';`. Do not bulk-reset unknown jobs.

For an uncertain checkout, inspect its intent and the Paddle dashboard. Recover only a confirmed transaction belonging to that intent/account with `node --env-file=.env scripts/recover-checkout.js <intent UUID> <transaction ID>`. This command verifies provider metadata and canonical status. Never cancel a genuinely paid transaction merely to clear a UI error.

Back up accounts/subscriptions/intents/adjustments, test restores, rotate secrets, isolate the DB network, give the runtime role only required table permissions, and define account-data retention/deletion procedures. Completed event metadata is pruned after 90 days; expired codes/rate buckets/sessions are pruned by the worker. Email delivery and Paddle store their own data under their policies. The app never uploads browsing rules, activity counters or visited-page content.

## Evidence boundaries

Automated tests exercise signatures, grants, policy and real PostgreSQL concurrency. The extension test uses a real installed Chromium extension with a simulated billing transport. No real Paddle/SMTP account or payment secrets are configured by this repository, so provider sandbox/live and deployment load tests remain your final launch gates. Do not charge users until those gates pass.

Official API references: https://developer.paddle.com/webhooks/about/signature-verification/ ; https://developer.paddle.com/api-reference/transactions/create-transaction/ ; https://developer.paddle.com/api-reference/subscriptions/get-subscription/ ; https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/ ; https://developer.paddle.com/webhooks/adjustments/adjustment-updated/ .
