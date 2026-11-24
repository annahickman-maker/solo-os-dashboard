/**
 * Library - what the API hands the browser and agents for one asset. The R2
 * key and preview hash stay on the server; the preview is reached through
 * /api/library/preview/[id] (owner session), versioned so a new preview shows.
 */
import type { LibraryAsset } from "./contract.ts";

export type ClientAsset = Omit<LibraryAsset, "preview_key" | "preview_sha256"> & { preview_url: string | null };

export function toClientAsset(a: LibraryAsset): ClientAsset {
  const { preview_key, preview_sha256, ...rest } = a;
  return {
    ...rest,
    preview_url: preview_key ? `/api/library/preview/${a.id}?v=${(preview_sha256 || "").slice(0, 12)}` : null,
  };
}
