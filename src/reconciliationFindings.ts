/**
 * Stage 5 publication wiring — Worker 3.
 *
 * Converts Stage 5 results (reconciliation outcomes, hypothesis
 * rankings, statistical flags, missing-data classifications, disposition
 * recommendations) into Findings through the Stage 4.5 contribution
 * protocol: `publishFindings` / `assembleContribution` from
 * src/publication.ts, merged with `mergeLogs` from src/contribution.ts.
 * This module builds no finding shape of its own — every Finding it
 * emits is a spec §7.2 Finding, and every package it assembles is a
 * spec §7.2 WorkProductContribution.
 *
 * Rules that govern this file (monadic spec §2.9, §5 invariants I, K;
 * §10 gates G1, G8, G13):
 * - Every Stage 5 finding carries evidence or an explicit
 *   missing-evidence exception, never an uncited fact. A finding with
 *   neither is REFUSED: it is not published, and the refusal is
 *   recorded as a blocking warning plus a missing-evidence open issue.
 *   Refusal is a value, never a throw.
 * - Statistical flags publish as diagnostic evidence (claimType
 *   `exception` or `risk`), never as established facts about the
 *   benefit. A statistical model estimates patterns; it does not
 *   establish any participant's legally correct benefit (§2.6).
 * - A close numeric match publishes as an investigation signal, never
 *   as proof of correctness (invariant I). A match obtained by an
 *   arbitrary change to rounding conventions is labelled Coincidence
 *   until documented (§2.7 anti-coincidence rule).
 * - A disposition recommendation publishes as a `decision` finding in
 *   reviewState `draft`. Publication never approves anything (G13):
 *   only a human reviewer approves, via the T3 transition in
 *   decisions.ts. A recommended disposition has no downstream effect.
 * - Evidence ids a caller asks to cite but that are not in the supplied
 *   pool are dropped, never silently kept — the same rule as
 *   publishFindings.
 *
 * SEAM (Worker 1 / Worker 2 inputs): reconciliation outcomes and
 * statistical flags arrive as plain data through the input types below
 * (`Stage5Reconciliation`, `StatisticalFlag`). This module does not
 * import src/reconcile.ts or src/statistics.ts.
 *
 * Pure functions only. No clock, no storage, no network, no randomness.
 * Money is integer minor units (cents). Synthetic data only.
 */

import type { CalculationOutcome, CalculationRun, MissingDataItem } from "./types";
import type { Finding as ValidationFinding } from "./validation";
import { formatMoneyMinor } from "./validation";
import { moneyMinorToDecimalString } from "./decimal";
import type { DeterminationRecord } from "./determination";
import {
  assembleContribution,
  publishFindings,
  type AssembleContributionInput,
  type PublishFindingsInput,
} from "./publication";
import {
  createEmptyLog,
  mergeLogs,
  type ContributionStatus,
  type EvidenceRef,
  type Finding,
  type LogWarning,
  type Materiality,
  type OpenIssue,
  type WorkProductContribution,
  type WorkProductLog,
} from "./contribution";
import type { DispositionRecommendation } from "./dispositionMapping";

// ---------------------------------------------------------------------------
// Input types (the seam for Worker 1 / Worker 2 outputs)
// ---------------------------------------------------------------------------

/** The reconciliation outcome for one participant, as Worker 1's
 *  reconciliation module reports it (Δ/D/R + tolerance verdict +
 *  recorded position against justified bounds). */
export interface Stage5Reconciliation {
  participantKey: string;
  recordedMinor: number | null;
  reconstructedMinor: number | null;
  deltaMinor: number | null;
  absDeltaMinor: number | null;
  /** Relative difference as an exact decimal string, or null when the
   *  denominator is not meaningful (flagged, not computed). */
  relDelta: string | null;
  denominatorFlag: string | null;
  withinTolerance: boolean | null;
  toleranceSetId: string;
  /** Where the recorded amount falls against justified bounds, when
   *  bounds (not an exact benefit) are the comparison. */
  recordedPosition: "inside" | "below-min" | "above-max" | "recorded-missing" | null;
  boundsMinor: { min: number; max: number } | null;
}

/** One ranked diagnostic hypothesis (Stage 1 §2.6): the counterfactual
 *  operation, the residual discrepancy after it, the support class, and
 *  the evidence for and against. Rank is evidence and explanatory power,
 *  not numerical proximity. */
export interface RankedHypothesis {
  code: string;
  rank: number;
  supportClass: "supported" | "plausible" | "coincidence" | "refuted";
  counterfactual: string;
  residualDeltaMinor: number | null;
  evidenceFor: string[];
  evidenceAgainst: string[];
}

/** One statistical flag (Worker 2 seam): a screen or model output that
 *  flags a participant for investigation. A flag is an investigation
 *  signal, never a benefit amount and never proof of error. */
export interface StatisticalFlag {
  flagId: string;
  participantKey: string;
  /** The screen that flagged it, e.g. "robust-z-score (MAD)", "IQR fence",
   *  "cohort outlier", "model residual". */
  method: string;
  /** The score, as a string (exact decimal where numeric). */
  score: string;
  description: string;
  /** The cohort context the flag was computed in (never pooled-only). */
  cohortContext: string;
  /** Whether the flag has been investigated yet. */
  investigated: boolean;
}

/** One missing-data classification to publish (from missingdata.ts). */
export interface MissingDataPublication {
  item: MissingDataItem;
  /** The stated rationale for the classification. */
  rationale: string;
}

/** Evidence supplied for one Stage 5 finding: ids from the pool, or an
 *  explicit missing-evidence exception. Exactly the publishFindings
 *  rule: evidence or exception, never neither. */
export interface FindingEvidence {
  evidenceIds: readonly string[];
  /** Explicit missing-evidence exception, used only when no evidence
   *  ids resolve. Null when evidence is supplied. */
  missingEvidenceException: string | null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function dollars(minor: number | null): string {
  if (minor === null) return "no amount recorded";
  return formatMoneyMinor(minor);
}

function materiality(input: { material?: boolean; materialityRule?: string | null }): Materiality {
  return { material: input.material ?? true, rule: input.materialityRule ?? null };
}

function resolveEvidenceIds(
  requested: readonly string[],
  pool: readonly EvidenceRef[],
): { found: string[]; dropped: string[] } {
  const poolIds = new Set(pool.map((ref) => ref.evidenceId));
  const found: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const id of requested) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (poolIds.has(id)) found.push(id);
    else dropped.push(id);
  }
  return { found, dropped };
}

function missingEvidenceIssue(findingId: string, detail: string, material: boolean): OpenIssue {
  return {
    issueId: `missing-evidence:${findingId}`,
    kind: "missing-evidence",
    severity: material ? "blocking" : "non-blocking",
    status: "open",
    message:
      `Finding ${findingId} was published without cited evidence: ${detail}. ` +
      `The missing-evidence exception is recorded on the finding; resolve the evidence or withdraw the finding before final use.`,
    relatedFindingIds: [findingId],
    relatedEvidenceIds: [],
    relatedFragmentIds: [],
  };
}

function droppedEvidenceWarning(findingId: string, dropped: readonly string[]): LogWarning {
  return {
    warningId: `dropped-evidence:${findingId}`,
    message:
      `Evidence ids requested for finding ${findingId} were not in the supplied evidence pool and were not cited: ${dropped.join(", ")}. ` +
      `Cite only ids from a verified evidence pool.`,
    severity: "blocking",
    relatedFindingIds: [findingId],
    relatedEvidenceIds: [],
  };
}

/** Attach evidence (or an exception) to a finding under construction.
 *  Returns the finding plus any warnings / issues the attachment
 *  raised. A finding that ends up with neither evidence nor an
 *  exception is NOT returned — see `refuseUnsupported`. */
function attachEvidence(args: {
  finding: Finding;
  evidence: FindingEvidence;
  pool: readonly EvidenceRef[];
}): { finding: Finding; warnings: LogWarning[]; issues: OpenIssue[] } {
  const { found, dropped } = resolveEvidenceIds(args.evidence.evidenceIds, args.pool);
  const warnings: LogWarning[] = [];
  const issues: OpenIssue[] = [];
  if (dropped.length > 0) {
    warnings.push(droppedEvidenceWarning(args.finding.findingId, dropped));
  }
  if (found.length > 0) {
    return {
      finding: { ...args.finding, evidenceRefs: found, missingEvidenceException: null },
      warnings,
      issues,
    };
  }
  const exception = args.evidence.missingEvidenceException;
  if (exception !== null && exception.trim() !== "") {
    const withException: Finding = {
      ...args.finding,
      evidenceRefs: [],
      missingEvidenceException: exception,
    };
    issues.push(missingEvidenceIssue(withException.findingId, exception, withException.materiality.material));
    return { finding: withException, warnings, issues };
  }
  // Neither evidence nor an exception: the caller must handle the
  // refusal (see refuseUnsupported); this path is unreachable when the
  // builders below are used, and is kept as a guard, not a publisher.
  return {
    finding: { ...args.finding, evidenceRefs: [], missingEvidenceException: null },
    warnings,
    issues,
  };
}

/** The refusal of an unsupported assertion: what publishStage5Findings
 *  records instead of publishing it. */
export interface UnsupportedRefusal {
  refused: true;
  findingId: string;
  reason: string;
  warning: LogWarning;
  issue: OpenIssue;
}

function refuseUnsupported(args: {
  findingId: string;
  statement: string;
  material: boolean;
}): UnsupportedRefusal {
  const reason =
    `Refused: "${args.statement}" carries neither cited evidence nor an explicit missing-evidence exception. ` +
    `An unsupported assertion is not published as a finding (G1). Supply evidence ids from the verified pool, or an explicit missing-evidence exception.`;
  return {
    refused: true,
    findingId: args.findingId,
    reason,
    warning: {
      warningId: `refused-unsupported:${args.findingId}`,
      message: reason,
      severity: "blocking",
      relatedFindingIds: [args.findingId],
      relatedEvidenceIds: [],
    },
    issue: {
      issueId: `refused-unsupported:${args.findingId}`,
      kind: "missing-evidence",
      severity: args.material ? "blocking" : "non-blocking",
      status: "open",
      message: reason,
      relatedFindingIds: [args.findingId],
      relatedEvidenceIds: [],
      relatedFragmentIds: [],
    },
  };
}

/** Guard: true only when a finding carries evidence or an explicit
 *  missing-evidence exception. Used by tests and by callers that build
 *  findings outside this module. */
export function findingHasEvidenceOrException(finding: Finding): boolean {
  return (
    finding.evidenceRefs.length > 0 ||
    (finding.missingEvidenceException !== null && finding.missingEvidenceException.trim() !== "")
  );
}

// ---------------------------------------------------------------------------
// Finding builders (each returns a Finding or a refusal, never an
// uncited fact)
// ---------------------------------------------------------------------------

export type BuiltFinding = { finding: Finding; warnings: LogWarning[]; issues: OpenIssue[] } | UnsupportedRefusal;

function isRefusal(value: BuiltFinding): value is UnsupportedRefusal {
  return "refused" in value && value.refused === true;
}

/**
 * Reconciliation outcome finding: Δ/D/R, the tolerance verdict, and the
 * recorded position against justified bounds. claimType
 * `derived_result`: the comparison is a derived result of the pipeline
 * and the reconciliation module, on the stated basis.
 */
export function buildReconciliationFinding(args: {
  caseId: string;
  runId: string;
  productVersion: string;
  reconciliation: Stage5Reconciliation;
  evidence: FindingEvidence;
  pool: readonly EvidenceRef[];
  material?: boolean;
  materialityRule?: string | null;
}): BuiltFinding {
  const rec = args.reconciliation;
  const findingId = `amb:${args.runId}:stage5:reconciliation:${rec.participantKey}`;
  const mat = materiality(args);
  const statement =
    rec.deltaMinor === null
      ? `No comparison computed for participant ${rec.participantKey}: ${rec.denominatorFlag ?? "comparison basis or reconstructed benefit not available"}.`
      : `Reconciliation for participant ${rec.participantKey}: Δ ${dollars(rec.deltaMinor)} (D ${dollars(rec.absDeltaMinor)}` +
        `${rec.relDelta === null ? "; relative difference not computed — denominator not meaningful" : `; R ${rec.relDelta}`}` +
        `); within tolerance: ${rec.withinTolerance === null ? "not determined" : String(rec.withinTolerance)} (tolerance set ${rec.toleranceSetId})` +
        `${rec.recordedPosition === null ? "" : `; recorded PA_AMB is ${rec.recordedPosition} justified bounds`}.`;
  const base: Finding = {
    findingId,
    caseId: args.caseId,
    originatingWorkProduct: "AMB",
    originatingVersion: `${args.productVersion} / ${args.runId}`,
    claimType: "derived_result",
    subjectScope: "participant",
    subjectIds: [rec.participantKey],
    effectivePeriod: { start: null, end: null },
    valueAndUnits: {
      value: rec.deltaMinor === null ? "no comparison" : moneyMinorToDecimalString(rec.deltaMinor),
      units: "USD/month",
      basis: `tolerance set ${rec.toleranceSetId}`,
    },
    findingStatement: statement,
    rationale:
      `Stage 5 reconciliation (run ${args.runId}): Δ_i = B_i^PA − B̂_i on an established comparison basis; ` +
      `tolerance is the case tolerance set (${rec.toleranceSetId}), a human-set documented parameter — no universal PBGC tolerance exists. ` +
      `${rec.denominatorFlag === null ? "" : `Denominator flag: ${rec.denominatorFlag}. `}` +
      `${rec.boundsMinor === null ? "" : `Justified bounds [${dollars(rec.boundsMinor.min)}, ${dollars(rec.boundsMinor.max)}]; recorded position ${rec.recordedPosition}.`}`,
    evidenceRefs: [],
    missingEvidenceException: null,
    derivedFromFindingIds: [],
    reviewState: "draft",
    materiality: mat,
    intendedR1Topics: ["data_issues"],
    supersedes: null,
  };
  const { found } = resolveEvidenceIds(args.evidence.evidenceIds, args.pool);
  if (found.length === 0 && (args.evidence.missingEvidenceException === null || args.evidence.missingEvidenceException.trim() === "")) {
    return refuseUnsupported({ findingId, statement, material: mat.material });
  }
  return attachEvidence({ finding: base, evidence: args.evidence, pool: args.pool });
}

/**
 * Hypothesis-ranking finding: the ranked hypotheses for one
 * participant, with support classes. A Coincidence is labelled as
 * such and never presented as an explanation. claimType `exception`
 * when the leading hypothesis is supported / plausible (it explains a
 * discrepancy); `risk` when the ranking is inconclusive.
 */
export function buildHypothesisFinding(args: {
  caseId: string;
  runId: string;
  productVersion: string;
  participantKey: string;
  hypotheses: RankedHypothesis[];
  evidence: FindingEvidence;
  pool: readonly EvidenceRef[];
  material?: boolean;
  materialityRule?: string | null;
}): BuiltFinding {
  const findingId = `amb:${args.runId}:stage5:hypotheses:${args.participantKey}`;
  const mat = materiality(args);
  const ranked = [...args.hypotheses].sort((a, b) => a.rank - b.rank);
  const leading = ranked[0];
  const statement =
    ranked.length === 0
      ? `No diagnostic hypothesis was tested for participant ${args.participantKey}; the discrepancy (if any) is unexplained.`
      : `Ranked diagnostic hypotheses for participant ${args.participantKey}: ` +
        ranked.map((h) => `${h.code} (rank ${h.rank}, ${h.supportClass}, residual ${dollars(h.residualDeltaMinor)})`).join("; ") +
        `. Leading: ${leading?.code} (${leading?.supportClass}).` +
        (ranked.some((h) => h.supportClass === "coincidence")
          ? " A hypothesis with support class coincidence is a numerical match with no document support; it is never presented as an explanation."
          : "");
  const base: Finding = {
    findingId,
    caseId: args.caseId,
    originatingWorkProduct: "AMB",
    originatingVersion: `${args.productVersion} / ${args.runId}`,
    claimType: ranked.length > 0 && (leading?.supportClass === "supported" || leading?.supportClass === "plausible") ? "exception" : "risk",
    subjectScope: "participant",
    subjectIds: [args.participantKey],
    effectivePeriod: { start: null, end: null },
    valueAndUnits: {
      value: ranked.length === 0 ? "no hypothesis tested" : `${leading?.code ?? "none"} (${leading?.supportClass ?? "none"})`,
      units: null,
      basis: "hypotheses ranked by evidence and explanatory power, not numerical proximity",
    },
    findingStatement: statement,
    rationale:
      `Stage 5 hypothesis ranking (run ${args.runId}): ` +
      ranked.map((h) => `${h.code}: ${h.counterfactual}; evidence for: ${h.evidenceFor.length === 0 ? "none stated" : h.evidenceFor.join("; ")}; evidence against: ${h.evidenceAgainst.length === 0 ? "none stated" : h.evidenceAgainst.join("; ")}`).join(" | "),
    evidenceRefs: [],
    missingEvidenceException: null,
    derivedFromFindingIds: [],
    reviewState: "draft",
    materiality: mat,
    intendedR1Topics: ["data_issues"],
    supersedes: null,
  };
  const { found } = resolveEvidenceIds(args.evidence.evidenceIds, args.pool);
  if (found.length === 0 && (args.evidence.missingEvidenceException === null || args.evidence.missingEvidenceException.trim() === "")) {
    return refuseUnsupported({ findingId, statement, material: mat.material });
  }
  return attachEvidence({ finding: base, evidence: args.evidence, pool: args.pool });
}

/**
 * Statistical flag finding: diagnostic evidence only (claimType
 * `exception` or `risk` — the caller chooses, default `risk`). The
 * statement always says the flag is an investigation signal, never an
 * established fact about the benefit. An uninvestigated flag is a
 * work-list entry; an investigated flag records its outcome.
 */
export function buildStatisticalFlagFinding(args: {
  caseId: string;
  runId: string;
  productVersion: string;
  flag: StatisticalFlag;
  claimType?: "exception" | "risk";
  evidence: FindingEvidence;
  pool: readonly EvidenceRef[];
  material?: boolean;
  materialityRule?: string | null;
}): BuiltFinding {
  const flag = args.flag;
  const findingId = `amb:${args.runId}:stage5:statistical-flag:${flag.flagId}`;
  const mat = materiality(args);
  const statement =
    `Statistical screen ${flag.method} flagged participant ${flag.participantKey} (${flag.description}; score ${flag.score}; cohort context: ${flag.cohortContext}). ` +
    `This is a diagnostic investigation signal, not an established fact about the benefit: a statistical model estimates patterns, it does not establish the participant's legally correct benefit. ` +
    (flag.investigated ? "The flag has been investigated; the investigation outcome is recorded with the flag." : "The flag has not yet been investigated; it is a work-list entry, not a correction.");
  const base: Finding = {
    findingId,
    caseId: args.caseId,
    originatingWorkProduct: "AMB",
    originatingVersion: `${args.productVersion} / ${args.runId}`,
    claimType: args.claimType ?? "risk",
    subjectScope: "participant",
    subjectIds: [flag.participantKey],
    effectivePeriod: { start: null, end: null },
    valueAndUnits: {
      value: flag.score,
      units: null,
      basis: `${flag.method} in cohort: ${flag.cohortContext}`,
    },
    findingStatement: statement,
    rationale:
      `Stage 5 statistical screen (run ${args.runId}, method ${flag.method}): the flag is an outlier / anomaly indicator on the reconciliation population, ` +
      `computed within the participant's formula / amendment cohort as well as pooled. Outliers are investigated, never auto-corrected (invariant I).`,
    evidenceRefs: [],
    missingEvidenceException: null,
    derivedFromFindingIds: [],
    reviewState: "draft",
    materiality: mat,
    intendedR1Topics: ["data_issues"],
    supersedes: null,
  };
  const { found } = resolveEvidenceIds(args.evidence.evidenceIds, args.pool);
  if (found.length === 0 && (args.evidence.missingEvidenceException === null || args.evidence.missingEvidenceException.trim() === "")) {
    return refuseUnsupported({ findingId, statement, material: mat.material });
  }
  return attachEvidence({ finding: base, evidence: args.evidence, pool: args.pool });
}

/**
 * Close-match finding: a close numeric match publishes as an
 * investigation signal, never as proof of correctness (invariant I).
 * claimType `risk`. The statement names the match size and, when the
 * supporting hypothesis is a Coincidence, says so explicitly.
 */
export function buildCloseMatchFinding(args: {
  caseId: string;
  runId: string;
  productVersion: string;
  participantKey: string;
  deltaMinor: number;
  toleranceSetId: string;
  hypothesisSupportClass: "supported" | "plausible" | "coincidence" | "refuted";
  hypothesisCode: string;
  evidence: FindingEvidence;
  pool: readonly EvidenceRef[];
  material?: boolean;
  materialityRule?: string | null;
}): BuiltFinding {
  const findingId = `amb:${args.runId}:stage5:close-match:${args.participantKey}`;
  const mat = materiality(args);
  const statement =
    `Close numeric match for participant ${args.participantKey}: Δ ${dollars(args.deltaMinor)} within tolerance set ${args.toleranceSetId}. ` +
    `A close match is an investigation signal, never proof of correctness: numerical agreement is not sufficient proof of legal or actuarial correctness if the underlying calculations use incorrect provisions. ` +
    (args.hypothesisSupportClass === "coincidence"
      ? `The match rests on hypothesis ${args.hypothesisCode} with support class coincidence — a numerical match with no document support — and must never move a disposition to Verified.`
      : `The match rests on hypothesis ${args.hypothesisCode} (${args.hypothesisSupportClass}).`);
  const base: Finding = {
    findingId,
    caseId: args.caseId,
    originatingWorkProduct: "AMB",
    originatingVersion: `${args.productVersion} / ${args.runId}`,
    claimType: "risk",
    subjectScope: "participant",
    subjectIds: [args.participantKey],
    effectivePeriod: { start: null, end: null },
    valueAndUnits: {
      value: moneyMinorToDecimalString(args.deltaMinor),
      units: "USD/month",
      basis: `tolerance set ${args.toleranceSetId}`,
    },
    findingStatement: statement,
    rationale:
      `Stage 5 close-match signal (run ${args.runId}, invariant I): a close numeric match and a statistical outlier are both investigation signals, ` +
      `not proof of error or correctness. A successful numerical match obtained by arbitrary changes to rounding conventions must not be treated as proof of the administrator's actual methodology (§2.7 anti-coincidence rule).`,
    evidenceRefs: [],
    missingEvidenceException: null,
    derivedFromFindingIds: [],
    reviewState: "draft",
    materiality: mat,
    intendedR1Topics: ["data_issues"],
    supersedes: null,
  };
  const { found } = resolveEvidenceIds(args.evidence.evidenceIds, args.pool);
  if (found.length === 0 && (args.evidence.missingEvidenceException === null || args.evidence.missingEvidenceException.trim() === "")) {
    return refuseUnsupported({ findingId, statement, material: mat.material });
  }
  return attachEvidence({ finding: base, evidence: args.evidence, pool: args.pool });
}

/**
 * Missing-data classification finding: one MissingDataItem (M1–M5)
 * with its classification rationale. claimType by class: M5 / M1 /
 * M2 → `exception` (reconstruction blocked or pending); M4 →
 * `assumption` (a stated assumption stands in); M3 → `risk` (the
 * uncertainty is bounded, and the bound width is the finding). The
 * finding names the missing input, its class, and what would resolve
 * it — never a filled-in value.
 */
export function buildMissingDataFinding(args: {
  caseId: string;
  runId: string;
  productVersion: string;
  participantKey: string;
  missing: MissingDataPublication;
  evidence: FindingEvidence;
  pool: readonly EvidenceRef[];
  material?: boolean;
  materialityRule?: string | null;
}): BuiltFinding {
  const item = args.missing.item;
  const label = { a: "M1", b: "M2", c: "M3", d: "M4", e: "M5" }[item.missingClass] as "M1" | "M2" | "M3" | "M4" | "M5";
  const findingId = `amb:${args.runId}:stage5:missing-data:${args.participantKey}:${item.field.replace(/[^A-Za-z0-9]+/g, "-")}`;
  const mat = materiality(args);
  const claimType: Finding["claimType"] =
    item.missingClass === "d" ? "assumption" : item.missingClass === "c" ? "risk" : "exception";
  const statement =
    `Missing input for participant ${args.participantKey}: ${item.field} (class ${label}). ${args.missing.rationale} ` +
    `Consequence: ${item.consequence} ${item.resolvesBy === null ? "No source identified that would resolve it." : `Resolves by: ${item.resolvesBy}.`} ` +
    `The blank is missing data, never zero.`;
  const base: Finding = {
    findingId,
    caseId: args.caseId,
    originatingWorkProduct: "AMB",
    originatingVersion: `${args.productVersion} / ${args.runId}`,
    claimType,
    subjectScope: "participant",
    subjectIds: [args.participantKey],
    effectivePeriod: { start: null, end: null },
    valueAndUnits: {
      value: `missing (${label})`,
      units: null,
      basis: item.field,
    },
    findingStatement: statement,
    rationale:
      `Stage 5 missing-data analysis (run ${args.runId}, §4.1 five-way framework): the input is classified ${label} with its consequence recorded; ` +
      `a missing input is never silently dropped from the calculation and never filled with zero or an imputed value.`,
    evidenceRefs: [],
    missingEvidenceException: null,
    derivedFromFindingIds: [],
    reviewState: "draft",
    materiality: mat,
    intendedR1Topics: ["data_issues"],
    supersedes: null,
  };
  const { found } = resolveEvidenceIds(args.evidence.evidenceIds, args.pool);
  if (found.length === 0 && (args.evidence.missingEvidenceException === null || args.evidence.missingEvidenceException.trim() === "")) {
    return refuseUnsupported({ findingId, statement, material: mat.material });
  }
  return attachEvidence({ finding: base, evidence: args.evidence, pool: args.pool });
}

/**
 * Disposition-recommendation finding: the mapping's recommendation as a
 * `decision` finding in reviewState `draft`. The statement always says
 * the recommendation is not an approval: only a human reviewer
 * approves (invariant K), via the T3 transition in decisions.ts, and a
 * recommendation has no downstream effect.
 */
export function buildDispositionRecommendationFinding(args: {
  caseId: string;
  runId: string;
  productVersion: string;
  recommendation: DispositionRecommendation;
  evidence: FindingEvidence;
  pool: readonly EvidenceRef[];
  material?: boolean;
  materialityRule?: string | null;
}): BuiltFinding {
  const rec = args.recommendation;
  const findingId = `amb:${args.runId}:stage5:disposition:${rec.participantKey}`;
  const mat = materiality(args);
  const statement =
    `Recommended disposition for participant ${rec.participantKey}: "${rec.disposition}" (${rec.mappingRow}). ${rec.rationale} ` +
    `This is a system recommendation, not an approval: the final decision is made and approved by an authorized human reviewer (invariant K). ` +
    `A recommendation has no downstream effect — it does not authorise valuation use and does not set PA_AMB_ACCEPT.`;
  const base: Finding = {
    findingId,
    caseId: args.caseId,
    originatingWorkProduct: "AMB",
    originatingVersion: `${args.productVersion} / ${args.runId}`,
    claimType: "decision",
    subjectScope: "participant",
    subjectIds: [rec.participantKey],
    effectivePeriod: { start: null, end: null },
    valueAndUnits: {
      value: rec.disposition,
      units: null,
      basis: rec.mappingRow,
    },
    findingStatement: statement,
    rationale:
      `Stage 5 disposition mapping (run ${args.runId}): ${rec.rationale} ` +
      `Supporting evidence: ${rec.supportingEvidence.length === 0 ? "none stated" : rec.supportingEvidence.join("; ")}. ` +
      `${rec.nextSteps.length === 0 ? "No next steps." : `Next steps: ${rec.nextSteps.join("; ")}.`}`,
    evidenceRefs: [],
    missingEvidenceException: null,
    derivedFromFindingIds: [],
    reviewState: "draft",
    materiality: mat,
    intendedR1Topics: ["data_issues"],
    supersedes: null,
  };
  const { found } = resolveEvidenceIds(args.evidence.evidenceIds, args.pool);
  if (found.length === 0 && (args.evidence.missingEvidenceException === null || args.evidence.missingEvidenceException.trim() === "")) {
    return refuseUnsupported({ findingId, statement, material: mat.material });
  }
  return attachEvidence({ finding: base, evidence: args.evidence, pool: args.pool });
}

// ---------------------------------------------------------------------------
// publishStage5Findings — the Stage 5 publication entry point
// ---------------------------------------------------------------------------

/** One participant's Stage 5 results to publish. */
export interface Stage5ParticipantPublication {
  participantKey: string;
  reconciliation: Stage5Reconciliation | null;
  hypotheses: RankedHypothesis[];
  statisticalFlags: StatisticalFlag[];
  missingData: MissingDataPublication[];
  dispositionRecommendation: DispositionRecommendation | null;
  /** Close-match signal, when the reconciliation is a close match that
   *  must be published as an investigation signal (invariant I). */
  closeMatch: {
    deltaMinor: number;
    toleranceSetId: string;
    hypothesisSupportClass: "supported" | "plausible" | "coincidence" | "refuted";
    hypothesisCode: string;
  } | null;
  /** Evidence per finding kind. A kind with no entry is refused, never
   *  published uncited. */
  evidenceByKind: Partial<Record<
    "reconciliation" | "hypotheses" | "statisticalFlag" | "closeMatch" | "missingData" | "disposition",
    FindingEvidence
  >>;
  /** Evidence ids per statistical flag, by flagId. */
  statisticalFlagEvidence?: Record<string, FindingEvidence>;
  /** Evidence per missing-data field. */
  missingDataEvidence?: Record<string, FindingEvidence>;
}

export interface PublishStage5FindingsInput {
  /** The calculation run: pins runId, caseId, ruleVersion,
   *  engineVersion, and inputSnapshotHash. */
  run: CalculationRun;
  /** The pipeline's return value for the run, when one is supplied.
   *  Published through publishFindings (Stage 4.5); Stage 5 findings
   *  are merged into the same log. Null when no pipeline outcome is
   *  being published in this call. */
  outcome: CalculationOutcome | null;
  /** Rule-check findings for publishFindings. */
  validations?: readonly ValidationFinding[];
  /** The determination record, when one has been recorded. */
  determination?: DeterminationRecord | null;
  /** Caller-verified evidence pool. */
  evidence: readonly EvidenceRef[];
  /** AMB product version, e.g. ENGINE_VERSION. */
  productVersion: string;
  /** Evidence ids supporting the pipeline-outcome finding. */
  calculationEvidenceIds?: readonly string[];
  /** Per-participant Stage 5 results. */
  participants: readonly Stage5ParticipantPublication[];
  /** Case-level materiality rule applied to every Stage 5 finding. */
  materialityRule?: string | null;
  material?: boolean;
}

/**
 * Publish Stage 5 results through the Stage 4.5 protocol. The pipeline
 * outcome (when supplied) is published by publishFindings; each Stage 5
 * finding is built by the builders above and merged into the same
 * WorkProductLog with mergeLogs. Unsupported assertions are refused,
 * not published: each refusal is recorded as a blocking warning plus a
 * blocking missing-evidence open issue naming the finding id.
 *
 * The returned log carries the evidence pool, the merged findings, and
 * every refusal — so a caller can see exactly what was published and
 * what was refused, and why.
 */
export function publishStage5Findings(input: PublishStage5FindingsInput): WorkProductLog {
  const pool = input.evidence;
  let log: WorkProductLog;
  if (input.outcome !== null) {
    const publishInput: PublishFindingsInput = {
      run: input.run,
      outcome: input.outcome,
      validations: input.validations ?? [],
      determination: input.determination ?? null,
      evidence: pool,
      productVersion: input.productVersion,
      calculationEvidenceIds: input.calculationEvidenceIds ?? [],
      materialityRule: input.materialityRule ?? null,
      material: input.material,
    };
    log = publishFindings(publishInput);
  } else {
    log = createEmptyLog();
    log = { ...log, evidenceRefs: [...pool] };
  }

  const stage5Log = createEmptyLog();
  stage5Log.evidenceRefs = [...pool];

  const collect = (built: BuiltFinding): void => {
    if (isRefusal(built)) {
      stage5Log.warnings.push(built.warning);
      stage5Log.openIssues.push(built.issue);
      return;
    }
    stage5Log.findings.push(built.finding);
    stage5Log.warnings.push(...built.warnings);
    stage5Log.openIssues.push(...built.issues);
  };

  const noEvidence: FindingEvidence = { evidenceIds: [], missingEvidenceException: null };

  for (const participant of input.participants) {
    const common = {
      caseId: input.run.caseId,
      runId: input.run.runId,
      productVersion: input.productVersion,
      pool,
      material: input.material,
      materialityRule: input.materialityRule ?? null,
    };
    if (participant.reconciliation !== null) {
      collect(
        buildReconciliationFinding({
          ...common,
          reconciliation: participant.reconciliation,
          evidence: participant.evidenceByKind.reconciliation ?? noEvidence,
        }),
      );
    }
    if (participant.hypotheses.length > 0) {
      collect(
        buildHypothesisFinding({
          ...common,
          participantKey: participant.participantKey,
          hypotheses: participant.hypotheses,
          evidence: participant.evidenceByKind.hypotheses ?? noEvidence,
        }),
      );
    }
    for (const flag of participant.statisticalFlags) {
      collect(
        buildStatisticalFlagFinding({
          ...common,
          flag,
          evidence:
            participant.statisticalFlagEvidence?.[flag.flagId] ??
            participant.evidenceByKind.statisticalFlag ??
            noEvidence,
        }),
      );
    }
    if (participant.closeMatch !== null) {
      collect(
        buildCloseMatchFinding({
          ...common,
          participantKey: participant.participantKey,
          deltaMinor: participant.closeMatch.deltaMinor,
          toleranceSetId: participant.closeMatch.toleranceSetId,
          hypothesisSupportClass: participant.closeMatch.hypothesisSupportClass,
          hypothesisCode: participant.closeMatch.hypothesisCode,
          evidence: participant.evidenceByKind.closeMatch ?? noEvidence,
        }),
      );
    }
    for (const missing of participant.missingData) {
      collect(
        buildMissingDataFinding({
          ...common,
          participantKey: participant.participantKey,
          missing,
          evidence:
            participant.missingDataEvidence?.[missing.item.field] ??
            participant.evidenceByKind.missingData ??
            noEvidence,
        }),
      );
    }
    if (participant.dispositionRecommendation !== null) {
      collect(
        buildDispositionRecommendationFinding({
          ...common,
          recommendation: participant.dispositionRecommendation,
          evidence: participant.evidenceByKind.disposition ?? noEvidence,
        }),
      );
    }
  }

  return mergeLogs(log, stage5Log);
}

// ---------------------------------------------------------------------------
// assembleStage5Contribution — the Stage 5 package
// ---------------------------------------------------------------------------

export interface AssembleStage5ContributionInput {
  caseId: string;
  productVersion: string;
  producedAt: string;
  publishedBy: string;
  run: CalculationRun;
  log: WorkProductLog;
  status?: ContributionStatus;
  approval?: { approvalId: string; reviewer: string } | null;
  requiredFollowups?: readonly string[];
  downstreamDependencies?: readonly string[];
}

/**
 * Build the versioned AMB contribution package from the published Stage
 * 5 log, through assembleContribution (Stage 4.5). Status "approved" is
 * honoured only with a recorded approval (G13); without one the package
 * is recorded as "draft" with a blocking warning.
 */
export function assembleStage5Contribution(
  input: AssembleStage5ContributionInput,
): WorkProductContribution {
  const assembleInput: AssembleContributionInput = {
    caseId: input.caseId,
    productVersion: input.productVersion,
    producedAt: input.producedAt,
    publishedBy: input.publishedBy,
    run: input.run,
    log: input.log,
    status: input.status,
    approval: input.approval,
  };
  if (input.requiredFollowups !== undefined) {
    assembleInput.requiredFollowups = input.requiredFollowups;
  }
  if (input.downstreamDependencies !== undefined) {
    assembleInput.downstreamDependencies = input.downstreamDependencies;
  }
  return assembleContribution(assembleInput);
}
