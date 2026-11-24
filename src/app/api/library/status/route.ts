/**
 * GET /api/library/status - counts, preview storage used, the latest run per
 * source (Mac folder sync, YouTube import) and whether the preview bucket and
 * a YouTube connection are present. Session or library:read.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { latestSyncRuns, libraryStats, libraryTags, previewBucket, youtubeConnections } from "@/lib/library/server";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "library:read");
  if (denied) return denied;

  const bucket = previewBucket() !== null;
  const youtube = (await youtubeConnections()).filter((c) => !!c.refresh_token).length;
  try {
    const [stats, runs, tags] = await Promise.all([libraryStats(), latestSyncRuns(), libraryTags()]);
    return NextResponse.json(
      { ready: true, bucket, youtube_connections: youtube, stats, runs, tags },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { ready: false, bucket, youtube_connections: youtube, error: "Apply migration 023_library.sql to turn the Library on." },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
