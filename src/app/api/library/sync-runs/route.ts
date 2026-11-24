/**
 * POST /api/library/sync-runs - a sync (scripts/library-sync.mjs) or import
 * reports how its run went, so Setup can show the last run. library:write.
 *   { source, label?, status?, scanned?, created?, updated?, unchanged?, failed?, note?, started_at? }
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { validateSyncRun } from "@/lib/library/contract";
import { recordSyncRun } from "@/lib/library/server";

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "library:write");
  if (denied) return denied;
  const text = await request.text();
  if (text.length > 8 * 1024) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const run = validateSyncRun(body);
  if (!run.ok) return NextResponse.json({ error: run.error }, { status: run.status });
  try {
    await recordSyncRun(run.value);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
