/**
 * Memory embeddings through the Workers AI binding (free tier), model
 * @cf/baai/bge-small-en-v1.5: 384 numbers per passage. Pure: the binding is
 * passed in (./server.ts finds it), so tests use a fake.
 *
 * Passages are embedded as they are; a question gets the model's retrieval
 * prefix. Both use CLS pooling. Changing the model or pooling means
 * re-embedding every chunk (see MEMORY.md).
 */

export const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5";
export const EMBED_DIMENSIONS = 384;
export const EMBED_BATCH = 50;
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

export type AiBinding = { run: (model: string, input: unknown) => Promise<unknown> };

export interface Embedder {
  model: string;
  /** One vector per text, in order. Throws when the model fails. */
  embed(texts: string[], as: "query" | "passage"): Promise<number[][]>;
}

export function workersAiEmbedder(ai: AiBinding): Embedder {
  return {
    model: EMBED_MODEL,
    async embed(texts, as) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH).map((t) => (as === "query" ? QUERY_PREFIX + t : t));
        const res = (await ai.run(EMBED_MODEL, { text: batch, pooling: "cls" })) as { data?: unknown };
        const data = res?.data;
        if (!Array.isArray(data) || data.length !== batch.length) throw new Error("Workers AI returned no embeddings");
        for (const v of data) {
          if (!Array.isArray(v) || v.length !== EMBED_DIMENSIONS) throw new Error("Workers AI returned an embedding of the wrong size");
          out.push(v.map(Number));
        }
      }
      return out;
    },
  };
}

/** The pgvector text form, e.g. "[0.012345,-0.5,...]". */
export function vectorLiteral(v: number[]): string {
  if (v.length !== EMBED_DIMENSIONS || v.some((x) => !Number.isFinite(x))) throw new Error("not a 384-dimension vector");
  return `[${v.map((x) => Number(x.toFixed(6))).join(",")}]`;
}
