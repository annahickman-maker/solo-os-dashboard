# Solo OS

Solo OS is a self-hosted dashboard for solo creators. It sits behind your public
sales page and gives you one place to decide what to focus on, schedule and track
your content, keep your brand research, memory and media library, and (if you want
them) run contacts, a client pipeline, email, sales and analytics.

It runs on your own accounts: Supabase for the database and login, Cloudflare
Workers for hosting, and GitHub for the code. Nothing is rented and nothing is
shared with anyone else.

## Pages

| Page | Route | What it is for |
|------|-------|----------------|
| Focus | `/focus` | Your front door: what matters this week |
| Content | `/social` | Schedule, calendar and performance for what you publish. The Content studio is coming soon |
| Brand | `/brand` | Your Brand Playbook: audience, language, positioning, offer |
| Memory | `/memory` | Your notes and transcripts, searchable |
| Library | `/library` | Previews of your images and video, linked to the originals |
| Setup | `/crm/settings` | Modules, connections, sending and agent access |

Optional modules, switched on or off in Setup -> Modules:

| Module | Nav label | Route | Default |
|--------|-----------|-------|---------|
| Analytics | Analytics | `/crm/analytics` | on |
| Client pipeline | Pipeline | `/crm/pipeline` | off |
| Sales | Sales | `/sales` | off |
| Contacts | Contacts | `/crm/leads` | on |
| Email | Email | `/crm/workflows` | on |

Contacts is everyone with an email: subscribers, buyers and people who book a
call. Someone who books a call or sends an enquiry also gets an open deal in the
client pipeline; a plain newsletter sign-up does not.

The navigation reads, top to bottom: Focus, Analytics, Pipeline, Sales; then
**Marketing** (Content, Contacts, Email); then **Brand** (Brand, Memory,
Library); with the light mode switch and Setup pinned at the bottom.

`/` opens Focus. The dashboard works on phones (a tab bar with Focus, Content,
Brand and More) and on desktop (a sidebar).

## Setup

You do not need to set this up yourself. Your manager (the setup employee) stands
it up on your own Supabase, Cloudflare and GitHub accounts, connects it to your
public site, verifies the login and lead loop, and hands you the links.

If you want to see exactly what they do, the technical steps are written down in
[CLAUDE.md](CLAUDE.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Docs

- [CLAUDE.md](CLAUDE.md) - setup steps, architecture and conventions
- [AGENTS.md](AGENTS.md) - how agents work inside this repo
- [DEPLOYMENT.md](DEPLOYMENT.md) - deploying to Cloudflare Workers
- [INSTALL.md](INSTALL.md) - installing the database
- [UPDATE.md](UPDATE.md) - updating to a new Solo OS version
- [MEDIA.md](MEDIA.md) - public image storage (R2)
- [CRM.md](CRM.md) - leads, pipeline, email workflows and capture
- [BOOKINGS.md](BOOKINGS.md) - bookings and appointments
- [SOCIAL.md](SOCIAL.md) - the social calendar and publishing
- [MONEY.md](MONEY.md) - products, orders, invoices and fulfilment
- [EVENTS.md](EVENTS.md) - the activity event stream
- [AGENT-KEYS.md](AGENT-KEYS.md) - scoped keys for agents
- [MCP.md](MCP.md) - connecting an agent over MCP
- [APPROVALS.md](APPROVALS.md) - how agent proposals are approved
- [SCHEMA-TYPES.md](SCHEMA-TYPES.md) - regenerating database types

## Tech

Next.js 16 (App Router), React 19, Tailwind CSS, Supabase, and Cloudflare Workers
via OpenNext. See [LICENSE](LICENSE) for terms.
