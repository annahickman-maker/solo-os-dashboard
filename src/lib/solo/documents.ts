import { createAdminClient } from "@/lib/supabase/server";

// solo_documents is not in the generated schema types yet; query it untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => createAdminClient() as any;

/** Keys the dashboard may store. Add a key here before a page uses it. */
export const SOLO_DOC_KEYS = ["focus", "reputation", "offer", "nav", "longform", "shortform", "memory_suggestions"] as const;
export type SoloDocKey = (typeof SOLO_DOC_KEYS)[number];

export function isSoloDocKey(key: string): key is SoloDocKey {
  return (SOLO_DOC_KEYS as readonly string[]).includes(key);
}

export async function readSoloDoc<T = Record<string, unknown>>(key: SoloDocKey): Promise<T | null> {
  const { data, error } = await db()
    .from("solo_documents").select("data").eq("key", key).maybeSingle();
  if (error) throw new Error(`solo_documents read failed: ${error.message}`);
  return (data?.data as T) ?? null;
}

export async function writeSoloDoc(key: SoloDocKey, value: unknown): Promise<void> {
  const { error } = await db()
    .from("solo_documents")
    .upsert({ key, data: value, updated_at: new Date().toISOString() });
  if (error) throw new Error(`solo_documents write failed: ${error.message}`);
}
