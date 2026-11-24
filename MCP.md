# Connect an agent to your dashboard

The owner opens Setup -> Manage agent access, creates a named key and selects
only the access needed. Save the key once in the client's secure connection
settings. Never paste it into a chat or store it in a repository. Revoking a key
stops new requests; it cannot undo a request already executing.

Use HTTPS `https://YOUR_DASHBOARD/api/mcp`, Streamable HTTP, and `Authorization:
Bearer <key>`. This MCP endpoint is the documented bearer exception to signed
HTTP. Named employee keys can also use their signed HTTP routes. The master key
is accepted for compatibility, but scoped keys are recommended.

MCP discovery returns the tools that key can use. `home.info` reads version and
actual migration history; `home.guide` describes routes and tools. Capabilities
show code availability; `module_schema.approvals` must be true before tools run.
Apply migration 008 first. Failure to open the audit trail stops the call.

The tool list covers discovery, leads/timeline/notes, pipeline, content
calendar, Brand Playbook, proposals and proposal status. Scope checks happen for
every call, not only discovery. No tool approves its own work, publishes,
deletes or charges money.

Pipeline moves, article topics and social drafts create approval proposals.
There is no Approvals page. An owner-authorised agent can review the exact
proposal, ask for the owner's decision, then use the signed master HTTP control
plane documented in APPROVALS.md. Ordinary scoped/named employee keys cannot
decide; MCP itself exposes no approval-execution tool. Owner sessions remain
supported for custom interfaces. Approval claims the proposal once; repeat
decisions refuse. A pipeline change also refuses if the deal moved since the
proposal. Approved articles await writing; social posts remain drafts.
An action stuck in "approved" needs inspection before anyone proposes it again:
a response or receipt failure does not prove the action did not happen.

Keep safe mode on during setup. MCP audit rows may contain business inputs;
only the owner/server can read those tables. The client gets redacted responses.
Keys belong to one dashboard: if you work across several, keep a separate
connection for each and verify `home.info` before doing any work. Do not reuse
global key files across dashboards. The machine-readable guide is the
authoritative list of supported scoped routes; other signed HTTP routes remain
available only to the master key.
