/**
 * Short form studio tools: the extension point for the short form studio
 * (Shorts, Reels, TikTok, carousels). Same contract as the long form file:
 * append a StudioTool and it shows up as a button. See STUDIO.md.
 */
import type { StudioConfig } from '@/components/longform/studio-tools';

export const SHORTFORM_STUDIO: StudioConfig = {
  board: 'shortform',
  medium: 'a short form post (YouTube Shorts, Instagram Reels, TikTok or a carousel)',
  role: 'a short form content writer',
  tools: [
    {
      id: 'hooks',
      label: 'hook options',
      description: 'Five scroll-stopping opening lines.',
      count: 5,
      applyTo: 'title',
      instruction:
        'Write hook options: the first line spoken on screen or shown as text in the first second. Each under 12 words, specific, and different in angle (bold claim, mistake, question, result, story). No emoji, no hashtags.',
    },
    {
      id: 'caption',
      label: 'caption',
      description: 'A ready-to-post caption with a call to action.',
      count: 1,
      maxTokens: 1000,
      instruction:
        'Write the caption. First line restates the hook in new words. Then two to four short lines of value. Then one clear call to action (follow, comment a word, or the most relevant active offer). Up to five relevant hashtags at the end. Keep it under 150 words.',
    },
  ],
};
