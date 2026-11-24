/**
 * transport.mjs - how the database tools send SQL. Every transport is a
 * function `query(sql) -> rows of the last statement`, so the tools can be
 * tested with a fake one.
 *
 *   managementQuery  Supabase Management API (POST /v1/projects/<ref>/database/query)
 *                    with a personal access token from SUPABASE_ACCESS_TOKEN
 *   directQuery      a direct Postgres connection (scripts/lib/db.mjs), with
 *                    the database password
 */
import { connect } from './db.mjs';
import { getPassword, PASSWORD_HELP } from './env.mjs';

const API = 'https://api.supabase.com/v1/projects/';

export function managementQuery(project, token, fetchImpl = fetch) {
  if (!token) throw new Error('Set SUPABASE_ACCESS_TOKEN (a Supabase personal access token) in the environment, or use --direct.');
  return async (sql) => {
    const response = await fetchImpl(API + project + '/database/query', {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 500);
      } catch { /* no body */ }
      throw new Error(`Management API returned HTTP ${response.status}${detail ? ': ' + detail : ''}`);
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Unexpected Management API response.');
    return rows;
  };
}

/** Wraps a connected pg client. A multi-statement query returns the last statement's rows. */
export function directQuery(client) {
  return async (sql) => {
    const result = await client.query(sql);
    return Array.isArray(result) ? result.at(-1).rows : result.rows;
  };
}

/** Opens the transport the flags ask for. Returns { query, close }. */
export async function openTransport(project, args, env = process.env) {
  if (args.direct) {
    const password = await getPassword(args);
    if (!password) throw new Error(PASSWORD_HELP);
    const client = await connect(project, password);
    return { query: directQuery(client), close: () => client.end().catch(() => {}) };
  }
  return { query: managementQuery(project, env.SUPABASE_ACCESS_TOKEN), close: async () => {} };
}
