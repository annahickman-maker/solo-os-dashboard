/**
 * GET/PUT /api/solo/docs/[key]: JSON documents for Solo OS pages.
 *
 * The owner's browser session can read and write every key. A signed agent
 * API key can too, if it holds the key's scope (the master and env-var keys
 * hold every scope):
 *   reputation, offer     brand:read (GET)   brand:write (PUT)
 *   longform, shortform   content:read (GET) content:write (PUT)
 *   focus, nav            owner only: session, master or env-var key
 * Minted keys are also gated by the matching entry in src/lib/api/scoped-routes.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse, type AuthResult } from "@/lib/api/auth";
import { WILDCARD_SCOPE, type Scope } from "@/lib/api/agent-key-scopes";
import { isSoloDocKey, readSoloDoc, writeSoloDoc, type SoloDocKey } from "@/lib/solo/documents";

const MAX_BYTES = 512 * 1024;

const SCOPES: Record<SoloDocKey, { read: Scope; write: Scope } | null> = {
  reputation: { read: "brand:read", write: "brand:write" },
  offer: { read: "brand:read", write: "brand:write" },
  longform: { read: "content:read", write: "content:write" },
  shortform: { read: "content:read", write: "content:write" },
  focus: null,
  nav: null,
};

/** null when allowed; otherwise the 401/403 response. */
function deny(auth: AuthResult, key: SoloDocKey, access: "read" | "write"): Response | null {
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  if (auth.mode === "session") return null;
  const scopes = SCOPES[key];
  if (scopes) return requireScope(auth, scopes[access]);
  if (auth.scopes?.includes(WILDCARD_SCOPE)) return null;
  return NextResponse.json({ error: "This document is owner-only" }, { status: 403 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const { key } = await params;
  if (!isSoloDocKey(key)) return NextResponse.json({ error: "Unknown document" }, { status: 404 });
  const denied = deny(auth, key, "read");
  if (denied) return denied;
  try {
    return NextResponse.json({ key, data: await readSoloDoc(key) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const { key } = await params;
  if (!isSoloDocKey(key)) return NextResponse.json({ error: "Unknown document" }, { status: 404 });
  const denied = deny(auth, key, "write");
  if (denied) return denied;
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "Document too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const data = (body as { data?: unknown })?.data;
  if (data === undefined || data === null || typeof data !== "object") {
    return NextResponse.json({ error: "Body must be { data: {...} }" }, { status: 400 });
  }
  try {
    await writeSoloDoc(key, data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
