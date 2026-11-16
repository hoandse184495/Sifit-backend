# FASHN fitting room in production

The production integration ports the FASHN model settings, outfit collage and
member credit limits from the frontend's original `fe-redesign` AI branch.
It uses the existing Sifit JWT authentication, published products and MongoDB.
The prototype's separate JSON user database, mock listings and local reset
controls are not part of this deployment.

## Render environment

Add these **backend-only** variables to the existing Render Web Service:

```dotenv
FASHN_API_KEY=your-existing-fashn-key
TRYON_MODE=live
FASHN_MONTHLY_BUDGET=100
```

The key is already available in the ignored local backend `.env.production`
after this migration. Copy its value privately into Render Environment; never
put it in a `VITE_` variable, Git commit, screenshot or build log.
Without the key and live mode, the API returns an unavailable state and makes
no paid generation requests. Deploy backend `main` before the frontend.

Run `npm run db:prepare` once to create the new job idempotency, active-job and
TTL indexes (requires a MongoDB replica set, as existing transactions do).
Use an always-running Render instance for uninterrupted background processing.

## Frontend deployment

Use production branch `main`, build command `npm run build`, output `dist`.
Set Cloudflare Pages build variables:

```dotenv
VITE_API_BASE_URL=https://api.sifit.id.vn/api/v1
VITE_SOCKET_URL=https://api.sifit.id.vn
```

Build again after changing these values. Cloudflare builds now fail explicitly
if the API URL is missing, instead of publishing a broken relative API URL.

## Processing and privacy

- JPEG, PNG or WebP portraits, max 8 MB. Decode, normalize and resize images
  before sending. Model settings come from the original AI branch:
  `tryon-v1.6` quality, `tryon-max` balanced 1k, and complete-outfit collage mode.
- Sequential fitting: up to 3 products, one per category. Complete outfit:
  up to 4 products in one collage, one provider generation.
- v1.6 clothing uses 1 credit/item; Max/accessories use 2/item; outfit uses
  2/set. Limits: 5/day, 10/month per account, plus shared monthly budget.
  Provider pricing should be reviewed if the selected model settings change.
- Reserve all limits in a MongoDB transaction. Unique request IDs and one
  active job per account prevent duplicate billing across tabs and restarts.
- Persist the submitting phase **before** contacting FASHN. A timeout without
  a prediction ID is held for support review and never automatically submitted
  again. Confirmed rejections refund unfinished steps only.
- Poll saved prediction IDs; the background worker saves results even after
  the page closes. Existing predictions resume after restarting the backend.
  A restart during the uncertain submitting phase requires support review.
- Portraits/results are stored privately in MongoDB, expire after 7 days and
  are never served without owner authentication. The result can be downloaded
  or deleted early; deletion does not reset usage. Completed jobs discard the
  input portrait immediately. No public personal-image Cloudinary URLs.
- The old prototype's face masking, Python background removal and Gemini/CLIP
  recommendation server are not enabled in this fitting-room integration.

## Verification

```text
npm test -- tests/stylist.test.js
npm run lint
```

In the frontend, `npm run test:stylist` exercises real auth/API/MongoDB with a
simulated external FASHN service. It verifies loading indicators, reload
recovery without a second paid submission, private results, deletion, and
desktop/mobile layout. `npm run test:integration` covers marketplace workflows.

`scripts/verifyStylistLive.js` is an explicit paid smoke test against a
**disposable database**. It requires `SIFIT_LIVE_TEST=true`, a local portrait
path and an HTTPS garment URL, and submits exactly one v1.6 generation.
Output is saved in ignored `artifacts/stylist-live/`.

## Uncertain submissions

An `attention` job without a prediction ID must be checked against the FASHN
dashboard using its submitting timestamp and account. Do not replay it.
Reconcile the actual provider result before releasing the active slot or
adjusting its reserved counters. Do not provide a public "reset credits" route.

Provider reference: https://docs.fashn.ai/api-reference/tryon-v1-6 and
https://docs.fashn.ai/api-reference/tryon-max.
