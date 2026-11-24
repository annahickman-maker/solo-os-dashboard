/**
 * Create (or re-role) a dashboard user in Supabase Auth.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/create-user.ts <email> [admin|social] [--reset-password]
 *
 * The password is never a command argument (it would land in shell history).
 * It is typed at a hidden prompt, or piped in on stdin.
 *
 * role: 'admin' (default - full dashboard) or 'social' (social media manager -
 * /social only; middleware + API auth enforce the boundary).
 *
 * If the email already exists, the script updates its role only. It changes the
 * existing password only with --reset-password.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  console.error("Run with: npx tsx --env-file=.env.local scripts/create-user.ts <email> [role]");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const RESET_PASSWORD = process.argv.includes("--reset-password");
const EMAIL = args[0];
const ROLE = (args[1] || "admin").toLowerCase();

if (!EMAIL || !EMAIL.includes("@")) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/create-user.ts <email> [admin|social] [--reset-password]");
  process.exit(1);
}

/** Read the password from a hidden prompt (terminal) or from stdin (pipe). */
async function readPassword(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = "";
    for await (const chunk of stdin) data += chunk;
    return data.replace(/\r?\n$/, "");
  }
  process.stdout.write("Password (hidden): ");
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    stdin.on("data", (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f") value = value.slice(0, -1);
        else value += c;
      }
    });
  });
}
if (!["admin", "social"].includes(ROLE)) {
  console.error(`Unknown role '${ROLE}' - use 'admin' or 'social'`);
  process.exit(1);
}

async function main() {
  const PASSWORD = await readPassword();
  if (PASSWORD.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role: ROLE },
  });

  if (!error) {
    console.log(`User created: ${data.user.email} (${data.user.id}) - role: ${ROLE}`);
    return;
  }

  if (!/already.*(registered|exists)/i.test(error.message)) {
    console.error("Failed to create user:", error.message);
    process.exit(1);
  }

  // Existing account - update its role, and its password only when asked.
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
  if (listError || !existing) {
    console.error("User exists but could not be found to update:", listError?.message || EMAIL);
    process.exit(1);
  }
  const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
    ...(RESET_PASSWORD ? { password: PASSWORD } : {}),
    app_metadata: { role: ROLE },
  });
  if (updateError) {
    console.error("Failed to update user:", updateError.message);
    process.exit(1);
  }
  console.log(`User updated: ${EMAIL} (${existing.id}) - role: ${ROLE}${RESET_PASSWORD ? " - password reset" : ""}`);
}

main();
