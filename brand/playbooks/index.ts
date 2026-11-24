/**
 * The playbook shelf.
 *
 * Solo OS ships with no brand research, so this bundled shelf is empty. The
 * live shelf is backed by `backend_settings` (keys `brand_playbook:*`), so an
 * approved playbook appears as soon as it is published through
 * /api/brand/playbooks, without a rebuild or redeploy.
 *
 * To bundle a playbook with the code instead, add a JSON file in this folder
 * that follows `brand/playbook.schema.json`, import it below and add it to
 * PLAYBOOKS, newest first.
 *
 * Shape: `brand/playbook.schema.json` for sections 1-9, plus the optional
 * `narrative` block (standingCopyRules, proofAsset, knownGaps, neverSay)
 * carrying sections 10-12, so each playbook is self-contained.
 */

export type NarrativeNote = { title: string; body: string };
type Quote = { text: string; source: string; url?: string };
type Complaint = { quote: string; source: string; url?: string };
type Place = {
  name: string;
  platform?: string;
  size?: string;
  relevance: string;
  exampleTopics?: string[];
  howToAccess?: string;
};
type PlatformRec = {
  platform: string;
  reasoning: string;
  contentFormats: string[];
  postingCadence?: string;
};

/** Sections 1-9 follow brand/playbook.schema.json; 10-12 are `narrative`. */
export type Playbook = {
  meta: {
    client: string;
    generatedAt: string;
    version: string;
    selectedAudience: { title: string; description: string };
    sources?: { brief?: string; transcripts?: string[] };
  };
  audienceResearch: {
    audienceState: { currentState: string; desiredState: string };
    urgencyGateway: {
      problem: string;
      whyUrgent: string;
      failedSolutions: string[];
      aspirinSolution: string;
    };
    painPoints: {
      pain: string;
      severity: string;
      emotionalContext: string;
      realQuotes?: Quote[];
    }[];
    languageMap: {
      painPhrases: string[];
      desirePhrases: string[];
      searchPhrases: { phrase: string; estimatedDemand: string; context?: string }[];
      emotionalTriggers: string[];
    };
    congregationPoints: {
      tier1_mainstream: Place[];
      tier2_niche: Place[];
      tier3_micro: Place[];
    };
    marketingRecommendation: {
      primaryPlatform: PlatformRec;
      secondaryPlatforms?: PlatformRec[];
      contentStrategyTips: string[];
      quickWin: string;
    };
    competitiveLandscape: {
      existingSolutions: {
        name: string;
        url?: string;
        positioning: string;
        pricing?: string;
        complaints?: Complaint[];
        strengths?: string[];
        weaknesses?: string[];
      }[];
      marketGaps: string[];
      positioningOpportunities: string[];
    };
  };
  offerCore: {
    offerStatement: { finalStatement: string; emotionalCore?: string };
    theOfferGivesYou: string[];
    youCanUseItTo: string[];
    hiddenBenefits: string[];
    programNameOptions: { name: string; uniqueMechanism: string; rationale: string }[];
  };
  narrative?: {
    standingCopyRules?: NarrativeNote[];
    proofAsset?: { body: string; caution?: string };
    knownGaps?: NarrativeNote[];
    neverSay?: string[];
  };
};

export type PlaybookEntry = { slug: string; playbook: Playbook };

/** True when a value holds real research in the playbook shape. */
export function isPlaybook(value: unknown): value is Playbook {
  const playbook = value as Playbook;
  return (
    !!value &&
    typeof value === 'object' &&
    typeof playbook.meta?.client === 'string' &&
    typeof playbook.meta?.generatedAt === 'string' &&
    typeof playbook.meta?.selectedAudience?.title === 'string' &&
    typeof playbook.meta?.selectedAudience?.description === 'string' &&
    typeof playbook.audienceResearch?.audienceState?.currentState === 'string' &&
    typeof playbook.audienceResearch?.audienceState?.desiredState === 'string' &&
    Array.isArray(playbook.audienceResearch?.painPoints) &&
    Array.isArray(playbook.audienceResearch?.languageMap?.painPhrases) &&
    Array.isArray(playbook.audienceResearch?.congregationPoints?.tier1_mainstream) &&
    Array.isArray(playbook.audienceResearch?.marketingRecommendation?.contentStrategyTips) &&
    Array.isArray(playbook.audienceResearch?.competitiveLandscape?.existingSolutions) &&
    typeof playbook.offerCore?.offerStatement?.finalStatement === 'string' &&
    Array.isArray(playbook.offerCore?.theOfferGivesYou) &&
    Array.isArray(playbook.offerCore?.youCanUseItTo) &&
    Array.isArray(playbook.offerCore?.hiddenBenefits) &&
    Array.isArray(playbook.offerCore?.programNameOptions)
  );
}

/** Newest first - the order the shelf is read in. */
export const PLAYBOOKS: PlaybookEntry[] = [
  // Bundled playbooks go here, newest first:
  // { slug: '2026-08-19-acme', playbook: acme20260819 as unknown as Playbook },
];

export function getPlaybook(slug: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.slug === slug)?.playbook;
}

/** The most recent playbook - what /brand opens to when there is only one. */
export const LATEST: PlaybookEntry | undefined = PLAYBOOKS[0];
