#!/usr/bin/env node
/**
 * prepare-schema-types.mjs - builds a reviewable candidate for
 * src/types/database.ts from freshly generated Supabase types.
 *
 *   node scripts/prepare-schema-types.mjs GENERATED_TYPES EXISTING_TYPES EMPTY_OUTPUT_DIR
 *
 * Only the Database and Json aliases are replaced; everything else in the
 * existing file is kept byte for byte. Writes database.ts and review.json into
 * the output folder (which must exist; existing outputs are never
 * overwritten). Never touches the source file or the database.
 */
import { readFileSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { prepareSchemaTypes } from "./lib/schema-types.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const [generatedFile, existingFile, outputDirectory] = process.argv.slice(2);
if (!outputDirectory) {
  console.error("Usage: node scripts/prepare-schema-types.mjs GENERATED_TYPES EXISTING_TYPES EMPTY_OUTPUT_DIR");
  process.exit(1);
}
try {
  const [generated, existing] = [generatedFile, existingFile].map((p) => {
    if (!lstatSync(p).isFile() || lstatSync(p).isSymbolicLink()) throw new Error("Inputs must be regular files");
    return { path: realpathSync(p), text: readFileSync(p, "utf8") };
  });
  if (!lstatSync(outputDirectory).isDirectory() || lstatSync(outputDirectory).isSymbolicLink())
    throw new Error("Output must be a real directory");
  const result = prepareSchemaTypes(existing.text, generated.text);
  const outputs = { types: resolve(outputDirectory, "database.ts"), review: resolve(outputDirectory, "review.json") };
  if (Object.values(outputs).some((o) => o === existing.path || o === generated.path))
    throw new Error("Output would overwrite input");
  const report = {
    format: "schema_type_review_v2",
    generated_sha256: sha(generated.text),
    existing: { path: existing.path, sha256: sha(existing.text) },
    removed: result.removed,
    added: result.added,
    review_required: true,
  };
  // wx refuses any pre-existing output. Partial output on an IO error is never applied.
  writeFileSync(outputs.review, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  writeFileSync(outputs.types, result.candidate, { flag: "wx", mode: 0o600 });
  console.log("Review candidate created. Source file and database unchanged. Review removals and changed types, then typecheck before adopting.");
  if (result.removed.length) {
    console.error("Schema members are missing from the generated output. Adoption is blocked until the schema is reconciled.");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
