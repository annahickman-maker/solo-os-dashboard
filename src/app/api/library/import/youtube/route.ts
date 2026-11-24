/**
 * POST /api/library/import/youtube - import the owner's own uploads from each
 * YouTube channel connected in Social: thumbnail preview plus a link to the
 * video. Re-running updates, never duplicates. Session or library:write.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { googleOAuthConfigured, googleRefreshAccessToken } from "@/lib/social/youtube";
import { importYouTubeUploads, type YouTubeImportCounts } from "@/lib/library/youtube-import";
import { previewBucket, recordSyncRun, supabaseLibraryDb, youtubeConnections } from "@/lib/library/server";

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "library:write");
  if (denied) return denied;

  if (!googleOAuthConfigured()) {
    return NextResponse.json({ error: "YouTube is not set up (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET). See SOCIAL.md." }, { status: 409 });
  }
  const channels = (await youtubeConnections()).filter((c) => c.refresh_token);
  if (channels.length === 0) {
    return NextResponse.json({ error: "No YouTube channel is connected. Connect one in Social first." }, { status: 409 });
  }
  const bucket = previewBucket();
  if (!bucket) return NextResponse.json({ error: "Preview storage is not connected (LIBRARY_PREVIEWS). See LIBRARY.md." }, { status: 503 });

  const started = new Date().toISOString();
  const db = supabaseLibraryDb();
  const results: (YouTubeImportCounts & { channel: string })[] = [];
  for (const channel of channels) {
    try {
      const token = await googleRefreshAccessToken(channel.refresh_token!);
      const counts = await importYouTubeUploads({ db, bucket, fetch: (u, i) => fetch(u, i) }, token, { channelTitle: channel.name });
      results.push({ channel: channel.name, ...counts });
    } catch (e) {
      results.push({ channel: channel.name, scanned: 0, created: 0, updated: 0, unchanged: 0, failed: 1, errors: [(e as Error).message] });
    }
  }

  const sum = (k: "scanned" | "created" | "updated" | "unchanged" | "failed") => results.reduce((n, r) => n + r[k], 0);
  const failed = sum("failed");
  const errors = results.flatMap((r) => r.errors);
  await recordSyncRun({
    source: "youtube",
    label: results.map((r) => r.channel).join(", ").slice(0, 200) || null,
    status: failed === 0 ? "ok" : sum("scanned") > failed ? "partial" : "failed",
    scanned: sum("scanned"),
    created: sum("created"),
    updated: sum("updated"),
    unchanged: sum("unchanged"),
    failed,
    note: errors.join("; ").slice(0, 1000) || null,
    started_at: started,
  }).catch(() => undefined);

  return NextResponse.json({ results });
}
