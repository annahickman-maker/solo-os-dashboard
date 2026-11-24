# Library

The Library shows previews of the owner's images, videos, audio and documents
in one place, at `/library`. **It stores previews only.** Each original stays
where it already lives: a folder on the owner's Mac, Google Drive, Dropbox,
YouTube, or any link. Solo OS keeps:

- a small preview image (about 800px on the long edge, JPEG, PNG or WebP, at
  most 400 KiB and 1024px), in the private R2 bucket `LIBRARY_PREVIEWS`
- a few lines of metadata (title, kind, size, duration, date, tags, collection)
- a link to the original, or a label saying where it lives ("Mac: Shoots/2026/beach.jpg")

A few thousand previews come to a few hundred MB, well inside R2's 10 GB free
tier. Setup -> Library connections and the Library page both show the storage
used.

## Setup (your manager)

1. Apply migration `023_library.sql` (`npm run db:migrate`). It adds
   `library_assets`, `library_sync_runs` and `library_stats()`, service role
   only, like the other owner tables.
2. Create the **private** bucket and deploy:
   `npx wrangler r2 bucket create solo-os-library-previews`. Do not turn on
   public access or a custom domain for it: the dashboard serves previews to
   the signed-in owner through `/api/library/preview/[id]`. The binding is
   already in `wrangler.jsonc` (`LIBRARY_PREVIEWS`). Without it, links and
   metadata still work and previews are refused with a clear error.
3. For the Mac sync, mint a key named e.g. `library-sync` with only
   `library:write` in Setup -> Manage agent access.

## Routes and scopes

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/library/assets?q=&kind=&source=&collection=&tag=&hidden=1&before=&limit=` | owner session or `library:read` |
| POST | `/api/library/assets` | owner session or `library:write` |
| GET | `/api/library/status` | owner session or `library:read` |
| POST | `/api/library/sync-runs` | owner session or `library:write` |
| POST | `/api/library/import/youtube` | owner session or `library:write` |
| PATCH | `/api/library/assets/[id]` (tags, collection, title, hidden) | owner session only |
| GET | `/api/library/preview/[id]` | owner session only |

`library:read` and `library:write` are separate: write does not imply read.
Minted keys reach only the routes above (src/lib/api/scoped-routes.ts).
Machine requests sign `METHOD:pathname:timestamp:body` as usual (AGENT-KEYS.md).

`POST /api/library/assets` takes JSON:

```json
{
  "source": "mac | gdrive | dropbox | youtube | link | upload",
  "source_id": "the original's stable id in its source (relative path, file id, URL)",
  "kind": "image | video | audio | doc",
  "title": "optional",
  "original_url": "https://... (required for source link)",
  "original_label": "where it lives, when there is no link",
  "width": 6000, "height": 4000, "duration_s": 12.5,
  "tags": ["beach"], "collection": "shoots", "taken_at": "2026-03-01T10:00:00Z",
  "meta": {},
  "preview_base64": "optional small JPEG, PNG or WebP"
}
```

It is **idempotent on (source, source_id)**: the same original sent again
updates its row and overwrites its preview at the same R2 key, and answers
`"status": "unchanged"` when nothing differs (201 `created`, 200 `updated` or
`unchanged`). The preview type is read from the file's bytes, never from a
declared type; anything that is not JPEG, PNG or WebP is refused (415), and an
oversize preview is refused (413). Once the owner edits an item's tags,
collection or hidden state, later syncs keep the owner's choices.

## Mac folder sync

`scripts/library-sync.mjs` runs on the owner's Mac. It walks a folder, makes
each preview with macOS built-ins (`sips` for images including HEIC; `ffmpeg`
for videos when installed, otherwise Quick Look `qlmanage -t`; Quick Look for
PDFs) and sends previews plus metadata. Originals and the home folder path
never leave the Mac: only the folder name and relative paths are sent.

```bash
SOLO_OS_URL=https://your-dashboard.example.com \
LIBRARY_API_KEY=bbk_library-sync_... \
node scripts/library-sync.mjs --folder ~/Pictures/Shoots --collection shoots
```

Options: `--name` (label for the folder, default its name), `--dry-run`,
`--force` (resend unchanged files), `--limit N`, `--env-file` (default
`~/.solo-os/library-sync.env` holding `SOLO_OS_URL=` and `LIBRARY_API_KEY=`,
mode 600), `--state` (default `~/.solo-os/library-sync-state.json`, which skips
files whose size and modified time have not changed). Each run is recorded and
shown in Setup -> Library connections.

To schedule it, your manager can add a launchd agent
(`~/Library/LaunchAgents/com.solo-os.library-sync.plist`) running that command
once a day with `StartCalendarInterval`, or a cron line. Keep the key in the
env file, not in the plist.

## YouTube

"Import from YouTube" on the Library page (or `POST /api/library/import/youtube`)
reuses the YouTube connection made in Social. That connection already asks for
`youtube.readonly`, so no new consent is needed. It imports the channel's own
uploads (up to 200 per run): each video's 320px thumbnail as the preview, its
title, publish date and a link to the video. Thumbnails are only fetched from
YouTube's image hosts, and only when new or changed. A channel connected before
the read scope existed gets "Reconnect the channel in Social".

## Add by link

Library -> Add takes any URL (a Drive or Dropbox share link, a page, a file
link) and/or a note of where the original lives, plus an optional preview
image the owner picks. The browser shrinks it to about 800px WebP before
upload; the picked file itself is not uploaded.

## Google Drive and Dropbox (recipes for later)

No OAuth connector is built yet. Until then, add items by link. A connector
later is a scheduled job that calls `POST /api/library/assets` with a
`library:write` key; nothing in the Library changes:

- **Google Drive**: OAuth scope `drive.metadata.readonly`. List a chosen folder
  with `files.list` (`q: '<folderId>' in parents`, fields `id, name, mimeType,
  webViewLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata,
  modifiedTime`). Send `source: "gdrive"`, `source_id: file.id`,
  `original_url: webViewLink`. `thumbnailLink` is short-lived and needs the
  token: fetch it server-side (append `=s800`) and send the bytes as
  `preview_base64`.
- **Dropbox**: scopes `files.metadata.read` and `sharing.read`. Walk with
  `files/list_folder` (recursive), get previews from `files/get_thumbnail_v2`
  (`size: w640h480`, `format: jpeg`) and a link from
  `sharing/list_shared_links` (or `create_shared_link_with_settings` only with
  the owner's say-so). Send `source: "dropbox"`, `source_id: entry.id`.

Either way, store the OAuth refresh token as a Worker secret or in the
connector's own runtime, never in the Library tables.

## Tests

`npm run test:library` runs input and preview limits, idempotent ingest
against a fake database and bucket, the YouTube import against a fake fetch,
scope enforcement through the real auth module, the sync script's helpers,
and migration 023 on an in-process Postgres (PGlite), both fresh and on top of
an installed 001-021 dashboard.
