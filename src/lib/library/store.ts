/**
 * Library - ingest and curation logic, with the database and the preview
 * bucket passed in. No framework imports, so the tests run it against fakes;
 * the Supabase and R2 adapters live in ./server.ts.
 *
 * Idempotent on (source, source_id): sending the same original again updates
 * its row and overwrites its preview at the same R2 key. Nothing is duplicated
 * and an unchanged re-send writes nothing.
 */
import {
  checkPreview,
  previewKey,
  sha256Hex,
  type AssetInput,
  type Checked,
  type CurationInput,
  type LibraryAsset,
  type LibrarySource,
  type PreviewType,
} from "./contract.ts";

export type AssetRow = Omit<LibraryAsset, "id" | "added_at" | "updated_at">;

/** Thrown by LibraryDb.insert when (source, source_id) already exists. */
export class DuplicateAssetError extends Error {
  constructor() {
    super("asset already exists");
  }
}

export interface LibraryDb {
  findBySource(source: LibrarySource, sourceId: string): Promise<LibraryAsset | null>;
  findById(id: string): Promise<LibraryAsset | null>;
  insert(row: AssetRow): Promise<LibraryAsset>;
  update(id: string, patch: Partial<AssetRow>): Promise<LibraryAsset>;
}

export interface PreviewBucket {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  delete?(key: string): Promise<unknown>;
}

export type IngestStatus = "created" | "updated" | "unchanged";
export type IngestResult = Checked<{ status: IngestStatus; asset: LibraryAsset; preview_written: boolean }>;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export async function ingestAsset(deps: { db: LibraryDb; bucket: PreviewBucket | null }, input: AssetInput): Promise<IngestResult> {
  let preview: { bytes: Uint8Array; type: PreviewType } | null = null;
  if (input.preview_base64) {
    const checked = checkPreview(input.preview_base64);
    if (!checked.ok) return checked;
    if (!deps.bucket) {
      return { ok: false, error: "Preview storage is not connected (LIBRARY_PREVIEWS bucket). See LIBRARY.md.", status: 503 };
    }
    preview = checked.value;
  }

  const existing = await deps.db.findBySource(input.source, input.source_id);
  try {
    return await write(deps, input, preview, existing);
  } catch (e) {
    if (!(e instanceof DuplicateAssetError)) throw e;
    // Another request created it between our read and insert: update that row.
    const winner = await deps.db.findBySource(input.source, input.source_id);
    if (!winner) throw e;
    return write(deps, input, preview, winner);
  }
}

async function write(
  deps: { db: LibraryDb; bucket: PreviewBucket | null },
  input: AssetInput,
  preview: { bytes: Uint8Array; type: PreviewType } | null,
  existing: LibraryAsset | null
): Promise<IngestResult> {
  const fields: Partial<AssetRow> = {
    title: input.title || existing?.title || "",
    kind: input.kind,
    original_url: input.original_url,
    original_label: input.original_label,
    width: input.width,
    height: input.height,
    duration_s: input.duration_s,
    taken_at: input.taken_at,
    meta: input.meta,
  };

  let previewWritten = false;
  if (preview) {
    const key = await previewKey(input.source, input.source_id, preview.type);
    const sha = await sha256Hex(preview.bytes);
    if (!existing || existing.preview_sha256 !== sha || existing.preview_key !== key) {
      await deps.bucket!.put(key, preview.bytes, { httpMetadata: { contentType: preview.type, cacheControl: "private, max-age=86400" } });
      previewWritten = true;
      if (existing?.preview_key && existing.preview_key !== key && deps.bucket!.delete) {
        await deps.bucket!.delete(existing.preview_key).catch(() => undefined);
      }
    }
    Object.assign(fields, { preview_key: key, preview_type: preview.type, preview_bytes: preview.bytes.length, preview_sha256: sha });
  }

  if (!existing) {
    const asset = await deps.db.insert({
      source: input.source,
      source_id: input.source_id,
      preview_key: null,
      preview_type: null,
      preview_bytes: 0,
      preview_sha256: null,
      tags: input.tags,
      collection: input.collection,
      curated_at: null,
      hidden: false,
      title: "",
      kind: input.kind,
      original_url: null,
      original_label: null,
      width: null,
      height: null,
      duration_s: null,
      taken_at: null,
      meta: {},
      ...fields,
    } as AssetRow);
    return { ok: true, value: { status: "created", asset, preview_written: previewWritten } };
  }

  // The owner's tags and collection win once they have curated the asset.
  if (!existing.curated_at) {
    fields.tags = input.tags;
    fields.collection = input.collection;
  }

  const patch: Partial<AssetRow> = {};
  for (const [k, v] of Object.entries(fields) as [keyof AssetRow, unknown][]) {
    if (!same(existing[k], v)) (patch as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true, value: { status: "unchanged", asset: existing, preview_written: previewWritten } };
  }
  const asset = await deps.db.update(existing.id, patch);
  return { ok: true, value: { status: "updated", asset, preview_written: previewWritten } };
}

/** The owner's edit from the dashboard. Marks the asset curated so a sync keeps it. */
export async function curateAsset(db: LibraryDb, id: string, change: CurationInput, now = new Date()): Promise<LibraryAsset | null> {
  const existing = await db.findById(id);
  if (!existing) return null;
  const patch: Partial<AssetRow> = { ...change };
  if ("tags" in change || "collection" in change || "hidden" in change) patch.curated_at = now.toISOString();
  return db.update(id, patch);
}
