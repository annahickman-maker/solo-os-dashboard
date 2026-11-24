/**
 * POST /api/memory/inbox - the universal memory inbox (MEMORY.md).
 *
 * Authorization: Bearer <inbox token> (or X-Memory-Token). The token is
 * generated in Setup > Memory connections and only its hash is stored. Not
 * a session or agent-key route: Zapier, Make and scripts call it directly.
 * Body: JSON {source, source_id, title, text, occurred_at, kind, url?},
 * a multipart form with a `file`, or a raw .txt/.md/.vtt/.srt body with the
 * details in the query string. Idempotent on (source, source_id).
 */
import { handleInbox } from "@/lib/memory/inbox";
import { memoryDb, memoryEmbedder } from "@/lib/memory/server";

export async function POST(request: Request) {
  return handleInbox(request, { db: memoryDb(), embedder: memoryEmbedder() });
}
