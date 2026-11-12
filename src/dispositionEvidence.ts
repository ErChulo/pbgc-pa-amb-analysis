/**
 * Stage 5 integration seam — build the `DispositionEvidence` input that
 * `src/dispositionMapping.ts` consumes, from the real outputs of the
 * reconciliation module (`src/reconcile.ts`) and the statistics module
 * (`src/statistics.ts`).
 *
 * This is the seam Worker 3 left for the coordinator (dispositionMapping.ts
 * header, "SEAM (Worker 1 / Worker 2 inputs)"): the mapping module consumes
 * Δ/D/R, the tolerance verdict, ranked hypotheses, and statistical flags as
 * plain data. This adapter is that mapping, as shipped code — not a test
 * fixture — so the full chain (reconcile → map disposition → publish) runs
 * on real module outputs end to end.
 *
 * Mapping rules (each is a decision, recorded here, not a silent default):
 *
 * - recorded / reconstructed amounts come from the typed benefit quantities
 *   (`amount?.amountMinor ?? null`). A blank is null, never zero.
 * - deltaMinor is present only when the comparison is comparable; otherwise
 *   null. withinTolerance is true / false from the tolerance verdict, and
 *   null when the verdict is "not-applicable" (no tolerance leg configured).
 * - boundsMinor comes from the reconciliation record's justified bounds.
 *   boundWidthMaterial is true when the width exceeds the case materiality
 *   threshold τ_material; when no τ_material is set, the width cannot be
 *   judged immaterial, so it is treated as material (the mapping then
 *   requires investigation, matching reconcile.ts's bounds branch — never a
 *   silent default).
 * - hypotheses map one-to-one onto MappingHypothesis: code, support class,
 *   materiality, and the corrected benefit when the counterfactual produced
 *   one. correctedBenefitMinor is the single agreed corrected value among
 *   supported hypotheses with a benefit, or null when they disagree (the
 *   conflicting-corrections case) or none exists.
 * - correctionDirection follows corrected vs recorded ("increase" /
 *   "decrease" / null). correctionReasonablyCertain is a caller-stated
 *   human judgement (Policy 5.8-1 §D) — never computed here.
 * - comparisonBasis is "unresolved" only when the reconciliation inputs'
 *   basis is "unresolved"; "same-basis" and "basis-converted" both count as
 *   established (a converted basis is established with the conversion
 *   stated).
 * - uninvestigatedFlag is true when the statistics module flagged this
 *   participant and the participant is not in the investigated set.
 *   Investigation status is workflow state supplied by the caller, never
 *   inferred from the detection result: a flag is an investigation signal,
 *   not proof of error (invariant I).
 * - missingEvidence, dataRequests, and nextSteps are caller-supplied (in
 *   production they come from src/missingdata.ts); this adapter never
 *   invents them. An empty missingEvidence array means "none recorded",
 *   not "none exists" — the caller must have classified the record.
 *
 * Pure functions only. No clock, no storage, no network, no randomness.
 * Money is integer minor units (cents). Synthetic data only.
 */

import type { DeterminationDataRequest } from "./determination";
import type {
  DispositionEvidence,
  MappingHypothesis,
  MappingMissingEvidence,
} from "./dispositionMapping";
import type { ParticipantReconciliation } from "./reconcile";
import type { OutlierFlag } from "./statistics";
import type { CompletenessGrade } from "./types";

export interface BuildDispositionEvidenceArgs {
  /** The reconciliation record from src/reconcile.ts. */
  reconciliation: ParticipantReconciliation;
  /** PBGC case number. */
  caseId: string;
  /** The tolerance set id the verdict was produced under (e.g. "tolerance-v1"). */
  toleranceSetId: string;
  /** The basis statement from the reconciliation inputs: "unresolved" maps
   *  to an unresolved comparison basis; anything else is established. */
  comparisonBasis: "same-basis" | "basis-converted" | "unresolved";
  /** Data completeness grade from validation (Stage 2 output 02). */
  completenessGrade: CompletenessGrade;
  /** τ_material in minor units, or null when the actuary has not set one. */
  materialityMinor: number | null;
  /** Statistical flags for this participant, from src/statistics.ts
   *  (already filtered to this participantKey). */
  outlierFlags: readonly OutlierFlag[];
  /** Participant keys whose statistical flags have been investigated
   *  (workflow state, caller-supplied). */
  investigatedParticipantKeys: readonly string[];
  /** Human judgement (Policy 5.8-1 §D), caller-stated. Never computed. */
  correctionReasonablyCertain: boolean;
  /** Whether the assumptions behind the justified bounds are in doubt. */
  boundAssumptionsInDoubt: boolean;
  /** Reviewer-recorded reason the bound width is immaterial, or null. */
  boundWidthJustification: string | null;
  /** Classified missing evidence, from src/missingdata.ts. */
  missingEvidence: readonly MappingMissingEvidence[];
  /** Prioritised data requests, from src/missingdata.ts. */
  dataRequests: readonly DeterminationDataRequest[];
  /** Next steps recorded with the evidence. */
  nextSteps: readonly string[];
  /** True when a blocking validation finding is outstanding (from the
   *  validation run). Required — never defaulted: a wrong false would let
   *  the mapping reach Verified with blocking validation outstanding. */
  blockingValidationOutstanding: boolean;
  /** True when the comparison basis cannot be established from any
   *  available source (not merely "not yet established"). */
  basisUnresolvable?: boolean;
  /** Note on how the measurement basis was (or was not) established. */
  basisNote?: string | null;
  /** True when the disposition would rest only on statistical evidence. */
  statisticalOnly?: boolean;
  /** True when the evidence is mutually contradictory with no resolution. */
  contradictoryEvidenceUnresolved?: boolean;
  /** Reviewer-recorded ground for acceptance (Stage 2 §1.2.2). */
  supportedGround?: string | null;
  /** Reviewer-recorded rationale when the outcome is Indeterminate. */
  indeterminateRationale?: string | null;
  /** Reviewer-recorded reason no further data request is needed. */
  noFurtherRequestReason?: string | null;
  /** False when the governing rule/tolerance is outside its applicability. */
  ruleApplicabilityOk?: boolean;
  /** False when the run snapshot/rule version no longer matches. */
  snapshotMatches?: boolean;
}

/** Map one participant's reconciliation + statistical flags onto the
 *  disposition-mapping input. Total: every field of DispositionEvidence is
 *  set from the inputs or an explicit caller-supplied default; nothing is
 *  left undefined and nothing is invented. */
export function buildDispositionEvidence(
  args: BuildDispositionEvidenceArgs,
): DispositionEvidence {
  const rec = args.reconciliation;
  const recordedMinor = rec.recorded?.amount?.amountMinor ?? null;
  const reconstructedMinor = rec.reconstructed?.amount?.amountMinor ?? null;
  const deltaMinor = rec.comparison.comparable
    ? rec.comparison.delta.amountMinor
    : null;
  const withinTolerance =
    rec.toleranceVerdict === "within-tolerance"
      ? true
      : rec.toleranceVerdict === "outside-tolerance"
        ? false
        : null;
  const denominatorFlag = rec.comparison.comparable
    ? rec.comparison.denominatorFlag
    : null;
  const boundsMinor =
    rec.bounds === null
      ? null
      : {
          min: rec.bounds.min.amountMinor,
          max: rec.bounds.max.amountMinor,
        };
  const boundWidthMinor =
    boundsMinor === null ? null : boundsMinor.max - boundsMinor.min;
  // Without τ_material the width cannot be judged immaterial: treat it as
  // material so the mapping requires investigation (reconcile.ts bounds
  // branch). Never a silent default.
  const boundWidthMaterial =
    boundsMinor === null
      ? false
      : args.materialityMinor === null
        ? true
        : boundWidthMinor !== null && boundWidthMinor > args.materialityMinor;

  const hypotheses: MappingHypothesis[] = rec.hypotheses.map((h) => ({
    code: h.hypothesisCode,
    supportClass: h.supportClass,
    material: h.material,
    correctedBenefitMinor: h.benefit?.amount?.amountMinor ?? null,
  }));

  // Single agreed corrected value among supported hypotheses with a
  // benefit; null when they disagree or none exists (the
  // conflicting-corrections case stays a tie — never silently picked).
  const supportedBenefits = rec.hypotheses
    .filter(
      (h) =>
        h.supportClass === "supported" &&
        h.benefit?.amount?.amountMinor !== null &&
        h.benefit?.amount?.amountMinor !== undefined,
    )
    .map((h) => h.benefit?.amount?.amountMinor as number);
  const correctedBenefitMinor =
    supportedBenefits.length > 0 &&
    supportedBenefits.every((v) => v === supportedBenefits[0])
      ? (supportedBenefits[0] as number)
      : null;
  const correctionDirection =
    correctedBenefitMinor === null || recordedMinor === null
      ? null
      : correctedBenefitMinor > recordedMinor
        ? "increase"
        : correctedBenefitMinor < recordedMinor
          ? "decrease"
          : null;

  const investigated = new Set(args.investigatedParticipantKeys);
  const uninvestigatedFlag =
    args.outlierFlags.length > 0 &&
    !investigated.has(rec.participantKey);

  return {
    participantKey: rec.participantKey,
    caseId: args.caseId,
    toleranceSetId: args.toleranceSetId,
    completenessGrade: args.completenessGrade,
    comparisonBasis:
      args.comparisonBasis === "unresolved" ? "unresolved" : "established",
    basisUnresolvable: args.basisUnresolvable ?? false,
    basisNote: args.basisNote ?? null,
    reconstructedMinor,
    recordedMinor,
    deltaMinor,
    withinTolerance,
    denominatorFlag,
    boundsMinor,
    boundWidthMaterial,
    boundWidthJustification: args.boundWidthJustification,
    boundAssumptionsInDoubt: args.boundAssumptionsInDoubt,
    hypotheses,
    conflictingCorrections: rec.conflictingCorrections,
    correctedBenefitMinor,
    correctionReasonablyCertain: args.correctionReasonablyCertain,
    correctionDirection,
    missingEvidence: [...args.missingEvidence],
    dataRequests: [...args.dataRequests],
    nextSteps: [...args.nextSteps],
    uninvestigatedFlag,
    blockingValidationOutstanding: args.blockingValidationOutstanding,
    statisticalOnly: args.statisticalOnly ?? false,
    contradictoryEvidenceUnresolved:
      args.contradictoryEvidenceUnresolved ?? false,
    supportedGround: args.supportedGround ?? null,
    indeterminateRationale: args.indeterminateRationale ?? null,
    noFurtherRequestReason: args.noFurtherRequestReason ?? null,
    ruleApplicabilityOk: args.ruleApplicabilityOk ?? true,
    snapshotMatches: args.snapshotMatches ?? true,
  };
}
