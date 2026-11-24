/**
 * PATCH /api/library/assets/[id] - the owner edits tags, collection, title or
 * hides an asset. Owner session (or the master/env keys) only; minted keys are
 * not routed here. An edit marks the asset curated, so a later sync keeps the
 * owner's tags and collection.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { WILDCARD_SCOPE } from "@/lib/api/agent-key-scopes";
import { validateCuration } from "@/lib/library/contract";
import { curateAsset } from "@/lib/library/store";
import { supabaseLibraryDb } from "@/lib/library/server";
import { toClientAsset } from "@/lib/library/client-shape";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  if (auth.mode === "api-key" && !auth.scopes?.includes(WILDCARD_SCOPE)) {
    return NextResponse.json({ error: "Library curation is owner-only" }, { status: 403 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Unknown asset" }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const change = validateCuration(body);
  if (!change.ok) return NextResponse.json({ error: change.error }, { status: change.status });
  try {
    const asset = await curateAsset(supabaseLibraryDb(), id, change.value);
    if (!asset) return NextResponse.json({ error: "Unknown asset" }, { status: 404 });
    return NextResponse.json({ asset: toClientAsset(asset) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
