# Money and fulfilment

Payment and fulfilment APIs provide products, orders, invoices, projects and
deliverables in the owner's own dashboard. The optional **Sales** page (`/sales`,
turned on in Setup -> Modules, off by default) lists and edits products, shows
orders with their delivery state and totals what was paid this month. Agents
use the APIs. Migration 006 is additive; existing table-name collisions stop for
a reviewed adoption. Payouts have a schema only; no automatic transfers.

Money records can be managed without Stripe. Hosted checkout and invoice sending
require the owner's STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, configured
through their secure setup. No credentials are supplied with the code.
`/api/webhooks/stripe` verifies the raw body signature, claims provider events,
retries failed processing and deduplicates deliveries. Test events do not affect
a live dashboard unless explicitly allowed. Local tests use synthetic signatures
and fake Stripe transport. Every owner still needs their own test-mode
checkout/webhook proof.

Owner-requested `/api/crm/fulfilment` POST `{action:"seed"}` adds missing onboarding,
project-stage and delivery-review recipes as drafts. Repeating setup preserves
existing email copy, workflow steps/status and onboarding selection. Nothing is
automatically enabled. Existing CRM safe mode continues to simulate email.
Winning a deal creates at most one project. Completing all deliverables adds the
`delivered` tag while retaining other tags. Project names are snapshotted into
workflow context for emails, without overwriting the lead's custom fields.

Route scopes are in `/api/home/guide`. Checkout-only keys cannot read Money or
send invoices. Approval advice in the guide is an agent instruction, not a new
server-side payment-approval queue. MCP proposals and owner Approvals handle
only their documented action kinds; they do not approve financial operations.

## Selling from the sales page

The public site sells a product by its slug. Its buy button posts to the site's
own `POST /api/checkout`, which forwards `{ product_slug, email? }` to
`POST /api/crm/checkout` here over the `BACKEND_WORKER` service binding, signed
with the site secret `CHECKOUT_API_KEY`. The price always comes from the
product in this dashboard; the browser never sends one. Stripe returns the
buyer to the site's `/thank-you` page, or to `/#offer` if they cancel.

`CHECKOUT_API_KEY` is a minted agent key with only `money:checkout`. It can
open a checkout session and nothing else: it cannot read orders or leads,
send invoices or mint keys. To mint it: Setup -> Sales page connections ->
"Mint the checkout key" (or Setup -> Manage agent access -> "Fill in the
checkout key"), which prefills the name `site-checkout` and the single scope.
Create it, copy the key once, and have your manager set it on the site:
`npx wrangler secret put CHECKOUT_API_KEY --name <site worker>`. Revoking it
switches the site's checkout off at once. Setup shows a warning if the only
checkout-capable key holds more scopes than it needs.

Until both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set, checkout
answers 503 and the site shows "Checkout isn't switched on yet".

## Digital products

A product with kind `digital` is a one-off payment with a `delivery_url`: the
https link the buyer receives (a private download, a course login, a shared
folder). Migration `021_digital_delivery.sql` adds the kind, the column and the
`order_deliveries` table. The link is never served by `GET /api/public/products`,
and checkout refuses (409) a digital product without one.

When `checkout.session.completed` marks the order paid, the webhook emails the
buyer the link through the CRM sender (`src/lib/money/delivery.ts`):

- It obeys safe mode: while `crm_safe_mode` is on, or without `RESEND_API_KEY`,
  the delivery is recorded as `simulated` in `email_sends` and on the lead's
  timeline, and nothing is sent. Once you go live, open Sales and use
  "Send again" on the simulated orders you want delivered for real.
- It is a transactional email: a buyer who unsubscribed from marketing still
  receives it. Bounced or complained addresses and suppression tags still
  block it (`suppressed`).
- One delivery per order. `order_deliveries` is keyed by the order and its
  insert is the claim, so a retried or duplicated webhook, or two deliveries
  racing, never email twice. A claim older than five minutes (a delivery that
  died mid-way) can be taken over.
- A failed send never fails the payment. The row is marked `failed`, the
  lead's timeline gets a `delivery_failed` entry, and the owner can "Send
  again" from Sales (`POST /api/crm/orders/deliver`, owner session only). A
  refunded or void order is never delivered.

To change the email, add an email template named `Digital delivery`. Its
subject, preheader and body may use `{{product_name}}`, `{{delivery_url}}`,
`{{delivery_links}}` and the usual lead merge tags. If the body leaves the link
out, it is added at the end.

Tests: `npm run test:money` runs `src/lib/money/delivery.test.ts` against the
fake database and a fake email transport (no network).
