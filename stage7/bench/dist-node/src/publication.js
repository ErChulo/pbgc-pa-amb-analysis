"use strict";
/**
 * Stage 4.5 publication functions — FindingPublicationCalc,
 * WorkProductContributionCalc, and the AMB `data_issues` placement.
 *
 * Built on the core protocol in `contribution.ts` (Worker A). This module
 * is re-exported from `contribution.ts` so the test worker has one import
 * surface (`src/index.ts` already re-exports `contribution.ts`).
 *
 * Sources:
 * - MONADIC_ARCHITECTURE_SPEC.md §7.2 (record types), §7.3 (two-level
 *   provenance), §7.4 (citation rendering), §8.3 (AMB acceptance
 *   placement, as corrected: the eight items are RECOMMENDED publication
 *   contents, not sourced requirements), §9.1–§9.3, §10 gates G1–G14
 *   as they apply to publication (G1, G2, G3, G5, G6, G7, G8, G9, G12,
 *   G13; G4, G10, G11, G14 belong to the later R1 module).
 * - MONADIC_ASSESSMENT.md §5.1 (the Stage 4.5 plan) and §5.4 (what NOT
 *   to build — no formal monad system, no R1 assembly, no ledger).
 *
 * Rules that govern this file:
 * - Publication consumes ONLY pipeline-boundary outputs
 *   (`CalculationOutcome`, `DeterminationRecord`, validation results).
 *   It never calls formula functions directly, so the low-level `throw`s
 *   in `src/` cannot leak into published findings.
 * - Never publish an unsupported assertion as an established fact.
 *   `claimType` + `reviewState` carry the status. A finding with an
 *   explicit missing-evidence exception is allowed; an uncited fact is
 *   not. Every finding built here carries either non-empty `evidenceRefs`
 *   or a non-null `missingEvidenceException` — by construction, never
 *   neither.
 * - An Image Viewer document number, a finding, or a citation must come
 *   from a verified source — never inferred or invented. Evidence ids a
 *   caller asks to cite but that are not in the supplied evidence pool
 *   are dropped, never silently kept: the drop is recorded as a warning
 *   plus a `missing-evidence` open issue, and the finding carries a
 *   missing-evidence exception when the drop leaves it uncited.
 * - Publication never approves anything. Published findings start in
 *   reviewState `draft`, except a determination finding whose approval
 *   is already recorded (approvalId set) — G13: no draft claims an
 *   approval that was not recorded. Package status `approved` likewise
 *   requires a recorded approval (see `assembleContribution`).
 * - Synthetic data only in any example. No live case data.
 * - Pure functions only. No clock (dates are caller-supplied), no
 *   storage, no network, no fetch. Deterministic: rebuilding from the
 *   same inputs gives the same package (G12 as it applies to the package).
 *
 * What is NOT here (later workers / later modules):
 * - No test lives here. No formal monad system (no `Calc<A>`, no
 *   map/flatMap/bind helpers, no unified `CalcError`). No R1 assembly,
 *   registry parser, renderer, ledger, or ledger consumption.
 * - No change to approval behaviour: `publishableDetermination` is a
 *   check the caller invokes AFTER approval; publication is a separate
 *   step over the approved record, never a side effect of approval.
 *   `determination.ts` / `decisions.ts` are untouched.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AMB_PRODUCT_ID = void 0;
exports.publishFindings = publishFindings;
exports.assembleContribution = assembleContribution;
exports.isStaleContribution = isStaleContribution;
exports.buildAmbDataIssuesFragment = buildAmbDataIssuesFragment;
exports.publishableDetermination = publishableDetermination;
const determination_1 = require("./determination");
const validation_1 = require("./validation");
const decimal_1 = require("./decimal");
const contribution_1 = require("./contribution");
/** Work-product id carried on every AMB contribution package (spec §7.2). */
exports.AMB_PRODUCT_ID = "AMB";
/** R1 topic keys a calculation finding proposes as its destinations.
 *  Candidate destinations only — the verified section registry decides
 *  where a finding belongs. */
const CALCULATION_TOPICS = ["data_issues", "benefit_formula"];
/** R1 topic keys a validation or determination finding proposes. */
const DATA_ISSUES_TOPICS = ["data_issues"];
// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
/** Exact decimal dollars string for a Money amount, or null when there is
 *  no amount (blank = missing, never 0). */
function moneyDollars(amount) {
    if (amount === null)
        return null;
    return (0, decimal_1.moneyMinorToDecimalString)(amount.amountMinor);
}
/** Units for a benefit quantity's value: "USD/month" or "USD/year". */
function benefitUnits(benefit) {
    return benefit.periodicity === "monthly" ? "USD/month" : "USD/year";
}
/** Basis string for a benefit quantity's value: measurement basis + date. */
function benefitBasis(benefit) {
    const date = benefit.measurementDate;
    return date === null
        ? `measured ${benefit.measurementBasis}`
        : `measured ${benefit.measurementBasis} ${date}`;
}
/** Participant key a benefit quantity belongs to (`ownerId`), or null
 *  when the quantity carries no owner. */
function benefitOwnerId(benefit) {
    return benefit.ownerId === "" ? null : benefit.ownerId;
}
/** Render a Money amount for a finding statement, or "no amount recorded"
 *  when the amount is null. */
function statementAmount(amount) {
    if (amount === null)
        return "no amount recorded";
    return (0, validation_1.formatMoneyMinor)(amount.amountMinor);
}
/** Materiality record for findings published by this call. The caller
 *  states the rule; the default is material with no rule recorded, and
 *  the caller should supply the rule whenever one was applied. */
function publicationMateriality(input) {
    return {
        material: input.material ?? true,
        rule: input.materialityRule ?? null,
    };
}
/** Split requested evidence ids into those present in the pool and those
 *  that are not. Order-preserving, deduplicated. A requested id that is
 *  not in the pool is never cited: it is dropped and reported by the
 *  caller (see `publishFindings`). */
function resolveEvidenceIds(requested, pool) {
    const poolIds = new Set(pool.map((ref) => ref.evidenceId));
    const found = [];
    const dropped = [];
    const seen = new Set();
    for (const id of requested) {
        if (seen.has(id))
            continue;
        seen.add(id);
        if (poolIds.has(id))
            found.push(id);
        else
            dropped.push(id);
    }
    return { found, dropped };
}
/** Deduplicate an evidence pool by stable `evidenceId`, first occurrence
 *  wins, in first-seen order. Two records sharing one id with different
 *  content are a merge conflict for `mergeLogs`, not for publication:
 *  publication keeps the first and the caller resolves the conflict
 *  before publishing. */
function dedupeEvidenceById(pool) {
    const seen = new Set();
    const out = [];
    for (const ref of pool) {
        if (!seen.has(ref.evidenceId)) {
            seen.add(ref.evidenceId);
            out.push(ref);
        }
    }
    return out;
}
/** The `missing-evidence` open issue for one finding that was published
 *  without cited evidence (explicit exception recorded). Blocking when
 *  the finding is material — a material claim without evidence must be
 *  resolved before final use (G1) — non-blocking otherwise. */
function missingEvidenceIssue(finding, detail) {
    const blocking = finding.materiality.material;
    return {
        issueId: `missing-evidence:${finding.findingId}`,
        kind: "missing-evidence",
        severity: blocking ? "blocking" : "non-blocking",
        status: "open",
        message: `Finding ${finding.findingId} was published without cited evidence: ${detail}. ` +
            `The missing-evidence exception is recorded on the finding; resolve the evidence or withdraw the finding before final use.`,
        relatedFindingIds: [finding.findingId],
        relatedEvidenceIds: [],
        relatedFragmentIds: [],
    };
}
/** A blocking warning for evidence ids a caller asked to cite that are
 *  not in the supplied pool. The ids are dropped, never cited. */
function droppedEvidenceWarning(findingId, dropped) {
    return {
        warningId: `dropped-evidence:${findingId}`,
        message: `Evidence ids requested for finding ${findingId} were not in the supplied evidence pool and were not cited: ${dropped.join(", ")}. ` +
            `Cite only ids from a verified evidence pool.`,
        severity: "blocking",
        relatedFindingIds: [findingId],
        relatedEvidenceIds: [],
    };
}
/** Stable finding id for the calculation finding of a run. */
function calculationFindingId(runId) {
    return `amb:${runId}:calculation`;
}
/** Stable finding id for one scenario finding of a run. */
function scenarioFindingId(runId, scenarioName) {
    return `amb:${runId}:scenario:${scenarioName}`;
}
/** Stable finding id for one validation finding. */
function validationFindingId(runId, resultId) {
    return `amb:${runId}:validation:${resultId}`;
}
/** Stable finding id for the determination finding of a run. */
function determinationFindingId(runId, determinationId) {
    return `amb:${runId}:determination:${determinationId}`;
}
/**
 * Convert a `CalculationRun` (with its `CalculationOutcome`), validation
 * rule-check findings, and a `DeterminationRecord` into spec §7.2
 * `Finding`s with evidence attached and candidate R1 destinations,
 * returned as a `WorkProductLog` (the Writer: trace events, findings,
 * evidence, warnings, decisions, open issues).
 *
 * What each input becomes:
 * - exact outcome → one `derived_result` finding: the reconstructed
 *   accrued benefit, with amount, units, basis, and measurement date.
 * - bounds outcome → one `derived_result` finding for the range, plus
 *   one `assumption` finding per named scenario (a scenario benefit
 *   holds only under its stated assumptions). Each scenario finding
 *   derives from the bounds finding (`derivedFromFindingIds`).
 * - indeterminate outcome → one `exception` finding: no defensible
 *   value could be produced, with the reason and what would resolve it.
 * - validation fail / not-applicable / not-run → one `exception`
 *   finding each, carrying the rule id, outcome, discrepancy, and the
 *   rule-check record id. The rule-check record is the evidence of the
 *   check, not a cited source: without supplied evidence ids the finding
 *   carries a missing-evidence exception naming that record.
 * - determination → one `decision` finding, deriving from the
 *   calculation finding. `reviewState` is `approved` only when the
 *   record already carries an approvalId (G13); otherwise `draft`.
 *   Every other finding starts in `draft` — publication never approves.
 *
 * Two-level provenance (§7.3): each finding's `evidenceRefs` are the
 * primary evidence ids; the interpreting work product is this AMB
 * publication itself (`originatingWorkProduct` "AMB", `originatingVersion`
 * product version + run id), recorded on every finding and on the
 * contribution package built from this log.
 *
 * Refusal, as values never as throws: nothing here throws for missing
 * evidence. A finding that ends up uncited carries a
 * `missingEvidenceException` and a `missing-evidence` open issue, and
 * evidence ids that are not in the pool are dropped with a blocking
 * warning plus the same issue. An uncited fact is never published as
 * established.
 */
function publishFindings(input) {
    const { run, outcome, productVersion } = input;
    const pool = dedupeEvidenceById(input.evidence);
    const materiality = publicationMateriality(input);
    const originatingVersion = `${productVersion} / ${run.runId}`;
    const trace = outcome.trace;
    const findings = [];
    const warnings = [];
    const openIssues = [];
    const decisions = [];
    /** Attach evidence (or an exception) to a finding under construction,
     *  recording drops and missing-evidence issues as values. */
    const attachEvidence = (finding, requested) => {
        const { found, dropped } = resolveEvidenceIds(requested, pool);
        if (dropped.length > 0) {
            warnings.push(droppedEvidenceWarning(finding.findingId, dropped));
        }
        if (found.length > 0) {
            return { ...finding, evidenceRefs: found, missingEvidenceException: null };
        }
        const withException = {
            ...finding,
            evidenceRefs: [],
            missingEvidenceException: finding.missingEvidenceException,
        };
        openIssues.push(missingEvidenceIssue(withException, finding.missingEvidenceException ?? "no evidence supplied"));
        return withException;
    };
    const calcEvidenceRequested = input.calculationEvidenceIds ?? [];
    const calcException = `No EvidenceRef supplied for calculation run ${run.runId}; ` +
        `the calculation trace (${trace.length} steps) is the derivation record, not a cited source.`;
    const ownerId = outcome.kind === "exact"
        ? benefitOwnerId(outcome.benefit)
        : outcome.kind === "bounds"
            ? benefitOwnerId(outcome.bounds.minBenefit)
            : null;
    const subjectIds = ownerId === null ? [] : [ownerId];
    // --- Calculation finding (exact / bounds / indeterminate) -------------
    if (outcome.kind === "exact") {
        const benefit = outcome.benefit;
        const amount = moneyDollars(benefit.amount);
        const lastStep = trace.length > 0 ? trace[trace.length - 1] : undefined;
        const base = {
            findingId: calculationFindingId(run.runId),
            caseId: run.caseId,
            originatingWorkProduct: "AMB",
            originatingVersion,
            claimType: "derived_result",
            subjectScope: "participant",
            subjectIds,
            effectivePeriod: {
                start: benefit.measurementDate,
                end: benefit.measurementDate,
            },
            valueAndUnits: {
                value: amount ?? "no amount recorded",
                units: benefitUnits(benefit),
                basis: benefitBasis(benefit),
            },
            findingStatement: amount === null
                ? `Reconstructed accrued benefit has no amount for participant ${ownerId ?? "unknown"} at ${benefit.measurementDate ?? "unresolved measurement date"}.`
                : `Reconstructed accrued benefit is ${statementAmount(benefit.amount)} per ${benefit.periodicity} for participant ${ownerId ?? "unknown"} at ${benefit.measurementDate ?? "unresolved measurement date"}.`,
            rationale: `Calculation run ${run.runId} (engine ${run.engineVersion}, rule version ${run.ruleVersion}), ` +
                `${trace.length} trace steps` +
                (lastStep === undefined ? "." : `; final step "${lastStep.name}" (${lastStep.ruleRef}).`),
            evidenceRefs: [],
            missingEvidenceException: calcException,
            derivedFromFindingIds: [],
            reviewState: "draft",
            materiality,
            intendedR1Topics: CALCULATION_TOPICS,
            supersedes: null,
        };
        findings.push(attachEvidence(base, calcEvidenceRequested));
    }
    else if (outcome.kind === "bounds") {
        const bounds = outcome.bounds;
        const minDollars = moneyDollars(bounds.min);
        const maxDollars = moneyDollars(bounds.max);
        const boundsId = calculationFindingId(run.runId);
        const base = {
            findingId: boundsId,
            caseId: run.caseId,
            originatingWorkProduct: "AMB",
            originatingVersion,
            claimType: "derived_result",
            subjectScope: "participant",
            subjectIds,
            effectivePeriod: {
                start: bounds.minBenefit.measurementDate,
                end: bounds.minBenefit.measurementDate,
            },
            valueAndUnits: {
                value: minDollars !== null && maxDollars !== null
                    ? `${minDollars} to ${maxDollars}`
                    : "bounds without amounts",
                units: benefitUnits(bounds.minBenefit),
                basis: benefitBasis(bounds.minBenefit),
            },
            findingStatement: `Reconstructed accrued benefit lies between ${statementAmount(bounds.min)} and ${statementAmount(bounds.max)} ` +
                `per ${bounds.minBenefit.periodicity} for participant ${ownerId ?? "unknown"} under the stated assumptions; ` +
                `recorded PA_AMB is ${bounds.recordedPosition}.`,
            rationale: `Calculation run ${run.runId} (engine ${run.engineVersion}, rule version ${run.ruleVersion}) ` +
                `could not reconstruct an exact benefit; justified bounds by ${bounds.derivation.method} ` +
                `over the feasible region: ${bounds.derivation.feasibleRegion}. ` +
                `Assumptions: ${bounds.assumptions.length === 0 ? "none stated" : bounds.assumptions.join("; ")}. ` +
                `Width attribution covers ${bounds.widthAttribution.length} missing input(s).`,
            evidenceRefs: [],
            missingEvidenceException: calcException,
            derivedFromFindingIds: [],
            reviewState: "draft",
            materiality,
            intendedR1Topics: CALCULATION_TOPICS,
            supersedes: null,
        };
        findings.push(attachEvidence(base, calcEvidenceRequested));
        for (const scenario of bounds.scenarios) {
            const scenarioBenefit = moneyDollars(scenario.benefit);
            const scenarioId = scenarioFindingId(run.runId, scenario.name);
            const scenarioTrace = scenario.trace ?? null;
            if (scenarioTrace === null) {
                warnings.push({
                    warningId: `scenario-trace-missing:${scenarioId}`,
                    message: `Scenario "${scenario.name}" carries no per-scenario derivation trace; ` +
                        `its benefit is published as an assumption on its stated assumptions only.`,
                    severity: "warning",
                    relatedFindingIds: [scenarioId],
                    relatedEvidenceIds: [],
                });
            }
            const scenarioBase = {
                findingId: scenarioId,
                caseId: run.caseId,
                originatingWorkProduct: "AMB",
                originatingVersion,
                claimType: "assumption",
                subjectScope: "participant",
                subjectIds,
                effectivePeriod: {
                    start: bounds.minBenefit.measurementDate,
                    end: bounds.minBenefit.measurementDate,
                },
                valueAndUnits: {
                    value: scenarioBenefit ?? "indeterminate",
                    units: scenarioBenefit === null ? null : benefitUnits(bounds.minBenefit),
                    basis: benefitBasis(bounds.minBenefit),
                },
                findingStatement: scenarioBenefit === null
                    ? `Under scenario "${scenario.name}" (${scenario.assumptions}), the benefit is indeterminate.`
                    : `Under scenario "${scenario.name}" (${scenario.assumptions}), the benefit is ${statementAmount(scenario.benefit)} per ${bounds.minBenefit.periodicity}.`,
                rationale: `Scenario of the bounds calculation for run ${run.runId} ` +
                    `(plan version ${scenario.planVersionId ?? "not stated"}, formula ${scenario.formulaId ?? "not stated"}); ` +
                    (scenarioTrace === null
                        ? "per-scenario derivation trace not recorded."
                        : `${scenarioTrace.length} derivation steps recorded.`),
                evidenceRefs: [],
                missingEvidenceException: calcException,
                derivedFromFindingIds: [boundsId],
                reviewState: "draft",
                materiality,
                intendedR1Topics: CALCULATION_TOPICS,
                supersedes: null,
            };
            findings.push(attachEvidence(scenarioBase, calcEvidenceRequested));
        }
    }
    else {
        const reason = outcome.reason;
        const base = {
            findingId: calculationFindingId(run.runId),
            caseId: run.caseId,
            originatingWorkProduct: "AMB",
            originatingVersion,
            claimType: "exception",
            subjectScope: "participant",
            subjectIds,
            effectivePeriod: { start: null, end: null },
            valueAndUnits: { value: "indeterminate", units: null, basis: null },
            findingStatement: `Accrued benefit could not be reconstructed for participant ${ownerId ?? "unknown"}: ${reason.detail}.`,
            rationale: `Calculation run ${run.runId} (engine ${run.engineVersion}, rule version ${run.ruleVersion}) ` +
                `ended indeterminate (code ${reason.code}); missing inputs: ` +
                `${reason.missingInputs.length === 0 ? "none named" : reason.missingInputs.join("; ")}; ` +
                `would resolve: ${reason.wouldResolve.length === 0 ? "nothing identified" : reason.wouldResolve.join("; ")}.`,
            evidenceRefs: [],
            missingEvidenceException: calcException,
            derivedFromFindingIds: [],
            reviewState: "draft",
            materiality,
            intendedR1Topics: DATA_ISSUES_TOPICS,
            supersedes: null,
        };
        findings.push(attachEvidence(base, calcEvidenceRequested));
    }
    // --- Validation findings ------------------------------------------------
    for (const validation of input.validations) {
        const requested = input.validationEvidenceIds?.[validation.resultId] ?? [];
        const base = {
            findingId: validationFindingId(run.runId, validation.resultId),
            caseId: run.caseId,
            originatingWorkProduct: "AMB",
            originatingVersion,
            claimType: "exception",
            subjectScope: validation.participantKey === null ? "plan" : "participant",
            subjectIds: validation.participantKey === null ? [] : [validation.participantKey],
            effectivePeriod: { start: null, end: null },
            valueAndUnits: {
                value: validation.outcome,
                units: null,
                basis: `rule ${validation.ruleId}`,
            },
            findingStatement: `Validation rule ${validation.ruleId} ${validation.outcome}: ${validation.discrepancy}`,
            rationale: `Rule-check record ${validation.resultId} (${validation.ruleSource}); ` +
                `investigation: ${validation.investigation}; disposition route: ${validation.dispositionRoute}. ` +
                `Fields examined: ${validation.fieldsExamined.length === 0 ? "none" : validation.fieldsExamined.join(", ")}.`,
            evidenceRefs: [],
            missingEvidenceException: `No EvidenceRef supplied for validation record ${validation.resultId} ` +
                `(rule ${validation.ruleId}, outcome ${validation.outcome}); ` +
                `the rule-check record is the evidence of the check, not a cited source.`,
            derivedFromFindingIds: [],
            reviewState: "draft",
            materiality,
            intendedR1Topics: DATA_ISSUES_TOPICS,
            supersedes: null,
        };
        findings.push(attachEvidence(base, requested));
    }
    // --- Determination finding ----------------------------------------------
    const determination = input.determination;
    if (determination !== null) {
        const determinationId = determination.determinationId;
        const findingId = determinationFindingId(run.runId, determinationId);
        const approved = determination.humanDetermination.approvalId !== null;
        const reviewState = approved ? "approved" : "draft";
        const matchedIds = determination.supportingDocuments
            .map((doc) => pool.find((ref) => ref.documentId === doc.documentId))
            .filter((ref) => ref !== undefined)
            .map((ref) => ref.evidenceId);
        const requested = [...matchedIds, ...(input.determinationEvidenceIds ?? [])];
        const downstream = determination.downstream;
        const valueCents = downstream.valueCents;
        const snapshot = input.determinationSnapshot ?? null;
        const base = {
            findingId,
            caseId: run.caseId,
            originatingWorkProduct: "AMB",
            originatingVersion,
            claimType: "decision",
            subjectScope: "participant",
            subjectIds: [determination.participantKey],
            effectivePeriod: {
                start: determination.comparisonBasis.measurementDate,
                end: determination.comparisonBasis.measurementDate,
            },
            valueAndUnits: {
                value: determination.humanDetermination.disposition,
                units: null,
                basis: determination.comparisonBasis.comparisonBasisState,
            },
            findingStatement: `Reviewer determined disposition "${determination.humanDetermination.disposition}" ` +
                `for participant ${determination.participantKey}; ` +
                `PA_AMB_ACCEPT ${downstream.paAmbAccept ?? "unset"}, downstream value ` +
                `${valueCents === null ? "none" : (0, validation_1.formatMoneyMinor)(valueCents)} (${downstream.valueKind}).`,
            rationale: `Determination ${determinationId} (schema ${determination.schemaVersion}, content hash ${determination.contentHash}); ` +
                `recommended "${determination.recommendedDisposition.disposition}" by ${determination.recommendedDisposition.recommendedBy}: ` +
                `${determination.recommendedDisposition.recommendationRationale}; ` +
                `human rationale: ${determination.humanDetermination.rationale}; ` +
                `reviewer ${determination.humanDetermination.reviewer} (${determination.humanDetermination.reviewerRole}), ` +
                `${determination.humanDetermination.determinationDate}` +
                (approved ? `; approval ${determination.humanDetermination.approvalId} recorded` : "; no approval recorded") +
                (snapshot === null
                    ? "."
                    : `; frozen evidence snapshot ${snapshot.snapshotId} (input snapshot ${snapshot.inputSnapshotHash}).`),
            evidenceRefs: [],
            missingEvidenceException: `No EvidenceRef matches the determination's supporting documents ` +
                `(determination ${determinationId}); the determination record ` +
                `(content hash ${determination.contentHash}) is the decision record, not a cited source.`,
            derivedFromFindingIds: [calculationFindingId(run.runId)],
            reviewState,
            materiality,
            intendedR1Topics: DATA_ISSUES_TOPICS,
            supersedes: null,
        };
        findings.push(attachEvidence(base, requested));
        decisions.push({
            decisionId: `amb:${run.runId}:decision:${determinationId}`,
            statement: `Disposition "${determination.humanDetermination.disposition}" determined for participant ${determination.participantKey}`,
            decidedBy: determination.humanDetermination.reviewer,
            decidedAt: determination.humanDetermination.determinationDate,
            basisFindingIds: [findingId],
        });
    }
    // --- Assemble the log ----------------------------------------------------
    const baseLog = {
        traceEvents: [...trace],
        findings,
        fragments: [],
        evidenceRefs: pool,
        warnings,
        decisions,
        openIssues,
    };
    // Missing Image Viewer numbers on material citations (spec §7.4): one
    // distinct blocking issue per material unsupported citation. Only refs
    // actually attached to a material finding are checked — an uncited pool
    // ref is not a citation.
    let log = baseLog;
    const checkedEvidenceIds = new Set();
    for (const finding of findings) {
        if (!finding.materiality.material)
            continue;
        for (const evidenceId of finding.evidenceRefs) {
            if (checkedEvidenceIds.has(evidenceId))
                continue;
            checkedEvidenceIds.add(evidenceId);
            const ref = pool.find((candidate) => candidate.evidenceId === evidenceId);
            if (ref !== undefined) {
                log = (0, contribution_1.appendMissingImageViewerIssue)(log, ref);
            }
        }
    }
    return log;
}
/**
 * Build the versioned AMB contribution package (`WorkProductContribution`)
 * from published findings + fragments + citations + warnings +
 * follow-ups (spec §2.10, §7.2, §11).
 *
 * Deterministic (G12 as it applies to the package): rebuilding from the
 * same log + run + metadata gives the same package — no clock, no
 * randomness, first-seen order throughout. `producedAt` is part of the
 * input, so a rebuild that reuses it is byte-identical; a rebuild at a
 * new date is a new package version, not a silent rewrite.
 *
 * G9 as it applies to the package: `sourceSnapshotId` pins the
 * `InputSnapshot` hash and `calculationRunId` pins the run. A source or
 * rule change must produce a new package version (bump `productVersion`);
 * consumers detect staleness with `isStaleContribution` — the package
 * itself never silently carries forward.
 *
 * Citations (G7): only evidence actually cited by the package's findings
 * or fragments is carried, deduplicated by stable `evidenceId` without
 * losing distinct page/cell citations (distinct citations are distinct
 * EvidenceRefs with distinct ids, all preserved). Rendered citation
 * strings are deduplicated separately by `renderCitations`, not here.
 */
function assembleContribution(input) {
    const findings = [...input.log.findings];
    const fragments = input.fragments === undefined ? [...input.log.fragments] : [...input.fragments];
    const citedIds = [];
    const seenCited = new Set();
    for (const finding of findings) {
        for (const id of finding.evidenceRefs) {
            if (!seenCited.has(id)) {
                seenCited.add(id);
                citedIds.push(id);
            }
        }
    }
    for (const fragment of fragments) {
        for (const id of fragment.evidenceRefs) {
            if (!seenCited.has(id)) {
                seenCited.add(id);
                citedIds.push(id);
            }
        }
    }
    const poolById = new Map(input.log.evidenceRefs.map((ref) => [ref.evidenceId, ref]));
    const citations = [];
    for (const id of citedIds) {
        const ref = poolById.get(id);
        if (ref !== undefined)
            citations.push(ref);
    }
    const warnings = [...input.log.warnings];
    const requestedStatus = input.status ?? "draft";
    let status = requestedStatus;
    if (requestedStatus === "approved" && (input.approval === undefined || input.approval === null)) {
        status = "draft";
        warnings.push({
            warningId: "contribution-approval-missing",
            message: `Package status "approved" was requested without a recorded approval (approvalId + reviewer); ` +
                `status recorded as "draft". No approval is claimed (G13).`,
            severity: "blocking",
            relatedFindingIds: findings.map((finding) => finding.findingId),
            relatedEvidenceIds: [],
        });
    }
    const requiredFollowups = input.requiredFollowups !== undefined
        ? [...input.requiredFollowups]
        : input.log.openIssues
            .filter((issue) => issue.status === "open" && issue.severity === "blocking")
            .map((issue) => issue.message);
    return {
        productId: exports.AMB_PRODUCT_ID,
        productVersion: input.productVersion,
        caseId: input.caseId,
        producedAt: input.producedAt,
        publishedBy: input.publishedBy,
        sourceSnapshotId: input.run.inputSnapshotHash,
        calculationRunId: input.run.runId,
        status,
        findings,
        fragments,
        citations,
        warnings,
        requiredFollowups,
        downstreamDependencies: input.downstreamDependencies !== undefined ? [...input.downstreamDependencies] : ["R1"],
    };
}
/**
 * G9 staleness check for a contribution package: true when the package
 * was built from a different input snapshot or a different calculation
 * run than the one supplied — i.e. a source or rule change has happened
 * since the package was produced, and the package must be rebuilt as a
 * new version, never silently carried forward. A product-version bump
 * alone does not make a package stale; the snapshot and run pins do.
 */
function isStaleContribution(pkg, run) {
    return pkg.sourceSnapshotId !== run.inputSnapshotHash || pkg.calculationRunId !== run.runId;
}
/** One recommended content as a labelled fragment line. A null content
 *  is stated as not established, never invented. */
function recommendedLine(label, content, notEstablished) {
    return `${label}: ${content === null ? notEstablished : content}`;
}
/**
 * Build the AMB acceptance placement (spec §8.3, corrected): a concise
 * `NarrativeFragment` targeting `data_issues` with the eight RECOMMENDED
 * contents — population; data availability and gaps; testing method;
 * differences and observed patterns; rationale for accepting or
 * correcting PA_AMB; exception counts and unresolved cases; original AMB
 * memo/workbook and supporting Image Viewer document numbers; reviewer
 * determination when applicable. The eight items are the AMB module's
 * recommended elaboration of the single sourced sentence ("indicate if
 * you accepted accrued benefits and support the decision"); they are not
 * presented as requirements from the R1 sample.
 *
 * The fragment references the complete AMB memo, the tested workbook,
 * and any appropriate appendix — it does NOT paste the entire AMB
 * analysis into the R1 main body by default. Where the AMB analysis
 * materially interprets the benefit formula, companion `benefit_formula`
 * and `interpretations` fragments are also produced.
 *
 * Citations use `citeEvidence`, so a missing Image Viewer number
 * renders as "Image Viewer document number pending" and becomes a
 * blocking open issue in the returned log (spec §7.4). A memo or
 * workbook reference not supplied is likewise a blocking open issue;
 * an appendix not supplied is non-blocking (an appendix is "any
 * appropriate Appendix", not always present).
 */
function buildAmbDataIssuesFragment(input) {
    const { run } = input;
    const findingIds = input.findings.map((finding) => finding.findingId);
    const displayOrder = input.displayOrder ?? 0;
    let log = input.log === undefined ? (0, contribution_1.createEmptyLog)() : input.log;
    const memoRef = input.memoRef ?? null;
    const workbookRef = input.workbookRef ?? null;
    const appendixRef = input.appendixRef ?? null;
    const citations = [];
    const referenceEvidenceIds = [];
    const referenceLines = [];
    const referenceIssues = [];
    const handleReference = (label, ref, blocking) => {
        if (ref === null) {
            referenceLines.push(`${label}: not supplied.`);
            referenceIssues.push({
                issueId: `missing-amb-reference:${label.toLowerCase().replace(/[^a-z]+/g, "-")}:${run.runId}`,
                kind: "missing-evidence",
                severity: blocking ? "blocking" : "non-blocking",
                status: "open",
                message: `AMB ${label} reference not supplied for run ${run.runId}; ` +
                    `the R1 data-issues summary must point at the complete AMB analysis. Supply the reference from a verified source.`,
                relatedFindingIds: findingIds,
                relatedEvidenceIds: [],
                relatedFragmentIds: [`amb:${run.runId}:fragment:data-issues`],
            });
            return;
        }
        const cited = (0, contribution_1.citeEvidence)(log, ref);
        log = cited.log;
        citations.push(cited.citation);
        referenceEvidenceIds.push(ref.evidenceId);
        referenceLines.push(`${label}: ${cited.citation}.`);
    };
    handleReference("Complete AMB memo", memoRef, true);
    handleReference("Tested workbook", workbookRef, true);
    handleReference("Appendix", appendixRef, false);
    const fragmentEvidenceIds = [];
    const seenEvidence = new Set();
    for (const id of [...referenceEvidenceIds]) {
        if (!seenEvidence.has(id)) {
            seenEvidence.add(id);
            fragmentEvidenceIds.push(id);
        }
    }
    for (const finding of input.findings) {
        for (const id of finding.evidenceRefs) {
            if (!seenEvidence.has(id)) {
                seenEvidence.add(id);
                fragmentEvidenceIds.push(id);
            }
        }
    }
    const content = [
        `AMB acceptance — run ${run.runId}, case ${run.caseId}.`,
        recommendedLine("Population", input.population, "Not established in the AMB analysis."),
        recommendedLine("Data availability and gaps", input.dataAvailability, "Not established in the AMB analysis."),
        recommendedLine("Testing method", input.testingMethod, "Not established in the AMB analysis."),
        recommendedLine("Differences and observed patterns", input.differencesAndPatterns, "Not established in the AMB analysis."),
        recommendedLine("Rationale for accepting or correcting PA_AMB", input.acceptanceRationale, "Not established in the AMB analysis."),
        recommendedLine("Exceptions and unresolved cases", input.exceptionCounts, "Not established in the AMB analysis."),
        ...referenceLines,
        recommendedLine("Reviewer determination", input.reviewerDetermination, "No reviewer determination recorded."),
        "The complete AMB memo, tested workbook, and appendix are referenced above; the full AMB analysis is not reproduced here.",
    ].join("\n");
    const fragment = {
        fragmentId: `amb:${run.runId}:fragment:data-issues`,
        findingIds,
        targetTopicKeys: ["data_issues"],
        form: "summary",
        content,
        evidenceRefs: fragmentEvidenceIds,
        inclusionState: "candidate",
        approvalState: "proposed",
        displayOrder,
        conflictGroup: null,
    };
    // Companion fragments, only where the AMB analysis materially
    // interprets the benefit formula.
    const companionFragments = [];
    const interpretation = input.formulaInterpretation === undefined ? null : input.formulaInterpretation;
    if (interpretation !== null && interpretation.trim() !== "") {
        const { found, dropped } = resolveEvidenceIds(input.interpretationEvidenceIds ?? [], input.evidence);
        if (dropped.length > 0) {
            log = {
                ...log,
                warnings: [
                    ...log.warnings,
                    {
                        warningId: `dropped-evidence:amb:${run.runId}:fragment:benefit-formula`,
                        message: `Interpretation evidence ids not in the supplied evidence pool and not cited: ${dropped.join(", ")}.`,
                        severity: "blocking",
                        relatedFindingIds: findingIds,
                        relatedEvidenceIds: [],
                    },
                ],
            };
        }
        const interpretationEvidenceIds = [];
        const seenInterpretation = new Set();
        for (const id of [...found, ...fragmentEvidenceIds]) {
            if (!seenInterpretation.has(id)) {
                seenInterpretation.add(id);
                interpretationEvidenceIds.push(id);
            }
        }
        const findingsForTopic = (topic) => {
            const targeted = input.findings
                .filter((finding) => finding.intendedR1Topics.includes(topic))
                .map((finding) => finding.findingId);
            return targeted.length === 0 ? findingIds : targeted;
        };
        companionFragments.push({
            fragmentId: `amb:${run.runId}:fragment:benefit-formula`,
            findingIds: findingsForTopic("benefit_formula"),
            targetTopicKeys: ["benefit_formula"],
            form: "summary",
            content: `Benefit-formula interpretation from the AMB analysis (run ${run.runId}): ${interpretation}`,
            evidenceRefs: interpretationEvidenceIds,
            inclusionState: "candidate",
            approvalState: "proposed",
            displayOrder: displayOrder + 1,
            conflictGroup: null,
        }, {
            fragmentId: `amb:${run.runId}:fragment:interpretations`,
            findingIds: findingsForTopic("interpretations"),
            targetTopicKeys: ["interpretations"],
            form: "summary",
            content: `Benefit / plan document interpretation of note from the AMB analysis (run ${run.runId}): ${interpretation}`,
            evidenceRefs: interpretationEvidenceIds,
            inclusionState: "candidate",
            approvalState: "proposed",
            displayOrder: displayOrder + 2,
            conflictGroup: null,
        });
    }
    if (referenceIssues.length > 0) {
        const seenIssueIds = new Set(log.openIssues.map((issue) => issue.issueId));
        const newIssues = referenceIssues.filter((issue) => !seenIssueIds.has(issue.issueId));
        if (newIssues.length > 0) {
            log = { ...log, openIssues: [...log.openIssues, ...newIssues] };
        }
    }
    return { fragment, companionFragments, citations, log };
}
/**
 * Check whether an approved `DeterminationRecord` plus its frozen
 * `EvidenceSnapshot` may be used as publishable input to
 * `publishFindings`. The caller invokes this AFTER approval (for
 * example after the T3 transition in `decisions.ts`, which calls
 * `approveDetermination` as its gate). Publication stays a SEPARATE
 * step over the record — never a side effect of approval — so this
 * function changes no approval behaviour and `determination.ts` /
 * `decisions.ts` are untouched.
 *
 * Publishable only when:
 * - the record is complete against the ten §14 items;
 * - `humanDetermination.approvalId` is set (a recorded approval — G13:
 *   publication must not claim an approval that was not recorded);
 * - a frozen evidence snapshot was supplied and names this determination.
 */
function publishableDetermination(record, evidenceSnapshot) {
    const reasons = [];
    const completeness = (0, determination_1.checkDeterminationCompleteness)(record);
    for (const missing of completeness.missingItems) {
        reasons.push(`§14 item ${missing.item} (${missing.label}) incomplete: ${missing.reason}`);
    }
    if (record.humanDetermination.approvalId === null) {
        reasons.push("determination has no recorded approval (approvalId is null) — publication must not claim approval (G13)");
    }
    if (evidenceSnapshot === null) {
        reasons.push("no frozen evidence snapshot supplied for the approval");
    }
    else if (evidenceSnapshot.determinationId !== record.determinationId) {
        reasons.push(`frozen evidence snapshot names determination ${evidenceSnapshot.determinationId}, not ${record.determinationId}`);
    }
    return { publishable: reasons.length === 0, reasons };
}
