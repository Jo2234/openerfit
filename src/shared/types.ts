export type QlooMode = "fixture" | "live";
export type DataOrigin = "fixture" | "live" | "live-cache";        // live-cache = served from private cache of an earlier live call
export type LlmMode = "none" | "fixture" | "openai-compatible";
export type QlooEndpoint = "/search" | "/v2/insights" | "/v2/tags";  // "/v2/analysis/compare" added only with S2
export type InsightsType = "urn:entity:artist" | "urn:entity:brand" | "urn:entity:place" | "urn:entity:podcast";
export type PartnerCategory = "brand" | "place" | "podcast";
export const PARTNER_TYPE: Record<PartnerCategory, InsightsType> = { brand: "urn:entity:brand", place: "urn:entity:place", podcast: "urn:entity:podcast" };
export type Bookability = "available" | "unavailable" | "unknown";
export type ParamTier = "guide" | "reference_only" | "undocumented";
export type QueryParams = [string, string][];   // canonical: sorted by key (code-unit order), values already stringified


export interface QlooCallRecord {
  callId: string;            // "C-" + first 12 hex of sha256(canonicalUrl + "\n" + requestedAt + "\n" + seq)
  endpoint: QlooEndpoint;
  params: QueryParams;       // exactly what was sent; NEVER contains the API key
  canonicalUrl: string;      // endpoint + "?" + URLSearchParams(params).toString()  (no host, no key)
  origin: DataOrigin;
  fixtureLabel: string | null;   // non-null iff origin === "fixture", e.g. "synthetic fixture fx-sg-indie (hand-written)"
  httpStatus: number;
  durationMs: number;
  requestedAt: string;
  liveFetchedAt: string | null;  // for live and live-cache: time of the original live fetch
  responseSha256: string;        // sha256 of the raw response body text
  body: unknown;                 // parsed JSON body
  paramWarnings: ParamWarning[]; // from params.ts (e.g. reference_only parameter used)
}
export interface ParamWarning { param: string; tier: ParamTier; message: string }


export interface Receipt {
  id: string;                 // "R-" + first 10 hex of sha256(callId + "\n" + valuePath)
  callId: string;
  endpoint: QlooEndpoint;
  params: QueryParams;
  origin: DataOrigin;
  fixtureLabel: string | null;
  valuePath: string;          // dot/bracket path into body, e.g. "results.entities[3].query.affinity"
  value: number | string | boolean | null;   // the parsed JSON value at valuePath, unmodified
  rawValueText: string;       // JSON.stringify(value) — what the UI shows as "exact returned value"
  entity: { id: string; name: string; subtype: string | null } | null;  // the entity object that contains valuePath
  liveFetchedAt: string | null;
  requestedAt: string;
}


export interface RosterEntryInput {
  rowId: string;              // "r1".."r25", assigned by parser in input order
  name: string;               // 1..120 chars after trim
  feeAmount: number | null;   // >= 0, finite; null = unknown
  bookability: Bookability;   // default "unknown"
  notes: string;              // <= 200 chars; never sent to Qloo; sent to LLM only as booker notes
}
export interface VenueInput {
  name: string;               // 1..120
  city: string;               // 1..80
  lat: number | null;         // -90..90; both lat and lon set, or both null
  lon: number | null;         // -180..180
  radiusM: number;            // integer 100..50000, default 3000
  capacity: number | null;    // integer 1..100000
}
export interface BudgetInput { perOpenerMax: number | null; currency: string }  // currency: 3 uppercase letters, default "SGD"
export interface BriefRequest {
  headlinerQuery: string;     // 1..120
  venue: VenueInput;
  budget: BudgetInput;
  showDate: string | null;    // YYYY-MM-DD, display only
  roster: RosterEntryInput[]; // 1..25; names unique after normalize() (duplicate → 400 duplicate_roster_name)
  goal: string;               // 0..500
  partnerCategories: PartnerCategory[];  // 1..3, unique
}


export interface SearchCandidate {
  entityId: string; name: string; subtype: string | null;
  disambiguation: string | null; popularity: number | null;
  receiptId: string;          // receipt on results[i].name (proves the candidate came from /search)
}
export type ResolutionStatus = "auto_matched" | "needs_confirmation" | "user_confirmed" | "not_found" | "user_skipped";
export interface Resolution {
  target: "headliner" | string;   // "headliner" or a roster rowId
  inputName: string;
  status: ResolutionStatus;
  chosen: SearchCandidate | null; // non-null iff status in {auto_matched, user_confirmed}
  candidates: SearchCandidate[];  // <= 5, in Qloo's order
  searchCallId: string;
}
export interface ConfirmedResolutions {
  headliner: { entityId: string; name: string; receiptId: string };
  roster: { rowId: string; entityId: string | null; name: string | null; receiptId: string | null; status: ResolutionStatus }[];
}


export type OpenerStatus = "ranked" | "no_affinity_returned" | "not_in_qloo" | "skipped";
export interface OpenerRow {
  rowId: string; inputName: string;
  entityId: string | null; qlooName: string | null;
  status: OpenerStatus;
  affinity: number | null;          // === receipts[affinityReceiptId].value when ranked
  affinityReceiptId: string | null;
  affinityRank: number | null;      // 1-based among "ranked" rows only
  qlooOrder: number | null;         // 0-based index in results.entities
  outOfRange: boolean;              // affinity not in [0,1]
  bookability: Bookability;
  feeAmount: number | null;
  withinBudget: boolean | null;     // null if fee or budget unknown
  shortlistEligible: boolean;       // status==="ranked" && bookability!=="unavailable" && withinBudget!==false
}
export interface RosterRanking {
  headliner: { entityId: string; name: string; receiptId: string };
  rows: OpenerRow[];                // order defined in §5.3
  recommendedRowIds: string[];      // first 3 shortlistEligible rows in affinity order (may be < 3)
  rankingCallId: string;
  uncertainty: string[];            // human-readable notes (§5.3)
}


export interface PartnerItem {
  entityId: string; name: string; category: PartnerCategory;
  affinity: number | null; affinityReceiptId: string | null;
  qlooOrder: number;
  address: string | null;
  distanceM: number | null;         // haversine from venue lat/lon to entity location, if both known; rounded to integer
  tags: { id: string; name: string }[];  // first 5 returned tags
}
export interface PartnerShortlist {
  category: PartnerCategory;
  scope: "global_taste" | "near_venue_point" | "city_name_match";
  scopeNote: string;                // fixed copy, §6
  tagFilter: { id: string; name: string; receiptId: string }[];   // tags used in filter.tags (from /v2/tags receipts)
  items: PartnerItem[];             // <= 8
  callId: string;
  planner: "llm" | "scripted";
  uncertainty: string[];
}


export type ClaimSection = "openers" | "partners" | "caveats";
export type ClaimRef =
  | { kind: "receipt"; receiptId: string }
  | { kind: "user_input"; field: "fee" | "budget" | "bookability" | "capacity" | "show_date" | "notes"; rowId: string | null };
export interface Claim { id: string; section: ClaimSection; text: string; refs: ClaimRef[]; author: "llm" | "template" }
export type ClaimRule = "EMPTY" | "TOO_LONG" | "NO_REFS" | "UNKNOWN_RECEIPT" | "NUMBER_NOT_IN_REFS"
  | "ENTITY_NOT_IN_REFS" | "FORBIDDEN_CLAIM" | "USER_FIELD_MISSING";
export interface ClaimViolation { rule: ClaimRule; detail: string; lexiconId?: string }
export interface ClaimCheck { claimId: string; ok: boolean; violations: ClaimViolation[] }

export interface WriterInfo { kind: "llm" | "template"; source: "llm" | "fixture" | null; fixtureLabel: string | null; model: string | null; promptVersion: string | null; attempts: number; fallbackReason: string | null }
export interface Brief {
  runId: string; createdAt: string;
  request: BriefRequest;
  ranking: RosterRanking;
  partners: PartnerShortlist[];
  systemNotes: string[];            // deterministic application observations, never LLM-authored
  claims: Claim[];                  // all pass validateClaim
  droppedClaims: { claim: Claim; check: ClaimCheck }[];
  writer: WriterInfo;
  receipts: Receipt[];              // every receipt referenced anywhere in this brief
  origins: DataOrigin[];            // distinct origins of all calls in this run
  disclaimer: string;               // COPY.disclaimer
}
export interface BaselineOutput {   // what the baseline LLM must emit (JSON schema §8.5)
  openerRanking: string[];          // roster names, best first
  partners: { brand: string[]; place: string[]; podcast: string[] };
  rationale: string[];              // <= 8 sentences
}
export interface BaselineResult {
  status: "ok" | "unavailable" | "invalid_output" | "error";
  source: "llm" | "fixture" | null;
  model: string | null; fixtureLabel: string | null; promptVersion: string | null;
  output: BaselineOutput | null;
  error: { code: string; message: string } | null;
  latencyMs: number | null;
}
export interface BaselineDiff {
  rows: { rowId: string; name: string; baselinePos: number | null; qlooRank: number | null; delta: number | null }[];
  kendallTau: number | null;        // over rows ranked by both; null if fewer than 2
  changedPositions: number;         // rows where baselinePos !== qlooRank and both non-null
  baselineNotInRoster: string[];    // names in openerRanking that do not normalise to a roster name
  partners: Record<PartnerCategory, { matchedQloo: string[]; noReceipt: string[] }>;
  baselineCopyViolations: { text: string; lexiconId: string }[];
}

export type RunState = "queued" | "ranking" | "partners" | "writing" | "baseline" | "done" | "failed" | "cancelled";
export type ToolName = "rank_roster" | "search_tags" | "find_partners";
export interface AgentStep {
  index: number;
  planner: "llm" | "scripted" | "system";
  kind: "tool_call" | "llm_action_rejected" | "note";
  tool: ToolName | null;
  args: Record<string, unknown> | null;
  status: "ok" | "error" | "rejected";
  summary: string;                  // one line, e.g. "Ranked 6 of 8 roster acts; 1 without affinity"
  callIds: string[]; receiptIds: string[];
  durationMs: number;
  error: { code: string; message: string } | null;
}
export interface Run {
  id: string;                       // "run_" + 32 random hex (128 bits)
  state: RunState;
  request: BriefRequest;
  resolutions: ConfirmedResolutions;
  options: RunOptions;
  steps: AgentStep[];
  brief: Brief | null;
  baseline: BaselineResult | null;
  diff: BaselineDiff | null;
  error: { code: string; message: string } | null;
  startedAt: string; finishedAt: string | null;
  qlooCallCount: number;
}
export interface RunOptions { planner: "auto" | "scripted"; baseline: boolean }

// v1.1 boundary contracts: candidate evidence is reconstructed on the server.
export interface ResolveRequest { headlinerQuery: string; roster: { rowId: string; name: string }[] }
export interface ResolveResponse { resolveId: string; headliner: Resolution; roster: Resolution[]; receipts: Receipt[] }
export interface CreateRunRequest { resolveId: string; request: BriefRequest; resolutions: ConfirmedResolutions; options: RunOptions }
export interface ClaimCatalogueEntry extends Claim { author: "template" }
export interface ClaimSelection { claimIds: string[] }
