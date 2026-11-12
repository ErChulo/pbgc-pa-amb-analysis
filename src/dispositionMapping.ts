/**
 * Disposition mapping — Stage 5 (Worker 3).
 *
 * Governing spec: MASTER_PROMPT §14 (five dispositions); Stage 1 output
 * 03, §4.7 (the evidence-state → disposition mapping); Stage 2 output 05
 * §§1.2–1.3 (entry conditions per disposition, stricter condition governs
 * where the two Stage 1 sources differ in emphasis); monadic spec §2.7
 * (DecisionCalc: prepare a proposed disposition) and §5 invariants I
 * and K.
 *
 * This module RECOMMENDS. It never approves: its output is a
 * recommendation with status "recommended", wired as an input to
 * src/decisions.ts (`toEntryCheckInput` builds the EntryCheckInput the
 * transition function reads; `checkEntryConditions` there is the guard).
 * Only a human reviewer approves, via the T3 transition in decisions.ts
 * — there is no code path here that creates an "approved" record, sets
 * PA_AMB_ACCEPT, or authorises valuation use. A recommendation has no
 * downstream effect: `downstreamUseFor` with status "recommended"
 * returns blocked, whatever the disposition.
 *
 * Totality: every evidence state reaches exactly one disposition. The
 * mapping is ordered by the entry conditions; the final fall-through is
 * Requires investigation with a named next step, never a silent
 * default and never no disposition. Indeterminate is reachable and is
 * a legitimate, complete outcome.
 *
 * SEAM (Worker 1 / Worker 2 inputs): this module does NOT import
 * src/reconcile.ts or src/statistics.ts (built in parallel). It consumes
 * their outputs as plain data through the `DispositionEvidence` input
 * type below: Δ/D/R and the tolerance verdict, ranked hypotheses with
 * support classes, and statistical flags. When those modules land, the
 * coordinator maps their return values onto this input type; nothing in
 * this module needs to change.
 *
 * Pure functions only. No clock, no storage, no network, no randomness.
 * Money is integer minor units (cents). Synthetic data only.
 */

import type {
  CompletenessGrade,
  Disposition,
  MissingDataClass,
} from "./types";
import type {
  DeterminationDataRequest,
  DeterminationMissingEvidence,
} from "./determination";
import type {
  EntryCheckInput,
  HypothesisCheck,
  IndeterminateContent,
  IndeterminateMissingEvidence,
} from "./decisions";
import { checkEntryConditions, downstreamUseFor } from "./decisions";

// ---------------------------------------------------------------------------
// Input: the evidence state (the seam for Worker 1 / Worker 2 outputs)
// ---------------------------------------------------------------------------

/** One ranked hypothesis as the mapping reads it. `supportClass` is the
 *  Stage 1 §2.6 support class; `material` says whether the hypothesis
 *  could change the amount by more than the tolerance. `correctedBenefitMinor`
 *  is the single corrected benefit the hypothesis implies, when it
 *  implies one. */
export interface MappingHypothesis {
  code: string;
  supportClass: "supported" | "plausible" | "coincidence" | "refuted" | "proposed" | "indeterminate";
  material: boolean;
  correctedBenefitMinor?: number | null;
  /**
   * Precise citation for the rule or document that supports this
   * hypothesis (Stage 7 Accuracy D-ACC-1). A "supported" label with no
   * citation is not recorded as supported: the demo SYN-V-01 H15 was
   * labelled supported with no citable rule in its plan, and the fix
   * was to demote it to "plausible". Callers that claim "supported"
   * should carry the citation here.
   */
  citation?: string | null;
}

/** One missing-evidence entry (§4.5 / Stage 2 output 05, §5.3). */
export interface MappingMissingEvidence {
  input: string;
  missingClass: "M1" | "M2" | "M3" | "M4" | "M5";
  decisionImpact: string;
  uncertaintyContributionMinor: number | null;
}

/**
 * The complete evidence state for one participant. Field-by-field this
 * is the evidence the §4.7 mapping and the Stage 2 §1.2 entry
 * conditions read:
 * - Reconciliation (Worker 1 seam): `reconstructedMinor` (B̂_i),
 *   `recordedMinor` (B_i^PA; null = blank, never 0), `deltaMinor`,
 *   `withinTolerance`, `toleranceSetId`, `bounds` with the recorded
 *   position, `boundWidthMaterial` + `boundWidthJustification`,
 *   `boundAssumptionsInDoubt`, `denominatorFlag`.
 * - Hypotheses (Worker 1 seam): `hypotheses` with support classes,
 *   `conflictingCorrections`, `correctedBenefitMinor`,
 *   `correctionReasonablyCertain` (the human reviewer's statement of
 *   certainty, Policy 5.8-1 §D — the system records it, it does not
 *   compute it; false / unstated means not reasonably certain),
 *   `correctionDirection`.
 * - Statistics (Worker 2 seam): `uninvestigatedFlag` — a statistical
 *   screen or validation finding flags the participant and is not yet
 *   investigated. A flag is an investigation signal (invariant I), never
 *   evidence for a benefit amount.
 * - Missing data (missingdata.ts): `missingEvidence`, `dataRequests`.
 * - Basis: `comparisonBasis`, `basisUnresolvable`, `basisNote`.
 * - Judgement facts the reviewer or the engine supplies:
 *   `completenessGrade`, `blockingValidationOutstanding`,
 *   `statisticalOnly` (the disposition would rest on a statistical
 *   output alone — guard G-INV-5), `contradictoryEvidenceUnresolved`,
 *   `supportedGround` (reviewer-named immaterial ground for Supported
 *   for acceptance on a Complete record), `nextSteps`,
 *   `indeterminateRationale`, `noFurtherRequestReason`.
 * - Run-level facts the transition guards read (decisions.ts G-INV-2 /
 *   G-INV-4): `ruleApplicabilityOk`, `snapshotMatches`. Caller-stated;
 *   this module never defaults them.
 */
export interface DispositionEvidence {
  participantKey: string;
  caseId: string;
  toleranceSetId: string;
  completenessGrade: CompletenessGrade;
  comparisonBasis: "established" | "unresolved";
  basisUnresolvable: boolean;
  basisNote: string | null;
  reconstructedMinor: number | null;
  recordedMinor: number | null;
  deltaMinor: number | null;
  withinTolerance: boolean | null;
  denominatorFlag: string | null;
  boundsMinor: { min: number; max: number } | null;
  boundWidthMaterial: boolean;
  boundWidthJustification: string | null;
  boundAssumptionsInDoubt: boolean;
  hypotheses: MappingHypothesis[];
  conflictingCorrections: boolean;
  correctedBenefitMinor: number | null;
  correctionReasonablyCertain: boolean;
  correctionDirection: "increase" | "decrease" | null;
  missingEvidence: MappingMissingEvidence[];
  dataRequests: DeterminationDataRequest[];
  nextSteps: string[];
  uninvestigatedFlag: boolean;
  blockingValidationOutstanding: boolean;
  statisticalOnly: boolean;
  contradictoryEvidenceUnresolved: boolean;
  supportedGround: string | null;
  indeterminateRationale: string | null;
  noFurtherRequestReason: string | null;
  /** The rule / tolerance applies within its applicability predicate. */
  ruleApplicabilityOk: boolean;
  /** The calculation run's snapshot hash and rule version match the
   *  current state. */
  snapshotMatches: boolean;
}

// ---------------------------------------------------------------------------
// Output: the recommendation
// ---------------------------------------------------------------------------

export interface DispositionRecommendation {
  participantKey: string;
  caseId: string;
  /** Always "recommended". This module never produces "approved". */
  status: "recommended";
  disposition: Disposition;
  /** Why this disposition, in the mapping's own words, citing the
   *  evidence state it read. */
  rationale: string;
  /** The §4.7 mapping row (or Stage 2 §1.2 entry condition) applied. */
  mappingRow: string;
  /** Evidence that supports the recommendation, as short statements. */
  supportingEvidence: string[];
  /** Concrete next steps (required for Requires investigation; the
   *  data requests that would resolve Indeterminate otherwise). */
  nextSteps: string[];
  /** Missing evidence carried with the recommendation. */
  missingEvidence: MappingMissingEvidence[];
  /** Prioritised data requests carried with the recommendation. */
  dataRequests: DeterminationDataRequest[];
  /** The corrected benefit, when the recommendation is Correction
   *  recommended; null otherwise. */
  correctedBenefitMinor: number | null;
  /**
   * Downstream use of a RECOMMENDATION: always blocked. A recommendation
   * has no downstream effect (§4.1 of output 05): it does not authorise
   * valuation use and does not set PA_AMB_ACCEPT, whatever the
   * disposition. Computed with decisions.ts downstreamUseFor so the
   * rule lives in one place.
   */
  downstreamUse: ReturnType<typeof downstreamUseFor>;
}

// ---------------------------------------------------------------------------
// Mapping (§4.7 + Stage 2 output 05, §1.2)
// ---------------------------------------------------------------------------

function hasMissingClass(evidence: DispositionEvidence, label: string): boolean {
  return evidence.missingEvidence.some((entry) => entry.missingClass === label);
}

function materialUnresolvedHypotheses(evidence: DispositionEvidence): MappingHypothesis[] {
  return evidence.hypotheses.filter(
    (h) =>
      h.material &&
      h.supportClass !== "supported" &&
      h.supportClass !== "refuted",
  );
}

function hasMaterialSupportClass(
  evidence: DispositionEvidence,
  supportClass: MappingHypothesis["supportClass"],
): boolean {
  return evidence.hypotheses.some((h) => h.material && h.supportClass === supportClass);
}

function recordedInsideBounds(evidence: DispositionEvidence): boolean {
  if (evidence.boundsMinor === null || evidence.recordedMinor === null) return false;
  return (
    evidence.recordedMinor >= evidence.boundsMinor.min &&
    evidence.recordedMinor <= evidence.boundsMinor.max
  );
}

function recordedOutsideBounds(evidence: DispositionEvidence): boolean {
  if (evidence.boundsMinor === null || evidence.recordedMinor === null) return false;
  return (
    evidence.recordedMinor < evidence.boundsMinor.min ||
    evidence.recordedMinor > evidence.boundsMinor.max
  );
}

function supportedHypothesisWithCorrection(
  evidence: DispositionEvidence,
): MappingHypothesis | null {
  const supported = evidence.hypotheses.filter(
    (h) => h.material && h.supportClass === "supported" && h.correctedBenefitMinor !== null && h.correctedBenefitMinor !== undefined,
  );
  if (supported.length === 0) return null;
  // A single supported correction: with two or more the corrections
  // conflict (or agree — agreement is checked by the caller through
  // conflictingCorrections, which is the ranked-hypothesis module's
  // judgement, not re-derived here).
  return supported[0] ?? null;
}

function recommend(
  evidence: DispositionEvidence,
  disposition: Disposition,
  mappingRow: string,
  rationale: string,
  supportingEvidence: string[],
  nextSteps: string[],
  correctedBenefitMinor: number | null = null,
): DispositionRecommendation {
  return {
    participantKey: evidence.participantKey,
    caseId: evidence.caseId,
    status: "recommended",
    disposition,
    rationale,
    mappingRow,
    supportingEvidence,
    nextSteps,
    missingEvidence: evidence.missingEvidence,
    dataRequests: evidence.dataRequests,
    correctedBenefitMinor,
    downstreamUse: downstreamUseFor(
      disposition,
      "recommended",
      evidence.recordedMinor,
      correctedBenefitMinor,
    ),
  };
}

/**
 * The complete mapping from evidence states to the five §14
 * dispositions (Stage 1 output 03, §4.7; Stage 2 output 05, §1.2).
 * Total: every evidence state reaches exactly one disposition.
 *
 * Order of evaluation (the stricter entry condition governs where the
 * sources differ in emphasis):
 * 1. Unresolved comparison basis that cannot be resolved → Indeterminate.
 *    Unresolved but resolvable → Requires investigation (the next step
 *    is to establish the basis; no Δ is computed meanwhile).
 * 2. Blank recorded benefit with no independent reconstruction →
 *    Indeterminate. Blank recorded benefit WITH an exact reconstruction
 *    → Requires investigation: no disposition's entry conditions are
 *    met by a blank recorded amount (Verified needs a Δ; Supported for
 *    acceptance needs the recorded amount inside bounds; Correction
 *    recommended needs a corrected value different from the recorded
 *    amount), so the case is not decidable until the recorded amount is
 *    obtained or the transfer failure is confirmed — the reconstruction
 *    is carried as evidence, not as the decision. See the open item in
 *    the module report: §4.7's last row ("the disposition follows the
 *    reconstruction") states no entry condition, and this mapping
 *    refuses to invent one.
 * 3. No exact benefit and no justifiable bounds (class M5, or
 *    contradictory evidence with no available resolution) →
 *    Indeterminate, carrying the missing evidence and data requests.
 * 4. Two supported hypotheses implying different corrected benefits →
 *    Requires investigation (Correction recommended is unreachable
 *    while they are tied, §2.6 multiple-hypothesis rule).
 * 5. Correction recommended: a supported hypothesis identifies the
 *    error, a single specific corrected benefit exists, it differs
 *    from the recorded amount, the basis is established, and the
 *    reviewer states reasonable certainty about both the error and the
 *    amount (Policy 5.8-1 §D). A supported correction without the
 *    reviewer's certainty statement → Requires investigation (next step:
 *    the reviewer records certainty or the correction is not made).
 * 6. Recorded amount outside justified bounds: with the bound
 *    assumptions in doubt → Requires investigation (re-examine the
 *    assumptions before recommending a correction); otherwise, without
 *    a certain corrected value, → Requires investigation as well — an
 *    outside-bounds position alone is a strong finding, not a corrected
 *    value.
 * 7. Verified: exact reconstruction, basis established, Δ within the
 *    documented tolerance, no material unexplained item, no blocking
 *    validation outstanding, completeness Complete, and the evidence
 *    supports an exact benefit. A rounding explanation counts only as a
 *    supported hypothesis (anti-coincidence rule, §2.7); a coincidence
 *    never supports Verified.
 * 8. Supported for acceptance: basis established, recorded amount
 *    inside justified bounds, bound width immaterial to the decision
 *    (or a reviewer-recorded reason why it is immaterial), no M5 gap,
 *    no material coincidence, every material discrepancy documented.
 *    Recorded inside bounds but width material → Requires investigation.
 * 9. Uninvestigated statistical / validation flag, or a key input
 *    missing with material decision effect, or Δ outside tolerance with
 *    no supported explanation → Requires investigation.
 * 10. Fall-through: Requires investigation with a named next step.
 *     No evidence state ends without a disposition.
 */
export function mapDisposition(evidence: DispositionEvidence): DispositionRecommendation {
  const missing = evidence.missingEvidence;
  const missingList =
    missing.length === 0
      ? "none listed"
      : missing.map((m) => `${m.input} (${m.missingClass})`).join("; ");

  // 1. Comparison basis.
  if (evidence.comparisonBasis === "unresolved") {
    if (evidence.basisUnresolvable) {
      return recommend(
        evidence,
        "indeterminate",
        "§4.7 row 6 / §1.2.5 entry 2: comparison basis unresolved and cannot be resolved",
        "The comparison basis is unresolved and cannot be resolved from available documents: no Δ is computed and no defensible conclusion can be established. " +
          `Missing evidence: ${missingList}. This is Indeterminate, a complete outcome — it names the evidence that would resolve it.`,
        [
          "Comparison basis unresolved.",
          evidence.basisNote ?? "No candidate basis can be evidenced from available documents.",
          `Missing evidence: ${missingList}.`,
        ],
        [],
      );
    }
    return recommend(
      evidence,
      "requires-investigation",
      "§1.2.3: unresolved comparison basis with a concrete next step",
      "The comparison basis is unresolved but may be resolvable: no Δ is computed until the basis is established.",
      ["Comparison basis unresolved; a candidate basis may be establishable."],
      ["Establish the measurement date and benefit basis from the PA schedule / plan documents."],
    );
  }

  // 2. Blank recorded benefit.
  if (evidence.recordedMinor === null) {
    if (evidence.reconstructedMinor === null) {
      return recommend(
        evidence,
        "indeterminate",
        "§4.7 row 7 / §1.2.5 entry 3: B_i^PA blank and no independent reconstruction",
        "The recorded administrator benefit is blank — missing data, never zero — and no independent reconstruction exists that could stand in its place. " +
          `Missing evidence: ${missingList}.`,
        [
          "Recorded PA_AMB is blank (missing, never zero).",
          "No independent reconstruction exists.",
          `Missing evidence: ${missingList}.`,
        ],
        [],
      );
    }
    return recommend(
      evidence,
      "requires-investigation",
      "§4.7 row 7 (interpreted): blank B_i^PA with an exact reconstruction — no entry condition is met by a blank recorded amount",
      "The recorded administrator benefit is blank, but an exact independent reconstruction exists. No disposition's entry conditions are met by a blank recorded amount " +
        "(Verified needs a Δ; Supported for acceptance needs the recorded amount inside bounds; Correction recommended needs a corrected value different from the recorded amount). " +
        "The reconstruction is carried as evidence; the next step is to obtain the recorded amount or confirm the data-transfer failure.",
      [
        "Recorded PA_AMB is blank (missing, never zero).",
        `Independent reconstruction is exact: ${evidence.reconstructedMinor} minor units.`,
        "Blank recorded as a data-quality finding; the reconstruction is evidence, not the decision.",
      ],
      ["Obtain the recorded PA_AMB from the PA schedule, or confirm the blank is a data-transfer failure and record the confirmation."],
    );
  }

  // 3. No exact benefit and no justifiable bounds.
  const noBenefitNoBounds =
    evidence.reconstructedMinor === null && evidence.boundsMinor === null;
  if (noBenefitNoBounds || evidence.contradictoryEvidenceUnresolved) {
    const reason = evidence.contradictoryEvidenceUnresolved
      ? "The evidence that exists is mutually contradictory in a way no available document resolves."
      : "No exact reconstructed benefit exists and no justified bounds can be established.";
    return recommend(
      evidence,
      "indeterminate",
      "§4.7 row 6 / §1.2.5 entries 1 and 4: no B̂_i and no justifiable bounds, or contradictory evidence with no available resolution",
      `${reason} Missing evidence: ${missingList}. ` +
        "This is Indeterminate, a complete outcome — it names the evidence that would resolve it.",
      [
        reason,
        `Missing evidence: ${missingList}.`,
        evidence.dataRequests.length === 0
          ? "No data requests recorded — the record must name the requests that would change the outcome."
          : `${evidence.dataRequests.length} prioritised data request(s) recorded.`,
      ],
      [],
    );
  }

  // 4. Tied hypotheses: two supported corrections, different values.
  if (evidence.conflictingCorrections) {
    return recommend(
      evidence,
      "requires-investigation",
      "§4.7 / §1.2.3 entry 4: two or more hypotheses both resolve the discrepancy but imply different corrected benefits",
      "Two or more hypotheses both resolve the discrepancy but imply different corrected benefits. The disposition cannot be Correction recommended while they are tied; both are recorded and ranked, and the system does not silently pick one.",
      ["Conflicting supported hypotheses imply different corrected benefits."],
      ["Resolve the tie: seek the document that distinguishes the hypotheses, or record why neither can be distinguished."],
    );
  }

  // 5. Correction recommended.
  const supportedCorrection = supportedHypothesisWithCorrection(evidence);
  if (supportedCorrection !== null && !evidence.conflictingCorrections) {
    const corrected = supportedCorrection.correctedBenefitMinor;
    if (
      corrected !== null &&
      corrected !== undefined &&
      corrected !== evidence.recordedMinor &&
      evidence.comparisonBasis === "established"
    ) {
      if (evidence.correctionReasonablyCertain) {
        return recommend(
          evidence,
          "correction-recommended",
          "§4.7 row 4 / §1.2.4: a supported hypothesis identifies the error and the corrected value, reasonably certain",
          `A supported hypothesis (${supportedCorrection.code}) identifies the error and the corrected value ${corrected} minor units, ` +
            `different from the recorded ${evidence.recordedMinor} minor units (${evidence.correctionDirection ?? "direction not recorded"}). ` +
            "The error and the amount are reasonably certain (Policy 5.8-1 §D, stated by the human reviewer).",
          [
            `Supported hypothesis ${supportedCorrection.code} identifies the error.`,
            `Corrected benefit ${corrected} minor units; recorded ${evidence.recordedMinor} minor units.`,
            "Reasonable certainty about both the error and the amount, stated by the reviewer.",
          ],
          [],
          corrected,
        );
      }
      return recommend(
        evidence,
        "requires-investigation",
        "§1.2.4: supported correction exists but reasonable certainty has not been stated",
        `A supported hypothesis (${supportedCorrection.code}) identifies a corrected value ${corrected} minor units, but the reviewer has not stated reasonable certainty ` +
          "about both the error and the amount (Policy 5.8-1 §D). A correction is not recommended until that certainty is recorded.",
        [`Supported hypothesis ${supportedCorrection.code} implies corrected benefit ${corrected} minor units.`],
        ["Reviewer records reasonable certainty about the error and the corrected amount, or records why certainty cannot be reached."],
      );
    }
  }

  // 6. Recorded amount outside justified bounds.
  if (recordedOutsideBounds(evidence)) {
    if (evidence.boundAssumptionsInDoubt) {
      return recommend(
        evidence,
        "requires-investigation",
        "§4.7 row 5 / §1.2.3 entry 3: B_i^PA outside bounds but the assumptions behind the bounds are themselves in doubt",
        "The recorded amount lies outside the justified bounds, but the assumptions behind the bounds are themselves in doubt. " +
          "Re-examine the assumptions before recommending any correction.",
        [
          `Recorded ${evidence.recordedMinor} minor units outside justified bounds [${evidence.boundsMinor?.min}, ${evidence.boundsMinor?.max}].`,
          "The bound assumptions are themselves in doubt.",
        ],
        ["Re-examine the bound assumptions (feasible region, cap, formula version) and re-derive the bounds."],
      );
    }
    return recommend(
      evidence,
      "requires-investigation",
      "§4.7 row 4 (not met): B_i^PA outside justified bounds with no certain corrected value",
      "The recorded amount lies outside the justified bounds under the stated assumptions — inconsistent with the known facts — " +
        "but no specific corrected value is established with reasonable certainty, so no correction is recommended. Either an assumption is wrong, the formula version is wrong, or the administrator's amount is wrong; investigation is required.",
      [
        `Recorded ${evidence.recordedMinor} minor units outside justified bounds [${evidence.boundsMinor?.min}, ${evidence.boundsMinor?.max}].`,
        "No specific corrected value established with reasonable certainty.",
      ],
      ["Test the bound assumptions and the formula version; test the discrepancy hypotheses H1–H17."],
    );
  }

  // 7. Verified: exact reconstruction within tolerance.
  if (
    evidence.reconstructedMinor !== null &&
    evidence.deltaMinor !== null &&
    evidence.withinTolerance === true &&
    evidence.comparisonBasis === "established" &&
    evidence.completenessGrade === "complete" &&
    !evidence.blockingValidationOutstanding &&
    !evidence.statisticalOnly &&
    !evidence.uninvestigatedFlag &&
    materialUnresolvedHypotheses(evidence).length === 0 &&
    !hasMaterialSupportClass(evidence, "coincidence")
  ) {
    return recommend(
      evidence,
      "verified",
      "§4.7 row 1 / §1.2.1: B̂_i exact; Δ within tolerance; basis established; no material unexplained item",
      `Independent calculation agrees with the reported amount within the applicable documented tolerance (Δ ${evidence.deltaMinor} minor units, tolerance set ${evidence.toleranceSetId}). ` +
        "Numerical agreement is not proof of legal correctness if the underlying provisions are wrong — the provisions applied are recorded with the comparison.",
      [
        `Exact reconstructed benefit ${evidence.reconstructedMinor} minor units.`,
        `Δ ${evidence.deltaMinor} minor units, within tolerance set ${evidence.toleranceSetId}.`,
        "No material unexplained item; no blocking validation outstanding.",
      ],
      [],
    );
  }

  // 8. Supported for acceptance: inside justified bounds, width immaterial.
  if (recordedInsideBounds(evidence) && evidence.comparisonBasis === "established") {
    const noM5 = !hasMissingClass(evidence, "M5");
    const widthOk =
      !evidence.boundWidthMaterial ||
      (evidence.boundWidthJustification !== null && evidence.boundWidthJustification.trim() !== "");
    const gradeOk =
      evidence.completenessGrade === "partial" ||
      (evidence.completenessGrade === "complete" &&
        evidence.supportedGround !== null &&
        evidence.supportedGround.trim() !== "");
    if (
      noM5 &&
      widthOk &&
      gradeOk &&
      !hasMaterialSupportClass(evidence, "coincidence") &&
      materialUnresolvedHypotheses(evidence).length === 0 &&
      !evidence.blockingValidationOutstanding &&
      !evidence.statisticalOnly &&
      !evidence.uninvestigatedFlag
    ) {
      return recommend(
        evidence,
        "supported-for-acceptance",
        "§4.7 row 2 / §1.2.2: B̂_i not exact; B_i^PA inside justified bounds; bounds narrow relative to materiality; no better competing hypothesis",
        `The recorded amount ${evidence.recordedMinor} minor units lies inside justified bounds [${evidence.boundsMinor?.min}, ${evidence.boundsMinor?.max}] ` +
          "and the bound width is immaterial to the decision. The available evidence supports accepting the administrator's benefit despite incomplete reconstruction; " +
          "the bounds and the missing evidence travel with the acceptance, and the bounds are never reported as an exact reconstructed benefit.",
        [
          `Recorded ${evidence.recordedMinor} minor units inside justified bounds [${evidence.boundsMinor?.min}, ${evidence.boundsMinor?.max}].`,
          "Bound width immaterial to the decision (or a reviewer-recorded reason why it is immaterial).",
          `Missing evidence: ${missingList}.`,
        ],
        [],
      );
    }
    // Inside bounds but the width is material, or a competing hypothesis
    // is unresolved: Requires investigation (§4.7 row 3).
    return recommend(
      evidence,
      "requires-investigation",
      "§4.7 row 3: B_i^PA inside bounds but bounds wide relative to materiality, or a competing hypothesis is unresolved",
      `The recorded amount lies inside justified bounds, but the bounds are wide relative to materiality${evidence.boundWidthMaterial ? "" : " or a competing hypothesis is unresolved"}. ` +
        "The uncertainty itself is the finding; the disposition reflects it.",
      [
        `Recorded ${evidence.recordedMinor} minor units inside justified bounds [${evidence.boundsMinor?.min}, ${evidence.boundsMinor?.max}].`,
        evidence.boundWidthMaterial
          ? "Bound width is material relative to the case materiality threshold."
          : "A competing hypothesis is unresolved.",
        `Missing evidence: ${missingList}.`,
      ],
      evidence.nextSteps.length > 0
        ? evidence.nextSteps
        : ["Narrow the bounds: resolve the missing input with the largest contribution to the interval width."],
    );
  }

  // 9. Outside tolerance with no supported explanation; key input missing
  //    with material effect; uninvestigated flag.
  const outsideToleranceUnexplained =
    evidence.deltaMinor !== null &&
    evidence.withinTolerance === false &&
    !hasMaterialSupportClass(evidence, "supported");
  const keyInputMissingMaterially =
    (evidence.completenessGrade === "partial" ||
      evidence.completenessGrade === "insufficient") &&
    missing.length > 0;
  if (outsideToleranceUnexplained || keyInputMissingMaterially || evidence.uninvestigatedFlag) {
    const reasons: string[] = [];
    if (outsideToleranceUnexplained) {
      reasons.push(`Δ ${evidence.deltaMinor} minor units is outside tolerance with no supported explanation.`);
    }
    if (keyInputMissingMaterially) {
      reasons.push(`A key input is missing with material decision effect: ${missingList}.`);
    }
    if (evidence.uninvestigatedFlag) {
      reasons.push("A statistical screen or validation finding flags the participant and is not yet investigated (an investigation signal, not proof of error — invariant I).");
    }
    return recommend(
      evidence,
      "requires-investigation",
      "§4.7 row 3 / §1.2.3 entries 1, 2, 5: material discrepancy or missing evidence remains unresolved",
      reasons.join(" "),
      reasons,
      evidence.nextSteps.length > 0
        ? evidence.nextSteps
        : ["Test the discrepancy hypotheses H1–H17; obtain the missing input with the largest expected decision effect."],
    );
  }

  // 10. Fall-through: Requires investigation. No evidence state ends
  //     without a disposition; a state that meets no decidable entry
  //     condition is, by definition, unresolved.
  return recommend(
    evidence,
    "requires-investigation",
    "Fall-through: no decidable entry condition holds",
    "No entry condition for a decidable disposition holds on this evidence state, and the case is not Indeterminate (an exact benefit or justified bounds exist). " +
      "The participant is Requires investigation until the open items are resolved.",
    ["No decidable entry condition holds; the evidence state is incomplete for a decision."],
    evidence.nextSteps.length > 0
      ? evidence.nextSteps
      : ["Name the concrete next step: the hypothesis to test, the document to request, or the source to re-check."],
  );
}

// ---------------------------------------------------------------------------
// Wiring into decisions.ts (READ ONLY — this module produces inputs to it)
// ---------------------------------------------------------------------------

function toMissingClassCode(label: MappingMissingEvidence["missingClass"]): MissingDataClass {
  switch (label) {
    case "M1": return "a";
    case "M2": return "b";
    case "M3": return "c";
    case "M4": return "d";
    case "M5": return "e";
  }
}

/**
 * Convert a DispositionEvidence state plus a mapping recommendation into
 * the EntryCheckInput that decisions.ts `checkEntryConditions` and
 * `transition` read. This is the wiring: the mapping recommends, the
 * state machine guards and (through the human gate) approves. The
 * recommendation itself is never passed off as an approval — the
 * EntryCheckInput carries no approval, and `transition` refuses an
 * approve event that is not initiated by a human reviewer.
 */
export function toEntryCheckInput(
  evidence: DispositionEvidence,
  recommendation: DispositionRecommendation,
): EntryCheckInput {
  const hypotheses: HypothesisCheck[] = evidence.hypotheses.map((h) => ({
    code: h.code,
    supportClass: h.supportClass,
    material: h.material,
    correctedBenefitCents:
      h.correctedBenefitMinor === undefined ? null : h.correctedBenefitMinor,
  }));
  const missingEvidence: IndeterminateMissingEvidence[] = evidence.missingEvidence.map((m) => ({
    input: m.input,
    missingClass: m.missingClass,
    decisionImpact: m.decisionImpact,
    uncertaintyContributionCents: m.uncertaintyContributionMinor,
  }));
  let indeterminateContent: IndeterminateContent | null = null;
  if (recommendation.disposition === "indeterminate") {
    indeterminateContent = {
      justifiedBoundsCents: evidence.boundsMinor,
      noBoundsReason:
        evidence.boundsMinor === null
          ? evidence.reconstructedMinor === null
            ? "No exact reconstructed benefit exists and no justified bounds can be established from the available evidence."
            : "Bounds were not derived for this participant; the Indeterminate outcome rests on the unresolved comparison basis or the blank recorded amount."
          : null,
      scenarioBounds: [],
      missingEvidence,
      dataRequests: evidence.dataRequests,
      indeterminateRationale:
        evidence.indeterminateRationale ?? recommendation.rationale,
      noFurtherRequestReason: evidence.noFurtherRequestReason,
    };
  }
  return {
    completenessGrade: evidence.completenessGrade,
    comparisonBasis: evidence.comparisonBasis,
    reconstructedBenefitCents: evidence.reconstructedMinor,
    boundsCents: evidence.boundsMinor,
    deltaCents: evidence.deltaMinor,
    withinTolerance: evidence.withinTolerance,
    toleranceSetId: evidence.toleranceSetId,
    hypotheses,
    blockingValidationOutstanding: evidence.blockingValidationOutstanding,
    boundWidthMaterial: evidence.boundWidthMaterial,
    boundWidthJustification: evidence.boundWidthJustification,
    missingEvidence,
    nextSteps:
      recommendation.nextSteps.length > 0 ? recommendation.nextSteps : evidence.nextSteps,
    correctedBenefitCents: recommendation.correctedBenefitMinor,
    correctionReasonablyCertain: evidence.correctionReasonablyCertain,
    correctionDirection: evidence.correctionDirection,
    recordedBenefitCents: evidence.recordedMinor,
    statisticalOnly: evidence.statisticalOnly,
    ruleApplicabilityOk: evidence.ruleApplicabilityOk,
    snapshotMatches: evidence.snapshotMatches,
    exactSupported: evidence.reconstructedMinor !== null,
    hasEvidenceState: true,
    supportedGround: evidence.supportedGround,
    boundAssumptionsInDoubt: evidence.boundAssumptionsInDoubt,
    conflictingCorrections: evidence.conflictingCorrections,
    uninvestigatedFlag: evidence.uninvestigatedFlag,
    basisUnresolvable: evidence.basisUnresolvable,
    contradictoryEvidenceUnresolved: evidence.contradictoryEvidenceUnresolved,
    indeterminateContent,
  };
}

/**
 * Check a recommendation against the decisions.ts entry conditions.
 * Returns the guard's verdict: whether the recommended disposition's
 * entry conditions hold on this evidence, and the failures when they
 * do not. A recommendation whose entry conditions do not hold must not
 * be proposed as-is — the mapping and the guard disagree, and the
 * disagreement is itself a finding for the coordinator, not something
 * to paper over.
 */
export function checkRecommendation(
  evidence: DispositionEvidence,
  recommendation: DispositionRecommendation,
): { holds: boolean; failures: string[] } {
  return checkEntryConditions(recommendation.disposition, toEntryCheckInput(evidence, recommendation));
}

/**
 * True when a recommendation is only a recommendation: status
 * "recommended", no approval, no downstream use. There is no input to
 * this module that can produce an approved record.
 */
export function recommendationIsNotApproval(
  recommendation: DispositionRecommendation,
): boolean {
  return (
    recommendation.status === "recommended" &&
    recommendation.downstreamUse.usableInValuation === false &&
    recommendation.downstreamUse.valueCents === null &&
    recommendation.downstreamUse.paAmbAccept === null
  );
}

// ---------------------------------------------------------------------------
// Worked examples (Stage 1 §4.3 / §4.7; synthetic participants SYN-xxx)
// ---------------------------------------------------------------------------

function baseEvidence(overrides: Partial<DispositionEvidence>): DispositionEvidence {
  return {
    participantKey: "SYN-001",
    caseId: "00000001",
    toleranceSetId: "tol-1",
    completenessGrade: "complete",
    comparisonBasis: "established",
    basisUnresolvable: false,
    basisNote: null,
    reconstructedMinor: null,
    recordedMinor: null,
    deltaMinor: null,
    withinTolerance: null,
    denominatorFlag: null,
    boundsMinor: null,
    boundWidthMaterial: false,
    boundWidthJustification: null,
    boundAssumptionsInDoubt: false,
    hypotheses: [],
    conflictingCorrections: false,
    correctedBenefitMinor: null,
    correctionReasonablyCertain: false,
    correctionDirection: null,
    missingEvidence: [],
    dataRequests: [],
    nextSteps: [],
    uninvestigatedFlag: false,
    blockingValidationOutstanding: false,
    statisticalOnly: false,
    contradictoryEvidenceUnresolved: false,
    supportedGround: null,
    indeterminateRationale: null,
    noFurtherRequestReason: null,
    ruleApplicabilityOk: true,
    snapshotMatches: true,
    ...overrides,
  };
}

/** SYN-001: exact $1,500.00, Δ $0 → Verified. */
export function workedExampleSyn001(): DispositionEvidence {
  return baseEvidence({
    participantKey: "SYN-001",
    reconstructedMinor: 150000,
    recordedMinor: 150000,
    deltaMinor: 0,
    withinTolerance: true,
  });
}

/**
 * SYN-002: bounds $1,584–$1,683 with PA_AMB $1,620 inside but the width
 * material → Requires investigation.
 */
export function workedExampleSyn002(): DispositionEvidence {
  return baseEvidence({
    participantKey: "SYN-002",
    completenessGrade: "partial",
    reconstructedMinor: null,
    recordedMinor: 162000,
    deltaMinor: null,
    withinTolerance: null,
    boundsMinor: { min: 158400, max: 168300 },
    boundWidthMaterial: true,
    boundWidthJustification: null,
    missingEvidence: [
      {
        input: "CompensationHistory.salaryYear 2019",
        missingClass: "M3",
        decisionImpact: "Resolving it narrows the bounds by $99.00/month and could move the participant out of Requires investigation.",
        uncertaintyContributionMinor: 9900,
      },
    ],
    nextSteps: ["Obtain compensation year 2019 from the payroll records."],
  });
}

/**
 * SYN-V-01: $850.00 vs $849.50 (Δ $0.50 explained by a documented
 * rounding rule) → Verified.
 */
export function workedExampleSynV01(): DispositionEvidence {
  return baseEvidence({
    participantKey: "SYN-V-01",
    reconstructedMinor: 84950,
    recordedMinor: 85000,
    deltaMinor: 50,
    withinTolerance: true,
    hypotheses: [
      {
        code: "H15",
        supportClass: "supported",
        material: true,
        correctedBenefitMinor: null,
      },
    ],
  });
}

/**
 * SYN-I-01: Indeterminate (DOTE blank → measurement date unresolved
 * and unresolvable from available documents → no Δ → Indeterminate).
 */
export function workedExampleSynI01(): DispositionEvidence {
  return baseEvidence({
    participantKey: "SYN-I-01",
    completenessGrade: "insufficient",
    comparisonBasis: "unresolved",
    basisUnresolvable: true,
    basisNote: "DOTE is blank; no PA benefit schedule or plan document establishes the measurement date.",
    reconstructedMinor: null,
    recordedMinor: null,
    deltaMinor: null,
    withinTolerance: null,
    missingEvidence: [
      {
        input: "DOTE (measurement date)",
        missingClass: "M5",
        decisionImpact: "Without a measurement date no comparison basis exists and no Δ can be computed.",
        uncertaintyContributionMinor: null,
      },
      {
        input: "PA_AMB",
        missingClass: "M1",
        decisionImpact: "Without the recorded amount there is nothing to compare.",
        uncertaintyContributionMinor: null,
      },
    ],
    dataRequests: [
      {
        requestId: "req-syn-i-01-1",
        input: "DOTE (measurement date)",
        participantKeys: ["SYN-I-01"],
        sourceToAsk: "PA benefit schedule",
        expectedDecisionEffect: "Establishing the measurement date would resolve the comparison basis and could move the participant out of Indeterminate.",
        priority: 1,
        status: "issued",
        statusReason: "Issued; awaiting response.",
        requestedDate: "2026-11-12",
        answeredDate: null,
      },
    ],
    indeterminateRationale:
      "The measurement date (DOTE) is blank and cannot be established from available documents, so no comparison basis exists and no Δ can be computed; no justified bounds can be established without a basis.",
    noFurtherRequestReason: null,
  });
}

/** All four worked examples, as evidence inputs, in order. */
export function workedExamples(): DispositionEvidence[] {
  return [
    workedExampleSyn001(),
    workedExampleSyn002(),
    workedExampleSynV01(),
    workedExampleSynI01(),
  ];
}

/** The §4.7 mapping rows, as data, so a test can assert every row is
 *  reachable and reaches exactly one disposition. */
export const MAPPING_ROWS: ReadonlyArray<{ row: string; disposition: Disposition }> = [
  { row: "B̂_i exact; Δ within tolerance; basis established", disposition: "verified" },
  { row: "B̂_i not exact; B_i^PA inside justified bounds; bounds narrow relative to materiality; no better competing hypothesis", disposition: "supported-for-acceptance" },
  { row: "B̂_i not exact; B_i^PA inside bounds but bounds wide relative to materiality, or a competing hypothesis is unresolved", disposition: "requires-investigation" },
  { row: "B_i^PA outside justified bounds, or a supported hypothesis identifies a specific error and the corrected value (reasonably certain)", disposition: "correction-recommended" },
  { row: "B_i^PA outside bounds but the assumptions behind the bounds are themselves in doubt", disposition: "requires-investigation" },
  { row: "No B̂_i and no justifiable bounds (class M5, or unresolved comparison basis that cannot be resolved)", disposition: "indeterminate" },
  { row: "B_i^PA blank (missing) with no independent reconstruction", disposition: "indeterminate" },
];

export type { DeterminationMissingEvidence };
