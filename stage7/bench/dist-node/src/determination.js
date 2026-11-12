"use strict";
/**
 * DeterminationRecord — the ten §14 documentation items.
 *
 * Stage 2 output 05, §7 (MASTER_PROMPT §14). Every approved determination
 * retains its supporting evidence (Invariant 7). The approval gate (§4)
 * requires a complete determination record plus the approval record (§4.2)
 * and a frozen evidence snapshot (§4.3).
 *
 * Completeness rule (§7): a record is complete only when all ten items are
 * present. Items that do not apply are stated as not applying, with the
 * reason — a stated "none" counts as present; a missing item blocks
 * approval. This module implements that rule as follows (resolved
 * interpretation, recorded here because the spec states the rule but not
 * its representation):
 * - A list item (5 missing evidence, 6 material assumptions, 8 supporting
 *   documents, data requests) is present when the array is present; an
 *   empty array means "none", stated explicitly. §7 says this outright
 *   for item 6 ("an empty list means 'no material assumptions'"); the
 *   same reading is applied to the other list items.
 * - A scalar that does not apply is present when its field is present with
 *   the "none" value the spec names for it (e.g. item 2 amountCents null
 *   together with calculationStatus "indeterminate" and a noBoundsReason;
 *   item 10 approvalId null until approved).
 * - A field that is `undefined` (absent) is missing, never "none".
 *
 * The approval function refuses an incomplete record as a result, never
 * by throwing for a missing item. It also enforces the human gate: the
 * reviewer must be a named human (never "system"), must match the reviewer
 * named in the record (05 §3.3 — nobody approves another reviewer's
 * determination without recording themselves as the reviewer), and the
 * rationale must be substantive ("Agreed" without a reason is not a
 * rationale, 05 §4.2).
 *
 * Pure functions only. No clock, no network, no storage. IDs, dates, and
 * the content hash are caller-supplied: hashing is a boundary concern, and
 * this module never computes one. Money is integer minor units (cents).
 *
 * Synthetic data only. No live case data.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DETERMINATION_SCHEMA_VERSION = void 0;
exports.isSubstantiveRationale = isSubstantiveRationale;
exports.checkDeterminationCompleteness = checkDeterminationCompleteness;
exports.checkDownstreamConsistency = checkDownstreamConsistency;
exports.approveDetermination = approveDetermination;
exports.toActuarialDecision = toActuarialDecision;
/** Disposition state-machine / determination schema version (05 §2.1). */
exports.DETERMINATION_SCHEMA_VERSION = "1.0.0";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isIntegerCents(value) {
    return typeof value === "number" && Number.isInteger(value);
}
/**
 * A rationale is substantive when it is non-empty and is not the bare word
 * "agreed" (05 §4.2: '"Agreed" without a reason is not a rationale').
 * The check is deliberately narrow: any reasoned sentence passes, however
 * short; only an empty rationale or the bare word fails.
 */
function isSubstantiveRationale(rationale) {
    if (!isNonEmptyString(rationale))
        return false;
    return rationale.trim().toLowerCase() !== "agreed";
}
/** Valid disposition names (MASTER_PROMPT §14; proposed application states). */
const DISPOSITIONS = [
    "verified",
    "supported-for-acceptance",
    "requires-investigation",
    "correction-recommended",
    "indeterminate",
];
function isDisposition(value) {
    return typeof value === "string" && DISPOSITIONS.includes(value);
}
// ---------------------------------------------------------------------------
// Completeness (§7 completeness rule)
// ---------------------------------------------------------------------------
/**
 * Check a determination record against the ten §14 items.
 * A stated "none" counts as present (see module note); a missing
 * (`undefined`) item blocks approval and is named in `missingItems`.
 * This function judges presence, not sufficiency of the evidence: a
 * present-but-wrong item is a reviewer question, not a completeness
 * failure. Downstream consistency (does the downstream block match the
 * disposition per §1.4?) is checked by `checkDownstreamConsistency` and
 * enforced by `approveDetermination`, not here.
 */
function checkDeterminationCompleteness(record) {
    const missingItems = [];
    const presentItems = [];
    const miss = (item, label, reason) => {
        missingItems.push({ item, label, reason });
    };
    const present = (item) => {
        presentItems.push(item);
    };
    // Header: the record's own identity. Not a §14 item, but a record
    // without an id, participant, case, schema version, or content hash
    // cannot be approved or audited.
    const headerFields = [
        ["determinationId", record.determinationId],
        ["dispositionId", record.dispositionId],
        ["participantKey", record.participantKey],
        ["caseId", record.caseId],
        ["schemaVersion", record.schemaVersion],
        ["createdAt", record.createdAt],
        ["createdBy", record.createdBy],
        ["contentHash", record.contentHash],
    ];
    for (const [field, value] of headerFields) {
        if (!isNonEmptyString(value)) {
            miss(0, "header", `header field "${field}" is missing or empty`);
        }
    }
    // Item 1 — recorded benefit. amountCents null is the stated "blank"
    // (missing, never 0) and is present when isBlank is true; a recorded
    // zero is amountCents 0 with isBlank false. The two must agree.
    const item1 = record.recordedBenefit;
    if (item1 === undefined || item1 === null) {
        miss(1, "recorded administrator benefit", "item 1 is absent");
    }
    else {
        const amountOk = item1.amountCents === null || isIntegerCents(item1.amountCents);
        const blankAgrees = typeof item1.isBlank === "boolean" &&
            (item1.amountCents === null) === item1.isBlank;
        if (!amountOk) {
            miss(1, "recorded administrator benefit", "amountCents is not integer cents or null");
        }
        else if (!blankAgrees) {
            miss(1, "recorded administrator benefit", "isBlank does not agree with amountCents (blank means amountCents null, never 0)");
        }
        else if (!isNonEmptyString(item1.sourceScheduleRef)) {
            miss(1, "recorded administrator benefit", "sourceScheduleRef is missing or empty");
        }
        else {
            present(1);
        }
    }
    // Item 2 — calculated benefit, if available. A null amount is present
    // only with a status that says why, plus bounds or a no-bounds reason.
    const item2 = record.calculatedBenefit;
    if (item2 === undefined || item2 === null) {
        miss(2, "independently calculated benefit", "item 2 is absent");
    }
    else {
        const statusOk = item2.calculationStatus === "complete" ||
            item2.calculationStatus === "partial" ||
            item2.calculationStatus === "blocked" ||
            item2.calculationStatus === "indeterminate";
        const amountOk = item2.amountCents === null || isIntegerCents(item2.amountCents);
        const boundsOk = item2.boundsCents === null ||
            (isIntegerCents(item2.boundsCents.min) &&
                isIntegerCents(item2.boundsCents.max) &&
                item2.boundsCents.min <= item2.boundsCents.max);
        const noAmountExplained = item2.amountCents !== null ||
            item2.boundsCents !== null ||
            isNonEmptyString(item2.noBoundsReason);
        if (!statusOk) {
            miss(2, "independently calculated benefit", "calculationStatus is missing or invalid");
        }
        else if (!amountOk) {
            miss(2, "independently calculated benefit", "amountCents is not integer cents or null");
        }
        else if (!boundsOk) {
            miss(2, "independently calculated benefit", "boundsCents is not a valid [min, max] cent range or null");
        }
        else if (!noAmountExplained) {
            miss(2, "independently calculated benefit", "no calculated amount and no bounds and no noBoundsReason — the absence is unstated");
        }
        else {
            present(2);
        }
    }
    // Item 3 — comparison basis and provisions. An unresolved basis is
    // present as a statement, but then no Δ may exist (G-INV-3).
    const item3 = record.comparisonBasis;
    if (item3 === undefined || item3 === null) {
        miss(3, "comparison basis and applicable provisions", "item 3 is absent");
    }
    else {
        const basisOk = item3.basis === "established" || item3.basis === "unresolved";
        const stateOk = item3.comparisonBasisState === "same-basis" ||
            item3.comparisonBasisState === "basis-converted" ||
            item3.comparisonBasisState === "unresolved";
        // An unresolved basis with a recorded (non-null) Δ is the G-INV-3
        // violation: no Δ exists across non-equivalent bases.
        const deltaViolation = item3.basis === "unresolved" && item3.deltaCents !== null;
        if (!basisOk) {
            miss(3, "comparison basis and applicable provisions", "basis is missing or invalid");
        }
        else if (!stateOk) {
            miss(3, "comparison basis and applicable provisions", "comparisonBasisState is missing or invalid");
        }
        else if (!isNonEmptyString(item3.toleranceSetId)) {
            miss(3, "comparison basis and applicable provisions", "toleranceSetId is missing or empty");
        }
        else if (item3.basis === "established" && !isNonEmptyString(item3.measurementDate)) {
            miss(3, "comparison basis and applicable provisions", "basis is established but measurementDate is missing");
        }
        else if (deltaViolation) {
            miss(3, "comparison basis and applicable provisions", "a Δ is recorded while the comparison basis is unresolved (no Δ exists across non-equivalent bases)");
        }
        else if (!Array.isArray(item3.planVersionIds)) {
            miss(3, "comparison basis and applicable provisions", "planVersionIds is missing");
        }
        else {
            present(3);
        }
    }
    // Item 4 — differences and explanations. hypotheses may be an empty
    // array (stated: no hypothesis was proposed); leadingExplanation must
    // say so ("none supported" / "none proposed") rather than stay silent.
    const item4 = record.differencesAndExplanations;
    if (item4 === undefined || item4 === null) {
        miss(4, "differences and their possible explanations", "item 4 is absent");
    }
    else if (!Array.isArray(item4.hypotheses)) {
        miss(4, "differences and their possible explanations", "hypotheses is missing");
    }
    else if (!isNonEmptyString(item4.leadingExplanation)) {
        miss(4, "differences and their possible explanations", "leadingExplanation is missing or empty");
    }
    else {
        present(4);
    }
    // Item 5 — missing evidence. Present array; empty = stated "none".
    const item5 = record.missingEvidence;
    if (!Array.isArray(item5)) {
        miss(5, "missing evidence", "item 5 is absent (an empty array means stated none)");
    }
    else {
        const bad = item5.find((entry) => entry === null ||
            entry === undefined ||
            !isNonEmptyString(entry.input) ||
            !isNonEmptyString(entry.decisionImpact));
        if (bad !== undefined) {
            miss(5, "missing evidence", "a missing-evidence entry lacks its input or decision impact");
        }
        else {
            present(5);
        }
    }
    // Item 6 — material assumptions. Present array; empty = stated "none".
    const item6 = record.materialAssumptions;
    if (!Array.isArray(item6)) {
        miss(6, "material assumptions", "item 6 is absent (an empty array means stated none)");
    }
    else {
        const bad = item6.find((entry) => entry === null ||
            entry === undefined ||
            !isNonEmptyString(entry.assumption) ||
            !isNonEmptyString(entry.basis) ||
            !isNonEmptyString(entry.effectIfWrong));
        if (bad !== undefined) {
            miss(6, "material assumptions", "a material-assumption entry lacks its assumption, basis, or effectIfWrong");
        }
        else {
            present(6);
        }
    }
    // Item 7 — sensitivity and uncertainty. Scenarios and attribution may
    // be empty arrays (stated: none evaluated / none attributable); the
    // disposition-sensitivity statement must be present.
    const item7 = record.sensitivityAndUncertainty;
    if (item7 === undefined || item7 === null) {
        miss(7, "sensitivity and uncertainty", "item 7 is absent");
    }
    else if (!Array.isArray(item7.scenarios)) {
        miss(7, "sensitivity and uncertainty", "scenarios is missing");
    }
    else if (!Array.isArray(item7.uncertaintyAttribution)) {
        miss(7, "sensitivity and uncertainty", "uncertaintyAttribution is missing");
    }
    else if (!isNonEmptyString(item7.dispositionSensitivity)) {
        miss(7, "sensitivity and uncertainty", "dispositionSensitivity is missing or empty");
    }
    else {
        present(7);
    }
    // Item 8 — supporting documents. Present array; empty = stated "none".
    const item8 = record.supportingDocuments;
    if (!Array.isArray(item8)) {
        miss(8, "supporting documents and precise citations", "item 8 is absent (an empty array means stated none)");
    }
    else {
        const bad = item8.find((entry) => entry === null ||
            entry === undefined ||
            !isNonEmptyString(entry.documentId) ||
            !isNonEmptyString(entry.citation) ||
            !isNonEmptyString(entry.whatItSupports));
        if (bad !== undefined) {
            miss(8, "supporting documents and precise citations", "a supporting-document entry lacks its document, citation, or whatItSupports");
        }
        else {
            present(8);
        }
    }
    // Item 9 — recommended disposition.
    const item9 = record.recommendedDisposition;
    if (item9 === undefined || item9 === null) {
        miss(9, "recommended disposition", "item 9 is absent");
    }
    else if (!isDisposition(item9.disposition)) {
        miss(9, "recommended disposition", "disposition is missing or invalid");
    }
    else if (!isNonEmptyString(item9.recommendedBy)) {
        miss(9, "recommended disposition", "recommendedBy is missing or empty");
    }
    else if (!isNonEmptyString(item9.recommendedAt)) {
        miss(9, "recommended disposition", "recommendedAt is missing or empty");
    }
    else if (!isNonEmptyString(item9.recommendationRationale)) {
        miss(9, "recommended disposition", "recommendationRationale is missing or empty");
    }
    else {
        present(9);
    }
    // Item 10 — human determination. approvalId may be null until approved;
    // the rationale must be substantive (not bare "agreed").
    const item10 = record.humanDetermination;
    if (item10 === undefined || item10 === null) {
        miss(10, "human determination, rationale, reviewer, and date", "item 10 is absent");
    }
    else if (!isDisposition(item10.disposition)) {
        miss(10, "human determination, rationale, reviewer, and date", "disposition is missing or invalid");
    }
    else if (!isSubstantiveRationale(item10.rationale)) {
        miss(10, "human determination, rationale, reviewer, and date", 'rationale is missing or is the bare word "agreed" without a reason');
    }
    else if (!isNonEmptyString(item10.reviewer) || item10.reviewer.trim() === "system") {
        miss(10, "human determination, rationale, reviewer, and date", "reviewer is missing or is the system, not a human");
    }
    else if (!isNonEmptyString(item10.reviewerRole)) {
        miss(10, "human determination, rationale, reviewer, and date", "reviewerRole is missing or empty");
    }
    else if (!isNonEmptyString(item10.determinationDate)) {
        miss(10, "human determination, rationale, reviewer, and date", "determinationDate is missing or empty");
    }
    else {
        present(10);
    }
    // Data requests (carried forward, §5.3): present array; empty = none.
    if (!Array.isArray(record.dataRequests)) {
        miss(0, "header", "dataRequests is absent (an empty array means stated none)");
    }
    // Downstream consequence: presence here; consistency with the
    // disposition is an approval check (checkDownstreamConsistency).
    const downstream = record.downstream;
    if (downstream === undefined || downstream === null) {
        miss(0, "header", "downstream is absent");
    }
    else if (downstream.valueKind !== "recorded" &&
        downstream.valueKind !== "corrected" &&
        downstream.valueKind !== "none") {
        miss(0, "header", "downstream.valueKind is missing or invalid");
    }
    return {
        complete: missingItems.length === 0,
        missingItems,
        presentItems,
    };
}
/**
 * Does the record's downstream block match its determined disposition?
 * Proposed mapping (§1.4; OD-2 leaves the Requires investigation /
 * Indeterminate flag open, so "N" or null are both accepted there):
 * - Verified / Supported for acceptance: usable, valueKind "recorded",
 *   value = the recorded benefit, PA_AMB_ACCEPT "Y".
 * - Correction recommended: usable, valueKind "corrected", value = the
 *   corrected benefit (which must be present), PA_AMB_ACCEPT "N".
 * - Requires investigation / Indeterminate: not usable, valueKind "none",
 *   value null, PA_AMB_ACCEPT "N" or null (unset until resolved).
 * The 5.8-1 $1/$5 tolerances do not decide this mapping; they govern a
 * separate, later decision about correcting an issued benefit
 * determination (§1.2.4 item 6).
 */
function checkDownstreamConsistency(record) {
    const reasons = [];
    const disposition = record.humanDetermination?.disposition;
    const downstream = record.downstream;
    if (disposition === undefined || !isDisposition(disposition)) {
        return { consistent: false, reasons: ["humanDetermination.disposition is missing or invalid"] };
    }
    if (downstream === undefined || downstream === null) {
        return { consistent: false, reasons: ["downstream is absent"] };
    }
    const recorded = record.recordedBenefit?.amountCents ?? null;
    const corrected = record.calculatedBenefit?.correctedBenefitCents ?? null;
    if (disposition === "verified" || disposition === "supported-for-acceptance") {
        if (!downstream.usableInValuation)
            reasons.push(`${disposition} must be usable in the valuation`);
        if (downstream.valueKind !== "recorded")
            reasons.push(`${disposition} must carry valueKind "recorded"`);
        if (downstream.valueCents !== recorded) {
            reasons.push(`${disposition} must carry the recorded benefit as its value`);
        }
        if (downstream.paAmbAccept !== "Y")
            reasons.push(`${disposition} must set PA_AMB_ACCEPT to "Y"`);
    }
    else if (disposition === "correction-recommended") {
        if (!downstream.usableInValuation)
            reasons.push("correction-recommended must be usable in the valuation as the corrected value");
        if (downstream.valueKind !== "corrected")
            reasons.push("correction-recommended must carry valueKind \"corrected\"");
        if (corrected === null) {
            reasons.push("correction-recommended must state a specific corrected benefit");
        }
        else if (downstream.valueCents !== corrected) {
            reasons.push("correction-recommended must carry the corrected benefit as its value");
        }
        if (downstream.paAmbAccept !== "N")
            reasons.push('correction-recommended must set PA_AMB_ACCEPT to "N" for the recorded amount as recorded');
    }
    else {
        // requires-investigation | indeterminate: blocked use.
        if (downstream.usableInValuation)
            reasons.push(`${disposition} must block use in the valuation`);
        if (downstream.valueKind !== "none")
            reasons.push(`${disposition} must carry valueKind "none"`);
        if (downstream.valueCents !== null)
            reasons.push(`${disposition} must carry no value`);
        if (downstream.paAmbAccept !== "N" && downstream.paAmbAccept !== null) {
            reasons.push(`${disposition} must set PA_AMB_ACCEPT to "N" or leave it unset (OD-2)`);
        }
    }
    return { consistent: reasons.length === 0, reasons };
}
/**
 * Approve a determination record. Refuses (as a result, never a throw for
 * a missing item) when:
 * - any §14 item is missing (G-INV-7);
 * - the downstream block does not match the determined disposition (§1.4);
 * - the reviewer is not a named human, or is not the reviewer named in
 *   the record (§3.3);
 * - the rationale is not substantive;
 * - any §4.2 confirmation is false.
 * On success the returned record is a new object with approvalId set; the
 * input record is untouched. Setting approvalId here does not by itself
 * create an approved DispositionRecord — that is transition T3 in
 * decisions.ts, which calls this function as its gate.
 */
function approveDetermination(record, approval) {
    const reasons = [];
    const completeness = checkDeterminationCompleteness(record);
    for (const missing of completeness.missingItems) {
        reasons.push(`§14 item ${missing.item} (${missing.label}) incomplete: ${missing.reason}`);
    }
    const downstream = checkDownstreamConsistency(record);
    reasons.push(...downstream.reasons);
    if (!isNonEmptyString(approval.approvalId))
        reasons.push("approvalId is missing or empty");
    if (!isNonEmptyString(approval.reviewer) || approval.reviewer.trim() === "system") {
        reasons.push("approval requires a named human reviewer, not the system");
    }
    if (!isNonEmptyString(approval.reviewerRole))
        reasons.push("reviewerRole is missing or empty");
    if (!isSubstantiveRationale(approval.rationale)) {
        reasons.push('approval rationale is missing or is the bare word "agreed" without a reason');
    }
    if (!isNonEmptyString(approval.approvalDate))
        reasons.push("approvalDate is missing or empty");
    const namedReviewer = record.humanDetermination?.reviewer;
    if (isNonEmptyString(namedReviewer) &&
        isNonEmptyString(approval.reviewer) &&
        namedReviewer.trim() !== approval.reviewer.trim()) {
        reasons.push("the approver must be the reviewer named in the determination (nobody approves another reviewer's determination without recording themselves as the reviewer)");
    }
    const confirmations = approval.confirmations;
    if (confirmations === undefined || confirmations === null) {
        reasons.push("§4.2 confirmations are absent");
    }
    else {
        if (!confirmations.entryConditionsHold)
            reasons.push("confirmation refused: entry conditions do not hold");
        if (!confirmations.determinationComplete)
            reasons.push("confirmation refused: determination is not complete");
        if (!confirmations.toleranceIdentified)
            reasons.push("confirmation refused: tolerance set is not identified");
        if (!confirmations.noMaterialUnexplainedItem) {
            reasons.push("confirmation refused: a material unexplained item remains (or is unnamed)");
        }
    }
    if (reasons.length > 0)
        return { approved: false, reasons };
    // checkDeterminationCompleteness passed, so the record is complete.
    const full = record;
    const approvedRecord = {
        ...full,
        humanDetermination: {
            ...full.humanDetermination,
            approvalId: approval.approvalId,
        },
    };
    return { approved: true, record: approvedRecord, approvalId: approval.approvalId };
}
// ---------------------------------------------------------------------------
// Mapping to the case package entity (Stage 2 output 01, §7.14)
// ---------------------------------------------------------------------------
/**
 * Build the ActuarialDecision entity that stores an approved determination
 * in the case package. The determination record carries citations as
 * strings; the ActuarialDecision's supportingDocuments are EvidenceItems
 * with precise SourceLocations, which only the caller holds — so the
 * caller supplies them. EntityCommon, observation/calculation/comparison
 * ids are likewise caller-supplied. The rationale, missing evidence,
 * assumptions, and sensitivity are carried verbatim from the §14 items.
 */
function toActuarialDecision(record, common, supportingDocuments, ids) {
    const hypothesesConsidered = record.differencesAndExplanations.hypotheses.map((hypothesis) => hypothesis.id);
    return {
        ...common,
        decisionId: record.determinationId,
        participantKey: record.participantKey,
        disposition: record.humanDetermination.disposition,
        recordedBenefit: record.recordedBenefit.amountCents === null
            ? null
            : {
                amountMinor: record.recordedBenefit.amountCents,
                minorUnitsPerMajor: 100,
                currency: "USD",
                sourceDecimalPlaces: 2,
            },
        calculatedBenefit: record.calculatedBenefit.amountCents === null
            ? null
            : {
                amountMinor: record.calculatedBenefit.amountCents,
                minorUnitsPerMajor: 100,
                currency: "USD",
                sourceDecimalPlaces: 2,
            },
        correctedBenefit: record.calculatedBenefit.correctedBenefitCents === null
            ? null
            : {
                amountMinor: record.calculatedBenefit.correctedBenefitCents,
                minorUnitsPerMajor: 100,
                currency: "USD",
                sourceDecimalPlaces: 2,
            },
        bounds: record.calculatedBenefit.boundsCents === null
            ? null
            : {
                min: {
                    amountMinor: record.calculatedBenefit.boundsCents.min,
                    minorUnitsPerMajor: 100,
                    currency: "USD",
                    sourceDecimalPlaces: 2,
                },
                max: {
                    amountMinor: record.calculatedBenefit.boundsCents.max,
                    minorUnitsPerMajor: 100,
                    currency: "USD",
                    sourceDecimalPlaces: 2,
                },
            },
        rationale: record.humanDetermination.rationale,
        missingEvidence: record.missingEvidence
            .map((entry) => `${entry.input} (${entry.missingClass}): ${entry.decisionImpact}`)
            .join("; "),
        assumptions: record.materialAssumptions
            .map((entry) => `${entry.assumption} [basis: ${entry.basis}; if wrong: ${entry.effectIfWrong}]`)
            .join("; "),
        sensitivity: record.sensitivityAndUncertainty.dispositionSensitivity,
        comparisonBasis: record.comparisonBasis.comparisonBasisState,
        hypothesesConsidered,
        supportingDocuments,
        reviewer: record.humanDetermination.reviewer,
        decisionDate: record.humanDetermination.determinationDate,
        paAmbAccept: record.downstream.paAmbAccept,
        status: record.humanDetermination.approvalId === null ? "recorded" : "approved",
        approvedBy: record.humanDetermination.approvalId === null
            ? null
            : record.humanDetermination.reviewer,
        approvedDate: record.humanDetermination.approvalId === null
            ? null
            : record.humanDetermination.determinationDate,
        observationId: ids.observationId,
        calculationId: ids.calculationId,
        comparisonId: ids.comparisonId,
    };
}
