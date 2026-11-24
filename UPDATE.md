# Updating Solo OS

New versions of Solo OS are published in the public dashboard repository. Your
copy is your own repository. Updating means pulling the new version's code
into your copy, then bringing your database up to date with
`scripts/migrate.mjs`.

The version you run is in the `VERSION` file.

## Once: add the public repository as `upstream`

    git remote add upstream <public-dashboard-repo-url>
    git fetch upstream --tags

`git remote -v` should now list `origin` (your copy) and `upstream` (the
public one).

## Each update

### 1. Start clean

    git status

Commit or stash your own changes first. Make a branch for the update:

    git checkout -b update-solo-os

### 2. Pull the new version

To take a released version (recommended), merge its tag:

    git fetch upstream --tags
    git tag --list 'v*' --sort=-v:refname | head
    git merge v1.1.0

Use the tag you want in place of `v1.1.0`. To follow the latest code instead,
use `git merge upstream/main`.

If git reports conflicts, they are in files both you and Solo OS changed.
Open each one, keep your changes and the new ones, then `git add` it and
`git commit`. Never edit or renumber a file in `supabase/migrations` that has
already been applied to your database: migrate.mjs checks them.

### 3. Install and check

    npm install
    npx tsc --noEmit -p .
    npm run test:db

### 4. See what the database needs

Use the same transport as when you installed: the Management API with
`SUPABASE_ACCESS_TOKEN` set, or `--direct` with the database password.

    node scripts/migrate.mjs

This only reads. It prints how many migrations are applied and lists each
pending one, for example:

    20 applied, 1 pending.
      pending  021_new_feature.sql

It also checks every applied migration still matches its file (by checksum).

### 5. Apply

Take a backup first (Supabase keeps daily backups on paid plans; you can also
use `pg_dump`). Then:

    node scripts/migrate.mjs --project-ref <project-ref> --yes

Each pending migration is applied with its `schema_migrations` row in one
transaction, in number order. It stops at the first failure; a failed file is
rolled back and nothing after it runs.

### 6. Deploy

Deploy the dashboard as usual, then merge the update branch into your main
branch and push it to `origin`.

## Your own migrations

Number your own database changes from `900` to `999`, for example
`supabase/migrations/901_my_table.sql`. Solo OS never uses those numbers, and
migrate.mjs never applies, checks or reports them. Apply one with:

    node scripts/apply-migration.mjs supabase/migrations/901_my_table.sql --project-ref <project-ref> --yes

It records the file in `schema_migrations` and refuses a name that is already
recorded, so give every change a new number.

## When migrate stops

migrate.mjs applies nothing if the history and the files disagree. It prints
one line per problem:

- **CHANGED** `<file>`: the file differs from the version applied to your
  database. Usually a merge touched it, or it was edited by hand. Put the file
  back to what was applied (`git log -p -- supabase/migrations/<file>`) and put
  any new change in a new migration.
- **UNKNOWN** `<file>`: your database has a Solo OS migration this checkout
  does not. The checkout is older than the database; pull the newer version.
- **ORDER** `<file>`: a pending file is numbered below one already applied.
  This should not happen with released versions. Check where the file came
  from before doing anything else.
- **no schema_migrations table**: the database was not installed with
  `scripts/install-db.mjs`. Do not run migrate.mjs against it.

If a run reports "no acknowledgement", run `node scripts/migrate.mjs` again
without `--yes` and read the list before applying anything more.
