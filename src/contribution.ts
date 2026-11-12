/**
 * Stage 4.5 contribution protocol — core record types, monoidal
 * WorkProductLog, R1 topic keys, and the Image Viewer citation builder.
 *
 * Sources:
 * - MONADIC_ARCHITECTURE_SPEC.md §7.2 (record types), §7.3 (two-level
 *   provenance), §7.4 (citation rendering), §9.3 (monoidal writer merge).
 * - MONADIC_ASSESSMENT.md §5.1 (file-level changes) and §6 corrections
 *   1–2 (topic keys `allocation_4022c` and `relevant_dates`, both proposed).
 *
 * Scope of this module (Worker A): the core protocol only. The publication
 * functions (`publishFindings`, `assembleContribution`,
 * `buildAmbDataIssuesFragment`) are built on top of these exports by a
 * later worker. No publication function lives here, and no test lives here.
 *
 * Rules that govern this file:
 * - An Image Viewer document number, a finding, or a citation must come
 *   from a verified source. Nothing here invents one: an unknown number
 *   renders as "Image Viewer document number pending" and is recorded as
 *   a blocking open issue (see `appendMissingImageViewerIssue`).
 * - The Writer carries provenance; it does not decide factual correctness,
 *   materiality, or location (spec §9.3). `mergeLogs` never silently
 *   discards a conflicting value: conflicts are escalated to an explicit
 *   review state plus a blocking open issue.
 * - Synthetic data only in any example. No live case data.
 * - Pure functions only. No clock, no storage, no network, no fetch.
 */

import type {
  CalculationStep,
  CalculationTrace,
  DateString,
  Provenance,
} from "./types";

/** Version of this contribution protocol. Additive changes bump minor;
 *  breaking changes bump major, always with a change note (Phase 0
 *  versioning rule). */
export const CONTRIBUTION_PROTOCOL_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// R1 topic keys (spec §8.2, corrected per assessment §6)
// ---------------------------------------------------------------------------

/**
 * Semantic R1 destination keys — NOT bare section numbers (spec §7.2).
 * Section numbers are display labels that may change with the template;
 * these keys are template-independent.
 *
 * Section numbers in the comments are the verified anchors from the
 * 2026-06-04 sample language / 2026-08-06 shell (assessment §4.2).
 * `allocation_4022c` (§18) and `relevant_dates` (§1) are PROPOSED keys
 * (assessment §6 corrections 1–2): they follow the spec's own
 * semantic-key convention but are design proposals, not sourced terms.
 * §18 exists in the shell and sample language ("18. 4022(c) Allocation");
 * the spec's "missing section 18" sentence is wrong and is not relied on.
 */
export type R1TopicKey =
  | "relevant_dates" // §1 Relevant Dates / Termination Information — PROPOSED
  | "participant_counts" // §2 Participant Count Reconciliation
  | "data_issues" // §3 Data Issues
  | "plan_documents" // §4 Plan Documents
  | "benefit_formula" // §5 Plan Benefit Formula Summary
  | "retirement_rules" // §6 Normal, Early, and Late Retirement
  | "vesting" // §7 Vesting
  | "preretirement_death" // §8 QPSA and other Pre-Retirement Death Benefits
  | "benefit_offsets" // §9 Offsets to Plan Benefits
  | "annuity_forms" // §10 Forms of Annuity
  | "interpretations" // §11 Benefit / Plan Document Interpretations of Note
  | "expected_retirement" // §12 Expected Retirement Age
  | "accrued_at_normal" // §13 Accrued-at-Normal Limitation
  | "max_guarantee" // §14 Maximum Guaranteeable Benefit / Aggregate Maximum Benefit
  | "phase_in" // §15 Phase-In Limitation
  | "ownership_limit" // §16 Majority Owner Limitation
  | "asset_allocation" // §17 Asset Allocation
  | "allocation_4022c" // §18 4022(c) Allocation — PROPOSED
  | "pre_dopt_adjustments" // §19 Pre-DOPT Retiree Benefit Changes
  | "post_dopt_retirees" // §20 Post-DOPT Retirees
  | "lump_sums" // §21 Estimated Lump Sums paid Post-DOPT
  | "estimated_adjustments" // §22 Estimated Benefit Adjustments
  | "post_nrd" // §23 Post-NRD Benefits
  | "qdros" // §24 Qualified Domestic Relations Orders (QDROs)
  | "bsrs" // §25 Benefit Statement and Recalculation System (BSRS)
  | "additional_comments" // §26 Additional Comments
  | "expense_loading" // §27 Expense Loading
  | "liability_analysis" // §28 Liability-Weighted Average Age, etc.
  | "valuation_rates"; // §29 Table of Valuation Interest Rates

// ---------------------------------------------------------------------------
// §7.2 record types
// ---------------------------------------------------------------------------

/** Source kind for an EvidenceRef (spec §7.2). */
export type EvidenceSourceKind =
  | "plan document"
  | "census"
  | "valuation report"
  | "PBGC policy"
  | "work product"
  | "other";

/** Whether the cited source could actually be consulted (spec §7.2). */
export type EvidenceAccessStatus = "verified" | "available" | "missing" | "pending";

/**
 * Second provenance level (spec §7.3): the intermediate work product that
 * interprets the primary evidence — e.g. the R5 paragraph, AMB memo,
 * Section 436 analysis, or V1 worksheet. The primary evidence itself is
 * the EvidenceRef this ref is attached to (its inherited `documentId` +
 * `location`); this field names the interpreting product, never the
 * primary source.
 */
export interface WorkProductRef {
  /** Work-product id, e.g. "AMB". */
  productId: string;
  /** Work-product version, e.g. "0.1.0". */
  productVersion: string;
  /** Location inside that product, e.g. "§3, paragraph 2". null when the
   *  product does not carry stable internal locations. */
  locationInProduct: string | null;
}

/**
 * One citable source record (spec §7.2, §7.3).
 *
 * EXTENDS the existing `Provenance`/`SourceLocation` (`types.ts:73`,
 * `types.ts:131`) instead of duplicating them:
 * - `documentId` (inherited) is the source-document identity — the spec's
 *   `sourceDocumentId`. A Google Drive file ID, a local filename, an
 *   internal `evidenceId`, and an Image Viewer document number are
 *   DIFFERENT identifiers; never substitute one for another.
 * - `location` (inherited) is the precise original source location — the
 *   spec's `documentLocation` (page, section, table, paragraph, sheet/cell,
 *   or other precise location).
 * - `sourceFileHash` (inherited) is the content-integrity fingerprint —
 *   the spec's `sourceHash`.
 * Added here: `evidenceId`, `sourceKind`, `title`, `versionOrDate`,
 * `imageViewerDocumentNumber`, `originalExcerpt`, `accessStatus`, and
 * `workProductRef` (second provenance level).
 */
export interface EvidenceRef extends Provenance {
  /** Stable internal reference. Never based on document ordering. */
  evidenceId: string;
  /** What kind of source this is. */
  sourceKind: EvidenceSourceKind;
  /** Original document title. */
  title: string;
  /** Applicable source version/date. null when not stated. */
  versionOrDate: string | null;
  /**
   * Exact Image Viewer document number, stored as TEXT to preserve the
   * exact identifier. null when unknown — never inferred or invented.
   * An unknown number renders as "Image Viewer document number pending"
   * (see `renderCitation`) and must be recorded as a blocking open issue
   * for every material citation (see `appendMissingImageViewerIssue`).
   */
  imageViewerDocumentNumber: string | null;
  /**
   * Short source excerpt or exact source values, if permitted; never
   * uncited invented text. null when no excerpt is recorded.
   */
  originalExcerpt: string | null;
  /** Whether the source could actually be consulted. */
  accessStatus: EvidenceAccessStatus;
  /**
   * The interpreting work product (second provenance level, spec §7.3).
   * null when the evidence is cited directly with no interpreting
   * intermediate product.
   */
  workProductRef: WorkProductRef | null;
}

/** Claim kind for a Finding (spec §7.2). */
export type ClaimType =
  | "fact"
  | "derived_result"
  | "assumption"
  | "interpretation"
  | "decision"
  | "exception"
  | "risk";

/** Subject scope for a Finding (spec §7.2). */
export type SubjectScope = "plan" | "participant" | "cohort" | "valuation";

/** Review lifecycle for a Finding (spec §7.2). */
export type ReviewState = "draft" | "reviewed" | "approved" | "superseded" | "disputed";

/**
 * The work product a Finding originates from (spec §7.2). "436" is the
 * Section 436 analysis; "EstimatedAdmin" / "EstimatedAdjustment" are the
 * estimated administration / estimated adjustment products.
 */
export type OriginatingWorkProduct =
  | "R5"
  | "PlanSummary"
  | "PF"
  | "DEL"
  | "436"
  | "EstimatedAdmin"
  | "EstimatedAdjustment"
  | "AMB"
  | "V1"
  | "BSRS"
  | "other";

/** Date range to which a Finding's claim applies. Either end may be null
 *  when the claim is open-ended on that side. */
export interface EffectivePeriod {
  start: DateString | null;
  end: DateString | null;
}

/** Structured value of a Finding's claim: the value, its units, and the
 *  basis it was stated on (e.g. measurement date / annuity form). */
export interface FindingValue {
  /** The claimed value, as a string (amounts as exact decimal strings,
   *  never binary floats). */
  value: string;
  /** Units, e.g. "USD/month" or "participants". null when unitless. */
  units: string | null;
  /** Basis the value is stated on, e.g. "accrued, normal form". null
   *  when no basis applies. */
  basis: string | null;
}

/**
 * Explicit case-level materiality flag/rule for a Finding (spec §7.2).
 * The module decides what is material; this record states the decision
 * and the rule or flag it rested on, so the R1 module never re-decides it.
 */
export interface Materiality {
  /** True when the finding is material at case level. */
  material: boolean;
  /** The flag or rule applied, e.g. "exceeds tolerance" or "reviewer
   *  judgement 2026-11-12". null when no rule was recorded. */
  rule: string | null;
}

/**
 * One publishable, structured finding (spec §7.2). This is NOT the
 * rule-check record `Finding` in `validation.ts:108` (ruleId,
 * fieldsExamined, actual/expected/discrepancy, severity, disposition
 * route) — that record stays a validation artefact. A spec §7.2 Finding
 * is what FindingPublicationCalc publishes into the shared ledger.
 *
 * A finding with an explicit missing-evidence exception is allowed; an
 * uncited fact is not. `evidenceRefs` holds EvidenceRef ids; the
 * referenced records live in the log's `evidenceRefs[]` / the
 * contribution's `citations[]`.
 */
export interface Finding {
  /** Stable key, not based on document ordering. */
  findingId: string;
  /** PBGC case number. */
  caseId: string;
  /** Work product that produced this finding. */
  originatingWorkProduct: OriginatingWorkProduct;
  /** Work-product version and calculation-run ID. */
  originatingVersion: string;
  /** What kind of claim this is. */
  claimType: ClaimType;
  /** What the claim is about. */
  subjectScope: SubjectScope;
  /** Participant IDs, only when required. */
  subjectIds: string[];
  /** Date range to which the claim applies. */
  effectivePeriod: EffectivePeriod;
  /** Structured value, amount, units, and basis. */
  valueAndUnits: FindingValue;
  /** Concise, factually bounded claim. */
  findingStatement: string;
  /** How the claim was reached. */
  rationale: string;
  /** One or more source EvidenceRef ids, or an explicit missing-evidence
   *  exception (see `missingEvidenceException`). */
  evidenceRefs: string[];
  /** Explicit missing-evidence exception, when the finding is published
   *  without evidence. null when evidence is attached. An uncited fact
   *  with no exception here must never be published as established. */
  missingEvidenceException: string | null;
  /** Upstream finding IDs; maintain full lineage. */
  derivedFromFindingIds: string[];
  /** Review lifecycle state. */
  reviewState: ReviewState;
  /** Explicit case-level materiality flag/rule. */
  materiality: Materiality;
  /** Semantic R1 target keys (NOT bare numbers). */
  intendedR1Topics: R1TopicKey[];
  /** Previous finding ID, when this finding revises one. null otherwise. */
  supersedes: string | null;
}

/** Narrative form for a NarrativeFragment (spec §7.2). */
export type FragmentForm =
  | "summary"
  | "detail"
  | "table"
  | "footnote"
  | "appendix"
  | "citation"
  | "open_issue";

/** Inclusion state for a NarrativeFragment (spec §7.2). */
export type InclusionState = "candidate" | "selected" | "rejected" | "superseded";

/** Approval state for a NarrativeFragment (spec §7.2). */
export type ApprovalState = "proposed" | "reviewed" | "approved";

/**
 * One reusable narrative fragment (spec §7.2): a proposed paragraph,
 * table, or structured narrative for an R1 section — not an unreviewed
 * final decision. The R1 module selects among candidates; it does not
 * approve them.
 */
export interface NarrativeFragment {
  /** Stable identity and version. */
  fragmentId: string;
  /** Supporting Finding IDs (one-to-many). */
  findingIds: string[];
  /** Requested R1 semantic destination(s). */
  targetTopicKeys: R1TopicKey[];
  /** What shape this fragment takes. */
  form: FragmentForm;
  /** Proposed paragraph, table, or structured narrative. */
  content: string;
  /** EvidenceRef ids that support each material claim in the content. */
  evidenceRefs: string[];
  /** Whether this fragment is a candidate, selected, rejected, or
   *  superseded. */
  inclusionState: InclusionState;
  /** Proposed | reviewed | approved, as required. */
  approvalState: ApprovalState;
  /** Relative placement inside the target section. */
  displayOrder: number;
  /** Shared subject/topic used for reconciliation. null when the fragment
   *  belongs to no conflict group. */
  conflictGroup: string | null;
}

/** Lifecycle status of a WorkProductContribution package. */
export type ContributionStatus = "draft" | "reviewed" | "approved" | "superseded";

/**
 * One versioned, machine-readable work-product contribution package
 * (spec §7.2, §11). Every product exports BOTH its traditional file and
 * one of these packages. The package is structured evidence and
 * conclusions captured DURING the analysis, not a summary of a finished
 * document.
 */
export interface WorkProductContribution {
  /** Work-product id, e.g. "AMB". */
  productId: string;
  /** Work-product version, e.g. "0.1.0". */
  productVersion: string;
  /** PBGC case number. */
  caseId: string;
  /** ISO date the package was produced (caller-supplied; the core never
   *  calls a clock). */
  producedAt: DateString;
  /** Who or what published it: user id, or "system". */
  publishedBy: string;
  /** The InputSnapshot hash the package was built from. A source/rule
   *  change produces a new package version; downstream placements
   *  depending on it are invalidated, never silently carried forward. */
  sourceSnapshotId: string;
  /** Calculation-run ID the package was built from. null when the product
   *  has no calculation run (e.g. a purely documentary product). */
  calculationRunId: string | null;
  /** Lifecycle status of this package version. */
  status: ContributionStatus;
  /** Published findings. */
  findings: Finding[];
  /** Candidate narrative fragments. */
  fragments: NarrativeFragment[];
  /** Citation records supporting the findings and fragments. */
  citations: EvidenceRef[];
  /** Warnings raised while producing the package. */
  warnings: LogWarning[];
  /** Follow-ups the package requires before final use. */
  requiredFollowups: string[];
  /** Downstream products that depend on this package. */
  downstreamDependencies: string[];
}

/** Placement status of an R1Placement (spec §7.2). */
export type PlacementStatus = "placed" | "unplaced" | "conflicted" | "superseded";

/**
 * One fragment placed into the R1 template (spec §7.2). Produced by the
 * later R1 module (R1AssemblyCalc); defined here so contributions and
 * placements share one shape. `sectionKey` is the template's section key;
 * section NUMBERS are display labels that may change with the template.
 */
export interface R1Placement {
  /** R1 template id. */
  templateId: string;
  /** R1 template version. */
  templateVersion: string;
  /** Template section key (semantic; see `R1TopicKey`). */
  sectionKey: string;
  /** Stable insertion anchor in the template. null when no anchor was
   *  matched — the placement is then `unplaced`, never guessed. */
  anchorId: string | null;
  /** Fragment placed. */
  fragmentId: string;
  /** Rendered text or table, as inserted. */
  renderedTextOrTable: string;
  /** Rendered citations, in insertion order (see `renderCitations`). */
  renderedCitations: string[];
  /** Placement outcome. */
  placementStatus: PlacementStatus;
}

// ---------------------------------------------------------------------------
// WorkProductLog — the monoidal Writer (spec §1.5, §9.3)
// ---------------------------------------------------------------------------

/** One warning carried in a WorkProductLog. */
export interface LogWarning {
  /** Stable warning id. */
  warningId: string;
  /** Human-readable warning text. */
  message: string;
  /** Severity. "blocking" stops silent publication of the affected
   *  assertion; "warning" / "info" do not. */
  severity: "info" | "warning" | "blocking";
  /** Finding ids this warning concerns. */
  relatedFindingIds: string[];
  /** EvidenceRef ids this warning concerns. */
  relatedEvidenceIds: string[];
}

/** One decision carried in a WorkProductLog. This is the log's record of
 *  a decision, not the engine's `ActuarialDecision` (`types.ts:988`):
 *  it records that a decision was taken, by whom, and on which findings
 *  — the full decision record stays with the deciding module. */
export interface LogDecision {
  /** Stable decision id. */
  decisionId: string;
  /** What was decided, in one concise statement. */
  statement: string;
  /** Who decided: user id, or "system" for a mechanical decision. */
  decidedBy: string;
  /** ISO date decided. null when not recorded. */
  decidedAt: DateString | null;
  /** Finding ids the decision rested on. */
  basisFindingIds: string[];
}

/** Kind of an open issue carried in a WorkProductLog. */
export type OpenIssueKind =
  | "missing-image-viewer-number"
  | "conflict"
  | "missing-evidence"
  | "unplaced"
  | "other";

/** Severity of an open issue. "blocking" issues must be resolved before
 *  the affected assertion can be published as final. */
export type OpenIssueSeverity = "blocking" | "non-blocking";

/** Status of an open issue. */
export type OpenIssueStatus = "open" | "resolved" | "waived";

/**
 * One explicit open issue (spec §7.4, §9.3). Conflicts and missing
 * citations are recorded here, never silently discarded and never
 * silently resolved.
 */
export interface OpenIssue {
  /** Stable issue id. For a missing Image Viewer number this is
   *  `missing-image-viewer-number:<evidenceId>` — one distinct issue per
   *  material unsupported citation. For a merge conflict it is
   *  `conflict:<collection>:<stableId>`. */
  issueId: string;
  /** What kind of issue this is. */
  kind: OpenIssueKind;
  /** Whether the issue blocks final publication. */
  severity: OpenIssueSeverity;
  /** Whether the issue is still open. */
  status: OpenIssueStatus;
  /** Human-readable issue text. */
  message: string;
  /** Finding ids this issue concerns. */
  relatedFindingIds: string[];
  /** EvidenceRef ids this issue concerns. */
  relatedEvidenceIds: string[];
  /** NarrativeFragment ids this issue concerns. */
  relatedFragmentIds: string[];
}

/**
 * The monoidal Writer log (spec §1.5, §9.3). Carries an ordered
 * calculation trace AND reusable report contributions: trace events, typed
 * findings, narrative fragments, evidence links, warnings, decisions, and
 * open issues.
 *
 * The Writer carries provenance; it does not decide the factual
 * correctness, materiality, or location of any conclusion.
 */
export interface WorkProductLog {
  /** Ordered calculation trace events (the engine's CalculationSteps). */
  traceEvents: CalculationStep[];
  /** Published findings (spec §7.2). */
  findings: Finding[];
  /** Candidate narrative fragments (spec §7.2). */
  fragments: NarrativeFragment[];
  /** Evidence records (spec §7.2). */
  evidenceRefs: EvidenceRef[];
  /** Warnings raised during the run. */
  warnings: LogWarning[];
  /** Decisions taken during the run. */
  decisions: LogDecision[];
  /** Explicit open issues: conflicts, missing citations, missing
   *  evidence, unplaced fragments. */
  openIssues: OpenIssue[];
}

/**
 * The empty log: the identity element of the merge (spec §9.3).
 * `mergeLogs(emptyLog, x)` is `x` and `mergeLogs(x, emptyLog)` is `x`.
 * Never mutate this object; build logs with `mergeLogs` and the
 * publication functions, or start from a fresh `createEmptyLog()`.
 */
export const emptyLog: WorkProductLog = {
  traceEvents: [],
  findings: [],
  fragments: [],
  evidenceRefs: [],
  warnings: [],
  decisions: [],
  openIssues: [],
};

/** A fresh, mutable empty log. Prefer this over copying `emptyLog` when
 *  a caller needs to accumulate entries before merging. */
export function createEmptyLog(): WorkProductLog {
  return {
    traceEvents: [],
    findings: [],
    fragments: [],
    evidenceRefs: [],
    warnings: [],
    decisions: [],
    openIssues: [],
  };
}

/** True when a log carries no entries at all. */
export function isEmptyLog(log: WorkProductLog): boolean {
  return (
    log.traceEvents.length === 0 &&
    log.findings.length === 0 &&
    log.fragments.length === 0 &&
    log.evidenceRefs.length === 0 &&
    log.warnings.length === 0 &&
    log.decisions.length === 0 &&
    log.openIssues.length === 0
  );
}

// ---------------------------------------------------------------------------
// mergeLogs — associative append (spec §9.3)
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON encoding with sorted object keys, so two records
 * with the same content compare equal regardless of key insertion order.
 * Bigint values (which plain JSON.stringify rejects) are encoded as
 * `bigint:<decimal>`; `undefined` as `undefined`.
 */
function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (typeof value === "undefined") return "undefined";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(",")}}`;
}

/** Result of merging one deduplicated collection: the kept items plus any
 *  conflict issues the merge raised. */
interface MergeOutcome<T> {
  items: T[];
  issues: OpenIssue[];
}

/** One conflict issue for two entries that share a stable id but carry
 *  different content. The issue id is deterministic in the stable id, so
 *  repeated merges never duplicate the issue. */
function conflictIssue(
  collection: string,
  stableId: string,
  detail: string,
  related: {
    findingIds?: string[];
    evidenceIds?: string[];
    fragmentIds?: string[];
  },
): OpenIssue {
  return {
    issueId: `conflict:${collection}:${stableId}`,
    kind: "conflict",
    severity: "blocking",
    status: "open",
    message:
      `Conflicting ${collection} entries share stable id ${stableId} with different content: ${detail}. ` +
      `The first entry was kept and the conflicting entry was escalated to review; neither was silently discarded.`,
    relatedFindingIds: related.findingIds ?? [],
    relatedEvidenceIds: related.evidenceIds ?? [],
    relatedFragmentIds: related.fragmentIds ?? [],
  };
}

/**
 * Merge two arrays by stable key, first occurrence wins, in first-seen
 * order (deterministic for given inputs). An exact duplicate (same key,
 * same content) is dropped silently — it is the same entry twice, not a
 * conflict. Same key with different content is a conflict: the kept entry
 * is escalated through `onConflict` and a blocking conflict issue is
 * raised. Neither input array is mutated.
 */
function mergeDeduped<T>(
  a: readonly T[],
  b: readonly T[],
  keyOf: (item: T) => string,
  onConflict?: (kept: T, incoming: T) => { kept: T; issue: OpenIssue },
): MergeOutcome<T> {
  const items: T[] = [];
  const indexByKey = new Map<string, number>();
  const issues: OpenIssue[] = [];
  const append = (item: T): void => {
    const key = keyOf(item);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, items.length);
      items.push(item);
      return;
    }
    const kept = items[existingIndex];
    if (kept === undefined) return;
    if (stableJson(kept) === stableJson(item)) return;
    if (onConflict === undefined) return;
    const outcome = onConflict(kept, item);
    items[existingIndex] = outcome.kept;
    issues.push(outcome.issue);
  };
  for (const item of a) append(item);
  for (const item of b) append(item);
  return { items, issues };
}

/**
 * Associative append of two WorkProductLogs (spec §9.3):
 * `mergeLogs(mergeLogs(a, b), c)` equals `mergeLogs(a, mergeLogs(b, c))`,
 * and `emptyLog` is the identity. Ordering is deterministic: first-seen
 * order within each collection. Entries are deduplicated by stable ID +
 * version (findings by `findingId` + `originatingVersion`; fragments,
 * evidence, warnings, decisions, and issues by their stable id; trace
 * events by full content).
 *
 * Conflicting values with the same semantic key are NEVER silently
 * discarded: the first entry is kept, escalated to an explicit review
 * state (a conflicting finding becomes `disputed`; a conflicting fragment
 * returns to `candidate`), and a blocking `conflict` open issue is added
 * naming the stable id. A finding superseded by a newer version is NOT a
 * conflict — different versions of one finding are both kept, and the R1
 * module resolves supersession (gate G5); this merge does not re-decide it.
 *
 * Neither input log is mutated.
 */
export function mergeLogs(a: WorkProductLog, b: WorkProductLog): WorkProductLog {
  const traceEvents = mergeDeduped(
    a.traceEvents,
    b.traceEvents,
    (step) => stableJson(step),
  );
  const findings = mergeDeduped(
    a.findings,
    b.findings,
    (f) => `${f.findingId}\u0000${f.originatingVersion}`,
    (kept) => ({
      kept: { ...kept, reviewState: "disputed" as ReviewState },
      issue: conflictIssue(
        "finding",
        `${kept.findingId}@${kept.originatingVersion}`,
        `finding ${kept.findingId} version ${kept.originatingVersion} was published with different content`,
        { findingIds: [kept.findingId] },
      ),
    }),
  );
  const fragments = mergeDeduped(
    a.fragments,
    b.fragments,
    (f) => f.fragmentId,
    (kept) => ({
      kept: { ...kept, inclusionState: "candidate" as InclusionState },
      issue: conflictIssue(
        "fragment",
        kept.fragmentId,
        `fragment ${kept.fragmentId} was published with different content`,
        { fragmentIds: [kept.fragmentId] },
      ),
    }),
  );
  const evidenceRefs = mergeDeduped(
    a.evidenceRefs,
    b.evidenceRefs,
    (e) => e.evidenceId,
    (kept) => ({
      kept,
      issue: conflictIssue(
        "evidence",
        kept.evidenceId,
        `evidence ${kept.evidenceId} was published with different content`,
        { evidenceIds: [kept.evidenceId] },
      ),
    }),
  );
  const warnings = mergeDeduped(
    a.warnings,
    b.warnings,
    (w) => w.warningId,
    (kept) => ({
      kept,
      issue: conflictIssue(
        "warning",
        kept.warningId,
        `warning ${kept.warningId} was published with different content`,
        { findingIds: kept.relatedFindingIds, evidenceIds: kept.relatedEvidenceIds },
      ),
    }),
  );
  const decisions = mergeDeduped(
    a.decisions,
    b.decisions,
    (d) => d.decisionId,
    (kept) => ({
      kept,
      issue: conflictIssue(
        "decision",
        kept.decisionId,
        `decision ${kept.decisionId} was published with different content`,
        { findingIds: kept.basisFindingIds },
      ),
    }),
  );
  const openIssues = mergeDeduped(
    a.openIssues,
    b.openIssues,
    (i) => i.issueId,
    (kept) => ({
      kept,
      issue: conflictIssue(
        "open-issue",
        kept.issueId,
        `open issue ${kept.issueId} was published with different content`,
        {
          findingIds: kept.relatedFindingIds,
          evidenceIds: kept.relatedEvidenceIds,
          fragmentIds: kept.relatedFragmentIds,
        },
      ),
    }),
  );

  // Conflict issues raised by this merge go after the pre-existing open
  // issues, deduplicated by issue id (a conflict already recorded in
  // either input is kept as recorded, not duplicated).
  const allIssues = [...openIssues.items];
  const seenIssueIds = new Set(allIssues.map((i) => i.issueId));
  for (const issue of [
    ...findings.issues,
    ...fragments.issues,
    ...evidenceRefs.issues,
    ...warnings.issues,
    ...decisions.issues,
    ...openIssues.issues,
  ]) {
    if (!seenIssueIds.has(issue.issueId)) {
      seenIssueIds.add(issue.issueId);
      allIssues.push(issue);
    }
  }

  return {
    traceEvents: traceEvents.items,
    findings: findings.items,
    fragments: fragments.items,
    evidenceRefs: evidenceRefs.items,
    warnings: warnings.items,
    decisions: decisions.items,
    openIssues: allIssues,
  };
}

// ---------------------------------------------------------------------------
// Citation builder (spec §7.3, §7.4)
// ---------------------------------------------------------------------------

/** Rendered when an Image Viewer document number is not known. The source
 *  and its exact location stay in the internal record; this string is what
 *  the R1 draft shows. Never a fabricated number. */
export const IMAGE_VIEWER_NUMBER_PENDING = "Image Viewer document number pending";

/**
 * Page number a citation can carry, from the evidence location. Only
 * paginated locations carry a page: `pdf-page` always, `document-section`
 * when its page is known. Spreadsheet cells, CSV rows, JSON paths, and
 * user-entered locations have no page.
 */
export function citationPageNumber(ref: EvidenceRef): number | null {
  const location = ref.location;
  if (location.kind === "pdf-page") return location.page;
  if (location.kind === "document-section") return location.page;
  return null;
}

/**
 * Render one citation in the confirmed format (assessment §4.4):
 * "Image Viewer Document #123", or "Image Viewer Document #123, page 5"
 * when a page number is known. The document number is stored as TEXT and
 * rendered exactly as recorded — never reformatted, never inferred.
 *
 * When the document number is null or empty, returns
 * `IMAGE_VIEWER_NUMBER_PENDING` ("Image Viewer document number pending").
 * That rendering alone is not enough: for a material citation the caller
 * must also record a blocking open issue — see
 * `appendMissingImageViewerIssue` / `citeEvidence`.
 */
export function renderCitation(ref: EvidenceRef): string {
  const number = ref.imageViewerDocumentNumber;
  if (number === null || number === "") return IMAGE_VIEWER_NUMBER_PENDING;
  const page = citationPageNumber(ref);
  if (page === null) return `Image Viewer Document #${number}`;
  return `Image Viewer Document #${number}, page ${page}`;
}

/**
 * The distinct blocking open issue for one material unsupported citation
 * (spec §7.4): one issue per citation, keyed by evidence id so repeated
 * handling never duplicates it. The issue is blocking and stays open
 * until the number is verified from a source or the citation is withdrawn.
 */
export function missingImageViewerIssue(ref: EvidenceRef): OpenIssue {
  return {
    issueId: `missing-image-viewer-number:${ref.evidenceId}`,
    kind: "missing-image-viewer-number",
    severity: "blocking",
    status: "open",
    message:
      `Image Viewer document number pending for evidence ${ref.evidenceId} (${ref.title}). ` +
      `The citation is required for final review; enter the number only from a verified source — never invent one.`,
    relatedFindingIds: [],
    relatedEvidenceIds: [ref.evidenceId],
    relatedFragmentIds: [],
  };
}

/**
 * Append the blocking open issue for a material unsupported citation to a
 * log, returning a new log (the input is not mutated). No-op when the
 * reference carries a document number, when the citation is not material
 * (`opts.material === false`), or when the issue is already recorded.
 * Distinct citations get distinct issues: the issue id carries the
 * evidence id.
 */
export function appendMissingImageViewerIssue(
  log: WorkProductLog,
  ref: EvidenceRef,
  opts?: { material?: boolean },
): WorkProductLog {
  const number = ref.imageViewerDocumentNumber;
  if (number !== null && number !== "") return log;
  if (opts?.material === false) return log;
  const issue = missingImageViewerIssue(ref);
  if (log.openIssues.some((i) => i.issueId === issue.issueId)) return log;
  return { ...log, openIssues: [...log.openIssues, issue] };
}

/**
 * Render one citation and, when its document number is unknown and the
 * citation is material, record the blocking open issue in the log — the
 * two halves of spec §7.4 in one call. Returns the rendered citation and
 * the (possibly extended) log. The input log is not mutated.
 */
export function citeEvidence(
  log: WorkProductLog,
  ref: EvidenceRef,
  opts?: { material?: boolean },
): { citation: string; log: WorkProductLog } {
  return {
    citation: renderCitation(ref),
    log: appendMissingImageViewerIssue(log, ref, opts),
  };
}

/**
 * Deduplicate identical references while preserving distinct page/cell
 * citations for the same document (spec §7.4). Two references are
 * identical when they cite the same source document, the same Image
 * Viewer number, and the same precise location; the first is kept.
 * References to different pages or cells of one document have different
 * locations and are all preserved. The `evidenceId` is deliberately NOT
 * part of the key: two internal ids for the same cited passage are one
 * citation, not two.
 */
export function dedupeCitations(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = stableJson([
      ref.documentId,
      ref.imageViewerDocumentNumber,
      ref.location,
    ]);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

/**
 * Render a list of citations, deduplicated as in `dedupeCitations`, in
 * first-seen order. This is the list an `R1Placement.renderedCitations`
 * carries.
 */
export function renderCitations(refs: readonly EvidenceRef[]): string[] {
  return dedupeCitations(refs).map((ref) => renderCitation(ref));
}

// ---------------------------------------------------------------------------
// JSON Schemas (companion export; types first)
// ---------------------------------------------------------------------------

/**
 * Minimal JSON Schema shape, following the Stage 2 pattern
 * (`stage2/02-input-schema.md` §9): draft 2020-12, one schema per record
 * type, `required` listing the fields a payload must carry. These schemas
 * describe the wire shape of a contribution package; the TypeScript
 * interfaces above are authoritative. No validator is bundled — validation
 * of an incoming package is the publication/ingest worker's job.
 */
export interface JsonSchema {
  $schema: string;
  $id: string;
  type: "object";
  title: string;
  required: string[];
  properties: Record<string, unknown>;
}

const SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";

/** JSON Schema for `EvidenceRef`. */
export const EVIDENCE_REF_JSON_SCHEMA: JsonSchema = {
  $schema: SCHEMA_DRAFT,
  $id: "https://pbgc-caseworkbench/contribution/evidence-ref.json",
  type: "object",
  title: "EvidenceRef",
  required: [
    "evidenceId",
    "documentId",
    "location",
    "acquisition",
    "sourceKind",
    "title",
    "imageViewerDocumentNumber",
    "accessStatus",
  ],
  properties: {
    evidenceId: { type: "string" },
    documentId: { type: "string" },
    location: { type: "object" },
    acquisition: { type: "string", enum: ["imported", "derived", "user-entered", "recovered"] },
    derivation: { type: ["string", "null"] },
    sourceFileHash: { type: ["string", "null"] },
    sourceKind: {
      type: "string",
      enum: ["plan document", "census", "valuation report", "PBGC policy", "work product", "other"],
    },
    title: { type: "string" },
    versionOrDate: { type: ["string", "null"] },
    imageViewerDocumentNumber: { type: ["string", "null"] },
    originalExcerpt: { type: ["string", "null"] },
    accessStatus: { type: "string", enum: ["verified", "available", "missing", "pending"] },
    workProductRef: { type: ["object", "null"] },
  },
};

/** JSON Schema for `Finding`. */
export const FINDING_JSON_SCHEMA: JsonSchema = {
  $schema: SCHEMA_DRAFT,
  $id: "https://pbgc-caseworkbench/contribution/finding.json",
  type: "object",
  title: "Finding",
  required: [
    "findingId",
    "caseId",
    "originatingWorkProduct",
    "originatingVersion",
    "claimType",
    "subjectScope",
    "findingStatement",
    "rationale",
    "evidenceRefs",
    "reviewState",
    "materiality",
    "intendedR1Topics",
  ],
  properties: {
    findingId: { type: "string" },
    caseId: { type: "string" },
    originatingWorkProduct: {
      type: "string",
      enum: ["R5", "PlanSummary", "PF", "DEL", "436", "EstimatedAdmin", "EstimatedAdjustment", "AMB", "V1", "BSRS", "other"],
    },
    originatingVersion: { type: "string" },
    claimType: {
      type: "string",
      enum: ["fact", "derived_result", "assumption", "interpretation", "decision", "exception", "risk"],
    },
    subjectScope: { type: "string", enum: ["plan", "participant", "cohort", "valuation"] },
    subjectIds: { type: "array", items: { type: "string" } },
    effectivePeriod: { type: "object" },
    valueAndUnits: { type: "object" },
    findingStatement: { type: "string" },
    rationale: { type: "string" },
    evidenceRefs: { type: "array", items: { type: "string" } },
    missingEvidenceException: { type: ["string", "null"] },
    derivedFromFindingIds: { type: "array", items: { type: "string" } },
    reviewState: { type: "string", enum: ["draft", "reviewed", "approved", "superseded", "disputed"] },
    materiality: { type: "object" },
    intendedR1Topics: { type: "array", items: { type: "string" } },
    supersedes: { type: ["string", "null"] },
  },
};

/** JSON Schema for `NarrativeFragment`. */
export const NARRATIVE_FRAGMENT_JSON_SCHEMA: JsonSchema = {
  $schema: SCHEMA_DRAFT,
  $id: "https://pbgc-caseworkbench/contribution/narrative-fragment.json",
  type: "object",
  title: "NarrativeFragment",
  required: [
    "fragmentId",
    "findingIds",
    "targetTopicKeys",
    "form",
    "content",
    "inclusionState",
    "approvalState",
    "displayOrder",
  ],
  properties: {
    fragmentId: { type: "string" },
    findingIds: { type: "array", items: { type: "string" } },
    targetTopicKeys: { type: "array", items: { type: "string" } },
    form: {
      type: "string",
      enum: ["summary", "detail", "table", "footnote", "appendix", "citation", "open_issue"],
    },
    content: { type: "string" },
    evidenceRefs: { type: "array", items: { type: "string" } },
    inclusionState: { type: "string", enum: ["candidate", "selected", "rejected", "superseded"] },
    approvalState: { type: "string", enum: ["proposed", "reviewed", "approved"] },
    displayOrder: { type: "number" },
    conflictGroup: { type: ["string", "null"] },
  },
};

/** JSON Schema for `WorkProductContribution`. */
export const WORK_PRODUCT_CONTRIBUTION_JSON_SCHEMA: JsonSchema = {
  $schema: SCHEMA_DRAFT,
  $id: "https://pbgc-caseworkbench/contribution/work-product-contribution.json",
  type: "object",
  title: "WorkProductContribution",
  required: [
    "productId",
    "productVersion",
    "caseId",
    "producedAt",
    "publishedBy",
    "sourceSnapshotId",
    "status",
    "findings",
    "fragments",
    "citations",
    "warnings",
    "requiredFollowups",
    "downstreamDependencies",
  ],
  properties: {
    productId: { type: "string" },
    productVersion: { type: "string" },
    caseId: { type: "string" },
    producedAt: { type: "string" },
    publishedBy: { type: "string" },
    sourceSnapshotId: { type: "string" },
    calculationRunId: { type: ["string", "null"] },
    status: { type: "string", enum: ["draft", "reviewed", "approved", "superseded"] },
    findings: { type: "array", items: { $ref: "finding.json" } },
    fragments: { type: "array", items: { $ref: "narrative-fragment.json" } },
    citations: { type: "array", items: { $ref: "evidence-ref.json" } },
    warnings: { type: "array", items: { type: "object" } },
    requiredFollowups: { type: "array", items: { type: "string" } },
    downstreamDependencies: { type: "array", items: { type: "string" } },
  },
};

/** All contribution JSON Schemas, keyed by record type. */
export const CONTRIBUTION_JSON_SCHEMAS: Record<string, JsonSchema> = {
  EvidenceRef: EVIDENCE_REF_JSON_SCHEMA,
  Finding: FINDING_JSON_SCHEMA,
  NarrativeFragment: NARRATIVE_FRAGMENT_JSON_SCHEMA,
  WorkProductContribution: WORK_PRODUCT_CONTRIBUTION_JSON_SCHEMA,
};

// ---------------------------------------------------------------------------
// Publication functions (Worker C, Stage 4.5) — src/publication.ts
// ---------------------------------------------------------------------------

/**
 * Re-exported here so the test worker has one import surface: everything
 * in `src/index.ts` comes through this module. `publication.ts` imports
 * only types and pure helpers from this file and uses them inside
 * function bodies, so this trailing re-export is safe: every export
 * above is already assigned by the time it runs.
 */
export * from "./publication";
