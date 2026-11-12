/**
 * Decision state machine — the five dispositions as a versioned state
 * machine with the human approval gate (Stage 2 output 05).
 *
 * Governing spec: MASTER_PROMPT §14 (five dispositions; ten documentation
 * items), §17 (S_{t+1} = T(S_t, E_t)); Stage 2 output 05 §§1–7.
 *
 * The five dispositions are proposed application states, NOT official PBGC
 * classifications (§14; 05 §0.2). The PA_AMB_ACCEPT mapping in §1.4 is a
 * proposed application mapping (OD-2); it is recorded visibly, not
 * presented as a PBGC rule.
 *
 * Design rules enforced here:
 * - The 12-row transition table T1–T12 is a pure function,
 *   `transition(current, event, ctx)`: refusal is a result, never a
 *   thrown exception for a disallowed transition (T12). A refused
 *   transition never partially applies: the analytic state is unchanged
 *   and only the audit log gains a refusal event.
 * - The system may only recommend; only a human may approve / reject /
 *   re-open (§4.1). A recommendation has no downstream effect: it does
 *   not authorise valuation use and does not set PA_AMB_ACCEPT.
 * - Source or rule changes invalidate the resting basis of an approved
 *   disposition (§3.2): re-propose, then re-approve. No silent
 *   carry-forward, no auto-re-approval — even when the re-proposed
 *   disposition is identical.
 * - Indeterminate is a legitimate terminal outcome (§5): no transition
 *   out on the same evidence; only T10 (new evidence) and T5/T6
 *   (human re-opening) leave it.
 * - Guards G-INV-1–9 and G-IND-1–2 (§6.7) are checked in catalogue order
 *   before any state change. There is no override and no configuration
 *   that disables a guard.
 * - Only Verified and Supported for acceptance (approved) carry B_i^PA
 *   into the valuation; Correction recommended (approved) carries only
 *   the corrected value; Requires investigation and Indeterminate block
 *   use (§1.2).
 *
 * Pure functions only. No clock, no network, no storage. IDs and
 * timestamps are caller-supplied (the core never generates them), so two
 * runs over the same inputs produce byte-identical outputs. Money is
 * integer minor units (cents); arithmetic on cents is exact integer
 * arithmetic. Synthetic data only.
 */

import type {
  BenefitCalculation,
  BenefitComparison,
  BenefitObservation,
  CalculationRun,
  CompletenessGrade,
  DiagnosticHypothesis,
  Disposition,
  PlanVersion,
  SourceDocument,
} from "./types";
import {
  approveDetermination,
  checkDeterminationCompleteness,
  isSubstantiveRationale,
} from "./determination";
import type {
  ApprovalEvidenceSnapshot,
  DeterminationApprovalInput,
  DeterminationDataRequest,
  DeterminationRecord,
  PartialDeterminationRecord,
} from "./determination";

/** Disposition state-machine schema version (05 §2.1). */
export const DISPOSITION_SCHEMA_VERSION = "1.0.0";

/** Case-analysis state schema version (05 §6.1; distinct from the
 *  disposition schema version). */
export const CASE_STATE_VERSION = "1.0.0";

/** An actor: "system" for the application, or a reviewer's identity.
 *  The application may only ever produce a `recommended` record (§4). */
export type Actor = string;

/** "unassessed" = no disposition yet; not a disposition and not terminal. */
export type DispositionState = "unassessed" | Disposition;

export type DispositionStatus = "recommended" | "approved" | "superseded";

/** Transition rows T1–T12 (05 §3.1). T12 is the refusal outcome. */
export type TransitionId =
  | "T1"
  | "T2"
  | "T3"
  | "T4"
  | "T5"
  | "T6"
  | "T7"
  | "T8"
  | "T9"
  | "T10"
  | "T11"
  | "T12";

export type GuardId =
  | "G-INV-1"
  | "G-INV-2"
  | "G-INV-3"
  | "G-INV-4"
  | "G-INV-5"
  | "G-INV-6"
  | "G-INV-7"
  | "G-INV-8"
  | "G-INV-9"
  | "G-IND-1"
  | "G-IND-2"
  | "human-gate"
  | "entry-conditions"
  | "transition-not-allowed"
  | "indeterminate-terminal";

/** The guard catalogue (05 §6.7), as data: guard, what it enforces, and
 *  when it refuses. Guards are checked in this order. */
export const GUARD_CATALOGUE: ReadonlyArray<{
  guard: GuardId;
  enforces: string;
  refusesWhen: string;
}> = [
  { guard: "G-INV-1", enforces: "Invariant 1 — source observations unchanged", refusesWhen: "a transition would write to the immutable input snapshot or present a correction without its original" },
  { guard: "G-INV-2", enforces: "Invariant 2 — reproducibility", refusesWhen: "a result's snapshot hash or rule version is missing or mismatched at approval / carry-forward" },
  { guard: "G-INV-3", enforces: "Invariant 3 — units and measurement bases", refusesWhen: "a disposition requiring an established basis is attempted while the basis is unresolved, or a Δ is computed across non-equivalent bases; also a Requires investigation record naming no next step" },
  { guard: "G-INV-4", enforces: "Invariant 4 — rule applicability", refusesWhen: "a rule is applied outside its applicability predicate" },
  { guard: "G-INV-5", enforces: "Invariant 5 — statistics cannot become benefits", refusesWhen: "a disposition, benefit, or corrected value would rest on a statistical output alone" },
  { guard: "G-INV-6", enforces: "Invariant 6 — no silent change to others", refusesWhen: "a transition would alter a participant outside the computed affected set, or cannot name its affected set" },
  { guard: "G-INV-7", enforces: "Invariant 7 — approved determinations retain evidence", refusesWhen: "approval is attempted with any §14 item missing, or the evidence snapshot no longer matches" },
  { guard: "G-INV-8", enforces: "Invariant 8 — no silent failure, no invented exactness", refusesWhen: "an exact number would be emitted where only bounds are supported; a case would close with an unassessed participant; a missing input would be filled with zero/an invented value" },
  { guard: "G-INV-9", enforces: "Invariant 9 — reliable output when exact reconstruction is impossible", refusesWhen: "a run/case/report would finish while a participant lacks a calculation/bounds/no-bounds-statement and a disposition" },
  { guard: "G-IND-1", enforces: "§5.3 — Indeterminate content", refusesWhen: "an Indeterminate transition lacks bounds (or a no-bounds reason), missing evidence, data requests, or the indeterminate rationale" },
  { guard: "G-IND-2", enforces: "§5.2 — Indeterminate end conditions", refusesWhen: "an Indeterminate transition is attempted while all data requests are still not-issued with no recorded reason why no request can be made" },
];

// ---------------------------------------------------------------------------
// Evidence state (§2) and the entry-condition input
// ---------------------------------------------------------------------------

/** Evidence state at the time of a disposition record (05 §2). */
export interface EvidenceState {
  completenessGrade: CompletenessGrade;
  comparisonBasis: "established" | "unresolved";
  /** B̂_i in integer cents; null if none. */
  reconstructedBenefitCents: number | null;
  /** Justified bounds; null if none justifiable. */
  boundsCents: { min: number; max: number } | null;
  /** Δ_i in cents; null when the basis is unresolved or B̂_i is null. */
  deltaCents: number | null;
  withinTolerance: boolean | null;
  toleranceSetId: string;
}

/** One hypothesis as the entry-condition checker reads it: its code, its
 *  support class (03 §2.6, plus "proposed"/"indeterminate" for untested
 *  hypotheses), whether it is material to the amount, and the corrected
 *  benefit it implies, if any. */
export interface HypothesisCheck {
  code: string;
  supportClass:
    | "supported"
    | "plausible"
    | "coincidence"
    | "refuted"
    | "proposed"
    | "indeterminate";
  material: boolean;
  correctedBenefitCents?: number | null;
}

/** One missing-evidence entry as the Indeterminate content carries it
 *  (05 §5.3): the input, its M1–M5 class, its decision impact, and its
 *  contribution to uncertainty where quantifiable (03 §4.5). */
export interface IndeterminateMissingEvidence {
  input: string;
  missingClass: "M1" | "M2" | "M3" | "M4" | "M5";
  decisionImpact: string;
  uncertaintyContributionCents: number | null;
}

/** What an Indeterminate record carries (05 §5.3). Guard G-IND-1 refuses
 *  an Indeterminate transition that lacks any of it. */
export interface IndeterminateContent {
  /** Justified bounds, or null with a no-bounds reason (never silently null). */
  justifiedBoundsCents: { min: number; max: number } | null;
  /** Why no justified bound exists, when justifiedBoundsCents is null. */
  noBoundsReason: string | null;
  /** Per-scenario bounds. Per-scenario bounds are NOT a single justified
   *  bound for the participant; the record must say so (the scenarios
   *  themselves carry their assumptions). */
  scenarioBounds: Array<{
    scenarioName: string;
    assumptions: string[];
    minCents: number;
    maxCents: number;
  }>;
  missingEvidence: IndeterminateMissingEvidence[];
  /** Prioritised data requests (03 §4.6). */
  dataRequests: DeterminationDataRequest[];
  /** Why this is Indeterminate and not Requires investigation (§5.2 item 3). */
  indeterminateRationale: string;
  /** §5.2 item 2(b): the reviewer records, with reasons, that no further
   *  request can currently be made. Null when further requests are possible. */
  noFurtherRequestReason: string | null;
}

/**
 * Everything the entry conditions (§1.2) and the guards (§6.7) read.
 * This is the evidence state plus the judgement facts the spec requires
 * the reviewer or the engine to supply: hypothesis support classes,
 * next steps, the corrected value and its certainty, and the
 * Indeterminate content. Fields that name a judgement carry the
 * judgement explicitly (e.g. `correctionReasonablyCertain` is the
 * reviewer's statement of certainty — the system records it, it does
 * not compute it, §1.2.4).
 */
export interface EntryCheckInput extends EvidenceState {
  /** Hypotheses tested against the discrepancy, with support class. */
  hypotheses: HypothesisCheck[];
  /** A validation rule that blocks calculation/bounds is outstanding. */
  blockingValidationOutstanding: boolean;
  /** True when the bound width is material relative to τ_material and
   *  no reviewer justification for its immateriality is recorded. */
  boundWidthMaterial: boolean;
  /** Reviewer reason the bound width is immaterial to the decision. */
  boundWidthJustification: string | null;
  /** Missing evidence with class and decision impact (03 §4.5). */
  missingEvidence: IndeterminateMissingEvidence[];
  /** Concrete next steps (Requires investigation, §1.2.3). */
  nextSteps: string[];
  /** The specific corrected monthly benefit, when one is proposed. */
  correctedBenefitCents: number | null;
  /** Reviewer's statement that the error and the amount are reasonably
   *  certain (Policy 5.8-1 §D standard, §1.2.4). */
  correctionReasonablyCertain: boolean;
  /** Direction of the correction, recorded for the reviewer (§1.2.4). */
  correctionDirection: "increase" | "decrease" | null;
  /** The recorded benefit B_i^PA in cents; null when blank. */
  recordedBenefitCents: number | null;
  /** The disposition would rest on a statistical output alone (G-INV-5). */
  statisticalOnly: boolean;
  /** The rule/tolerance applies within its applicability predicate. */
  ruleApplicabilityOk: boolean;
  /** The calculation run's snapshot hash and rule version match the
   *  current state (G-INV-2). */
  snapshotMatches: boolean;
  /** The evidence supports an exact reconstructed benefit (G-INV-8). */
  exactSupported: boolean;
  /** An evidence state exists for this participant (T4: a participant
   *  with an evidence state must not be left without a proposed
   *  disposition). */
  hasEvidenceState: boolean;
  /** Supported for acceptance on a Complete record: the reviewer-named
   *  ground on which a Verified condition other than exact agreement
   *  fails on a documented, immaterial ground (§1.2.2 item 1). */
  supportedGround: string | null;
  /** B_i^PA lies outside justified bounds but the assumptions behind
   *  the bounds are themselves in doubt (§1.2.3 item 3). */
  boundAssumptionsInDoubt: boolean;
  /** Two or more hypotheses both resolve the discrepancy but imply
   *  different corrected benefits (§1.2.3 item 4; 03 §2.6). */
  conflictingCorrections: boolean;
  /** A statistical screen or validation finding flags the participant
   *  and is not yet investigated (§1.2.3 item 5). */
  uninvestigatedFlag: boolean;
  /** The comparison basis is unresolved and cannot be resolved from
   *  available documents (§1.2.5 item 2). */
  basisUnresolvable: boolean;
  /** Evidence exists that is mutually contradictory in a way no
   *  available document resolves (§1.2.5 item 4). */
  contradictoryEvidenceUnresolved: boolean;
  /** Indeterminate content (§5.3); null when not an Indeterminate case. */
  indeterminateContent: IndeterminateContent | null;
}

// ---------------------------------------------------------------------------
// Records: DispositionRecord, ApprovalRecord, EvidenceSnapshot (§2, §4)
// ---------------------------------------------------------------------------

/** What downstream may use, per §1.2. Null value when use is blocked. */
export interface DownstreamUse {
  usableInValuation: boolean;
  /** B_i^PA, or correctedBenefit, or null when blocked. */
  valueCents: number | null;
  valueKind: "recorded" | "corrected" | "none";
  /** BCV3.PA_AMB_ACCEPT; null until an approved determination sets it. */
  paAmbAccept: "Y" | "N" | null;
}

/** The versioned disposition record (05 §2). A transition creates a new
 *  record; it never edits the previous record in place. */
export interface DispositionRecord {
  dispositionId: string;
  /** Disposition state-machine version (§2.1). */
  schemaVersion: string;
  participantKey: string;
  /** CASE (BCV, VARCHAR2(8), leading zeros kept as text). */
  caseId: string;
  disposition: Disposition;
  status: DispositionStatus;
  evidenceState: EvidenceState;
  downstreamUse: DownstreamUse;
  /** Pointer to the full determination record (§7). Null while only
   *  recommended on system-generated evidence with no reviewer-drafted
   *  determination yet. */
  determinationId: string | null;
  /** 1, 2, 3, … — increments on every transition. */
  version: number;
  supersedesId: string | null;
  /** Who proposed it; approval is always a human (§4). */
  createdBy: "system" | Actor;
  /** ISO date-time of the transition (audit clock, not calculation input). */
  createdAt: string;
  /** SHA-256 of the input snapshot this record rests on. */
  inputSnapshotHash: string;
  ruleVersion: string;
  /** CalculationRun this record rests on, if any. */
  calculationRunId: CalculationRun["runId"] | null;
  /** The audit-log event that recorded this transition. */
  auditEventId: string;
}

/** The frozen evidence snapshot the approval rests on (05 §4.3).
 *  Defined in determination.ts (ApprovalEvidenceSnapshot) and reused here. */
export type EvidenceSnapshot = ApprovalEvidenceSnapshot;

/** Approval is itself a record, not a flag (05 §4.2). */
export interface ApprovalRecord {
  approvalId: string;
  dispositionId: string;
  determinationId: string;
  /** Name/identity of the authorized human reviewer. */
  reviewer: string;
  /** Role as recorded (see OD-3; not invented here). */
  reviewerRole: string;
  /** ISO date of approval. */
  approvalDate: string;
  /** The reviewer's own rationale, in their own words. Must be present. */
  rationale: string;
  /** The evidence snapshot the decision rests on — frozen at approval time. */
  evidenceSnapshot: EvidenceSnapshot;
  /** The reviewer confirms each of these; the approval is refused if any
   *  is false. */
  confirmations: {
    entryConditionsHold: boolean;
    determinationComplete: boolean;
    toleranceIdentified: boolean;
    noMaterialUnexplainedItem: boolean;
  };
  /** Set when re-approving after a re-opening (T5/T6 → T3). */
  supersedesApprovalId: string | null;
}

// ---------------------------------------------------------------------------
// Downstream permission (§1.2, §1.4)
// ---------------------------------------------------------------------------

/** Proposed PA_AMB_ACCEPT mapping (§1.4; OD-2 leaves the Requires
 *  investigation / Indeterminate flag open, so this function returns
 *  "N" for those — the proposed limb — and the determination module
 *  accepts "N" or null there). */
export function paAmbAcceptFor(disposition: Disposition): "Y" | "N" {
  switch (disposition) {
    case "verified":
    case "supported-for-acceptance":
      return "Y";
    case "requires-investigation":
    case "correction-recommended":
    case "indeterminate":
      return "N";
  }
}

/**
 * What downstream may use for a disposition in a given status (§1.2).
 * A recommendation has NO downstream effect (§4.1): it does not
 * authorise valuation use and does not set PA_AMB_ACCEPT, whatever the
 * disposition. Only an approved disposition authorises use:
 * - Verified / Supported for acceptance: B_i^PA, labelled as accepted
 *   (Supported carries its bounds and missing evidence with it).
 * - Correction recommended: the corrected value only, never B_i^PA.
 * - Requires investigation / Indeterminate: blocked, no value.
 */
export function downstreamUseFor(
  disposition: Disposition,
  status: DispositionStatus,
  recordedBenefitCents: number | null,
  correctedBenefitCents: number | null,
): DownstreamUse {
  if (status !== "approved") {
    return { usableInValuation: false, valueCents: null, valueKind: "none", paAmbAccept: null };
  }
  switch (disposition) {
    case "verified":
    case "supported-for-acceptance":
      return {
        usableInValuation: true,
        valueCents: recordedBenefitCents,
        valueKind: "recorded",
        paAmbAccept: "Y",
      };
    case "correction-recommended":
      return {
        usableInValuation: true,
        valueCents: correctedBenefitCents,
        valueKind: "corrected",
        paAmbAccept: "N",
      };
    case "requires-investigation":
    case "indeterminate":
      return { usableInValuation: false, valueCents: null, valueKind: "none", paAmbAccept: "N" };
  }
}

// ---------------------------------------------------------------------------
// Entry conditions (§1.2)
// ---------------------------------------------------------------------------

export interface EntryCheckResult {
  holds: boolean;
  failures: string[];
}

function materialUnresolvedHypotheses(evidence: EntryCheckInput): HypothesisCheck[] {
  return evidence.hypotheses.filter(
    (h) =>
      h.material &&
      h.supportClass !== "supported" &&
      h.supportClass !== "refuted",
  );
}

function hasMaterialClass(
  evidence: EntryCheckInput,
  supportClass: HypothesisCheck["supportClass"],
): boolean {
  return evidence.hypotheses.some((h) => h.material && h.supportClass === supportClass);
}

function hasMissingClass(evidence: EntryCheckInput, missingClass: string): boolean {
  return evidence.missingEvidence.some((entry) => entry.missingClass === missingClass);
}

function recordedInsideBounds(evidence: EntryCheckInput): boolean {
  if (evidence.boundsCents === null || evidence.recordedBenefitCents === null) return false;
  return (
    evidence.recordedBenefitCents >= evidence.boundsCents.min &&
    evidence.recordedBenefitCents <= evidence.boundsCents.max
  );
}

/**
 * Test one disposition's entry conditions (§1.2) against the evidence.
 * Entry conditions are guards: the transition function refuses a
 * disposition whose entry conditions do not hold. This function judges
 * the evidence as given; it does not fetch, recompute, or invent any.
 */
export function checkEntryConditions(
  disposition: Disposition,
  evidence: EntryCheckInput,
): EntryCheckResult {
  const failures: string[] = [];

  if (disposition === "verified") {
    if (evidence.completenessGrade !== "complete") {
      failures.push("Verified requires completeness grade Complete");
    }
    if (evidence.comparisonBasis !== "established") {
      failures.push("Verified requires an established comparison basis");
    }
    if (evidence.reconstructedBenefitCents === null) {
      failures.push("Verified requires an exact reconstructed benefit B̂_i");
    }
    if (evidence.withinTolerance !== true) {
      failures.push("Verified requires D_i within the case tolerance");
    }
    if (evidence.deltaCents === null) {
      failures.push("Verified requires a computed comparison (Δ_i)");
    }
    const unresolved = materialUnresolvedHypotheses(evidence);
    if (unresolved.length > 0) {
      failures.push(
        `Verified requires no material unexplained item; unresolved material hypotheses: ${unresolved.map((h) => h.code).join(", ")}`,
      );
    }
    if (evidence.blockingValidationOutstanding) {
      failures.push("Verified requires no validation rule that blocks calculation to be outstanding");
    }
    if (!evidence.exactSupported) {
      failures.push("Verified requires the evidence to support an exact reconstructed benefit");
    }
  }

  if (disposition === "supported-for-acceptance") {
    const partialWithoutM5 =
      evidence.completenessGrade === "partial" && !hasMissingClass(evidence, "M5");
    const completeWithNamedGround =
      evidence.completenessGrade === "complete" &&
      evidence.supportedGround !== null &&
      evidence.supportedGround.trim().length > 0;
    if (!partialWithoutM5 && !completeWithNamedGround) {
      failures.push(
        "Supported for acceptance requires grade Partial (classes M2/M3/M4 only, no class-M5 gap) or grade Complete with a reviewer-named immaterial ground",
      );
    }
    if (evidence.comparisonBasis !== "established") {
      failures.push("Supported for acceptance requires an established comparison basis");
    }
    if (!recordedInsideBounds(evidence)) {
      failures.push("Supported for acceptance requires B_i^PA inside justified bounds");
    }
    if (evidence.boundWidthMaterial && (evidence.boundWidthJustification === null || evidence.boundWidthJustification.trim().length === 0)) {
      failures.push("Supported for acceptance requires the bound width to be immaterial to the decision, or a reviewer-recorded reason why it is immaterial");
    }
    if (hasMaterialClass(evidence, "coincidence")) {
      failures.push("A hypothesis with support class coincidence never supports Supported for acceptance");
    }
    if (materialUnresolvedHypotheses(evidence).length > 0) {
      failures.push("Supported for acceptance requires every material discrepancy to have a documented explanation, or the residual uncertainty to be bounded and documented");
    }
    if (evidence.completenessGrade === "partial" && evidence.missingEvidence.length === 0) {
      failures.push("Supported for acceptance requires the missing evidence to be listed with its class and its quantified contribution to uncertainty");
    }
    if (evidence.blockingValidationOutstanding) {
      failures.push("Supported for acceptance requires no validation rule that blocks the bound computation to be outstanding");
    }
  }

  if (disposition === "requires-investigation") {
    const outsideToleranceUnexplained =
      evidence.deltaCents !== null &&
      evidence.withinTolerance === false &&
      !hasMaterialClass(evidence, "supported");
    const keyInputMissingMaterially =
      (evidence.completenessGrade === "partial" ||
        evidence.completenessGrade === "insufficient") &&
      evidence.missingEvidence.length > 0;
    const outsideBoundsAssumptionsInDoubt =
      evidence.boundsCents !== null &&
      evidence.recordedBenefitCents !== null &&
      (evidence.recordedBenefitCents < evidence.boundsCents.min ||
        evidence.recordedBenefitCents > evidence.boundsCents.max) &&
      evidence.boundAssumptionsInDoubt;
    const tiedHypotheses = evidence.conflictingCorrections;
    const flagUninvestigated = evidence.uninvestigatedFlag;
    if (
      !outsideToleranceUnexplained &&
      !keyInputMissingMaterially &&
      !outsideBoundsAssumptionsInDoubt &&
      !tiedHypotheses &&
      !flagUninvestigated
    ) {
      failures.push(
        "Requires investigation requires at least one entry condition: D_i outside tolerance with no supported explanation; a key input missing with material effect; B_i^PA outside bounds with the bound assumptions in doubt; tied hypotheses implying different corrected benefits; or an uninvestigated flag",
      );
    }
    if (evidence.nextSteps.length === 0) {
      failures.push("Requires investigation requires at least one concrete named next step (guard G-INV-3)");
    }
  }

  if (disposition === "correction-recommended") {
    if (!hasMaterialClass(evidence, "supported")) {
      failures.push("Correction recommended requires a supported hypothesis identifying the error");
    }
    if (evidence.correctedBenefitCents === null) {
      failures.push("Correction recommended requires a specific, single corrected monthly benefit");
    }
    if (evidence.conflictingCorrections) {
      failures.push("Correction recommended is unreachable while two supported hypotheses imply different corrected values");
    }
    if (!evidence.correctionReasonablyCertain) {
      failures.push("Correction recommended requires reasonable certainty about both the error and the amount (Policy 5.8-1 §D), stated by the human reviewer");
    }
    const boundsCollapseToOne =
      evidence.boundsCents !== null &&
      evidence.boundsCents.min === evidence.boundsCents.max;
    if (evidence.completenessGrade !== "complete" && !boundsCollapseToOne) {
      failures.push("Correction recommended requires grade Complete, or Partial where the bounds collapse to a single defensible value");
    }
    if (evidence.comparisonBasis !== "established") {
      failures.push("Correction recommended requires an established comparison basis");
    }
    if (evidence.correctionDirection === null) {
      failures.push("Correction recommended requires the correction's direction (increase or decrease) to be recorded");
    }
    if (
      evidence.correctedBenefitCents !== null &&
      evidence.recordedBenefitCents !== null &&
      evidence.correctedBenefitCents === evidence.recordedBenefitCents
    ) {
      failures.push("Correction recommended requires a corrected benefit different from B_i^PA");
    }
  }

  if (disposition === "indeterminate") {
    const noBenefitNoBounds =
      evidence.reconstructedBenefitCents === null && evidence.boundsCents === null;
    const basisUnresolvable =
      evidence.comparisonBasis === "unresolved" && evidence.basisUnresolvable;
    const blankNoReconstruction =
      evidence.recordedBenefitCents === null &&
      evidence.reconstructedBenefitCents === null;
    const contradictory = evidence.contradictoryEvidenceUnresolved;
    if (!noBenefitNoBounds && !basisUnresolvable && !blankNoReconstruction && !contradictory) {
      failures.push(
        "Indeterminate requires one entry condition: no B̂_i and no justifiable bounds; an unresolvable comparison basis; a blank B_i^PA with no independent reconstruction; or mutually contradictory evidence with no available resolution",
      );
    }
  }

  return { holds: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Indeterminate end conditions (§5.2) — the approval-time bar
// ---------------------------------------------------------------------------

/**
 * Whether an Indeterminate disposition may be APPROVED (§5.2). Proposing
 * Indeterminate (T1) requires only the §1.2.5 entry conditions plus the
 * G-IND-1 content and the G-IND-2 boundary; approving it requires more:
 * the missing evidence must have been SOUGHT, not merely listed — every
 * data request has been answered without resolving the gap
 * (answered-no-data / exhausted), or the reviewer records, with reasons,
 * that no further request can currently be made and no request is still
 * awaiting a response. Approving Indeterminate while a live request could
 * still resolve the case would misrepresent an open investigation as a
 * closed decision (05 §8.2 step 3).
 */
export function indeterminateApprovable(evidence: EntryCheckInput): {
  approvable: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const content = evidence.indeterminateContent;
  if (content === null) {
    return { approvable: false, reasons: ["no Indeterminate content (§5.3) is present"] };
  }
  const allAnswered = content.dataRequests.every(
    (request) =>
      request.status === "answered-no-data" || request.status === "exhausted",
  );
  const nothingAwaitingResponse = content.dataRequests.every(
    (request) => request.status !== "issued",
  );
  const noFurtherRecorded =
    content.noFurtherRequestReason !== null &&
    content.noFurtherRequestReason.trim().length > 0;
  if (!allAnswered && !(noFurtherRecorded && nothingAwaitingResponse)) {
    reasons.push(
      "§5.2: the missing evidence must have been sought — every data request answered without resolving the gap, or the reviewer records why no further request can currently be made; a live request is still awaiting a response",
    );
  }
  return { approvable: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Audit log (§6.5)
// ---------------------------------------------------------------------------

export type AuditEventKind =
  | "import"
  | "calculation-run"
  | "disposition-proposed"
  | "disposition-approved"
  | "disposition-rejected"
  | "disposition-reopened"
  | "source-update"
  | "rule-revision"
  | "data-request"
  | "data-received"
  | "valuation-use-recorded"
  | "transition-refused";

export interface AuditEvent {
  auditEventId: string;
  /** Supplied by the caller, not read by T (§6.3). */
  occurredAt: string;
  actor: "system" | Actor;
  kind: AuditEventKind;
  participantKeys: string[];
  summary: string;
  detail: {
    fromDisposition?: DispositionState;
    toDisposition?: DispositionState;
    ruleVersion?: string;
    inputSnapshotHash?: string;
    refusalReason?: string;
  };
}

export function makeAuditEvent(args: {
  auditEventId: string;
  occurredAt: string;
  actor: "system" | Actor;
  kind: AuditEventKind;
  participantKeys: string[];
  summary: string;
  detail?: AuditEvent["detail"];
}): AuditEvent {
  return {
    auditEventId: args.auditEventId,
    occurredAt: args.occurredAt,
    actor: args.actor,
    kind: args.kind,
    participantKeys: [...args.participantKeys],
    summary: args.summary,
    detail: args.detail ?? {},
  };
}

// ---------------------------------------------------------------------------
// Transition events (the disposition part of E_t, §6.2)
// ---------------------------------------------------------------------------

export type DispositionEvent =
  | {
      kind: "propose";
      actor: Actor;
      target: Disposition;
      /** A re-proposal with no change in evidence is refused as a no-op (T2). */
      evidenceChanged: boolean;
      /** Filling a missing input with zero is refused (G-INV-8). */
      fillsMissingWithZero?: boolean;
    }
  | {
      kind: "approve";
      actor: Actor;
      /** The complete determination record (§7) being approved. */
      determination: PartialDeterminationRecord;
      /** The approval record input (§4.2). */
      approval: DeterminationApprovalInput;
    }
  | {
      kind: "reject";
      actor: Actor;
      rationale: string;
      replacement?: Disposition;
    }
  | {
      kind: "reopen";
      actor: Actor;
      reason: string;
      replacement?: Disposition;
    }
  | {
      kind: "source-update";
      actor: Actor;
      updateKind: "source-corrected" | "source-reimported" | "document-added";
      newSnapshotHash: string;
      affectedParticipantKeys: string[];
      /** The re-computation's proposal; defaults to the current disposition. */
      proposedTarget?: Disposition;
      /** G-INV-1: the update rewrites the snapshot in place. */
      mutatesSnapshotInPlace?: boolean;
      /** G-INV-1: a correction presented without its original. */
      correctionWithoutOriginal?: boolean;
    }
  | {
      kind: "rule-revision";
      actor: Actor;
      revisionKind:
        | "tolerance-revised"
        | "formula-version-revised"
        | "validation-rule-revised"
        | "disposition-schema-revised";
      newRuleVersion: string;
      changeNote: string;
      affectedParticipantKeys: string[];
      /** The re-computation's proposal; defaults to the current disposition. */
      proposedTarget?: Disposition;
    }
  | {
      kind: "investigation-completed";
      actor: Actor;
      target: Disposition;
      /** Which next step was completed and what it showed. */
      outcome: string;
    }
  | {
      kind: "new-evidence";
      actor: Actor;
      target: Disposition;
      /** Indeterminate is terminal on the same evidence: re-arguing old
       *  evidence is not a transition out (§5.1). */
      evidenceIsNew: boolean;
      description: string;
    }
  | {
      kind: "record-valuation-use";
      actor: Actor;
      useReference: string;
    };

export interface TransitionContext {
  participantKey: string;
  caseId: string;
  /** The evidence the entry conditions and guards read. */
  evidence: EntryCheckInput;
  /** Current input snapshot hash (for the G-INV-2 approval re-check). */
  inputSnapshotHash: string;
  /** Current rule version (for the G-INV-2 approval re-check). */
  ruleVersion: string;
  /** Caller-supplied timestamp (the core never reads a clock). */
  occurredAt: string;
  /** Caller-supplied id for the new disposition record. */
  newDispositionId: string;
  /** Caller-supplied id for the audit event this transition appends. */
  auditEventId: string;
  /** CalculationRun the new record rests on, if any. */
  calculationRunId: CalculationRun["runId"] | null;
  /** Previous approval's id, when re-approving after a re-opening. */
  previousApprovalId?: string | null;
}

export type DecisionOutcome =
  | {
      outcome: "applied";
      transitionId: TransitionId;
      /** False for T11 (audit event only, no disposition change). */
      dispositionChanged: boolean;
      /** Null when T4 returns the participant to unassessed. */
      record: DispositionRecord | null;
      /** The previous record, with status "superseded"; null from unassessed. */
      superseded: DispositionRecord | null;
      auditEvent: AuditEvent;
      /** Set by T3; null otherwise. */
      approvalRecord: ApprovalRecord | null;
      /** The approved determination, with approvalId set; null otherwise. */
      determination: DeterminationRecord | null;
    }
  | {
      outcome: "refused";
      /** The row the attempt belonged to, when identifiable; null otherwise. */
      transitionId: TransitionId | null;
      guard: GuardId;
      reason: string;
      /** T12: the refusal is itself the audit event. */
      auditEvent: AuditEvent;
    };

// ---------------------------------------------------------------------------
// Guards (§6.6, §6.7)
// ---------------------------------------------------------------------------

interface GuardFailure {
  guard: GuardId;
  reason: string;
}

interface GuardAttempt {
  current: DispositionRecord | null;
  event: DispositionEvent;
  evidence: EntryCheckInput;
  participantKey: string;
  target: Disposition | null;
  currentSnapshotHash: string;
  currentRuleVersion: string;
}

function guardInv1(attempt: GuardAttempt): GuardFailure | null {
  if (attempt.event.kind === "source-update") {
    if (attempt.event.mutatesSnapshotInPlace === true) {
      return {
        guard: "G-INV-1",
        reason: "the source update would write to the immutable input snapshot in place",
      };
    }
    if (attempt.event.correctionWithoutOriginal === true) {
      return {
        guard: "G-INV-1",
        reason: "the correction is presented without its original value",
      };
    }
  }
  return null;
}

function guardInv2(attempt: GuardAttempt): GuardFailure | null {
  if (attempt.event.kind === "approve") {
    const snapshot = attempt.event.approval.evidenceSnapshot;
    if (snapshot.inputSnapshotHash !== attempt.currentSnapshotHash) {
      return {
        guard: "G-INV-2",
        reason: "the approval's frozen evidence snapshot no longer matches the current input snapshot — re-proposal and re-approval are required",
      };
    }
    if (snapshot.ruleVersion !== attempt.currentRuleVersion) {
      return {
        guard: "G-INV-2",
        reason: "the approval's frozen evidence snapshot no longer matches the current rule version — re-proposal and re-approval are required",
      };
    }
  }
  if (attempt.event.kind === "source-update") {
    if (attempt.event.newSnapshotHash.trim().length === 0) {
      return { guard: "G-INV-2", reason: "the source update names no new input snapshot hash" };
    }
    if (attempt.event.newSnapshotHash === attempt.currentSnapshotHash) {
      return {
        guard: "G-INV-2",
        reason: "the source update names no new snapshot (hash unchanged) — there is nothing to re-propose on",
      };
    }
  }
  if (attempt.event.kind === "rule-revision") {
    if (attempt.event.newRuleVersion.trim().length === 0) {
      return { guard: "G-INV-2", reason: "the rule revision names no new rule version" };
    }
  }
  return null;
}

function guardInv3(attempt: GuardAttempt): GuardFailure | null {
  const { evidence, target } = attempt;
  if (
    target !== null &&
    (target === "verified" ||
      target === "supported-for-acceptance" ||
      target === "correction-recommended") &&
    evidence.comparisonBasis === "unresolved"
  ) {
    return {
      guard: "G-INV-3",
      reason: `${target} requires an established comparison basis, but the basis is unresolved`,
    };
  }
  if (evidence.comparisonBasis === "unresolved" && evidence.deltaCents !== null) {
    return {
      guard: "G-INV-3",
      reason: "a Δ is recorded while the comparison basis is unresolved — no Δ exists across non-equivalent bases",
    };
  }
  if (target === "requires-investigation" && evidence.nextSteps.length === 0) {
    return {
      guard: "G-INV-3",
      reason: "a Requires investigation record naming no next step is incomplete",
    };
  }
  return null;
}

function guardInv4(attempt: GuardAttempt): GuardFailure | null {
  if (!attempt.evidence.ruleApplicabilityOk) {
    return {
      guard: "G-INV-4",
      reason: "a rule would be applied outside its applicability predicate",
    };
  }
  return null;
}

function guardInv5(attempt: GuardAttempt): GuardFailure | null {
  const { evidence, target } = attempt;
  if (
    evidence.statisticalOnly &&
    target !== null &&
    (target === "verified" ||
      target === "supported-for-acceptance" ||
      target === "correction-recommended")
  ) {
    return {
      guard: "G-INV-5",
      reason: "the disposition would rest on a statistical output alone — unverified statistical results cannot become approved participant benefits",
    };
  }
  return null;
}

function guardInv6(attempt: GuardAttempt): GuardFailure | null {
  if (attempt.event.kind === "source-update" || attempt.event.kind === "rule-revision") {
    const affected = attempt.event.affectedParticipantKeys;
    if (!Array.isArray(affected) || affected.length === 0) {
      return {
        guard: "G-INV-6",
        reason: "the event cannot name its affected participant set",
      };
    }
    if (!affected.includes(attempt.participantKey)) {
      return {
        guard: "G-INV-6",
        reason: "the participant is outside the event's computed affected set and must not be altered by it",
      };
    }
  }
  return null;
}

function guardInv7(attempt: GuardAttempt): GuardFailure | null {
  if (attempt.event.kind === "approve") {
    const completeness = checkDeterminationCompleteness(attempt.event.determination);
    if (!completeness.complete) {
      const first = completeness.missingItems[0];
      const detail =
        first === undefined
          ? "determination record is incomplete"
          : `§14 item ${first.item} (${first.label}) incomplete: ${first.reason}`;
      return {
        guard: "G-INV-7",
        reason: `approval refused — ${detail}`,
      };
    }
  }
  return null;
}

function guardInv8(attempt: GuardAttempt): GuardFailure | null {
  const { evidence, target } = attempt;
  if (
    target !== null &&
    (target === "verified" || target === "correction-recommended") &&
    evidence.reconstructedBenefitCents !== null &&
    !evidence.exactSupported
  ) {
    return {
      guard: "G-INV-8",
      reason: "an exact reconstructed benefit would be stored where the evidence supports only bounds",
    };
  }
  if (attempt.event.kind === "propose" && attempt.event.fillsMissingWithZero === true) {
    return {
      guard: "G-INV-8",
      reason: "a missing input would be filled with zero — blanks are missing data, never zero",
    };
  }
  return null;
}

// G-INV-9 is a run/case-level guard, not a per-transition guard: it is
// enforced by checkRunCompleteness / checkCaseClosure and by
// applyCaseEvent on finish-run / close-case events. It has no per-row
// check here; the catalogue entry documents it.

function guardInd1(attempt: GuardAttempt): GuardFailure | null {
  if (attempt.target !== "indeterminate") return null;
  const content = attempt.evidence.indeterminateContent;
  if (content === null) {
    return { guard: "G-IND-1", reason: "an Indeterminate transition carries no §5.3 content" };
  }
  if (content.justifiedBoundsCents === null) {
    if (content.noBoundsReason === null || content.noBoundsReason.trim().length === 0) {
      return {
        guard: "G-IND-1",
        reason: "no justified bounds exist and no no-bounds reason is stated — a null bound is never silent",
      };
    }
  }
  if (content.missingEvidence.length === 0) {
    return { guard: "G-IND-1", reason: "an Indeterminate transition names no missing evidence" };
  }
  if (content.dataRequests.length === 0) {
    return { guard: "G-IND-1", reason: "an Indeterminate transition names no data requests" };
  }
  if (content.indeterminateRationale.trim().length === 0) {
    return {
      guard: "G-IND-1",
      reason: "an Indeterminate transition states no rationale for why this is Indeterminate and not Requires investigation",
    };
  }
  return null;
}

function guardInd2(attempt: GuardAttempt): GuardFailure | null {
  if (attempt.target !== "indeterminate") return null;
  const content = attempt.evidence.indeterminateContent;
  if (content === null) return null; // G-IND-1 already reports this.
  const allNotIssued =
    content.dataRequests.length > 0 &&
    content.dataRequests.every((request) => request.status === "not-issued");
  const noReason =
    content.noFurtherRequestReason === null ||
    content.noFurtherRequestReason.trim().length === 0;
  if (allNotIssued && noReason) {
    return {
      guard: "G-IND-2",
      reason: "all data requests are still not-issued with no recorded reason why no request can be made — that participant is Requires investigation, not Indeterminate",
    };
  }
  return null;
}

/** Run the guards in catalogue order; the first failure stops the transition. */
function runGuards(attempt: GuardAttempt): GuardFailure | null {
  const guards: Array<(attempt: GuardAttempt) => GuardFailure | null> = [
    guardInv1,
    guardInv2,
    guardInv3,
    guardInv4,
    guardInv5,
    guardInv6,
    guardInv7,
    guardInv8,
    guardInd1,
    guardInd2,
  ];
  for (const guard of guards) {
    const failure = guard(attempt);
    if (failure !== null) return failure;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The transition function T (disposition part of §17)
// ---------------------------------------------------------------------------

function isHuman(actor: Actor): boolean {
  return actor.trim().length > 0 && actor !== "system";
}

function supersede(record: DispositionRecord): DispositionRecord {
  return { ...record, status: "superseded" };
}

function stateOf(record: DispositionRecord | null): DispositionState {
  return record === null ? "unassessed" : record.disposition;
}

/**
 * Identify the transition-table row (05 §3.1) for a (current, event)
 * pair, or null when no row covers it. Indeterminate is terminal on the
 * same evidence: from Indeterminate, only T10 (new evidence) and T5/T6
 * (human re-opening) are rows; a propose of another disposition is not a
 * row at all.
 */
export function identifyTransition(
  current: DispositionRecord | null,
  event: DispositionEvent,
): TransitionId | null {
  switch (event.kind) {
    case "propose":
      if (current === null) return "T1";
      // Indeterminate is terminal on the same evidence (§5.1): the only
      // transitions out are T10 (new evidence) and T5/T6 (human
      // re-opening). A propose of another disposition from Indeterminate
      // is not a row at all — it is refused as transition-not-allowed.
      if (current.disposition === "indeterminate") return null;
      if (current.status === "recommended") return "T2";
      return null;
    case "approve":
      return current !== null && current.status === "recommended" ? "T3" : null;
    case "reject":
      return current !== null && current.status === "recommended" ? "T4" : null;
    case "reopen":
      return current !== null && current.status === "approved"
        ? event.replacement === undefined
          ? "T5"
          : "T6"
        : null;
    case "source-update":
      return current !== null ? "T7" : null;
    case "rule-revision":
      return current !== null ? "T8" : null;
    case "investigation-completed":
      return current !== null && current.disposition === "requires-investigation" ? "T9" : null;
    case "new-evidence":
      return current !== null && current.disposition === "indeterminate" ? "T10" : null;
    case "record-valuation-use":
      return current !== null &&
        current.status === "approved" &&
        (current.disposition === "verified" ||
          current.disposition === "supported-for-acceptance" ||
          current.disposition === "correction-recommended")
        ? "T11"
        : null;
  }
}

/** The target disposition a row proposes, or null when the row proposes none. */
function targetOf(
  current: DispositionRecord | null,
  event: DispositionEvent,
): Disposition | null {
  switch (event.kind) {
    case "propose":
      return event.target;
    case "approve":
      return current === null ? null : current.disposition;
    case "reject":
      return event.replacement ?? null;
    case "reopen":
      return event.replacement ?? (current === null ? null : current.disposition);
    case "source-update":
    case "rule-revision":
      return event.proposedTarget ?? (current === null ? null : current.disposition);
    case "investigation-completed":
    case "new-evidence":
      return event.target;
    case "record-valuation-use":
      return null;
  }
}

function buildRecord(args: {
  ctx: TransitionContext;
  disposition: Disposition;
  status: DispositionStatus;
  current: DispositionRecord | null;
  inputSnapshotHash: string;
  ruleVersion: string;
  determinationId: string | null;
  /** Who created this record: the proposing actor, or the approving
   *  human reviewer for T3. The system never creates an approved record. */
  createdBy: Actor;
}): DispositionRecord {
  const { ctx, disposition, status, current } = args;
  const evidence: EvidenceState = {
    completenessGrade: ctx.evidence.completenessGrade,
    comparisonBasis: ctx.evidence.comparisonBasis,
    reconstructedBenefitCents: ctx.evidence.reconstructedBenefitCents,
    boundsCents: ctx.evidence.boundsCents,
    deltaCents: ctx.evidence.deltaCents,
    withinTolerance: ctx.evidence.withinTolerance,
    toleranceSetId: ctx.evidence.toleranceSetId,
  };
  return {
    dispositionId: ctx.newDispositionId,
    schemaVersion: DISPOSITION_SCHEMA_VERSION,
    participantKey: ctx.participantKey,
    caseId: ctx.caseId,
    disposition,
    status,
    evidenceState: evidence,
    downstreamUse: downstreamUseFor(
      disposition,
      status,
      ctx.evidence.recordedBenefitCents,
      ctx.evidence.correctedBenefitCents,
    ),
    determinationId: args.determinationId,
    version: (current === null ? 0 : current.version) + 1,
    supersedesId: current === null ? null : current.dispositionId,
    createdBy: args.createdBy,
    /** ISO date-time of the transition (audit clock, not calculation input). */
    createdAt: ctx.occurredAt,
    inputSnapshotHash: args.inputSnapshotHash,
    ruleVersion: args.ruleVersion,
    calculationRunId: ctx.calculationRunId,
    auditEventId: ctx.auditEventId,
  };
}

function refusedOutcome(
  ctx: TransitionContext,
  current: DispositionRecord | null,
  event: DispositionEvent,
  transitionId: TransitionId | null,
  guard: GuardId,
  reason: string,
): DecisionOutcome {
  return {
    outcome: "refused",
    transitionId,
    guard,
    reason,
    auditEvent: makeAuditEvent({
      auditEventId: ctx.auditEventId,
      occurredAt: ctx.occurredAt,
      actor: eventActor(event),
      kind: "transition-refused",
      participantKeys: [ctx.participantKey],
      summary: `Transition ${transitionId ?? "unidentified"} refused (${guard}): ${reason}`,
      detail: {
        fromDisposition: stateOf(current),
        refusalReason: `${guard}: ${reason}`,
      },
    }),
  };
}

function eventActor(event: DispositionEvent): Actor {
  return event.actor;
}

function auditKindFor(transitionId: TransitionId): AuditEventKind {
  switch (transitionId) {
    case "T1":
    case "T2":
      return "disposition-proposed";
    case "T3":
      return "disposition-approved";
    case "T4":
      return "disposition-rejected";
    case "T5":
    case "T6":
      return "disposition-reopened";
    case "T7":
      return "source-update";
    case "T8":
      return "rule-revision";
    case "T9":
    case "T10":
      return "disposition-proposed";
    case "T11":
      return "valuation-use-recorded";
    case "T12":
      return "transition-refused";
  }
}

/**
 * The disposition transition function: S_{t+1} = T(S_t, E_t) for one
 * participant's disposition (05 §3.1, §6.3). Pure: the current record is
 * never mutated; an applied transition returns a new record and the
 * previous record superseded; a refused transition returns the prior
 * analytic state unchanged plus a T12 refusal audit event. Refusal is
 * part of T, not an exception to it — this function never throws for a
 * disallowed transition.
 */
export function transition(
  current: DispositionRecord | null,
  event: DispositionEvent,
  ctx: TransitionContext,
): DecisionOutcome {
  const evidence = ctx.evidence;
  const transitionId = identifyTransition(current, event);
  const from = stateOf(current);

  if (transitionId === null) {
    return refusedOutcome(
      ctx,
      current,
      event,
      null,
      "transition-not-allowed",
      `no transition-table row covers ${event.kind} from ${from}${current === null ? "" : ` (${current.status})`}`,
    );
  }

  // T11 is an audit event on the disposition, not a transition (§3.1):
  // it changes nothing, and needs no entry-condition check.
  if (transitionId === "T11" && current !== null) {
    return {
      outcome: "applied",
      transitionId: "T11",
      dispositionChanged: false,
      record: current,
      superseded: null,
      auditEvent: makeAuditEvent({
        auditEventId: ctx.auditEventId,
        occurredAt: ctx.occurredAt,
        actor: event.actor,
        kind: "valuation-use-recorded",
        participantKeys: [ctx.participantKey],
        summary: `Valuation use recorded for ${current.disposition} (approved ${current.dispositionId})${event.kind === "record-valuation-use" ? `; ref ${event.useReference}` : ""}.`,
        detail: { fromDisposition: from, toDisposition: from },
      }),
      approvalRecord: null,
      determination: null,
    };
  }

  const target = targetOf(current, event);
  const guardFailure = runGuards({
    current,
    event,
    evidence,
    participantKey: ctx.participantKey,
    target,
    currentSnapshotHash: ctx.inputSnapshotHash,
    currentRuleVersion: ctx.ruleVersion,
  });
  if (guardFailure !== null) {
    return refusedOutcome(ctx, current, event, transitionId, guardFailure.guard, guardFailure.reason);
  }

  // Row-specific checks (actor rules, entry conditions, terminal rules).
  if (transitionId === "T2" && event.kind === "propose" && !event.evidenceChanged) {
    return refusedOutcome(
      ctx, current, event, transitionId, "transition-not-allowed",
      "a re-proposal with no change in evidence is refused as a no-op — it would create history without content",
    );
  }

  if (
    (transitionId === "T3" || transitionId === "T4" || transitionId === "T5" || transitionId === "T6") &&
    !isHuman(event.actor)
  ) {
    return refusedOutcome(
      ctx, current, event, transitionId, "human-gate",
      "only an authorized human reviewer may approve, reject, or re-open a disposition — the system may only recommend",
    );
  }

  if (transitionId === "T3" && event.kind === "approve" && current !== null) {
    // Entry conditions re-checked at approval time, not assumed from
    // proposal time (§4.2). The determination gate itself is
    // approveDetermination (G-INV-7 already ran in the guards).
    const entry = checkEntryConditions(current.disposition, evidence);
    if (!entry.holds) {
      return refusedOutcome(
        ctx, current, event, transitionId, "entry-conditions",
        `entry conditions no longer hold on the current snapshot: ${entry.failures.join("; ")}`,
      );
    }
    if (current.disposition === "indeterminate") {
      const approvable = indeterminateApprovable(evidence);
      if (!approvable.approvable) {
        return refusedOutcome(
          ctx, current, event, transitionId, "G-IND-2",
          approvable.reasons.join("; "),
        );
      }
    }
    // Stage 7 Compliance D3: an approval approves the CURRENT
    // disposition and attaches the determination for that disposition.
    // A determination whose humanDetermination (or whose recorded
    // recommendation) names a different disposition is refused: the
    // audit trail must never hold an approved requires-investigation
    // carrying a "verified" determination. A reviewer who wants a
    // different disposition rejects or re-proposes; approval is not
    // the path to change it.
    const detHumanDisposition = event.determination.humanDetermination?.disposition;
    if (detHumanDisposition !== undefined && detHumanDisposition !== current.disposition) {
      return refusedOutcome(
        ctx, current, event, transitionId, "entry-conditions",
        `the determination's humanDetermination says ${detHumanDisposition} but the disposition being approved is ${current.disposition} — an approval must attach the determination for the disposition it approves`,
      );
    }
    const detRecommendedDisposition = event.determination.recommendedDisposition?.disposition;
    if (detRecommendedDisposition !== undefined && detRecommendedDisposition !== current.disposition) {
      return refusedOutcome(
        ctx, current, event, transitionId, "entry-conditions",
        `the determination's recommendedDisposition says ${detRecommendedDisposition} but the disposition being approved is ${current.disposition} — an approval must attach the determination for the disposition it approves`,
      );
    }
    if (event.approval.reviewer.trim() !== event.determination.humanDetermination?.reviewer?.trim()) {
      return refusedOutcome(
        ctx, current, event, transitionId, "human-gate",
        "the approver must be the reviewer named in the determination",
      );
    }
    const approved = approveDetermination(event.determination, event.approval);
    if (!approved.approved) {
      return refusedOutcome(
        ctx, current, event, transitionId, "G-INV-7",
        `determination approval refused: ${approved.reasons.join("; ")}`,
      );
    }
    const determination = approved.record;
    const approvalRecord: ApprovalRecord = {
      approvalId: event.approval.approvalId,
      dispositionId: current.dispositionId,
      determinationId: determination.determinationId,
      reviewer: event.approval.reviewer,
      reviewerRole: event.approval.reviewerRole,
      approvalDate: event.approval.approvalDate,
      rationale: event.approval.rationale,
      evidenceSnapshot: event.approval.evidenceSnapshot,
      confirmations: { ...event.approval.confirmations },
      supersedesApprovalId: ctx.previousApprovalId ?? null,
    };
    const record = buildRecord({
      ctx,
      disposition: current.disposition,
      status: "approved",
      current,
      inputSnapshotHash: ctx.inputSnapshotHash,
      ruleVersion: ctx.ruleVersion,
      determinationId: determination.determinationId,
      createdBy: event.approval.reviewer,
    });
    return {
      outcome: "applied",
      transitionId: "T3",
      dispositionChanged: false,
      record,
      superseded: supersede(current),
      auditEvent: makeAuditEvent({
        auditEventId: ctx.auditEventId,
        occurredAt: ctx.occurredAt,
        actor: event.actor,
        kind: "disposition-approved",
        participantKeys: [ctx.participantKey],
        summary: `Disposition ${current.disposition} approved by ${event.approval.reviewer}.`,
        detail: {
          fromDisposition: from,
          toDisposition: current.disposition,
          inputSnapshotHash: ctx.inputSnapshotHash,
          ruleVersion: ctx.ruleVersion,
        },
      }),
      approvalRecord,
      determination,
    };
  }

  if (transitionId === "T4" && event.kind === "reject") {
    if (!isSubstantiveRationale(event.rationale)) {
      return refusedOutcome(
        ctx, current, event, transitionId, "human-gate",
        'rejecting a recommendation requires a reviewer rationale; "agreed" without a reason is not a rationale',
      );
    }
    if (event.replacement === undefined) {
      if (evidence.hasEvidenceState) {
        return refusedOutcome(
          ctx, current, event, transitionId, "transition-not-allowed",
          "rejecting without a replacement returns the participant to unassessed only if no evidence state exists yet; a participant with an evidence state must not be left without a proposed disposition",
        );
      }
      return {
        outcome: "applied",
        transitionId: "T4",
        dispositionChanged: true,
        record: null,
        superseded: current === null ? null : supersede(current),
        auditEvent: makeAuditEvent({
          auditEventId: ctx.auditEventId,
          occurredAt: ctx.occurredAt,
          actor: event.actor,
          kind: "disposition-rejected",
          participantKeys: [ctx.participantKey],
          summary: `Recommendation rejected by ${event.actor}; participant returned to unassessed (no evidence state yet).`,
          detail: { fromDisposition: from, toDisposition: "unassessed" },
        }),
        approvalRecord: null,
        determination: null,
      };
    }
    const entry = checkEntryConditions(event.replacement, evidence);
    if (!entry.holds) {
      return refusedOutcome(
        ctx, current, event, transitionId, "entry-conditions",
        `replacement disposition ${event.replacement} entry conditions do not hold: ${entry.failures.join("; ")}`,
      );
    }
    const record = buildRecord({
      ctx,
      disposition: event.replacement,
      status: "recommended",
      current,
      inputSnapshotHash: ctx.inputSnapshotHash,
      ruleVersion: ctx.ruleVersion,
      determinationId: null,
      createdBy: event.actor,
    });
    return {
      outcome: "applied",
      transitionId: "T4",
      dispositionChanged: true,
      record,
      superseded: current === null ? null : supersede(current),
      auditEvent: makeAuditEvent({
        auditEventId: ctx.auditEventId,
        occurredAt: ctx.occurredAt,
        actor: event.actor,
        kind: "disposition-rejected",
        participantKeys: [ctx.participantKey],
        summary: `Recommendation rejected by ${event.actor}; replacement ${event.replacement} proposed.`,
        detail: { fromDisposition: from, toDisposition: event.replacement },
      }),
      approvalRecord: null,
      determination: null,
    };
  }

  if ((transitionId === "T5" || transitionId === "T6") && event.kind === "reopen") {
    if (!isSubstantiveRationale(event.reason)) {
      return refusedOutcome(
        ctx, current, event, transitionId, "human-gate",
        "re-opening an approved disposition requires a stated reason (new evidence, a source correction, a rule/tolerance revision, or a discovered error)",
      );
    }
    const disposition =
      event.replacement ?? (current === null ? null : current.disposition);
    if (disposition === null) {
      return refusedOutcome(
        ctx, current, event, transitionId, "transition-not-allowed",
        "re-opening requires a current disposition to re-open",
      );
    }
    const entry = checkEntryConditions(disposition, evidence);
    if (!entry.holds) {
      return refusedOutcome(
        ctx, current, event, transitionId, "entry-conditions",
        `re-opened disposition ${disposition} entry conditions do not hold: ${entry.failures.join("; ")}`,
      );
    }
    const record = buildRecord({
      ctx,
      disposition,
      status: "recommended",
      current,
      inputSnapshotHash: ctx.inputSnapshotHash,
      ruleVersion: ctx.ruleVersion,
      determinationId: null,
      createdBy: event.actor,
    });
    return {
      outcome: "applied",
      transitionId,
      dispositionChanged: disposition !== (current === null ? null : current.disposition),
      record,
      superseded: current === null ? null : supersede(current),
      auditEvent: makeAuditEvent({
        auditEventId: ctx.auditEventId,
        occurredAt: ctx.occurredAt,
        actor: event.actor,
        kind: "disposition-reopened",
        participantKeys: [ctx.participantKey],
        summary: `Approved disposition re-opened by ${event.actor}: ${event.reason}`,
        detail: { fromDisposition: from, toDisposition: disposition },
      }),
      approvalRecord: null,
      determination: null,
    };
  }

  if (
    (transitionId === "T7" || transitionId === "T8") &&
    (event.kind === "source-update" || event.kind === "rule-revision")
  ) {
    // §3.2: the previous disposition is not silently carried forward. It
    // is re-proposed (same or different) and must be re-approved; the
    // previous approved record becomes superseded only when the new
    // recommendation is created — which is this transition, atomically.
    const disposition = target;
    if (disposition === null || current === null) {
      return refusedOutcome(
        ctx, current, event, transitionId, "transition-not-allowed",
        "a source update or rule revision requires a current disposition to re-propose",
      );
    }
    const entry = checkEntryConditions(disposition, evidence);
    if (!entry.holds) {
      return refusedOutcome(
        ctx, current, event, transitionId, "entry-conditions",
        `re-proposed disposition ${disposition} entry conditions do not hold on the new evidence: ${entry.failures.join("; ")}`,
      );
    }
    const record = buildRecord({
      ctx,
      disposition,
      status: "recommended",
      current,
      inputSnapshotHash:
        event.kind === "source-update" ? event.newSnapshotHash : ctx.inputSnapshotHash,
      ruleVersion:
        event.kind === "rule-revision" ? event.newRuleVersion : ctx.ruleVersion,
      determinationId: null,
      createdBy: "system",
    });
    const summary =
      event.kind === "source-update"
        ? `Source update (${event.updateKind}) re-proposed ${disposition} as recommended; re-approval required.`
        : `Rule revision (${event.revisionKind}: ${event.changeNote}) re-proposed ${disposition} as recommended; re-approval required.`;
    return {
      outcome: "applied",
      transitionId,
      dispositionChanged: disposition !== current.disposition,
      record,
      superseded: supersede(current),
      auditEvent: makeAuditEvent({
        auditEventId: ctx.auditEventId,
        occurredAt: ctx.occurredAt,
        actor: "system",
        kind: auditKindFor(transitionId),
        participantKeys: [ctx.participantKey],
        summary,
        detail: {
          fromDisposition: from,
          toDisposition: disposition,
          inputSnapshotHash:
            event.kind === "source-update" ? event.newSnapshotHash : ctx.inputSnapshotHash,
          ruleVersion:
            event.kind === "rule-revision" ? event.newRuleVersion : ctx.ruleVersion,
        },
      }),
      approvalRecord: null,
      determination: null,
    };
  }

  if (transitionId === "T10" && event.kind === "new-evidence") {
    // Indeterminate is terminal for the analysis as it stands (§5.1):
    // re-arguing the same evidence is not a transition out.
    if (!event.evidenceIsNew) {
      return refusedOutcome(
        ctx, current, event, transitionId, "indeterminate-terminal",
        "Indeterminate is terminal on the same evidence — it is re-opened only by new evidence, never by re-arguing the old evidence",
      );
    }
  }

  // Remaining proposing rows: T1, T2, T9, T10. Each needs the target's
  // entry conditions to hold on the (new) evidence.
  if (target !== null) {
    const entry = checkEntryConditions(target, evidence);
    if (!entry.holds) {
      return refusedOutcome(
        ctx, current, event, transitionId, "entry-conditions",
        `disposition ${target} entry conditions do not hold: ${entry.failures.join("; ")}`,
      );
    }
    const record = buildRecord({
      ctx,
      disposition: target,
      status: "recommended",
      current,
      inputSnapshotHash: ctx.inputSnapshotHash,
      ruleVersion: ctx.ruleVersion,
      determinationId: null,
      createdBy: event.actor,
    });
    const kind =
      transitionId === "T9" || transitionId === "T10"
        ? "disposition-proposed"
        : auditKindFor(transitionId);
    return {
      outcome: "applied",
      transitionId,
      dispositionChanged: target !== (current === null ? null : current.disposition),
      record,
      superseded: current === null ? null : supersede(current),
      auditEvent: makeAuditEvent({
        auditEventId: ctx.auditEventId,
        occurredAt: ctx.occurredAt,
        actor: event.actor,
        kind,
        participantKeys: [ctx.participantKey],
        summary:
          transitionId === "T1"
            ? `Disposition ${target} proposed (recommended).`
            : transitionId === "T2"
              ? `Disposition ${target} re-proposed (recommended) on changed evidence.`
              : transitionId === "T9"
                ? `Investigation step completed (${event.kind === "investigation-completed" ? event.outcome : ""}); ${target} proposed (recommended).`
                : `New evidence received (${event.kind === "new-evidence" ? event.description : ""}); ${target} proposed (recommended).`,
        detail: { fromDisposition: from, toDisposition: target },
      }),
      approvalRecord: null,
      determination: null,
    };
  }

  return refusedOutcome(
    ctx, current, event, transitionId, "transition-not-allowed",
    `row ${transitionId} proposes no disposition for this event`,
  );
}

// ---------------------------------------------------------------------------
// Run / case completeness — Invariant 9 and the case-closure rule (§1.5)
// ---------------------------------------------------------------------------

export interface ParticipantCompletenessInput {
  participantKey: string;
  completenessGrade: CompletenessGrade;
  /** At least one of: an exact B̂_i with its trace; justified bounds
   *  with stated assumptions; an explicit statement that no justified
   *  bound exists, with the reason (Invariant 9 output obligation). */
  hasCalculationOrBoundsOrNoBoundsStatement: boolean;
  /** The current disposition record; null = unassessed. */
  disposition: DispositionRecord | null;
}

export interface RunCompleteness {
  complete: boolean;
  /** Participants (in-scope) and the pieces they lack, named. */
  missing: Array<{ participantKey: string; missing: string[] }>;
  /** Recommended-but-unapproved dispositions: unfinished business that
   *  the case report must show, not hidden (§1.5). */
  unapprovedRecommended: string[];
}

/**
 * Invariant 9 (output obligation) + the case-closure rule (§1.5): for
 * every in-scope participant (RETSTAT 5 records are graded `excluded`
 * and are out of scope), a finished run must contain a calculation,
 * justified bounds, or an explicit no-bounds statement, together with
 * exactly one disposition. A case cannot close while any in-scope
 * participant is unassessed. It CAN close with participants in Requires
 * investigation or Indeterminate — those are documented decisions — and
 * with recommended (unapproved) dispositions, which are reported as
 * unfinished business (OD-6 leaves whether that is the right closure
 * rule open; this function reports, it does not decide).
 */
export function checkRunCompleteness(
  participants: readonly ParticipantCompletenessInput[],
): RunCompleteness {
  const missing: RunCompleteness["missing"] = [];
  const unapprovedRecommended: string[] = [];
  for (const participant of participants) {
    if (participant.completenessGrade === "excluded") continue;
    const lacking: string[] = [];
    if (!participant.hasCalculationOrBoundsOrNoBoundsStatement) {
      lacking.push("calculation, justified bounds, or an explicit no-bounds statement");
    }
    if (participant.disposition === null) {
      lacking.push("disposition (unassessed)");
    } else if (participant.disposition.status === "recommended") {
      unapprovedRecommended.push(participant.participantKey);
    }
    if (lacking.length > 0) {
      missing.push({ participantKey: participant.participantKey, missing: lacking });
    }
  }
  return { complete: missing.length === 0, missing, unapprovedRecommended };
}

// ---------------------------------------------------------------------------
// The §17 case-analysis state S_t and the transformation T
// ---------------------------------------------------------------------------

/** Per-participant analysis inside S_t (05 §6.1). */
export interface ParticipantAnalysis {
  participantKey: string;
  benefitObservation: BenefitObservation | null;
  benefitCalculation: BenefitCalculation | null;
  /** Justified bounds in integer cents; null when none justifiable. */
  bounds: { minCents: number; maxCents: number } | null;
  benefitComparison: BenefitComparison | null;
  /** Ranked, with support class (03 §2.6). */
  hypotheses: DiagnosticHypothesis[];
  completenessGrade: CompletenessGrade;
  /** Null = unassessed. */
  disposition: DispositionRecord | null;
  dataRequests: DeterminationDataRequest[];
  /** The evidence the entry conditions and guards read; null until a
   *  calculation/bounds run has produced an evidence state. */
  evidence: EntryCheckInput | null;
}

/** The case-analysis state S_t (05 §6.1). */
export interface CaseAnalysisState {
  stateVersion: string;
  caseId: string;
  /** Immutable input snapshot: imported source values + provenance.
   *  Never mutated (§6.1, Invariant 1). Corrections create new versions
   *  that reference the original; the snapshot hash here is the CURRENT
   *  version's hash, and the audit log records every prior hash. */
  inputSnapshot: {
    snapshotHash: string;
    sourceDocuments: SourceDocument[];
    importedValues: unknown;
  };
  /** Plan provisions P(t): effective-dated provisions, amendments,
   *  freezes, grandfathering. */
  planProvisions: PlanVersion[];
  /** Rule and tolerance versions in force for this state. */
  ruleVersions: {
    validationRules: string;
    formulaTaxonomy: string;
    dispositionSchema: string;
    toleranceSetId: string;
  };
  /** Per-participant analysis. One entry per in-scope participant. */
  participants: Record<string, ParticipantAnalysis>;
  /** The audit log: append-only. Every transition appends an event. */
  auditLog: AuditEvent[];
  /** Advisory work-list entries from statistical screens. Advisory only:
   *  statistics never write a benefit or a disposition (Invariant 5). */
  advisoryWorkList: Array<{
    participantKey: string;
    note: string;
    occurredAt: string;
  }>;
  /** UI / workflow position: wizard step, filters, drill-down selection. */
  workflow: {
    currentStep: string;
    selectedParticipantKey: string | null;
  };
}

export type UserAction =
  | "import-case"
  | "map-fields"
  | "enter-provision"
  | "enter-exception"
  | "run-calculation"
  | "propose-disposition"
  | "approve-disposition"
  | "reject-recommendation"
  | "reopen-disposition"
  | "record-data-request"
  | "record-data-received"
  | "record-valuation-use";

export type SourceUpdateKind = "source-corrected" | "source-reimported" | "document-added";

export type RuleRevisionKind =
  | "tolerance-revised"
  | "formula-version-revised"
  | "validation-rule-revised"
  | "disposition-schema-revised";

export type CalculationEventKind =
  | "calculation-completed"
  | "bounds-computed"
  | "hypothesis-tested"
  | "statistical-screen-completed";

/** The four event families E_t (05 §6.2), plus the run/case-level
 *  finish and close events the Invariant 9 guard needs. Every event
 *  carries an id, an actor, and a caller-supplied timestamp; an event
 *  without an actor and a timestamp is not a valid E_t and is refused. */
export type AnalysisEvent =
  | {
      kind: "user-action";
      eventId: string;
      actor: Actor;
      occurredAt: string;
      action: UserAction;
      participantKey: string;
      dispositionEvent?: DispositionEvent;
    }
  | {
      kind: "source-update";
      eventId: string;
      actor: Actor;
      occurredAt: string;
      update: SourceUpdateKind;
      affectedParticipantKeys: string[];
      /** How the affected set was computed (Invariant 6: computed
       *  explicitly and logged). */
      affectedSetBasis: string;
      newSnapshotHash: string;
      proposedTargets?: Record<string, Disposition>;
    }
  | {
      kind: "rule-revision";
      eventId: string;
      actor: Actor;
      occurredAt: string;
      revision: RuleRevisionKind;
      newRuleVersion: string;
      changeNote: string;
      affectedParticipantKeys: string[];
      /** How the affected set was computed (Invariant 6). */
      affectedSetBasis: string;
      proposedTargets?: Record<string, Disposition>;
    }
  | {
      kind: "calculation-event";
      eventId: string;
      actor: Actor;
      occurredAt: string;
      calculationEvent: CalculationEventKind;
      participantKey?: string;
      payload?: {
        benefitCalculation?: BenefitCalculation | null;
        bounds?: { minCents: number; maxCents: number } | null;
        hypotheses?: DiagnosticHypothesis[];
        benefitComparison?: BenefitComparison | null;
        /** Advisory note for a statistical screen (work-list only). */
        advisoryNote?: string;
      };
    }
  | { kind: "finish-run"; eventId: string; actor: Actor; occurredAt: string }
  | { kind: "close-case"; eventId: string; actor: Actor; occurredAt: string };

export interface ApplyCaseEventIds {
  /** Caller-supplied id for a new disposition record for a participant. */
  newDispositionId: (participantKey: string) => string;
  /** Caller-supplied id for an audit event (index counts events appended
   *  by this call, from 0). */
  auditEventId: (index: number) => string;
}

export interface ApplyCaseEventResult {
  state: CaseAnalysisState;
  /** Participant keys whose disposition was applied (changed or newly set). */
  applied: string[];
  refused: Array<{ participantKey: string; guard: GuardId; reason: string }>;
  /** Case-level refusal (finish-run / close-case / unknown participant). */
  caseRefusal: { guard: GuardId; reason: string } | null;
}

/**
 * Compute the affected set for a source update or rule revision
 * (Invariant 6, §6.3): the event names its affected participants, and
 * this function splits them into affected (in the case), unaffected
 * (in-scope but not affected — untouched, and named in the run log), and
 * unknown (named but not in the case — a refusal). The predicate that
 * selects the set lives in the engine workers that raise the event; this
 * function verifies the set against the case, it does not re-derive the
 * predicate.
 */
export function computeAffectedSet(
  state: CaseAnalysisState,
  affectedParticipantKeys: readonly string[],
): { affected: string[]; unaffected: string[]; unknownKeys: string[] } {
  const affected: string[] = [];
  const unknownKeys: string[] = [];
  for (const key of affectedParticipantKeys) {
    if (Object.prototype.hasOwnProperty.call(state.participants, key)) affected.push(key);
    else unknownKeys.push(key);
  }
  const unaffected: string[] = [];
  for (const key of Object.keys(state.participants)) {
    if (!affected.includes(key)) unaffected.push(key);
  }
  return { affected, unaffected, unknownKeys };
}

function cloneState(state: CaseAnalysisState): CaseAnalysisState {
  return {
    ...state,
    inputSnapshot: { ...state.inputSnapshot },
    ruleVersions: { ...state.ruleVersions },
    participants: { ...state.participants },
    auditLog: [...state.auditLog],
    advisoryWorkList: [...state.advisoryWorkList],
    workflow: { ...state.workflow },
  };
}

/**
 * The §17 transformation T for the case-analysis state:
 * S_{t+1} = T(S_t, E_t). Pure where it touches decisions: it reads no
 * DOM, no storage, no clock, and no network — timestamps and ids are
 * supplied by the caller. Refusal is part of T: a refused event leaves
 * the analytic content unchanged and only appends a refusal audit event.
 * Recomputation scope is exactly the affected set, computed explicitly
 * and logged (Invariant 6); an unchanged participant's records are
 * untouched. T itself does not run calculations — a calculation event
 * stores the artefacts the engine already computed; a statistical screen
 * writes only to the advisory work-list, never to a benefit or a
 * disposition (Invariant 5).
 */
export function applyCaseEvent(
  state: CaseAnalysisState,
  event: AnalysisEvent,
  ids: ApplyCaseEventIds,
): ApplyCaseEventResult {
  const applied: string[] = [];
  const refused: ApplyCaseEventResult["refused"] = [];
  let caseRefusal: ApplyCaseEventResult["caseRefusal"] = null;
  let next = cloneState(state);
  let auditIndex = 0;
  const nextAuditId = (): string => {
    const id = ids.auditEventId(auditIndex);
    auditIndex += 1;
    return id;
  };
  const appendAudit = (auditEvent: AuditEvent): void => {
    next = { ...next, auditLog: [...next.auditLog, auditEvent] };
  };

  if (event.kind === "user-action") {
    const participant = next.participants[event.participantKey];
    if (participant === undefined) {
      caseRefusal = {
        guard: "G-INV-6",
        reason: `user action ${event.action} names participant ${event.participantKey}, who is not in this case`,
      };
      appendAudit(
        makeAuditEvent({
          auditEventId: nextAuditId(),
          occurredAt: event.occurredAt,
          actor: event.actor,
          kind: "transition-refused",
          participantKeys: [event.participantKey],
          summary: `User action ${event.action} refused (G-INV-6): ${caseRefusal.reason}`,
          detail: { refusalReason: `G-INV-6: ${caseRefusal.reason}` },
        }),
      );
      return { state: next, applied, refused, caseRefusal };
    }
    if (event.dispositionEvent === undefined) {
      // A workflow action with no disposition effect (import, mapping,
      // provision entry, data-request recording): audited, no analytic
      // change. Data-request status changes themselves are recorded on
      // the participant's dataRequests by the caller through a
      // calculation-event payload in this version; the action is logged.
      appendAudit(
        makeAuditEvent({
          auditEventId: nextAuditId(),
          occurredAt: event.occurredAt,
          actor: event.actor,
          kind: "import",
          participantKeys: [event.participantKey],
          summary: `User action ${event.action} recorded (no disposition effect).`,
        }),
      );
      return { state: next, applied, refused, caseRefusal };
    }
    if (participant.evidence === null) {
      const reason = `no evidence state exists for ${event.participantKey} — run a calculation or bounds computation first`;
      refused.push({ participantKey: event.participantKey, guard: "entry-conditions", reason });
      appendAudit(
        makeAuditEvent({
          auditEventId: nextAuditId(),
          occurredAt: event.occurredAt,
          actor: event.actor,
          kind: "transition-refused",
          participantKeys: [event.participantKey],
          summary: `Transition refused (entry-conditions): ${reason}`,
          detail: { fromDisposition: stateOf(participant.disposition), refusalReason: reason },
        }),
      );
      return { state: next, applied, refused, caseRefusal };
    }
    const outcome = transition(participant.disposition, event.dispositionEvent, {
      participantKey: event.participantKey,
      caseId: state.caseId,
      evidence: participant.evidence,
      inputSnapshotHash: state.inputSnapshot.snapshotHash,
      ruleVersion: state.ruleVersions.validationRules,
      occurredAt: event.occurredAt,
      newDispositionId: ids.newDispositionId(event.participantKey),
      auditEventId: nextAuditId(),
      calculationRunId: null,
    });
    appendAudit(outcome.auditEvent);
    if (outcome.outcome === "applied") {
      const updated: ParticipantAnalysis = {
        ...participant,
        disposition: outcome.record,
      };
      next = {
        ...next,
        participants: { ...next.participants, [event.participantKey]: updated },
      };
      if (outcome.dispositionChanged) applied.push(event.participantKey);
    } else {
      refused.push({
        participantKey: event.participantKey,
        guard: outcome.guard,
        reason: outcome.reason,
      });
    }
    return { state: next, applied, refused, caseRefusal };
  }

  if (event.kind === "source-update" || event.kind === "rule-revision") {
    const affectedKeys = event.affectedParticipantKeys;
    const { affected, unknownKeys } = computeAffectedSet(next, affectedKeys);
    if (unknownKeys.length > 0) {
      caseRefusal = {
        guard: "G-INV-6",
        reason: `the event names participants not in this case: ${unknownKeys.join(", ")}`,
      };
      appendAudit(
        makeAuditEvent({
          auditEventId: nextAuditId(),
          occurredAt: event.occurredAt,
          actor: event.actor,
          kind: "transition-refused",
          participantKeys: affectedKeys,
          summary: `${event.kind} refused (G-INV-6): ${caseRefusal.reason}`,
          detail: { refusalReason: `G-INV-6: ${caseRefusal.reason}` },
        }),
      );
      return { state: next, applied, refused, caseRefusal };
    }
    // The new snapshot / rule version takes effect for the state; the
    // old hash and version remain in the audit log (Invariant 1/2).
    if (event.kind === "source-update") {
      next = {
        ...next,
        inputSnapshot: { ...next.inputSnapshot, snapshotHash: event.newSnapshotHash },
      };
    } else {
      const ruleVersions = { ...next.ruleVersions };
      if (event.revision === "validation-rule-revised") ruleVersions.validationRules = event.newRuleVersion;
      else if (event.revision === "formula-version-revised") ruleVersions.formulaTaxonomy = event.newRuleVersion;
      else if (event.revision === "tolerance-revised") ruleVersions.toleranceSetId = event.newRuleVersion;
      else ruleVersions.dispositionSchema = event.newRuleVersion;
      next = { ...next, ruleVersions };
    }
    for (const key of affected) {
      const participant = next.participants[key];
      if (participant === undefined) continue; // unreachable; computeAffectedSet verified membership
      if (participant.evidence === null) {
        refused.push({
          participantKey: key,
          guard: "entry-conditions",
          reason: `no evidence state exists for ${key} — run a calculation or bounds computation first`,
        });
        continue;
      }
      const dispositionEvent: DispositionEvent =
        event.kind === "source-update"
          ? {
              kind: "source-update",
              actor: "system",
              updateKind: event.update,
              newSnapshotHash: event.newSnapshotHash,
              affectedParticipantKeys: affected,
              proposedTarget:
                event.proposedTargets === undefined ? undefined : event.proposedTargets[key],
            }
          : {
              kind: "rule-revision",
              actor: "system",
              revisionKind: event.revision,
              newRuleVersion: event.newRuleVersion,
              changeNote: event.changeNote,
              affectedParticipantKeys: affected,
              proposedTarget:
                event.proposedTargets === undefined ? undefined : event.proposedTargets[key],
            };
      const outcome = transition(participant.disposition, dispositionEvent, {
        participantKey: key,
        caseId: state.caseId,
        evidence: participant.evidence,
        // The re-proposal is checked against the CURRENT (old) snapshot
        // and rule version: G-INV-2 refuses a re-proposal that names no
        // new snapshot, and the new record itself carries the new
        // versions (see buildRecord in transition). Passing the new hash
        // here would make the guard compare the new hash to itself.
        inputSnapshotHash: state.inputSnapshot.snapshotHash,
        ruleVersion: state.ruleVersions.validationRules,
        occurredAt: event.occurredAt,
        newDispositionId: ids.newDispositionId(key),
        auditEventId: nextAuditId(),
        calculationRunId: null,
      });
      appendAudit(outcome.auditEvent);
      if (outcome.outcome === "applied") {
        const updated: ParticipantAnalysis = { ...participant, disposition: outcome.record };
        next = {
          ...next,
          participants: { ...next.participants, [key]: updated },
        };
        if (outcome.dispositionChanged) applied.push(key);
      } else {
        refused.push({ participantKey: key, guard: outcome.guard, reason: outcome.reason });
      }
    }
    return { state: next, applied, refused, caseRefusal };
  }

  if (event.kind === "calculation-event") {
    if (event.calculationEvent === "statistical-screen-completed") {
      // Advisory only (Invariant 5): the screen writes to the work-list,
      // never to a benefit, comparison, or disposition.
      const note = event.payload?.advisoryNote ?? "statistical screen completed";
      const key = event.participantKey ?? "";
      next = {
        ...next,
        advisoryWorkList: [
          ...next.advisoryWorkList,
          { participantKey: key, note, occurredAt: event.occurredAt },
        ],
      };
      appendAudit(
        makeAuditEvent({
          auditEventId: nextAuditId(),
          occurredAt: event.occurredAt,
          actor: event.actor,
          kind: "calculation-run",
          participantKeys: key === "" ? [] : [key],
          summary: `Statistical screen completed (advisory only): ${note}`,
        }),
      );
      return { state: next, applied, refused, caseRefusal };
    }
    if (event.participantKey === undefined) {
      caseRefusal = {
        guard: "transition-not-allowed",
        reason: `calculation event ${event.calculationEvent} names no participant`,
      };
      appendAudit(
        makeAuditEvent({
          auditEventId: nextAuditId(),
          occurredAt: event.occurredAt,
          actor: event.actor,
          kind: "transition-refused",
          participantKeys: [],
          summary: `Calculation event refused: ${caseRefusal.reason}`,
          detail: { refusalReason: caseRefusal.reason },
        }),
      );
      return { state: next, applied, refused, caseRefusal };
    }
    const participant = next.participants[event.participantKey];
    if (participant === undefined) {
      caseRefusal = {
        guard: "G-INV-6",
        reason: `calculation event names participant ${event.participantKey}, who is not in this case`,
      };
      appendAudit(
        makeAuditEvent({
          auditEventId: nextAuditId(),
          occurredAt: event.occurredAt,
          actor: event.actor,
          kind: "transition-refused",
          participantKeys: [event.participantKey],
          summary: `Calculation event refused (G-INV-6): ${caseRefusal.reason}`,
          detail: { refusalReason: `G-INV-6: ${caseRefusal.reason}` },
        }),
      );
      return { state: next, applied, refused, caseRefusal };
    }
    const payload = event.payload;
    const updated: ParticipantAnalysis = {
      ...participant,
      benefitCalculation:
        payload?.benefitCalculation !== undefined
          ? payload.benefitCalculation
          : participant.benefitCalculation,
      bounds: payload?.bounds !== undefined ? payload.bounds : participant.bounds,
      hypotheses:
        payload?.hypotheses !== undefined ? [...payload.hypotheses] : participant.hypotheses,
      benefitComparison:
        payload?.benefitComparison !== undefined
          ? payload.benefitComparison
          : participant.benefitComparison,
    };
    next = {
      ...next,
      participants: { ...next.participants, [event.participantKey]: updated },
    };
    appendAudit(
      makeAuditEvent({
        auditEventId: nextAuditId(),
        occurredAt: event.occurredAt,
        actor: event.actor,
        kind: "calculation-run",
        participantKeys: [event.participantKey],
        summary: `Calculation event ${event.calculationEvent} stored for ${event.participantKey}.`,
      }),
    );
    return { state: next, applied, refused, caseRefusal };
  }

  // finish-run / close-case: Invariant 9. A run whose output lacks a
  // calculation/bounds/no-bounds-statement and a disposition for any
  // in-scope participant is incomplete: it cannot be reported as
  // finished, and the case cannot close on it.
  const completeness = checkRunCompleteness(
    Object.values(next.participants).map((participant) => ({
      participantKey: participant.participantKey,
      completenessGrade: participant.completenessGrade,
      hasCalculationOrBoundsOrNoBoundsStatement:
        participant.benefitCalculation !== null ||
        participant.bounds !== null ||
        (participant.evidence !== null &&
          participant.evidence.indeterminateContent !== null &&
          participant.evidence.indeterminateContent.justifiedBoundsCents === null &&
          participant.evidence.indeterminateContent.noBoundsReason !== null),
      disposition: participant.disposition,
    })),
  );
  if (!completeness.complete) {
    const reason = `run/case cannot finish: ${completeness.missing
      .map((entry) => `${entry.participantKey} lacks ${entry.missing.join("; ")}`)
      .join("; ")}`;
    caseRefusal = { guard: "G-INV-9", reason };
    appendAudit(
      makeAuditEvent({
        auditEventId: nextAuditId(),
        occurredAt: event.occurredAt,
        actor: event.actor,
        kind: "transition-refused",
        participantKeys: completeness.missing.map((entry) => entry.participantKey),
        summary: `${event.kind} refused (G-INV-9): ${reason}`,
        detail: { refusalReason: `G-INV-9: ${reason}` },
      }),
    );
    return { state: next, applied, refused, caseRefusal };
  }
  appendAudit(
    makeAuditEvent({
      auditEventId: nextAuditId(),
      occurredAt: event.occurredAt,
      actor: event.actor,
      kind: "calculation-run",
      participantKeys: [],
      summary:
        event.kind === "finish-run"
          ? `Run finished. Unapproved recommended dispositions (unfinished business): ${completeness.unapprovedRecommended.join(", ") || "none"}.`
          : `Case closed. Unapproved recommended dispositions (unfinished business): ${completeness.unapprovedRecommended.join(", ") || "none"}.`,
    }),
  );
  return { state: next, applied, refused, caseRefusal };
}
