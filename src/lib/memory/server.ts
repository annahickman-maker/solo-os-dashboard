/**
 * Memory - the real database and embedder for routes. Tests never import
 * this file; they pass fakes to ./store.ts and ./inbox.ts.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminClient } from "@/lib/supabase/server";
import { workersAiEmbedder, type AiBinding, type Embedder } from "./embed";
import type { MemoryDb } from "./store";

/** The memory tables are not in the generated types yet (see SCHEMA-TYPES.md). */
export function memoryDb(): MemoryDb {
  return createAdminClient() as unknown as MemoryDb;
}

/** The Workers AI binding, or null in local `next dev` without it. */
export function aiBinding(): AiBinding | null {
  try {
    const ai = (getCloudflareContext().env as unknown as { AI?: AiBinding }).AI;
    return ai && typeof ai.run === "function" ? ai : null;
  } catch {
    return null;
  }
}

export function memoryEmbedder(): Embedder | null {
  const ai = aiBinding();
  return ai ? workersAiEmbedder(ai) : null;
}
