/**
 * Long form studio tools: the extension point for the long form (YouTube) studio.
 *
 * Each entry becomes one button in the studio panel on a long form card. The
 * server route /api/studio/generate looks the tool up here by id, so the
 * browser never sends prompt text. To add a tool, append an entry; nothing
 * else needs to change. See STUDIO.md at the repo root.
 *
 * This file is plain data (no React, no server imports) so both the page and
 * the API route can import it.
 */

/** One generator button in a studio panel. */
export interface StudioTool {
  /** Stable key. Results are saved on the card under card.studio[id]. Never rename a shipped id. */
  id: string;
  /** Button label, lower case like the rest of the Solo look. */
  label: string;
  /** One line shown under the label. */
  description: string;
  /** How many options to return. 1 means a single piece of text. */
  count: number;
  /** What the model should write. Sent server-side only, together with the card and brand context. */
  instruction: string;
  /** Optional: show a "use as title" button that copies the chosen option into the card title. */
  applyTo?: 'title';
  /** Rough output budget in tokens. Defaults to 1500. */
  maxTokens?: number;
}

/** A studio: who is writing, for what medium, and which tools it offers. */
export interface StudioConfig {
  /** Solo document key of the board this studio belongs to. */
  board: 'longform' | 'shortform';
  /** Plain description of the medium, used in the prompt. */
  medium: string;
  /** Role the model plays, used in the prompt. */
  role: string;
  tools: StudioTool[];
}

export const LONGFORM_STUDIO: StudioConfig = {
  board: 'longform',
  medium: 'a long form YouTube video',
  role: 'a YouTube scriptwriter and packaging editor',
  tools: [
    {
      id: 'titles',
      label: 'title options',
      description: 'Five clickable, honest titles under 60 characters.',
      count: 5,
      applyTo: 'title',
      instruction:
        'Write YouTube title options for this video. Each under 60 characters, specific, curiosity-driven and honest about what the video delivers. Vary the angle (outcome, mistake, story, how-to, contrarian). No clickbait, no all caps, no emoji.',
    },
    {
      id: 'hook',
      label: 'hook and intro',
      description: 'The first 30 seconds, written to be spoken.',
      count: 1,
      maxTokens: 1200,
      instruction:
        'Write the spoken hook and intro for this video (about 30 seconds, 70 to 90 words). Open with the viewer\'s problem or a bold specific claim in the first sentence, say what they will get by the end, and give one reason to trust the speaker drawn only from the brand context. Short sentences, written to be said out loud.',
    },
    {
      id: 'description',
      label: 'description',
      description: 'A YouTube description with a call to action.',
      count: 1,
      maxTokens: 1500,
      instruction:
        'Write the YouTube description. First two lines summarise the payoff in search-friendly words. Then three to five short lines on what the video covers. Then one call to action that points to the most relevant active offer, using its exact URL if one is given. Plain text, no hashtags beyond three at the very end.',
    },
  ],
};
