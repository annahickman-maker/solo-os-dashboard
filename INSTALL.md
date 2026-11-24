# Installing the Solo OS database

Solo OS keeps all of its data in one Supabase project that you own. The
dashboard repository holds every migration for that database, in
`supabase/migrations`, numbered `001` to `023`. The sales page site uses the
same database and has no migrations of its own.

This guide installs the database into a **new, empty** Supabase project. If
your project already has tables in it, stop here and read UPDATE.md instead.

## What you need

- Node 22 or later, and this repository checked out with `npm install` done.
- A new Supabase project. Do not create tables, users or storage buckets in it
  first: the installer refuses a project that has any.
- One way for the installer to reach the database:
  - **Management API (default).** A Supabase personal access token, from your
    Supabase account settings under Access Tokens.
  - **Direct connection (`--direct`).** The database password you set when you
    created the project.

## 1. Point this checkout at your project

Create `.env.local` in the repository folder (it is ignored by git) with at
least:

    SUPABASE_URL=https://<project-ref>.supabase.co

`<project-ref>` is the 20-character id in your project's URL. The installer
reads it from here and will only write to this project.

## 2. Check the files

    node scripts/install-db.mjs --check

This reads `supabase/migrations` and prints how many migrations will be
installed and the first and last names. It does not contact the database. If
it lists files of your own (numbers 900 to 999), they are not installed here;
apply them afterwards (see UPDATE.md).

## 3. Install

With the Management API, put the token in the environment for this one
command (not in `.env.local`, and not in your shell history if you can avoid
it):

    read -s SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
    node scripts/install-db.mjs --project-ref <project-ref> --yes

With a direct connection instead:

    node scripts/install-db.mjs --project-ref <project-ref> --yes --direct

It asks for the database password without showing it. You can also set
`SUPABASE_DB_PASSWORD`, or pipe it in with `--password-stdin`.

What the installer does, in order:

1. Checks the project is empty: no tables in the public schema, no users, no
   storage buckets.
2. Creates a receipts file at `~/.solo-os/receipts/<project-ref>.jsonl` (the
   folder is created private to you). It refuses to start if that file already
   exists, so an earlier attempt is never overwritten. Use `--receipts <file>`
   to put it somewhere else.
3. Sends each migration, `001` to `023`, as one request. Each request ends by
   asking the database to echo back a short receipt. A file only counts as
   done when that receipt comes back, and then it is written to the receipts
   file.
4. When all 22 are confirmed, records them in the `schema_migrations` table
   (file name and checksum) in one transaction, reads the table back and
   checks it matches.

A successful run ends with:

    Done. 23 migrations installed and recorded for <project-ref>.

## 4. Create your login

    npx tsx --env-file=.env.local scripts/create-user.ts <email>

It asks for your password without showing it (at least 10 characters). You can
also pipe it in. It is never typed as part of the command.

Then sign in to the dashboard. `GET /api/home` (signed in) lists the applied
migrations from `schema_migrations`.

## If an install stops

The installer stops at the first error or missing receipt and never re-sends a
file on its own. Nothing is retried, because a file that ran without its
receipt coming back would run twice.

- **A migration failed or did not confirm.** The project is part-installed.
  Because it is a new project, the simplest fix is to delete it in Supabase,
  create a new empty one, update `.env.local`, and install again. Keep the old
  receipts file until you are done, as a record.
- **All 23 migrations confirmed but recording the history failed** (for
  example the connection dropped at the very end). Re-run with the same
  receipts file and `--record-only`:

      node scripts/install-db.mjs --project-ref <project-ref> --yes --record-only

  This sends no migrations. It checks the receipts cover all 22 files for this
  project, writes the history, and reads it back.
- **"already exists" for the receipts file.** An earlier install ran against
  this project. Look at the file to see how far it got, then follow one of the
  two cases above.

## Tests

    npm run test:db

runs the installer and update logic against a fake database (no network).
To try the real SQL on a throwaway local Postgres, set `PG_TEST_URL` to an
empty server you do not care about and run `npm run test:db-local`. It adds
small stand-ins for the Supabase `auth` and `storage` schemas and roles.
