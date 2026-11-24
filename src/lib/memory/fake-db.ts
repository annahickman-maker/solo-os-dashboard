/**
 * An in-memory stand-in for the Supabase client, for the memory tests only.
 * It speaks the slice of the query builder ./store.ts and ./inbox.ts use,
 * enforces the unique keys of 022_memory.sql (answering 23505 like
 * Postgres), and records rpc calls. `rpcs` answers memory_search; the test
 * decides what the database would rank.
 */
import { randomUUID } from "crypto";
import type { DbResult, MemoryDb, Query } from "./store.ts";

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "delete";

const UNIQUE: Record<string, string[][]> = {
  memory_documents: [["source", "source_id"]],
  memory_chunks: [["document_id", "chunk_index"]],
  backend_settings: [["key"]],
};

export interface FakeMemoryDb extends MemoryDb {
  tables: Record<string, Row[]>;
  calls: string[];
  rpcCalls: { fn: string; args: Record<string, unknown> | undefined }[];
  rpcs: Record<string, (args: Record<string, unknown> | undefined, db: FakeMemoryDb) => DbResult>;
  failWhen: ((table: string, op: Op) => boolean) | null;
  /** Runs once before the next insert into a table (a racing writer). */
  beforeInsert: ((table: string) => void) | null;
}

export function fakeMemoryDb(seed: Record<string, Row[]> = {}): FakeMemoryDb {
  const tables: Record<string, Row[]> = { memory_documents: [], memory_chunks: [], backend_settings: [], ...seed };
  const db: FakeMemoryDb = {
    tables,
    calls: [],
    rpcCalls: [],
    failWhen: null,
    beforeInsert: null,
    rpcs: {
      memory_status: (_a, d) => ({
        data: [{
          documents: d.tables.memory_documents.length,
          chunks: d.tables.memory_chunks.length,
          embedded: d.tables.memory_chunks.filter((c) => c.embedding).length,
          last_import_at: d.tables.memory_documents.map((r) => r.updated_at as string).sort().pop() ?? null,
        }],
        error: null,
      }),
      memory_set_embeddings: (args, d) => {
        let n = 0;
        for (const item of (args?.items as { id: string; embedding: string }[]) || []) {
          const row = d.tables.memory_chunks.find((c) => c.id === item.id);
          if (row) { row.embedding = item.embedding; n++; }
        }
        return { data: n, error: null };
      },
      memory_search: () => ({ data: [], error: null }),
    },
    from: (table: string) => builder(db, table),
    rpc: (fn, args) => {
      db.rpcCalls.push({ fn, args });
      const handler = db.rpcs[fn];
      return Promise.resolve(handler ? handler(args, db) : { data: null, error: { message: `function ${fn} does not exist`, code: "42883" } });
    },
  };
  return db;
}

function builder(db: FakeMemoryDb, table: string): Query<Row> {
  let op: Op = "select";
  let values: Row | Row[] | null = null;
  let returning = false;
  let countWanted = false;
  let columns: string[] | null = null;
  let single: "one" | "maybe" | null = null;
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { column: string; ascending: boolean }[] = [];
  let from = 0;
  let to = Infinity;

  const rows = () => (db.tables[table] ||= []);

  const run = (): DbResult<Row> => {
    db.calls.push(`${op} ${table}`);
    if (db.failWhen?.(table, op)) return { data: null, error: { message: `fake failure on ${op} ${table}` } };
    let out: Row[] = [];
    if (op === "insert") {
      if (db.beforeInsert) { const f = db.beforeInsert; db.beforeInsert = null; f(table); }
      const list = Array.isArray(values) ? values : [values as Row];
      for (const v of list) {
        for (const key of UNIQUE[table] || []) {
          if (rows().some((r) => key.every((k) => r[k] === v[k]))) {
            return { data: null, error: { message: `duplicate key value violates unique constraint (${key.join(", ")})`, code: "23505" } };
          }
        }
      }
      const now = new Date().toISOString();
      for (const v of list) {
        const row = { id: randomUUID(), created_at: now, updated_at: now, embedding: null, ...v };
        rows().push(row);
        out.push(row);
      }
    } else {
      const matched = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of matched) Object.assign(r, values, { updated_at: new Date().toISOString() });
        out = matched;
      } else if (op === "delete") {
        db.tables[table] = rows().filter((r) => !matched.includes(r));
        if (table === "memory_documents") {
          const ids = new Set(matched.map((r) => r.id));
          db.tables.memory_chunks = db.tables.memory_chunks.filter((c) => !ids.has(c.document_id));
        }
        out = matched;
      } else {
        out = [...matched];
        for (const o of [...orders].reverse()) {
          out.sort((a, b) => {
            const x = a[o.column] as string | number | null;
            const y = b[o.column] as string | number | null;
            if (x === y) return 0;
            if (x === null || x === undefined) return 1;
            if (y === null || y === undefined) return -1;
            return (x < y ? -1 : 1) * (o.ascending ? 1 : -1);
          });
        }
      }
    }
    const count = out.length;
    if (op === "select") out = out.slice(from, to === Infinity ? undefined : to + 1);
    const copy = out.map((r) => (columns ? Object.fromEntries(columns.map((k) => [k, r[k] ?? null])) : { ...r }));
    if (single) {
      if (copy.length > 1) return { data: null, error: { message: "more than one row" } };
      if (single === "one" && copy.length === 0) return { data: null, error: { message: "no rows" } };
      return { data: copy[0] ?? null, error: null };
    }
    if ((op === "update" || op === "delete") && !returning) return { data: null, error: null };
    return { data: copy as unknown as Row, error: null, count: countWanted ? count : null };
  };

  const q: Query<Row> = {
    select(c, options) { if (op !== "select") returning = true; if (c && c !== "*") columns = c.split(",").map((x) => x.trim()); if (options?.count) countWanted = true; return q; },
    insert(v) { op = "insert"; values = v as Row; return q; },
    update(v) { op = "update"; values = v as Row; return q; },
    delete() { op = "delete"; return q; },
    eq(c, v) { filters.push((r) => r[c] === v); return q; },
    is(c, v) { filters.push((r) => (r[c] ?? null) === v); return q; },
    ilike(c, p) {
      const re = new RegExp("^" + p.replace(/\\([\\%_])|([%_])|([.*+?^${}()|[\]])/g, (_m, esc, wild, meta) => (esc ? `\\${esc}` : wild === "%" ? ".*" : wild === "_" ? "." : `\\${meta}`)) + "$", "i");
      filters.push((r) => re.test(String(r[c] ?? "")));
      return q;
    },
    order(c, o) { orders.push({ column: c, ascending: o?.ascending !== false }); return q; },
    range(a, b) { from = a; to = b; return q; },
    limit(n) { to = from + n - 1; return q; },
    maybeSingle() { single = "maybe"; return q; },
    single() { single = "one"; return q; },
    then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
  };
  return q;
}
