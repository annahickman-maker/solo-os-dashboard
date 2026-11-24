# Content studio

**Status: parked.** The dashboard's Content room is `/social` (scheduler,
calendar and performance) with a "Content studio: coming soon" card. The long
form and short form pages below are kept in the repo for the future studio but
are not linked from the navigation; you can still open them by URL. Bring them
back by adding them to `NAV_GROUPS` in `src/components/nav.tsx`.

The long form (`/long-form`) and short form (`/short-form`) pages each have a
pipeline board and a minimal studio on every card. The studio is meant to be
extended: an advanced long form studio (YouTube strategy) and an advanced short
form studio can be added later without touching the boards.

## How it fits together

| Piece | File |
| --- | --- |
| Long form tools (titles, hook, description) | `src/components/longform/studio-tools.ts` |
| Short form tools (hooks, caption) | `src/components/shortform/studio-tools.ts` |
| Studio panel (one button per tool) | `src/components/longform/studio-panel.tsx` |
| Board, card editor | `src/components/longform/pipeline-board.tsx` |
| Generate route | `src/app/api/studio/generate/route.ts` |
| Prompt building | `src/app/api/studio/prompt.ts` |
| Card data | `src/components/longform/types.ts`, `src/components/shortform/types.ts` |

The browser sends `{ board, tool, source }` to `POST /api/studio/generate`. The
route looks the tool up by id in the config for that board, adds the owner's
brand context and active offers (`brand_context` and `offers` tables), calls
the model with `ANTHROPIC_API_KEY`, and returns `{ tool, options: string[] }`.
Results are saved on the card under `card.studio[tool.id]`. Without a key the
route returns 412 with `code: "AI_KEY_MISSING"` and the panel says "Add your AI
key in Setup".

## Adding a simple tool

Append a `StudioTool` to the right config:

```ts
{
  id: 'thumbnail-text',          // stable, never rename once shipped
  label: 'thumbnail text',
  description: 'Three short overlays for the thumbnail.',
  count: 3,                      // 1 = a single piece of text
  instruction: 'Write thumbnail text options, 2 to 4 words each...',
  applyTo: 'title',              // optional "use" button that sets the card title
  maxTokens: 800,                // optional, default 1500
}
```

That is all. The button appears on every card, the route accepts the id, and
results persist on the card.

## Adding an advanced tool

When a tool needs more than "instruction in, list of strings out" (research,
several steps, its own UI):

1. Add a route under `src/app/api/studio/<tool>/route.ts`. Use
   `authenticateSession` and reuse `loadBrandContext`, `loadOffers` and
   `callModelStructured` from `src/lib/crm/ai.ts`. Return the same 412
   `AI_KEY_MISSING` shape when the key is missing.
2. Add a component under `src/components/longform/` or
   `src/components/shortform/` and render it from the page's `renderStudio`
   prop (in `src/app/long-form/page.tsx` or `src/app/short-form/page.tsx`),
   next to or instead of `StudioPanel`.
3. Save results on the card under `card.studio[<your id>]` (an array of
   strings), or add a new optional field to the card type and to its
   `normalize` function so older documents still load.

## Data shapes

Solo document `longform`:

```ts
{ version: 1, cards: Array<{
  id: string; title: string; notes: string;
  stage: 'idea' | 'scripting' | 'filming' | 'editing' | 'scheduled' | 'published';
  targetDate: string | null;   // YYYY-MM-DD
  link: string;
  createdAt: string; updatedAt: string;   // ISO
  studio?: Record<string, string[]>;      // by tool id
}> }
```

Solo document `shortform`: the same card fields, plus

```ts
stage: 'idea' | 'drafting' | 'ready' | 'scheduled' | 'posted';
platforms: Array<'shorts' | 'reels' | 'tiktok' | 'carousel'>;
longformId: string | null;   // a longform card id
```

Scheduling and publishing stay on `/social`; the short form board links to it.
