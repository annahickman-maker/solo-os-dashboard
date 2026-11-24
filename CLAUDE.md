@AGENTS.md

# Solo OS dashboard

Solo OS is a self-hosted dashboard for solo creators. Each owner runs it on their
own Supabase, Cloudflare and GitHub accounts, next to a public sales site that
shares the same database. Setup is done by the owner's manager (the setup
employee); this file holds the technical steps and conventions they follow.

## Guided setup

Deploy and verify the working foundation with the business facts already
supplied. Brand research and design are later, optional work. Their
absence does not make a verified core build incomplete. Do not start that work
automatically or hold the handover until it is done. Hand over the live links
and explain the next choices once the login and lead loop are verified.

## First time setup

Work with both this repository and the public site repository, using one parent
folder, separate repository folders and the same Supabase project. Check the
working directory before each repo-specific action. Order: shared database,
dashboard user/admin access, R2 activation, dashboard, public site, verification.
The public site's migrations own the shared website schema; the site does not
need to be deployed first.

### Step 0: Check for Node.js 22 or newer
Run `node -v`. This project requires Node.js 22 or newer. If the command fails or
reports an older version, install the LTS version from [nodejs.org](https://nodejs.org).

### Step 1: Supabase and migrations
Create a new empty Supabase project. Before running any SQL or creating an admin
user, follow [INSTALL.md](INSTALL.md). Its installer applies and records
every migration file and verifies history. Then create the owner login. After
deployment, verify the signed-in dashboard reports all modules.

Both repos share the same database. This repo owns the whole schema, including the
website tables, plus backend settings, brand context, CRM, migration history,
agent keys, events, payment/fulfilment records and the Solo OS documents
(`solo_documents`).

### Your own database changes

Keep the shipped migration filenames and contents unchanged. Numbers `001`-`899`
are reserved for shipped migrations. For your own migration use an unused
three-digit number `900`-`999`, for example `900_my_feature.sql`. Current tools
require `NNN_name.sql`; four-digit and timestamp filenames are ignored. Do not
blindly rename or replay applied migrations, or rewrite history.

### Step 2: Environment variables
```bash
cp .env.local.example .env.local
```
Fill in:
- `NEXT_PUBLIC_SUPABASE_URL` - your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - your Supabase anon key
- `SUPABASE_URL` - runtime duplicate of your Supabase URL for Workers
- `SUPABASE_ANON_KEY` - runtime duplicate of your anon key for Workers
- `SUPABASE_SERVICE_ROLE_KEY` - your Supabase service role key
- `SITE_URL` and `NEXT_PUBLIC_SITE_URL` - your public site's live URL (e.g. `https://yourdomain.com`)
- `API_SECRET_KEY` - a shared secret you choose (must match the public site)
- `API_SIGNATURE_REQUIRED` - keep `true` unless you intentionally need unsigned machine requests during a migration
- `API_REQUEST_SIGNATURE_TTL_SECONDS` - optional request age limit for signed API calls (default `300`)
- `ANTHROPIC_API_KEY` - from [console.anthropic.com](https://console.anthropic.com) (for AI article writing)
- `OPENAI_API_KEY` - from [platform.openai.com](https://platform.openai.com) (for hero images, optional)
- `OPENAI_IMAGE_MODEL` - optional; defaults to `gpt-image-1`

### Step 3: Brand context (when beginning content work)
Brand context is what makes the AI write in the owner's voice. Publish an approved
Brand Playbook (see DEPLOYMENT.md) and seed any operational rows either via the
Supabase dashboard or via the authenticated `/api/setup` route. A good corpus
includes a voice guide, tone examples, content hooks, core positioning, offer
architecture, competitive landscape, SEO keyword clusters and real proof. Develop
it with the owner before generating brand-specific articles.

Three operational entries in the `brand_context` table:

**CTA Links** - the links the AI uses in article CTAs:
```
category: cta
key: links
content: (your CTA links in HTML, one per line, with when to use each)
```

**Author Name** - the byline on articles:
```
category: identity
key: author
content: [Your Name]
```

**Image Style** - controls AI-generated hero images:
```
category: content
key: image_style
content: (composition, colour palette, lighting, mood, what to avoid)
```
Without an image style the system uses a clean editorial photography default.

### Step 4: Install and run
```bash
npm install
npm run dev
```
Open `http://localhost:3001` and log in with the admin user you created in Supabase.

### Step 5: Required R2 public media
Follow `MEDIA.md` to provision and verify the public image pipeline independently
of social scheduling. Do not create a public Supabase image bucket or publish an
image-enabled article without its hero.

### Step 6: Deploy to Cloudflare
Follow DEPLOYMENT.md. The manager owns the deployment using the verified account
access; Worker names and URLs are outputs, not questions for the owner. Replace
every `REPLACE_` placeholder in `wrangler.jsonc`, keep `WORKER_SELF_REFERENCE`
matching the Worker name, configure the public-media bucket and `IMAGES`, then
fill real public build variables in ignored `.env.local` before compiling.
Install secrets through protected Wrangler input without logging values. If the
public site Worker does not exist yet, omit only `FRONTEND_WORKER` for the first
deploy, then add it once the site is deployed.

Run `npm run deploy` once, or `npx opennextjs-cloudflare deploy` if the unchanged
output already passed `npm run build`. Save the resulting dashboard URL, pin its
verified `/media` gateway in `PUBLIC_MEDIA_BASE`, and run the signed external
media probe. Verify dashboard sign-in, the public site and the lead loop.

### Step 7: Verify the public site connection
After login works, visit `https://DASHBOARD_URL/api/test-frontend`. You should see
`api_key_set: true` and `status: 200`. A `401` means `API_SECRET_KEY` differs
between the dashboard and the public site; re-set it on both Workers.

### Step 8: Test the contact loop
1. Submit the public site's sign-up form; confirm the person appears in Contacts
   (`/crm/leads`) with no pipeline deal.
2. Submit an enquiry form (a capture with `intent: "enquiry"`); confirm they get
   an open deal in the first pipeline stage.

---

## What this is

The dashboard is the private back office; the public site is the storefront. Both
read one Supabase database.

Pages:
- **Focus** (`/focus`) - the owner's front door: what matters this week.
- **Content** (`/social`) - the content scheduler, calendar, performance and
  accounts, with a "Content studio: coming soon" card. The long form
  (`/long-form`) and short form (`/short-form`) boards are parked for the
  studio: still in the repo, not in the nav (see STUDIO.md).
- **Brand** (`/brand`), **Memory** (`/memory`), **Library** (`/library`).
- **Setup** (`/crm/settings`) - modules, connections, sending, agent access.
- Optional modules, toggled in Setup: Analytics (`/crm/analytics`), Client
  pipeline (nav label Pipeline, `/crm/pipeline`), Sales (`/sales`), Contacts
  (`/crm/leads`, everyone with an email) and Email (`/crm/workflows`).

Articles were removed from the dashboard (no `/content` page, editor or
write-article routes). Their tables stay; `/api/articles`,
`/api/content-calendar` and `/api/publish` remain for agents and the public site.

`/` redirects to `/focus`; `/crm` redirects to `/crm/leads`.

### Navigation
Navigation lives in `src/components/nav.tsx` (`NAV_GROUPS`) and is shared by
the desktop sidebar (`src/components/sidebar.tsx`) and the phone shell
(`src/components/mobile-shell.tsx`). Order: Focus, Analytics, Pipeline, Sales;
group Marketing (Content, Contacts, Email); group Brand (Brand, Memory,
Library); pinned at the bottom the light mode switch, then Setup. On phones the
tab bar is Focus, Content, Brand and More. Optional modules are stored in the
solo document `nav` as `{ modules: { leads, pipeline, email, analytics, sales } }`
(`leads` is the Contacts room; defaults: leads, email, analytics on; pipeline
and sales off).

### Solo documents
New pages store JSON documents through `src/lib/solo/documents.ts` (server),
`src/lib/solo/client.ts` (browser `loadDoc`/`saveDoc`) and
`/api/solo/docs/[key]`. Allowed keys are listed in `SOLO_DOC_KEYS`.

## Architecture

```
+-------------------------+     +-------------------------+
|     PUBLIC SITE         |     |     DASHBOARD           |
|  (sales page, blog)     |     |  (this repo)            |
|                         |     |                         |
|  - Homepage             |     |  - Focus, content       |
|  - Blog                 |     |  - Brand                |
|  - Offers               |     |  - Contacts and email   |
|  - API routes           |     |  - Analytics            |
|                         |     |  - Agent oversight      |
|  yourdomain.com         |     |  dashboard.yourdomain.com|
+-----------+-------------+     +-----------+-------------+
            |                               |
            +---------------+---------------+
                            |
                  +---------v---------+
                  |     SUPABASE      |
                  |  (shared database)|
                  +-------------------+
```

## Tech stack
- **Framework:** Next.js 16 (App Router, TypeScript), React 19
- **Styling:** Tailwind CSS v4 plus the Solo look (`src/app/solo-theme.css`,
  `src/components/solo/*`, `src/components/solo-icons.tsx`)
- **Database:** Supabase (PostgreSQL), shared with the public site
- **Auth:** Supabase Auth (email/password, no public signup)
- **Deployment:** Cloudflare Workers via `@opennextjs/cloudflare` (OpenNext)

## Project structure
```
CLAUDE.md              <- You are here
/src
  /app
    layout.tsx         <- Shell: sidebar, phone shell, auth layout
    page.tsx           <- Redirects to /focus
    /focus /social /brand /memory /library
    /long-form /short-form   <- Parked for the Content studio (not in nav)
    /crm               <- Contacts, pipeline, email, analytics and Setup
    /login /privacy    <- Public pages
  /components          <- Shared UI (nav, sidebar, phone shell, kits)
  /lib
    /supabase          <- Supabase clients
    /solo              <- Solo documents store
  /types
    database.ts        <- Shared database types (keep in sync with the public site)
  middleware.ts        <- Auth guard: redirects to /login if no session
```

## Environment variables

### Build-time public variables
Baked into JavaScript at build time. Supply real values in ignored `.env.local`
before a local build (or the CI build environment), and in `wrangler.jsonc` `vars`
for runtime:
```
NEXT_PUBLIC_SUPABASE_URL      - Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY - Supabase anon key
NEXT_PUBLIC_SITE_URL          - Public site URL used for "View live" links
```

### Server-side values
Install secrets with `wrangler secret put` using protected input; never print or
commit them.
```
SUPABASE_SERVICE_ROLE_KEY     - Service role key, bypasses RLS
SUPABASE_ANON_KEY             - Anon key for server-side access (Workers can't read NEXT_PUBLIC_ at runtime)
SUPABASE_URL                  - Supabase URL for server-side access (same reason)
SITE_URL                      - The public site URL (e.g. https://yourdomain.com)
API_SECRET_KEY                - Shared secret between the public site and the dashboard
ANTHROPIC_API_KEY             - Anthropic API key for AI article writing
OPENAI_API_KEY                - OpenAI API key for hero images
OPENAI_IMAGE_MODEL            - Optional image model override (defaults to gpt-image-1)
```

Common mistakes:
- When `wrangler secret put` prompts, paste ONLY the value, not `NAME=value`.
- `SITE_URL` must be the live site URL, not `http://localhost:3000`.
- `API_SECRET_KEY` must be identical on both Workers.

## Important conventions
- **Auth required on all pages** except `/login` and `/privacy`. Middleware handles the redirect.
- **No public signup.** Admin users are created directly in Supabase.
- **Protected API routes for admin data.** The dashboard reads and writes admin
  tables through authenticated Next API routes, not browser-side Supabase queries.
- **Route auth split:**
  - session-only: dashboard APIs (`/api/articles`, `/api/content-calendar`, `/api/publish`, `/api/settings`, `/api/setup`, `/api/test-frontend`, `/api/solo/docs`)
  - session or signed API request: automation routes (`/api/trend-scan`)
- **Phones and desktop.** Every page must work below 640px and on desktop.
- **Shared database types:** merge schema changes into both repositories'
  `src/types/database.ts`, preserving custom columns and types. Verify both builds.

## Cloudflare / OpenNext rules

This project runs on Cloudflare Workers via `@opennextjs/cloudflare`. The older
`@cloudflare/next-on-pages` adapter is deprecated and incompatible.

- **Never add edge runtime exports.** Do not add `export const runtime = 'edge'`;
  OpenNext rejects it.
- **NEXT_PUBLIC_ vars don't exist at runtime on Workers.** They are baked in at
  build time. `wrangler.jsonc` has both `SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_URL`; server code uses
  `process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL`. Use the same
  fallback for any `NEXT_PUBLIC_` value read on the server.
- **Run `npm run build` before pushing.** `next dev` misses some type errors.
- **New Supabase tables must be in the types file**, or the production build fails.
- **Build artifacts stay out of git:** `.vercel/`, `.open-next/`, `.wrangler/`.
- **Secrets go through `wrangler secret put`** and take effect without a rebuild.
