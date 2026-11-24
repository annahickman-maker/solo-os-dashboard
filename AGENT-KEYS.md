# Agent keys

Optional owner-managed keys for the agents that work in your dashboard.
Existing master/env keys and their signing mode remain valid. Do not rotate them
or enable API_PER_KEY_SIGNING as a side effect of other work.

After migration 004, the owner can use `/api/settings/agent-keys` (or Setup ->
Manage agent access): GET lists metadata, POST accepts `{name, scopes, note?}`,
DELETE accepts `id` or `name`. Only an admin session or signed master key may
manage keys. Mint returns plaintext once; never log the response, paste it into
chat or commit it. The database stores a hash and a short display prefix.
Revocation retains the audit row.

Minted requests sign METHOD:pathname:timestamp:body with the minted key itself.
They still require signatures if signing was explicitly disabled.
Scopes are checked centrally against reviewed method/path pairs; unknown routes
are denied. Read the live `/api/home/guide` for supported route/scope pairs.
Current signed-HTTP coverage: discovery, Analytics, events, Money and Memory
(MEMORY.md). MCP
separately exposes the reviewed tools documented in MCP.md. Other signed-HTTP
module routes remain unavailable to minted keys; do not move an agent from the
master key to a minted key until all routes it uses are supported and verified.
An events-only key cannot read leads, perform payments, mint keys or invoke
worker ticks.

Tests execute the actual auth module with synthetic credentials and provider
boundaries. They cover master-key signing without database access, minted
self-signing, wrong signatures, route confinement and unchanged owner login.

Owner approval management is a separate signed master/admin control plane,
documented in APPROVALS.md. It is not granted by approvals:propose or by naming
an employee key "owner". Keep that credential confined to the owner-authorised
connection; decisions require the owner's explicit instruction for that proposal.

## The sales page checkout key

The public site's buy buttons need one narrow key, `CHECKOUT_API_KEY`, with
only `money:checkout`. The owner (or the manager, with the owner signed in)
mints it in Setup -> Manage agent access: "Fill in the checkout key" sets the
name `site-checkout` and that single scope. The plaintext is shown once; set it
on the site Worker with `npx wrangler secret put CHECKOUT_API_KEY --name <site
worker>` and do not store it anywhere else. The site signs each checkout request
with it (`POST:/api/crm/checkout:<timestamp>:<body>`, HMAC-SHA256 with the key
itself). It reaches `POST /api/crm/checkout` only. To rotate: revoke it, mint
`site-checkout` again, and replace the site secret. See MONEY.md.
