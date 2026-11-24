/**
 * POST /api/studio/generate: run one studio tool on a pipeline card.
 *
 * Body: { board: "longform" | "shortform", tool: "<StudioTool.id>", source: StudioSource }
 * 200:  { tool, options: string[] }
 * 412:  { code: "AI_KEY_MISSING", error } when ANTHROPIC_API_KEY is not set
 *
 * Tools are looked up by id in the studio configs, so the browser never sends
 * prompt text. Owner session only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateSession, unauthorizedResponse } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { callModelStructured, loadBrandContext, loadOffers } from '@/lib/crm/ai';
import { LONGFORM_STUDIO, type StudioConfig } from '@/components/longform/studio-tools';
import { SHORTFORM_STUDIO } from '@/components/shortform/studio-tools';
import { AI_KEY_MISSING_MESSAGE, OPTIONS_SCHEMA, buildSystemPrompt, buildUserPrompt, cleanOptions, parseSource } from '../prompt';

const STUDIOS: Record<string, StudioConfig> = { longform: LONGFORM_STUDIO, shortform: SHORTFORM_STUDIO };

export async function POST(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const config = STUDIOS[String(body.board)];
  if (!config) return NextResponse.json({ error: 'Unknown board' }, { status: 400 });
  const tool = config.tools.find((t) => t.id === body.tool);
  if (!tool) return NextResponse.json({ error: 'Unknown studio tool' }, { status: 400 });
  const source = parseSource(body.source);
  if (!source) return NextResponse.json({ error: 'Add a title or some notes to the card first.' }, { status: 400 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: AI_KEY_MISSING_MESSAGE, code: 'AI_KEY_MISSING' }, { status: 412 });
  }

  try {
    const supabase = createAdminClient();
    const [brand, offers] = await Promise.all([loadBrandContext(supabase), loadOffers(supabase)]);
    const { result } = await callModelStructured<{ options?: unknown }>(
      buildSystemPrompt(config, brand, offers),
      buildUserPrompt(tool, source),
      OPTIONS_SCHEMA,
      tool.maxTokens ?? 1500,
    );
    const options = cleanOptions(result.options, tool.count);
    if (!options.length) return NextResponse.json({ error: 'The AI returned nothing usable. Try again.' }, { status: 502 });
    return NextResponse.json({ tool: tool.id, options });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Generation failed' }, { status: 500 });
  }
}
