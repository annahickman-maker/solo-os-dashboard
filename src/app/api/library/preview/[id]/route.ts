/**
 * GET /api/library/preview/[id] - one asset's preview image from the private
 * LIBRARY_PREVIEWS bucket. Owner session only; previews are never public.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { previewBucket, supabaseLibraryDb } from "@/lib/library/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Unknown asset" }, { status: 404 });
  const bucket = previewBucket();
  if (!bucket) return NextResponse.json({ error: "Preview storage is not connected" }, { status: 503 });
  try {
    const asset = await supabaseLibraryDb().findById(id);
    if (!asset?.preview_key) return NextResponse.json({ error: "No preview" }, { status: 404 });
    const object = await bucket.get(asset.preview_key);
    if (!object) return NextResponse.json({ error: "No preview" }, { status: 404 });
    if (request.headers.get("if-none-match") === object.httpEtag) return new Response(null, { status: 304 });
    return new Response(object.body, {
      headers: {
        "Content-Type": asset.preview_type || object.httpMetadata?.contentType || "image/jpeg",
        "Content-Length": String(object.size),
        ETag: object.httpEtag,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
