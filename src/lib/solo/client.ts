"use client";
/** Browser helpers for Solo OS documents. Pages hold the whole document and save it back. */
export async function loadDoc<T>(key: string, fallback: T): Promise<T> {
  const res = await fetch(`/api/solo/docs/${key}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${key} (${res.status})`);
  const json = (await res.json()) as { data: T | null };
  return json.data ?? fallback;
}

export async function saveDoc<T>(key: string, data: T): Promise<void> {
  const res = await fetch(`/api/solo/docs/${key}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`Could not save ${key} (${res.status})`);
}
