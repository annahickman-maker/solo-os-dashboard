/**
 * Library - import the owner's own YouTube uploads as previews: each video's
 * thumbnail (YouTube's 320px "medium" size) plus a link back to the video.
 * The video itself is never copied.
 *
 * Uses the YouTube connection made in Social (src/lib/social/youtube.ts),
 * which already asks for youtube.readonly. A channel connected before that
 * scope was added must be reconnected; the import then reports it.
 *
 * fetch is passed in so tests run without the network.
 */
import type { AssetInput } from "./contract.ts";
import { ingestAsset, type LibraryDb, type PreviewBucket } from "./store.ts";

const YT = "https://www.googleapis.com/youtube/v3";
/** Thumbnails are only ever fetched from YouTube's image hosts. */
const THUMB_HOST = /^(?:i\d?|img)\.ytimg\.com$/;
export const MAX_VIDEOS_PER_RUN = 200;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface YouTubeImportCounts {
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  errors: string[];
}

interface PlaylistItem {
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string; width?: number; height?: number } | undefined>;
  };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
  status?: { privacyStatus?: string };
}

async function ytJson<T>(fetchImpl: Fetch, url: URL, accessToken: string): Promise<T> {
  const res = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    if (res.status === 403 && /scope/i.test(msg)) {
      throw new Error("This YouTube connection cannot read your videos. Reconnect the channel in Social.");
    }
    throw new Error(`YouTube: ${msg}`);
  }
  return data;
}

/** The uploads playlist of the channel this token belongs to. */
export async function uploadsPlaylist(fetchImpl: Fetch, accessToken: string): Promise<string> {
  const url = new URL(`${YT}/channels`);
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set("mine", "true");
  const data = await ytJson<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(fetchImpl, url, accessToken);
  const id = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!id) throw new Error("No YouTube channel or uploads on this connection");
  return id;
}

export async function listUploads(fetchImpl: Fetch, accessToken: string, playlistId: string, max = MAX_VIDEOS_PER_RUN): Promise<PlaylistItem[]> {
  const out: PlaylistItem[] = [];
  let pageToken = "";
  while (out.length < max) {
    const url = new URL(`${YT}/playlistItems`);
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await ytJson<{ items?: PlaylistItem[]; nextPageToken?: string }>(fetchImpl, url, accessToken);
    out.push(...(data.items || []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out.slice(0, max);
}

function pickThumb(item: PlaylistItem): string | null {
  const t = item.snippet?.thumbnails || {};
  for (const size of ["medium", "high", "default"]) {
    const url = t[size]?.url;
    if (!url) continue;
    try {
      const u = new URL(url);
      if (u.protocol === "https:" && THUMB_HOST.test(u.hostname)) return u.toString();
    } catch {
      /* skip */
    }
  }
  return null;
}

function isoOrNull(v: string | undefined): string | null {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** One channel's uploads into the Library. Re-running updates, never duplicates. */
export async function importYouTubeUploads(
  deps: { db: LibraryDb; bucket: PreviewBucket | null; fetch: Fetch },
  accessToken: string,
  opts: { channelTitle?: string; max?: number } = {}
): Promise<YouTubeImportCounts> {
  const counts: YouTubeImportCounts = { scanned: 0, created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
  const playlist = await uploadsPlaylist(deps.fetch, accessToken);
  const items = await listUploads(deps.fetch, accessToken, playlist, opts.max);

  for (const item of items) {
    const videoId = item.contentDetails?.videoId;
    const title = item.snippet?.title || "";
    if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) continue;
    if (title === "Private video" || title === "Deleted video") continue;
    counts.scanned++;
    try {
      const thumbUrl = pickThumb(item);
      const existing = await deps.db.findBySource("youtube", videoId);
      let preview: string | null = null;
      // Fetch the thumbnail only when it is new or YouTube changed it.
      if (thumbUrl && (!existing?.preview_key || existing.meta?.thumbnail_url !== thumbUrl)) {
        const res = await deps.fetch(thumbUrl);
        if (res.ok) preview = toBase64(new Uint8Array(await res.arrayBuffer()));
      }
      const input: AssetInput = {
        source: "youtube",
        source_id: videoId,
        title: title.slice(0, 300),
        kind: "video",
        original_url: `https://www.youtube.com/watch?v=${videoId}`,
        original_label: opts.channelTitle ? `YouTube: ${opts.channelTitle.slice(0, 200)}` : null,
        width: null,
        height: null,
        duration_s: null,
        tags: [],
        collection: "youtube",
        taken_at: isoOrNull(item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt),
        meta: { thumbnail_url: thumbUrl, privacy: item.status?.privacyStatus ?? null },
        preview_base64: preview,
      };
      if (!preview && existing?.preview_key) {
        // Keep the stored preview's metadata stable when nothing was refetched.
        input.meta = { ...input.meta, thumbnail_url: existing.meta?.thumbnail_url ?? thumbUrl };
      }
      const r = await ingestAsset(deps, input);
      if (!r.ok) {
        counts.failed++;
        if (counts.errors.length < 5) counts.errors.push(`${videoId}: ${r.error}`);
        continue;
      }
      counts[r.value.status]++;
    } catch (e) {
      counts.failed++;
      if (counts.errors.length < 5) counts.errors.push(`${videoId}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return counts;
}
