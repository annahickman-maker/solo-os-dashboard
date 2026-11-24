# Memory

Memory keeps your own words where you can find them again: call and meeting
transcripts, video captions, voice notes and written notes. On the Memory page
you ask a question and get an answer built from what you actually said, with
the sources (title, date, the passage, a link to the full document). You can
also browse and search everything, and add more by pasting or uploading.

Everything lives in your own Supabase database. Nothing is shared.

## Install

Memory needs migration `022_memory.sql` (pgvector, `memory_documents`,
`memory_chunks` and the `memory_search` function). A new install gets it with
every other migration (INSTALL.md). An existing dashboard picks it up with
`npm run db:migrate` (UPDATE.md). Until it is applied, the Memory page and
Setup > Memory connections say "not installed".

## How it works

- **Documents.** Each transcript or note is one document, identified by its
  `source` (for example `zoom`, `drive`, `folder`, `upload`) and `source_id`
  (the recording id, file path or video id). Sending the same source and id
  again updates that document instead of adding a copy, so imports are safe
  to retry. Same text: nothing changes (`unchanged`). New text: its passages
  are replaced (`updated`).
- **Kinds.** `conversation` (calls, meetings, interviews), `content` (your
  videos, podcasts, talks, posts) and `note` (everything else).
- **Passages.** Text is cleaned (caption timestamps and cue numbers removed,
  speaker labels kept as `Name: words`) and cut into passages of about 1,200
  characters with a small overlap.
- **Search.** Every passage is indexed by keywords. With the Workers AI
  binding, each passage also gets an embedding
  (`@cf/baai/bge-small-en-v1.5`, free tier), so search also understands
  meaning ("how I price" finds "what I charge"). The two are merged by rank.
  Without the binding (local `npm run dev`) search uses keywords only and
  says so. Passages imported without an embedding are found by keywords
  until Setup > Memory connections > "Embed waiting passages" fills them in.
- **Answers.** "Ask" sends the best passages (up to 10) to Claude with your
  own `ANTHROPIC_API_KEY`, one call per question. The answer quotes and cites
  your words ([1], [2]); it does not add outside advice. Without the key the
  page says so and "Search only" still works for free. The model defaults to
  `claude-opus-5-5`; set `MEMORY_AI_MODEL` to change it.
- **Whose words.** For a conversation you can say which speaker label is you
  (`owner_speaker`, e.g. `"Me"` or your name as the transcript shows it).
  Answers then treat other speakers' lines as context, not as your words.

Workers AI's free tier is 10,000 neurons a day; embedding one passage uses a
tiny fraction of one. A very large backlog may take a few days of "Embed
waiting passages" on the free tier, or a few cents on a paid Workers plan.

## Adding documents

1. **The Memory page.** "Add" > paste text, or upload `.txt`, `.md`, `.vtt`
   or `.srt` files (1.5 MB each). Uploading a file with the same name again
   updates it.
2. **The inbox** (below), for Zapier, Make, scripts and connectors.
3. **Agent keys.** Mint a key in Setup > Manage agent access with
   `memory:write` (add documents) and/or `memory:read` (list, read, search,
   ask). Signed requests as in AGENT-KEYS.md:

   | Method | Path | Scope |
   | --- | --- | --- |
   | GET | `/api/memory/documents?q=&kind=&limit=&offset=` | memory:read |
   | GET | `/api/memory/documents/{id}` | memory:read |
   | GET | `/api/memory/search?q=&kind=&limit=` | memory:read |
   | POST | `/api/memory/ask` `{question, kind?}` | memory:read (spends your Anthropic key) |
   | POST | `/api/memory/documents` (same body as the inbox) | memory:write |

   Deleting a document and the inbox settings are owner only (your session or
   the master key). An agent's documents record its key name in `added_by`
   and default to source `agent`.

## The inbox

`POST https://<your dashboard>/api/memory/inbox`

Turn it on in **Setup > Memory connections > Turn on the inbox**. You get a
token once (it starts with `mem_`); only its hash is stored. Copy it into the
tool that sends to the inbox. "Rotate inbox token" makes a new one and the old
one stops working; "Turn the inbox off" stops all of them.

Send the token in a header, never in the URL:

    Authorization: Bearer mem_...

(`X-Memory-Token: mem_...` also works, for tools that cannot set
`Authorization`.)

### JSON

```json
{
  "source": "zoom",
  "source_id": "85312345678-2026-03-04",
  "title": "Client call: launch plan",
  "kind": "conversation",
  "occurred_at": "2026-03-04T10:00:00Z",
  "text": "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Sam>So where do we start?</v>\n...",
  "url": "https://zoom.us/rec/share/...",
  "owner_speaker": "Sam"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `text` | yes | Plain text, Markdown, or a whole `.vtt` / `.srt` file. `transcript` is accepted as another name. |
| `source` | no (default `inbox`) | Lowercase letters, digits, `_ . : -`, up to 64. |
| `source_id` | no | Up to 500 characters. Without it the text itself is the id, so the same text twice is one document. Send it whenever the tool has one. |
| `title` | no | Defaults to the file name or the first line. |
| `kind` | no (default `note`) | `conversation`, `content` or `note`. |
| `occurred_at` | no | ISO date or Unix seconds: when it was said or published. |
| `url` | no | A link back to the original. |
| `speakers`, `owner_speaker`, `metadata` | no | A list of names, which one is you, any small JSON object (10 KB). |

### A raw file

Send the file as the body with its details in the query string:

```sh
curl -X POST "https://<your dashboard>/api/memory/inbox?source=folder&source_id=calls/2026-03-04.vtt&kind=conversation&title=Client%20call" \
  -H "Authorization: Bearer $MEMORY_INBOX_TOKEN" \
  -H "Content-Type: text/vtt" \
  --data-binary @2026-03-04.vtt
```

Or as a multipart form with a `file` field plus the same fields as form
values (`-F file=@call.srt -F source=drive -F kind=conversation`).

### Answers and limits

- `201 {"ok":true,"status":"created","id":"...","chunks":12,"embedded":12,"pending_embeddings":0}`
- `200` with `"status":"updated"` or `"unchanged"`: the same source and id was sent before.
- `400` bad field, `401` wrong or missing token, `403` inbox off, `413` too
  large, `415` an unsupported body (PDF, audio: send the transcript text).
- A request body is at most 1.5 MB; a document's cleaned text at most 400,000
  characters (about six hours of talk). Split anything longer into parts
  (`source_id` `...-part-1`, `...-part-2`).

## Connection recipes

All of these use the inbox. Each tool needs the inbox URL and the token,
stored in that tool's own secret field.

### Zapier (any app)

1. Trigger: the app's "new recording", "new transcript", "new file" or
   "new note" event.
2. If the trigger only gives a link to the transcript, add a step that
   downloads it as text (for example "Webhooks by Zapier > GET" on the link).
3. Action: **Webhooks by Zapier > Custom Request**. Method `POST`, URL the
   inbox URL, Data pass-through off, Data:
   `{"source":"<app>","source_id":"<the item's id>","title":"<its title>","kind":"conversation","occurred_at":"<its date>","text":"<the transcript>"}`.
   Headers: `Authorization` = `Bearer mem_...`, `Content-Type` =
   `application/json`.
4. Test it, then check the Memory page. Re-running the Zap is harmless.

### Make

HTTP module > "Make a request": method POST, the inbox URL, header
`Authorization: Bearer mem_...`, body type Raw, content type JSON, the same
JSON as above with the scenario's fields mapped in.

### Zoom recordings

Needs Zoom cloud recording with "Create audio transcript" turned on (Zoom
settings > Recording; a paid Zoom plan). In Zapier: trigger **Zoom > New
Recording**, then a step that fetches the recording's transcript file (the
`TRANSCRIPT` / `.vtt` file among the recording files; depending on your Zoom
settings the download link may need the download token from the trigger), then the Custom Request above with
`source` `zoom`, `source_id` the meeting UUID, `kind` `conversation`, and
`text` the downloaded `.vtt`. The inbox removes the timestamps and keeps the
speaker names. Set `owner_speaker` to your Zoom display name.

### Google Drive folder

Drop transcripts (Google Docs, `.txt`, `.vtt`, `.srt`) into one folder. In
Zapier: trigger **Google Drive > New File in Folder**, then **Google Drive >
Export file** (Google Docs as plain text) or **Retrieve file** for text files,
then the Custom Request with `source` `drive`, `source_id` the file id. Many
meeting recorders (Google Meet, Otter, Fathom and others) can save
transcripts into Drive, which makes this the simplest catch-all.

### YouTube captions of your own videos

YouTube's API only returns caption files to the channel owner through OAuth,
which Zapier's YouTube app does not offer. Two ways that work:

- **YouTube Studio:** Subtitles > the video > download `.vtt` or `.srt`, then
  upload it on the Memory page (kind Content) or drop it in your watched
  folder. Set the title to the video title.
- **Your manager on your Mac:** download the captions of your own videos into
  the watched folder with a caption downloader (for example
  `yt-dlp --skip-download --write-subs --write-auto-subs --sub-format vtt -o "%(upload_date)s %(title)s.%(ext)s" <your channel or video URL>`),
  then the folder import below sends them. Use `--source youtube --kind content`.

### A watched folder on your Mac

`scripts/memory-import.mjs` sends every `.txt`, `.md`, `.vtt` and `.srt` in a
folder (and its subfolders). It remembers what it sent (by path, size and
modified time) and only sends new or changed files; the inbox is idempotent as
well, so running it often is harmless.

```sh
mkdir -p ~/.solo-os && chmod 700 ~/.solo-os
printf '%s' 'mem_...' > ~/.solo-os/memory-inbox-token && chmod 600 ~/.solo-os/memory-inbox-token
MEMORY_INBOX_URL=https://<your dashboard>/api/memory/inbox \
  node scripts/memory-import.mjs ~/Transcripts --kind conversation --dry-run
```

Remove `--dry-run` to send. To run it every hour and whenever the folder
changes, your manager installs a launchd job at
`~/Library/LaunchAgents/os.solo.memory-import.plist` (paths filled in for your
Mac; `node` must be the full path from `which node`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>os.solo.memory-import</string>
  <key>ProgramArguments</key><array>
    <string>/full/path/to/node</string>
    <string>/full/path/to/dashboard/scripts/memory-import.mjs</string>
    <string>/Users/you/Transcripts</string>
    <string>--kind</string><string>conversation</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>MEMORY_INBOX_URL</key><string>https://your-dashboard.example.com/api/memory/inbox</string>
  </dict>
  <key>WatchPaths</key><array><string>/Users/you/Transcripts</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>/Users/you/.solo-os/memory-import.log</string>
  <key>StandardErrorPath</key><string>/Users/you/.solo-os/memory-import.log</string>
</dict></plist>
```

Then `launchctl load ~/Library/LaunchAgents/os.solo.memory-import.plist`. The
token stays in `~/.solo-os/memory-inbox-token`, never in the plist. Point any
app that can save transcripts to a folder (a recorder, a dictation app, a
voice memo exporter) at this folder and Memory picks them up.

### Wispr Flow

What we could confirm from Wispr Flow's public help pages (checked
2026-11):

- **No public REST API, webhooks, Zapier or Make integration** was found.
- **An MCP server exists** (Wispr Flow Settings > MCP,
  `https://api.wisprflow.ai/connect/mcp`). It gives an AI assistant read
  access to Wispr meeting notes, summaries, action items and calendar events;
  transcripts are available when asked for explicitly. It does not expose
  dictation history.
- **A full data export exists** in the Mac and Windows apps (a downloadable
  archive including dictation history; the format is not documented and the
  link expires after 30 days). It is a one-off export, not a feed.

So there is no direct automatic connection today. What works:

- **Meeting notes through your manager.** An assistant connected to Wispr
  Flow's MCP can read new meeting transcripts and add each one with an agent
  key holding `memory:write` (`POST /api/memory/documents`, `source`
  `wispr`, `source_id` the Wispr meeting id, `kind` `conversation`). Run on a
  schedule this keeps Memory up to date. It needs the assistant's Wispr
  connection, which you approve in Wispr Flow.
- **Dictation.** Wispr types into whatever app you are in. Dictate notes into
  a notes app or a text file that saves into your watched folder, and the
  folder import sends them.
- **Occasional backfill.** Use the data export, then paste or upload what you
  want to keep.

### Anything else

Any tool that can make an HTTP request, save a file to a folder, or save to
Google Drive can feed Memory through one of the recipes above.

## Security

- The inbox token is shown once and stored only as a SHA-256 hash in
  `backend_settings.memory_inbox`. It is accepted only in a header. Rotate it
  if it may have leaked.
- The token can only add or update documents. It cannot read, search, ask
  or delete.
- Memory tables are service-role only (row level security on, no public
  policies). The page and agent routes check your session or a scoped key.
