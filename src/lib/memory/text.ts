/**
 * Memory - the pure half: transcript parsing, chunking, hashing, snippets.
 *
 * No framework imports, so `node --test` can load it, and the page and the
 * import script share the same rules.
 */
import { createHash } from "crypto";

export const MEMORY_KINDS = ["conversation", "content", "note"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type TextFormat = "txt" | "md" | "vtt" | "srt";

/** Largest document text kept, in characters (about a three-hour transcript, twice). */
export const MAX_TEXT_CHARS = 400_000;
/** Largest request body accepted by the inbox and the documents route. */
export const MAX_BODY_BYTES = 1_500_000;

export const CHUNK_TARGET = 1200;
export const CHUNK_OVERLAP = 150;

const SOURCE_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === "string" && (MEMORY_KINDS as readonly string[]).includes(value);
}

export function isValidSource(value: unknown): value is string {
  return typeof value === "string" && SOURCE_RE.test(value);
}

/** The format from a file name, a content type, or the text itself. */
export function detectFormat(text: string, hint?: string | null): TextFormat {
  const h = (hint || "").toLowerCase();
  if (h.endsWith(".vtt") || h.includes("text/vtt") || h === "vtt") return "vtt";
  if (h.endsWith(".srt") || h.includes("subrip") || h === "srt") return "srt";
  if (h.endsWith(".md") || h.endsWith(".markdown") || h.includes("markdown") || h === "md") return "md";
  if (h.endsWith(".txt") || h === "txt") return "txt";
  const head = text.replace(/^﻿/, "").slice(0, 400);
  if (/^WEBVTT/.test(head)) return "vtt";
  if (/^\s*\d+\s*\r?\n\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(head)) return "srt";
  return "txt";
}

const CUE_TIME = /^(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}.*$/;

/**
 * Plain text from a caption file: timestamps, cue numbers and markup go;
 * speaker labels stay as "Name: words". Consecutive cues from the same
 * speaker are joined into one paragraph, and a repeated line (rolling
 * captions) is kept once.
 */
function captionsToText(raw: string): { text: string; speakers: string[] } {
  const lines = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const speakers = new Set<string>();
  const paragraphs: { speaker: string | null; words: string[] }[] = [];
  let lastLine = "";
  let skipBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { skipBlock = false; continue; }
    if (skipBlock) continue;
    if (/^WEBVTT/.test(line)) { skipBlock = true; continue; }
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) { skipBlock = true; continue; }
    if (CUE_TIME.test(line)) continue;
    if (/^\d+$/.test(line) && CUE_TIME.test((lines[i + 1] || "").trim())) continue;
    if (/^[\w-]+$/.test(line) && CUE_TIME.test((lines[i + 1] || "").trim())) continue; // VTT cue id

    let speaker: string | null = null;
    let words = line;
    const voice = words.match(/^<v(?:\.[^\s>]*)?\s+([^>]+)>/);
    if (voice) speaker = voice[1].trim();
    words = words.replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "").trim();
    if (!speaker) {
      const label = words.match(/^([A-Z][\w .'-]{0,40}?):\s+(.+)$/);
      if (label) { speaker = label[1].trim(); words = label[2]; }
    }
    if (!words || words === lastLine) continue;
    lastLine = words;
    if (speaker) speakers.add(speaker);
    const last = paragraphs[paragraphs.length - 1];
    if (last && (speaker === null || last.speaker === speaker)) last.words.push(words);
    else paragraphs.push({ speaker, words: [words] });
  }
  const text = paragraphs.map((p) => (p.speaker ? `${p.speaker}: ` : "") + p.words.join(" ")).join("\n\n");
  return { text, speakers: [...speakers] };
}

/** Speaker labels at the start of lines in a plain text transcript ("Sam: ..."). */
function plainSpeakers(text: string): string[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/^([A-Z][\w .'-]{0,40}?):\s+\S/gm)) counts.set(m[1].trim(), (counts.get(m[1].trim()) || 0) + 1);
  // A label used once is more likely a heading ("Note: ...") than a speaker.
  return [...counts.entries()].filter(([, n]) => n >= 2).map(([name]) => name).slice(0, 20);
}

export function normaliseText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ParsedText = { text: string; format: TextFormat; speakers: string[] };

export function parseText(raw: string, hint?: string | null): ParsedText {
  const format = detectFormat(raw, hint);
  if (format === "vtt" || format === "srt") {
    const { text, speakers } = captionsToText(raw);
    return { text: normaliseText(text), format, speakers };
  }
  const text = normaliseText(raw);
  return { text, format, speakers: plainSpeakers(text) };
}

/**
 * Cuts text into passages of about `target` characters, breaking at
 * paragraph, then sentence, then word boundaries, with a little overlap so
 * a thought that crosses a boundary is still found whole in one passage.
 */
export function chunkText(text: string, target = CHUNK_TARGET, overlap = CHUNK_OVERLAP): string[] {
  const clean = normaliseText(text);
  if (!clean) return [];
  if (clean.length <= target) return [clean];

  // Units no longer than the target: paragraphs, else sentences, else word runs.
  const units: string[] = [];
  for (const para of clean.split(/\n\n+/)) {
    if (para.length <= target) { units.push(para); continue; }
    for (const sentence of para.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) || [para]) {
      const s = sentence.trim();
      if (!s) continue;
      if (s.length <= target) { units.push(s); continue; }
      let run = "";
      for (const word of s.split(" ")) {
        if (run && run.length + 1 + word.length > target) { units.push(run); run = ""; }
        run = run ? `${run} ${word}` : word.slice(0, target);
      }
      if (run) units.push(run);
    }
  }

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + 2 + unit.length > target) {
      chunks.push(current);
      const tail = overlap > 0 ? current.slice(-overlap) : "";
      const cut = tail.indexOf(" ");
      current = cut >= 0 && tail.length > 0 ? tail.slice(cut + 1) : "";
    }
    current = current ? `${current}\n\n${unit}` : unit;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function contentHash(text: string): string {
  return "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
}

/** "2026-03-04 Team call.vtt" -> "2026-03-04 Team call". */
export function titleFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() || name;
  const title = base.replace(/\.(txt|md|markdown|vtt|srt)$/i, "").replace(/[_]+/g, " ").trim();
  return title.slice(0, 300) || "Untitled";
}

/** The first line, cut to a title, when nothing better is given. */
export function titleFromText(text: string): string {
  const first = text.split("\n").find((l) => l.trim()) || "Untitled";
  const clean = first.replace(/^#+\s*/, "").trim();
  return clean.length > 80 ? clean.slice(0, 77).replace(/\s+\S*$/, "") + "..." : clean || "Untitled";
}

const STOP = new Set("a an and are as at be but by do does for from had has have how i if in is it its me my of on or our so that the their them then there they this to was we were what when where which who why will with you your".split(" "));

export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])].filter((t) => t.length > 1 && !STOP.has(t));
}

/** How many of the query's words a passage contains, longest words weighted most. */
export function keywordScore(content: string, terms: string[]): number {
  const lower = content.toLowerCase();
  let score = 0;
  for (const t of terms) {
    const stem = t.length > 5 ? t.slice(0, t.length - 2) : t;
    if (lower.includes(stem)) score += Math.min(t.length, 8);
  }
  return score;
}

/** A window of about `size` characters around the densest run of query words. */
export function bestSnippet(content: string, query: string, size = 280): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= size) return text;
  const terms = queryTerms(query);
  let bestStart = 0;
  let best = -1;
  const step = Math.max(20, Math.floor(size / 4));
  for (let start = 0; start < text.length; start += step) {
    const s = keywordScore(text.slice(start, start + size), terms);
    if (s > best) { best = s; bestStart = start; }
    if (start + size >= text.length) break;
  }
  let start = bestStart;
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space >= 0 && space - start < 30 ? space + 1 : start;
  }
  let end = Math.min(text.length, start + size);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start + size / 2) end = space;
  }
  return (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
}
