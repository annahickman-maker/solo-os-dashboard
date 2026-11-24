/**
 * /api/library/assets - the Library index (LIBRARY.md). Previews only: the
 * original stays where it lives; a row holds a small preview and a link back.
 *
 *   GET   ?q=&kind=&source=&collection=&tag=&hidden=1&before=&limit=   library:read
 *   POST  { source, source_id, kind, title?, original_url?, original_label?,
 *           width?, height?, duration_s?, tags?, collection?, taken_at?, meta?,
 *           preview_base64? }                                          library:write
 *
 * POST is idempotent on (source, source_id): the same original sent again
 * updates its row and preview, and answers status "unchanged" when nothing
 * differs. The preview must be a JPEG, PNG or WebP under 400 KiB and 1024px.
 * Owner sessions may do both; minted keys are gated in src/lib/api/scoped-routes.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { LIBRARY_KINDS, LIBRARY_SOURCES, MAX_BODY_BYTES, normaliseCollection, validateAssetInput, type LibraryKind, type LibrarySource } from "@/lib/library/contract";
import { ingestAsset } from "@/lib/library/store";
import { listAssets, previewBucket, supabaseLibraryDb } from "@/lib/library/server";
import { toClientAsset } from "@/lib/library/client-shape";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "library:read");
  if (denied) return denied;

  const p = request.nextUrl.searchParams;
  const kind = p.get("kind");
  const source = p.get("source");
  const before = p.get("before");
  try {
    const assets = await listAssets({
      q: p.get("q")?.trim().slice(0, 100) || undefined,
      kind: kind && (LIBRARY_KINDS as readonly string[]).includes(kind) ? (kind as LibraryKind) : undefined,
      source: source && (LIBRARY_SOURCES as readonly string[]).includes(source) ? (source as LibrarySource) : undefined,
      collection: normaliseCollection(p.get("collection")) || undefined,
      tag: p.get("tag")?.trim().toLowerCase().slice(0, 40) || undefined,
      hidden: p.get("hidden") === "1",
      before: before && Number.isFinite(Date.parse(before)) ? new Date(before).toISOString() : undefined,
      limit: Number(p.get("limit")) || undefined,
    });
    return NextResponse.json({ assets: assets.map(toClientAsset) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large. Send a small preview, not the original." }, { status: 413 });
  }
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "library:write");
  if (denied) return denied;

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large. Send a small preview, not the original." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const input = validateAssetInput(body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: input.status });

  try {
    const result = await ingestAsset({ db: supabaseLibraryDb(), bucket: previewBucket() }, input.value);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    const { status, asset, preview_written } = result.value;
    return NextResponse.json({ status, preview_written, asset: toClientAsset(asset) }, { status: status === "created" ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
