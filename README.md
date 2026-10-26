# SIFIT Backend

SIFIT is a production-oriented backend foundation for a C2C second-hand fashion marketplace. It is designed for users who can buy and sell from the same account, while SIFIT later manages commissions, verified payments, seller payouts, disputes, and admin operations.

This initialization focuses only on the backend foundation: Express application setup, environment validation, MongoDB connection management, centralized errors, a health endpoint, testing, linting, and maintainable project structure.

## Technology Stack

- Node.js Active LTS
- JavaScript with CommonJS
- Express.js
- MongoDB and Mongoose
- dotenv and Zod
- helmet, cors, express-rate-limit, cookie-parser, morgan
- Argon2 and jsonwebtoken prepared for future authentication
- Jest and Supertest
- ESLint and Prettier

## Folder Structure

```text
src/
  config/         Environment, CORS, and MongoDB configuration
  constants/      Shared constants such as roles and HTTP status codes
  controllers/    HTTP request and response handlers
  middlewares/    Error, not-found, and rate-limit middleware
  models/         Future Mongoose schemas
  routes/         API route definitions
  services/       Business logic independent from Express
  utils/          API helpers, async handling, and logging
tests/            Jest and Supertest tests
```

## Installation

```bash
npm install
```

## Environment Configuration

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Required and supported variables:

```text
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/sifit
FRONTEND_URL=http://localhost:5173
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
REFRESH_COOKIE_SAME_SITE=lax
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
RESERVATION_EXPIRES_IN_MINUTES=15
PAYMENT_PROVIDER=simulator
PAYMENT_MODE=sandbox
PAYMENT_WEBHOOK_SECRET=
PAYMENT_RETURN_URL=http://localhost:5173/payment/result
PAYMENT_CANCEL_URL=http://localhost:5173/payment/cancel
PAYOUT_MODE=simulation
PAYOUT_HOLD_DAYS=7
SHIPPING_PROVIDER=simulator
SHIPPING_MODE=sandbox
SHIPPING_WEBHOOK_SECRET=
BUYER_PROTECTION_DAYS=3
SELLER_VERIFICATION_MODE=simulation
COMMISSION_RATE=10
REVIEW_EDIT_WINDOW_DAYS=7
SOCKET_IO_ENABLED=true
SOCKET_CORS_ORIGIN=http://localhost:5173
CHAT_MAX_MESSAGE_LENGTH=2000
CHAT_MAX_MESSAGES_PER_MINUTE=30
NOTIFICATION_OUTBOX_BATCH_SIZE=100
NOTIFICATION_OUTBOX_RETRY_LIMIT=5
```

JWT secrets are required outside the test environment and must be strong random values with at least 32 characters. `PORT` must be a valid TCP port and `COMMISSION_RATE` must be between `0` and `100`.

## MongoDB Setup

Run MongoDB locally or provide a valid remote MongoDB connection string in `MONGODB_URI`. The HTTP server connects to MongoDB before listening for requests and exits if the initial connection fails.

## Scripts

```bash
npm run dev      # Start with nodemon
npm start        # Start production-style Node process
npm test         # Run Jest tests
npm run lint     # Run ESLint
npm run format   # Format files with Prettier
npm run seed:categories # Idempotently seed initial product categories
npm run worker:expire-reservations # Expire unpaid reserved checkouts
npm run worker:reconcile-payments  # Expire unresolved simulator payment attempts
npm run worker:evaluate-payouts    # Evaluate payout eligibility foundation
npm run worker:process-payouts     # Process simulated approved payouts foundation
npm run worker:reconcile-shipments # Simulator shipment reconciliation placeholder
npm run worker:complete-deliveries # Complete eligible delivered orders
npm run worker:dispute-deadlines   # Dispute deadline placeholder
npm run worker:notification-outbox # Deliver queued notification outbox events
```

## API Endpoints

### `GET /api/v1/health`

Successful response when MongoDB is connected:

```json
{
  "success": true,
  "message": "SIFIT API is running",
  "data": {
    "status": "ok",
    "database": "connected"
  }
}
```

When MongoDB is unavailable, the endpoint returns `503` using the centralized error format.

### `POST /api/v1/auth/register`

Registers a public account as `BUYER` (default) or `SELLER`, using the optional `role` request field. `ADMIN` cannot be self-registered.

```json
{
  "fullName": "Nguyen Van A",
  "email": "user@example.com",
  "password": "StrongPassword123!"
}
```

### `POST /api/v1/auth/login`

Verifies credentials, returns a short-lived access token, and stores the refresh token in an HttpOnly cookie.

```json
{
  "email": "user@example.com",
  "password": "StrongPassword123!"
}
```

### `POST /api/v1/auth/refresh-token`

Reads the refresh token from the HttpOnly cookie, rotates it, revokes the previous refresh session, and returns a new access token.

### `POST /api/v1/auth/logout`

Revokes the current refresh session and clears the refresh cookie. Repeated logout requests are safe.

### `GET /api/v1/auth/me`

Requires an `Authorization: Bearer <accessToken>` header and returns the current safe user profile.

### `PATCH /api/v1/auth/change-password`

Requires a valid access token. Verifies the current password, stores the new password with Argon2id, revokes active refresh sessions, and requires login again.

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!"
}
```

## Product And Category APIs

Public endpoints:

- `GET /api/v1/categories` returns active categories.
- `GET /api/v1/products` returns active, non-deleted products with pagination and filters.
- `GET /api/v1/products/:id` returns one active product with safe seller fields only.

Product list query parameters:

```text
page=1
limit=20
search=denim
categoryId=<categoryId>
condition=GOOD
size=M
brand=Levis
minPrice=100000
maxPrice=500000
sort=newest|oldest|price_asc|price_desc
```

Authenticated user endpoints:

- `POST /api/v1/products` creates a draft product for the authenticated user.
- `GET /api/v1/products/my` returns the authenticated user's products.
- `PATCH /api/v1/products/:id` edits only owned `DRAFT` or `REJECTED` products.
- `DELETE /api/v1/products/:id` soft-deletes an owned product unless it is `RESERVED` or `SOLD`.
- `POST /api/v1/products/:id/submit` submits an owned draft/rejected product for moderation.
- `POST /api/v1/products/:id/images` uploads product images using multipart form-data field `images`.
- `DELETE /api/v1/products/:id/images/:publicId` removes an owned editable product image. URL-encode `publicId` because Cloudinary IDs contain slashes.

Create product example:

```json
{
  "title": "Vintage denim jacket",
  "description": "A clean second-hand denim jacket in good condition.",
  "price": 250000,
  "categoryId": "68f000000000000000000001",
  "brand": "Levis",
  "size": "M",
  "color": "Blue",
  "condition": "GOOD"
}
```

Admin endpoints:

- `GET /api/v1/admin/products/pending`
- `PATCH /api/v1/admin/products/:id/approve`
- `PATCH /api/v1/admin/products/:id/reject`
- `POST /api/v1/admin/categories`
- `PATCH /api/v1/admin/categories/:id`

Reject product example:

```json
{
  "reason": "Product images are unclear"
}
```

Category example:

```json
{
  "name": "Túi xách",
  "slug": "tui-xach",
  "description": "Bags and purses",
  "isActive": true
}
```

## Cloudinary

Product image upload uses Multer memory storage and Cloudinary. Configure:

```text
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Uploads accept JPEG, PNG, and WebP only, with a maximum of 5MB per image and 8 images per product. The backend validates actual file contents before upload. Newly uploaded Cloudinary assets are cleaned up if the database update fails. If Cloudinary deletion fails after removing an image reference, the public ID should be reconciled by a future retry job.

## Product Lifecycle

```text
DRAFT -> PENDING -> ACTIVE
PENDING -> REJECTED
REJECTED -> DRAFT -> PENDING
ACTIVE -> RESERVED -> SOLD
ACTIVE -> ARCHIVED
```

`RESERVED` and `SOLD` transitions are reserved for future order management. Sellers cannot directly publish products; moderation is mandatory.

## Postman Flow

1. Run `npm run seed:categories`.
2. Register or log in with `/api/v1/auth/register` and `/api/v1/auth/login`.
3. Copy `data.accessToken`.
4. Add `Authorization: Bearer <accessToken>` for product creation.
5. Create a product with `POST /api/v1/products`.
6. Upload images with `POST /api/v1/products/:id/images`, body type `form-data`, key `images`, type `File`.
7. Submit with `POST /api/v1/products/:id/submit`.
8. Use an `ADMIN` account to approve or reject from `/api/v1/admin/products/:id/approve` or `/reject`.

## Cart APIs

All cart routes require `Authorization: Bearer <accessToken>`.

- `GET /api/v1/cart` returns the current user's cart with safe product and seller summaries.
- `POST /api/v1/cart/items` adds one active product.
- `DELETE /api/v1/cart/items/:productId` removes a product safely.
- `DELETE /api/v1/cart` clears the cart.

Add item example:

```json
{
  "productId": "68f000000000000000000001"
}
```

Cart prices are informational. Checkout reloads current product prices from MongoDB.

## Checkout And Orders

SIFIT uses a parent `CheckoutGroup` plus seller-specific `Order` documents. A single buyer checkout can create multiple seller orders, one per seller. Buyers can see every order created by their checkout; sellers can only see their own seller-specific orders; admins can see all orders.

Checkout:

- `POST /api/v1/orders`

```json
{
  "shippingAddress": {
    "recipientName": "Nguyen Van A",
    "phone": "0901234567",
    "addressLine": "123 Nguyen Trai",
    "ward": "Ben Thanh",
    "city": "Ho Chi Minh City"
  },
  "notes": "Please call before delivery",
  "idempotencyKey": "11111111-1111-4111-8111-111111111111"
}
```

Buyer order APIs:

- `GET /api/v1/orders/my`
- `GET /api/v1/orders/:id`
- `POST /api/v1/orders/:id/cancel`

Seller order APIs:

- `GET /api/v1/seller/orders`
- `GET /api/v1/seller/orders/:id`

Admin order APIs:

- `GET /api/v1/admin/orders`
- `GET /api/v1/admin/orders/:id`

Pagination and filtering:

```text
page=1
limit=20
status=PENDING_PAYMENT
```

Admin order listing also accepts `search=<orderObjectId>`.

## Commission Rules

For this phase, commission is calculated on product subtotal only. Shipping is excluded from commission and seller proceeds. Monetary values are stored as integer VND units.

`COMMISSION_RATE=10` means 10 percent. Internally the order snapshot stores `commissionRateBasisPoints=1000`. Commission uses deterministic nearest-VND rounding:

```text
commissionAmount = round(subtotal * commissionRateBasisPoints / 10000)
sellerProceeds = subtotal - commissionAmount
```

Seller proceeds are historical accounting values, not payable balances. Real payouts are reserved for a future payment and settlement phase.

## Order Lifecycle

```text
PENDING_PAYMENT -> PAID -> PROCESSING -> SHIPPED -> DELIVERED -> COMPLETED
PENDING_PAYMENT -> CANCELLED
PAID -> REFUND_PENDING -> REFUNDED
```

This phase does not expose insecure endpoints to mark orders as paid or completed. Future verified payment webhooks should advance payment state.

## Reservation Lifecycle

Checkout atomically reserves products by moving them from `ACTIVE` to `RESERVED` and creates unpaid orders. If payment is not completed before `reservationExpiresAt`, run:

```bash
npm run worker:expire-reservations
```

The worker claims expired checkout groups with a short database lease, cancels unpaid orders, and restores reserved products to `ACTIVE`. It is idempotent and safe to run repeatedly. It does not delete historical order records.

## Idempotency

Checkout requires an `idempotencyKey` UUID. The same buyer and key with the same canonical payload returns the original checkout result. The same key with a different payload returns `409 Conflict`. This prevents duplicate orders from retries.

## MongoDB Transactions

Checkout, cancellation, and reservation expiry use MongoDB multi-document transactions. Local MongoDB must run as a replica set; standalone MongoDB cannot provide the required safety.

Single-node local replica set outline:

```bash
mongod --dbpath <your-data-path> --replSet rs0 --bind_ip localhost
mongosh
rs.initiate()
```

MongoDB Atlas also supports transactions. Automated transaction tests use an isolated in-memory replica set and do not touch development data.

## Payment Foundation

Payments use a provider abstraction with a simulator-only implementation for this phase. The simulator does not transfer real money, does not use external gateway credentials, and is rejected in production.

Payment APIs:

- `POST /api/v1/payments`
- `GET /api/v1/payments/:id`
- `POST /api/v1/webhooks/payments/:provider`

Create payment example:

```json
{
  "checkoutGroupId": "68f000000000000000000001",
  "idempotencyKey": "11111111-1111-4111-8111-111111111111"
}
```

The backend always loads the amount from `CheckoutGroup`. A browser redirect is not proof of payment. Only a verified provider webhook can advance payment state.

Simulator webhooks are signed with `PAYMENT_WEBHOOK_SECRET` using HMAC-SHA256 over the JSON payload and sent as `x-sifit-signature`.

Verified payment success atomically marks the payment, checkout group, and seller orders as paid, moves reserved products to `SOLD`, creates commission records, and posts balanced ledger entries. Late payment success for cancelled or expired reservations is recorded as an exception and does not reactivate inventory.

## Financial Ledger

The ledger is append-only and double-entry. Every entry must balance, and each source event has a unique key to prevent duplicate posting.

Verified simulator payment success posts:

- Debit `provider_clearing`.
- Credit `seller_liability`.
- Credit `platform_commission_revenue_pending`.

Corrections should use reversal entries rather than editing historical records.

## Seller Finance

Seller APIs:

- `GET /api/v1/seller/earnings`
- `GET /api/v1/seller/payouts`
- `GET /api/v1/seller/payouts/:id`

Admin finance APIs:

- `GET /api/v1/admin/payments`
- `GET /api/v1/admin/commissions`
- `GET /api/v1/admin/payouts`
- `GET /api/v1/admin/financial-summary`
- `POST /api/v1/admin/payouts/:id/approve`
- `POST /api/v1/admin/refunds`

Payouts are simulation records only. Approval does not transfer funds. Real payouts require verified seller destination data, encryption for sensitive fields, settlement holds, reconciliation, provider authorization, and legal review.

## Refund Foundation

Refund requests are simulator records linked to successful payments. Refund amounts cannot exceed the remaining refundable amount. Refund completion still requires future provider confirmation. Refunds do not automatically restore sold inventory.

## Production Payment Checklist

- Replace simulator with an approved provider adapter based on official documentation.
- Verify merchant permissions for collection, refunds, marketplace settlement, and payouts.
- Verify webhook signatures, event IDs, replay protection, and reconciliation behavior.
- Run MongoDB with transaction support.
- Store secrets in environment variables or a secrets manager.
- Add operational alerts for payment exceptions and reconciliation failures.

## Seller Profiles And Verification

Seller profile APIs:

- `POST /api/v1/seller/profile`
- `GET /api/v1/seller/profile`
- `PATCH /api/v1/seller/profile`
- `GET /api/v1/shops`
- `GET /api/v1/shops/:slug`

Verification APIs:

- `POST /api/v1/seller/verification/submit`
- `GET /api/v1/seller/verification/status`
- `GET /api/v1/admin/seller-verifications`
- `PATCH /api/v1/admin/seller-verifications/:id/approve`
- `PATCH /api/v1/admin/seller-verifications/:id/reject`

The current verification mode is simulation-only. It must not be treated as completed legal KYC in production.

## Addresses

Address APIs require authentication:

- `GET /api/v1/addresses`
- `POST /api/v1/addresses`
- `PATCH /api/v1/addresses/:id`
- `DELETE /api/v1/addresses/:id`
- `PATCH /api/v1/addresses/:id/default`

Addresses are owned by users, soft-deleted with `isActive=false`, and historical order/shipment records keep snapshots.

## Shipping And Delivery

Shipping uses a provider abstraction:

- `shippingProvider.interface.js`
- `simulator.provider.js`
- `shippingProvider.factory.js`

Simulator shipping is sandbox-only and rejected in production.

Shipping APIs:

- `POST /api/v1/shipping/quote`
- `POST /api/v1/seller/orders/:orderId/shipments`
- `GET /api/v1/shipments/:id`
- `GET /api/v1/orders/:orderId/tracking`
- `GET /api/v1/seller/shipments`
- `GET /api/v1/admin/shipments`
- `POST /api/v1/webhooks/shipping/:provider`
- `POST /api/v1/orders/:id/confirm-receipt`
- `POST /api/v1/admin/shipments/:id/review-delivery`

Shipping webhooks are signed with `SHIPPING_WEBHOOK_SECRET` using HMAC-SHA256 over the JSON payload and sent as `x-sifit-signature`.

Delivery is verified by trusted provider webhook or admin review. Buyer acknowledgment does not override provider evidence. Sellers cannot mark their own shipment delivered.

## Reviews, Seller Ratings, And Wishlist

Product reviews require a verified completed purchase. The backend checks that the authenticated buyer owns the order, the product belongs to that order, the order is `COMPLETED`, payment is `PAID`, delivery exists, and no active dispute is open. Buyers cannot review their own products, and each buyer can review a product only once per order.

Product review APIs:

- `POST /api/v1/reviews/products`
- `GET /api/v1/products/:productId/reviews`
- `GET /api/v1/products/:productId/reviews/summary`
- `GET /api/v1/reviews/my`
- `GET /api/v1/reviews/:id`
- `PATCH /api/v1/reviews/:id`
- `DELETE /api/v1/reviews/:id`
- `POST /api/v1/reviews/:id/reply`
- `POST /api/v1/reviews/:id/images`
- `DELETE /api/v1/reviews/:id/images/:publicId`

Create review example:

```json
{
  "orderId": "68f000000000000000000001",
  "productId": "68f000000000000000000002",
  "rating": 5,
  "title": "Great item",
  "comment": "Exactly as described"
}
```

Review images use multipart form-data field `images`, accept JPEG, PNG, and WebP, and are limited to 5 images per review. Edits are limited by `REVIEW_EDIT_WINDOW_DAYS`. Author removal is a soft removal and cannot be restored by admin moderation.

Seller ratings are tied to completed seller-specific orders and drive seller reputation. Product reviews do not affect seller reputation.

Seller rating APIs:

- `POST /api/v1/reviews/sellers`
- `GET /api/v1/shops/:slug/ratings`
- `GET /api/v1/shops/:slug/ratings/summary`
- `GET /api/v1/seller/ratings`
- `GET /api/v1/seller/ratings/summary`

Admin moderation APIs:

- `GET /api/v1/admin/reviews?type=product|seller`
- `PATCH /api/v1/admin/reviews/:id/hide`
- `PATCH /api/v1/admin/reviews/:id/restore`

Moderation hide/restore preserves historical records. Seller rating moderation recalculates seller profile `ratingAverage` and `ratingCount`.

Wishlist APIs require authentication and do not reserve inventory:

- `GET /api/v1/wishlist`
- `POST /api/v1/wishlist/items`
- `GET /api/v1/wishlist/items/:productId`
- `DELETE /api/v1/wishlist/items/:productId`
- `DELETE /api/v1/wishlist/items`

Wishlist items expose availability as `AVAILABLE`, `RESERVED`, `SOLD`, or `UNAVAILABLE`. Unavailable products return limited data only.

## Real-Time Chat And Notifications

Socket.IO is attached to the existing HTTP server when `SOCKET_IO_ENABLED=true`. Clients authenticate with the JWT access token in `handshake.auth.token` or the `Authorization: Bearer <token>` header. Do not send tokens in URL query strings.

Conversation APIs:

- `POST /api/v1/conversations`
- `GET /api/v1/conversations`
- `GET /api/v1/conversations/:id`
- `GET /api/v1/conversations/:id/messages`
- `POST /api/v1/conversations/:id/messages`
- `PATCH /api/v1/conversations/:id/read`

Message moderation APIs:

- `POST /api/v1/users/:id/block`
- `DELETE /api/v1/users/:id/block`
- `POST /api/v1/messages/:id/report`
- `GET /api/v1/admin/message-reports`
- `PATCH /api/v1/admin/message-reports/:id/resolve`

Socket client example:

```js
const socket = io('http://localhost:5000', {
  auth: { token: accessToken },
});

socket.emit('conversation:join', { conversationId }, console.log);
socket.emit(
  'message:send',
  {
    conversationId,
    clientMessageId: crypto.randomUUID(),
    type: 'TEXT',
    content: 'Is this jacket still available?',
  },
  console.log,
);
```

Client events: `conversation:join`, `conversation:leave`, `message:send`, `message:read`, `typing:start`, `typing:stop`.

Server events: `message:new`, `message:ack`, `message:error`, `message:read`, `typing:update`, `conversation:updated`, `notification:new`, `notification:count`, `presence:update`.

Notification APIs:

- `GET /api/v1/notifications`
- `GET /api/v1/notifications/unread-count`
- `PATCH /api/v1/notifications/:id/read`
- `PATCH /api/v1/notifications/read-all`
- `DELETE /api/v1/notifications/:id`
- `GET /api/v1/notifications/preferences`
- `PATCH /api/v1/notifications/preferences`

Messages and notifications are persisted in MongoDB before realtime events are emitted. Socket.IO delivery is not the source of history. Missed notifications and message history are recovered through REST.

The notification outbox model is implemented for durable queued notification creation. Product submission, approval, and rejection enqueue notification events and can be delivered with:

```bash
npm run worker:notification-outbox
```

Some older modules still create notifications directly after persistence rather than inside their original business transaction. Payment success notifications must only be added from verified webhook persistence paths; frontend redirects must never create payment-confirmed notifications.

Presence is in-memory and single-instance only. Production multi-instance deployments need a Socket.IO Redis adapter plus distributed presence storage to prevent split-brain online state.

## Admin Dashboard And Reporting

All admin endpoints require `Authorization: Bearer <adminAccessToken>` and the `ADMIN` role.

Dashboard and analytics:

- `GET /api/v1/admin/dashboard/overview`
- `GET /api/v1/admin/dashboard/revenue`
- `GET /api/v1/admin/dashboard/orders`
- `GET /api/v1/admin/dashboard/users`
- `GET /api/v1/admin/dashboard/products`
- `GET /api/v1/admin/analytics/commissions`

Supported reporting filters:

```text
startDate=2026-01-01T00:00:00.000Z
endDate=2026-01-31T23:59:59.999Z
groupBy=day|week|month
```

Timestamps are stored in UTC. Dashboard grouping uses `Asia/Ho_Chi_Minh` for business reporting buckets.

Financial metric definitions:

- `grossMerchandiseValue`: sum of paid seller-order subtotal snapshots in VND.
- `platformCommissionEarned`: sum of recognized commission snapshots, not gross order amount.
- `platformCommissionPending`: sum of pending commission snapshots.
- `totalRefundedAmount`: sum of refund records in requested, pending, or succeeded states.
- `pendingPayoutAmount`: sum of non-final payout records before `PAID`.
- `completedPayoutAmount`: sum of `PAID` payout records.

Admin user and seller management:

- `GET /api/v1/admin/users`
- `GET /api/v1/admin/users/:id`
- `PATCH /api/v1/admin/users/:id/status`
- `GET /api/v1/admin/sellers`
- `GET /api/v1/admin/sellers/:id`
- `PATCH /api/v1/admin/sellers/:id/status`

Suspension requires a reason, revokes active refresh sessions, prevents self-suspension, and protects the last active admin account.

Admin product, order, finance, audit, and export APIs:

- `GET /api/v1/admin/products`
- `GET /api/v1/admin/products/pending`
- `PATCH /api/v1/admin/products/:id/approve`
- `PATCH /api/v1/admin/products/:id/reject`
- `PATCH /api/v1/admin/products/:id/hide`
- `GET /api/v1/admin/orders`
- `GET /api/v1/admin/orders/:id`
- `GET /api/v1/admin/payments`
- `GET /api/v1/admin/payouts`
- `GET /api/v1/admin/payouts/:id`
- `GET /api/v1/admin/reports`
- `GET /api/v1/admin/audit-logs`
- `GET /api/v1/admin/reports/orders/export`
- `GET /api/v1/admin/reports/commissions/export`
- `GET /api/v1/admin/reports/users/export`

CSV exports cap the requested size, exclude passwords/tokens/secrets, escape values, and prefix formula-like values with a single quote to reduce spreadsheet injection risk. Export actions are recorded in append-only admin audit logs.

## Buyer Protection And Disputes

`BUYER_PROTECTION_DAYS` controls the protection period after verified delivery. Payout eligibility is blocked while the protection window is active or while a dispute is open.

Dispute APIs:

- `POST /api/v1/orders/:id/disputes`
- `GET /api/v1/disputes/my`
- `GET /api/v1/disputes/:id`
- `GET /api/v1/admin/disputes`
- `PATCH /api/v1/admin/disputes/:id/review`
- `PATCH /api/v1/admin/disputes/:id/resolve`

Evidence handling is modeled as private references. Do not expose evidence with public URLs.

## Settlement Eligibility

Seller proceeds become payout-eligible only when:

- Payment is verified.
- Order is `COMPLETED`.
- Delivery is verified.
- Buyer protection window has ended.
- No active dispute exists.
- Seller verification is complete.
- Payout hold period has ended.
- The order has not already been paid or reserved for another payout.

The eligibility worker creates simulation payout records only. It does not transfer real money.

## Architecture

The project follows `Route -> Controller -> Service -> Model`.

- Routes define endpoints and attach middleware.
- Controllers handle HTTP input and output.
- Services contain business logic and will interact with Mongoose models.
- Models define MongoDB schemas.
- Middleware handles cross-cutting concerns such as rate limiting and errors.

## Marketplace Notes

Authorization roles are `BUYER`, `SELLER`, and `ADMIN`. Buyers create carts, wishlists, purchase orders and product conversations. Sellers manage products, shops, shipping, verification and earnings. Admins use the dedicated moderation endpoints. All `/seller` endpoints enforce the seller role; existing ownership checks still apply. Shared chat, notifications and addresses remain available to authenticated accounts.

Run `npm run migrate:roles` for a dry run, then `npm run migrate:roles -- --apply` to upgrade legacy accounts. Legacy `USER` accounts with a shop, product or sale become `SELLER`; the others become `BUYER`. Admins and already migrated roles are unchanged. The script is idempotent and preserves orders, chats, addresses and all other business data. Sellers can still settle, review, dispute and track their own historical purchases, but cannot create new purchase orders.

Future financial features must calculate prices, commissions, and payout eligibility on the server. Store monetary amounts as integer VND units, preserve commission snapshots per order, verify payment webhooks, and design idempotent payment processing.

## Roadmap

- User and seller profiles
- Product listings and moderation
- Shopping carts and orders
- Payment integration and webhook verification
- Commission snapshots and seller payout workflows
- Reviews, disputes, and admin dashboard tools
