# Analytics: where every number comes from

`/crm/analytics` has three sections. Every number on it fills itself: no
one types numbers in and no one has to click Refresh. This page lists, for
each number, where it is read from, what fills it, and what the owner
connects once.

Two scheduled jobs do the work. Both run on the dashboard worker's
Cloudflare cron (`wrangler.jsonc` `triggers.crons`: `*/5 * * * *`, handled
in `worker.ts`):

- **CRM tick** (`POST /api/crm/tick`): sends due workflow emails, advances
  workflows and their stage moves.
- **Social tick** (`POST /api/social/tick`): publishes due posts, then
  refreshes view counts (`src/lib/social/metrics.ts`). Runs only when the
  social calendar is on (`SOCIAL_PUBLISHING_ENABLED` is `true`; your manager
  switches it on) and `SOCIAL_SCHEDULER_MODE` is `native`.

Everything else is written the moment it happens (a visit, a form, a
payment, a booking).

## 1. From views to email to sales

Read by `GET /api/analytics/funnel-summary` (rules:
`src/lib/analytics/funnel-summary.ts`). Period switch: 7 days, 30 days,
this month (UTC, default), 90 days.

| Number | Read from | Filled automatically by | Connect once |
| --- | --- | --- | --- |
| Reach: content views | `social_metrics`: newest snapshot's `views` per post target published in the period | Social tick: every post published in the last 90 days, every 6 hours for its first 30 days, then daily. YouTube in batches of 50 videos per call (one token per channel); Instagram and Facebook up to 25 posts per tick. Disconnected accounts are skipped | Content > Accounts: connect YouTube (needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and Instagram / Facebook (needs `META_APP_ID`, `META_APP_SECRET`). Social calendar switched on (see above) |
| Reach: site visits | `analytics_events` `page_view` rows, plus `funnel_events` `start` rows of any other funnel (one per session) | The sales page site: `PageTracker` in its root layout records a page view on every page (sales page repo, `SITE.md` section 7). A funnel site posting to `POST /api/crm/funnel/ingest` adds its starts | Sales page site deployed against the same Supabase project (`SUPABASE_SERVICE_ROLE_KEY` on the site). A separate funnel site also needs the `crm_funnel_secret` setting |
| Capture | `leads` created in the period, any source | Sales page email form (`POST /api/leads` on the site, forwarded to `POST /api/crm/capture`); checkout buyers (Stripe webhook creates the contact); Cal.com bookings (`POST /api/crm/webhooks/calcom`); any other form posting to `/api/crm/capture` | Site: `BACKEND_URL` / `BACKEND_WORKER` binding and `CRM_CAPTURE_KEY`. Cal.com: webhook with `CALCOM_WEBHOOK_SECRET` (BOOKINGS.md) |
| Conversions: orders | `orders` with status `paid`, `paid_at` in the period, net of refunds (a full refund is not a sale) | Stripe webhook `POST /api/webhooks/stripe` marks the order paid (orders are opened by the site's checkout button via `POST /api/crm/checkout`) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the webhook in Stripe, and `CHECKOUT_API_KEY` on the site (MONEY.md) |
| Conversions: deals | `opportunities` with status `won`, `won_at` in the period | Set when a deal is marked won (Pipeline board, or the agent's deal tools) | Client pipeline module on |

Rates under each box are the box divided by the one before it. A source the
database cannot answer counts as 0 and is named above the boxes.

## 2. Sales page performance

**Website report** (`GET /api/crm/analytics`, `src/lib/analytics/website.ts`),
from `analytics_events` written by the sales page site's `POST /api/analytics`:

| Number | Event names | Recorded by (sales page site) |
| --- | --- | --- |
| Page views | `page_view` | `PageTracker`, every page, every navigation |
| CTA / offer clicks | `cta_click`, `offer_click` | Every selling button (`CtaButton`: lead, checkout, booking, link) |
| Email capture events | `email_capture` | The email form, after the dashboard accepts the sign-up |
| Source, device filters | `event_data.traffic_source`, `event_data.device_type` | The tracker (utm_source or referrer host; user agent) |

**Funnels report** (`GET /api/crm/funnel`, `src/lib/crm/funnel.ts`), from
`funnel_events`, distinct sessions per step. The sales page site writes the
`sales-page` funnel itself:

| Step | Written when |
| --- | --- |
| Sales page (start) | The home page is viewed |
| Opened checkout | A checkout button opens Stripe (`checkout_start`) |
| Thank-you page (paid) | Stripe returns the buyer to `/thank-you` |
| Opt-ins | The email form succeeds |
| CTA clicks | Any selling button |

Other funnels (for example a quiz on its own site) appear in the funnel
picker once they post to `/api/crm/funnel/ingest`. The `sales-page` funnel's
starts are not added to Reach a second time: its visits already count as
page views.

Connect once: nothing beyond deploying the site (section 1). Tracking is
skipped in local development unless `NEXT_PUBLIC_TRACK_DEV=1`. Query strings
(such as Stripe's `?session_id=`) are never stored.

## 3. Client pipeline

Shown only when Setup > Modules > Client pipeline is on. Read by
`GET /api/crm/dashboard` (rules: `src/lib/analytics/flow-cards.ts`).

| Card | Read from | Filled automatically by |
| --- | --- | --- |
| Contacts | All `leads`; "+N new this week" = created in the last 7 days | The same capture paths as Capture above |
| Nurture | `workflow_enrollments` with status `active`; emails = `email_sends` sent or simulated in 7 days | Workflows enrol contacts on their trigger (form submitted, lead created, tag added, ...); the CRM tick sends the emails |
| Pipeline | Open `opportunities`, summed value (or stage estimates), and the count per stage | Auto-deal rules (`src/lib/crm/auto-deal.ts`): a Cal.com booking opens a deal at the booking stage, an enquiry form (`intent: "enquiry"`) opens one at the first stage; workflow enrolment moves it to Nurturing; workflow `move_stage` steps move it on |
| Revenue this month | Deals won this month, plus paid orders this month when the Sales module is on | Marking a deal won; the Stripe webhook |

Connect once: Cal.com webhook (BOOKINGS.md), `RESEND_API_KEY` and the
sender in Setup so workflow emails really send (until then, with safe mode on,
sends are simulated and still counted), and at least one active workflow.

## Not automatic yet, and why

- **Won deals.** A deal becomes won when someone marks it won. Doing it from
  a payment would count the same sale twice in Conversions (once as an
  order, once as a deal), so it stays a deliberate step.
- **Views of content not published through the dashboard.** Content views
  only cover posts the social calendar published (it knows their platform
  ids). Videos uploaded straight to YouTube or Instagram are not counted.
- **Facebook carousel views.** Meta no longer offers a view metric for
  multi-photo posts, so they add likes and clicks but 0 views.
- **Instagram and Facebook insights in the first hour.** Meta often has no
  insights yet; the miss is logged and the next tick tries again.
- **Sign-ups kept while the dashboard is unreachable.** The site saves the
  contact straight to the database so it is not lost, and it counts in
  Capture, but no workflow or deal runs for that sign-up.
- **Visitors without JavaScript or with tracking blocked** are not counted
  as page views.
