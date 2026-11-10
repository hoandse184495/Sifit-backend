# Account and operations release

## Deploy without Docker

Use `deploy/RENDER_PAGES.md` for Render (BE) and Cloudflare Pages (FE).
Set Render `FRONTEND_URL` and `SOCKET_CORS_ORIGIN` to the exact public FE origin.
Set Pages `VITE_API_BASE_URL` to the BE origin followed by `/api/v1`, and
`VITE_SOCKET_URL` to the BE origin. Redeploy Pages after changing build variables.
For sifit.id.vn, use https://sifit.id.vn and https://api.sifit.id.vn once both
custom domains have valid DNS/TLS. Until then use the assigned Render/Pages URLs.

Before starting this version on an existing database, run `npm run db:prepare`
with the same production environment to create indexes for the new models.
MongoDB must support transactions (Atlas or a replica set).
Keep `BACKGROUND_JOBS_ENABLED=true`; jobs run inside `npm start`, with database
leases to avoid overlapping instances. A sleeping free hosting instance cannot
guarantee on-time reminders. No separate Docker worker is required.

## Email

Provide SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
in Render Environment. Port 587 uses STARTTLS; port 465 uses SMTP_SECURE=true.
Verify the sending domain and configure the SPF/DKIM records supplied by your
email provider. Check that your Render plan permits outbound SMTP; if it does
not, use a plan that permits it before enabling this transport.
Never put these credentials in Pages VITE variables or commit .env files.

Registration queues verification when SMTP is configured. Existing users can
request verification in Account > Profile. Password recovery is on the login
page. Generic recovery responses do not reveal account existence. Reset links
expire in 30 minutes, verification in 24 hours; only the latest link works and
each can be consumed once. Requests have IP limits and a 60-second cooldown.
Successful password reset/change invalidates existing access/refresh sessions
and disconnects sockets. Link tokens are hashed; email payloads are encrypted
using a key derived from JWT_REFRESH_SECRET. Rotating that secret invalidates
pending encrypted mail; request fresh links afterwards.

Email delivery retries five times. Admin > Operations shows failed or stale
mail and notifications, background job status and explicit audited retries.
Expired email links require a fresh request. Do a real test email before public
release; local tests mock transport and cannot verify provider delivery.

## Deadlines

Defaults: SELLER_SHIP_DAYS=3 after payment, SHIP_REMINDER_HOURS=24 before deadline,
DISPUTE_REVIEW_DAYS=3. Existing paid orders without a deadline are backfilled from
payment time, falling back to order creation time for legacy data. Reminders
are generated once per order. Admin and seller can view overdue shipping orders.
Overdue disputes/returns are escalated to admin, never automatically adjudicated.
Paid orders are never automatically cancelled by this deadline worker.

## Recovery after payout

An independent admin can accept a late complaint for a completed, paid-out order
in Operations > Recovery. Resolve the dispute for the buyer and satisfy any
required return first. Open a recovery case, contact the seller, and independently
verify actual incoming bank transfers before recording amounts and private image
proofs. The system records money; it does not initiate bank transfers or offset
future seller payouts. Incoming bank references are unique across PayOS payments
and recovery receipts.

After collecting the full seller allocation, create the refund under Finance,
using the exact order, dispute and remaining full buyer refund amount. Existing
refund approval, bank proof and completion controls remain required. Original
PAID payouts remain unchanged and the recovery ledger funds the refund.
This version supports one separately allocated order per paid payout and a full
remaining refund. Bundled or mismatched legacy payouts require separate manual
reconciliation; the API rejects them instead of guessing allocations.

## Validation

BE: npm test; npm run lint.
FE: npm run lint; npm run build; set SIFIT_BACKEND_DIR to this backend and run
npm run test:integration. Integration uses an isolated MongoDB replica set and
simulated external payment/shipping/storage/email; no production database.
