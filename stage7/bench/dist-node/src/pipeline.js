"use strict";
/**
 * The ten-stage deterministic calculation pipeline — Stage 4 (Wave 2).
 *
 * MASTER_PROMPT §8; Stage 2 output 04 §§1–2, §6. Each stage is a pure
 * function from the accumulated pipeline state to its output plus a trace;
 * `calculateAccruedBenefit` composes them in order. Every intermediate is
 * inspectable (a CalculationStep per stage output); evidence grades travel
 * with values; a stage failure stops the exact path and never produces a
 * guessed value (rule F-1); a rule that does not apply is refused and the
 * refusal is recorded, never silently skipped (rule F-2); a stage failure
 * never produces a partial exact benefit (rule F-3).
 *
 * Stage 10 emits only comparison inputs (`emitReconciliationInputs`) — no
 * Δ/D/R computation, no tolerance test here. Those belong to the
 * reconciliation module (Stage 5 build).
 *
 * ADAPTERS (spec gaps, flagged — see the report):
 * 1. CalculationRequest (types.ts, frozen) carries no formula parameters,
 *    no averaging-period rule, no service/compensation overrides, no
 *    protection/restriction directives, and no bounds ranges. The caller
 *    supplies those as `PipelineInputs`, an optional second argument to
 *    `calculateAccruedBenefit`. Without it, Stages 1–4 run from the
 *    request alone and Stage 5 fails with a missing-input stage failure —
 *    never a guessed value.
 * 2. Stage 3 service computation: RESOLVED in Stage 5 — CalculationRequest
 *    now carries an optional caller-supplied `serviceDefinition`
 *    (ServiceDefinition) and `employmentPeriods` (EmploymentPeriodInput[]).
 *    When both are present, Stage 3 derives service from the real service
 *    module (src/service.ts `serviceAtDate`); when either is absent, Stage 3
 *    still derives service from the ServiceHistory already carried in the
 *    request (service periods summed, else BCV/PA credited service), records
 *    which source was used, and records a missing input when none is
 *    available. A supplied definition that cannot derive service is refused
 *    with the missing definition fields named (rule D-0: no defaults).
 *    Constructing a ServiceDefinition inside the pipeline would invent plan
 *    rules and remains forbidden.
 * 3. Date primitives: REWIRED (Wave 3) — `daysBetween` is now imported
 *    from src/dates.ts and re-exported here so existing import sites
 *    keep working. The local implementation was verified identical and
 *    removed.
 * 4. Rounding: REWIRED (Wave 3) — Stage 3 credited-service rounding
 *    now goes through src/rounding.ts `applyServiceRounding` (thin
 *    adapter: ServiceMeasures → ServiceResult carrying the value);
 *    Stage 4 average-compensation rounding, Stage 8 final/intermediate
 *    rounding, and the Stage 8 maximum-plausible-effect computation now
 *    go through `applyMoneyRounding` / `maxPlausibleRoundingEffect`.
 *    The Stage 9 no-prescribed-rule half-up cents representation keeps
 *    its direct decRound: it is a representation, not a prescribed
 *    rule application. The Stage 3/4 trace steps still record
 *    before/after/unit/mode as before.
 * 5. Counterfactual hypothesis codes (H1–H17) are mapped by operation
 *    kind in `testCounterfactual`; only H15 (rounding) is verified against
 *    the spec text. The rest are labelled as an assumption in the report.
 *
 * Synthetic data only. Pure functions; no clock, no storage, no network,
 * no randomness. Decimal-safe via src/decimal.ts; integer minor units for
 * money; rounding only at prescribed points (Stage 8, and Stage 9's
 * annual→monthly conversion under the final-monthly rule).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.daysBetween = void 0;
exports.resetStepCounter = resetStepCounter;
exports.roundingSpecFromConfig = roundingSpecFromConfig;
exports.resolveComparisonBasis = resolveComparisonBasis;
exports.identifyProvisions = identifyProvisions;
exports.determineEligibility = determineEligibility;
exports.determineServiceMeasures = determineServiceMeasures;
exports.determineCompensationMeasures = determineCompensationMeasures;
exports.calculateBaseBenefit = calculateBaseBenefit;
exports.applyAccrualAndProtection = applyAccrualAndProtection;
exports.applyRestrictions = applyRestrictions;
exports.applyPrescribedRounding = applyPrescribedRounding;
exports.expressOnNormalRetirementBasis = expressOnNormalRetirementBasis;
exports.emitReconciliationInputs = emitReconciliationInputs;
exports.runExactPath = runExactPath;
exports.deriveBoundsForRequest = deriveBoundsForRequest;
exports.calculateAccruedBenefit = calculateAccruedBenefit;
exports.testCounterfactual = testCounterfactual;
const decimal_1 = require("./decimal");
const dates_1 = require("./dates");
Object.defineProperty(exports, "daysBetween", { enumerable: true, get: function () { return dates_1.daysBetween; } });
const service_1 = require("./service");
const rounding_1 = require("./rounding");
const compose_1 = require("./compose");
const bounds_1 = require("./bounds");
const formulas_1 = require("./formulas");
// ---------------------------------------------------------------------------
// Trace helpers
// ---------------------------------------------------------------------------
let stepCounter = 0;
function nextStepNumber() {
    stepCounter += 1;
    return stepCounter;
}
/** Reset the step counter for a fresh pipeline run (call-site only;
 *  calculateAccruedBenefit resets it at run start). */
function resetStepCounter() {
    stepCounter = 0;
}
function makeStep(name, inputs, output, ruleRef, evidenceGrade, assumption = null) {
    return {
        step: nextStepNumber(),
        name,
        inputs,
        output,
        ruleRef,
        evidenceGrade,
        assumption,
    };
}
function isStageFailure(value) {
    return (typeof value === "object"
        && value !== null
        && "stage" in value
        && "reason" in value
        && "next" in value);
}
function stageFailure(stage, reason, detail, next) {
    return { stage, reason, detail, next };
}
function missingItem(field, missingClass, consequence, resolvesBy) {
    return { field, missingClass, consequence, resolvesBy };
}
function classForField(inputs, field) {
    if (inputs?.missingClassOverrides?.[field] !== undefined) {
        return inputs.missingClassOverrides[field];
    }
    if (inputs?.boundsSpec?.ranges.some((r) => r.field === field) === true) {
        return "c";
    }
    return "e";
}
/** Map a RoundingConfig to the formula-level RoundingSpec. */
function roundingSpecFromConfig(config) {
    const seq = config.prescribedSequence;
    if (seq === null || seq.rules.length === 0) {
        return { stage: "final-only", mode: "none", source: "unknown" };
    }
    const finalRule = seq.rules.find((r) => r.target === "final-monthly-benefit")
        ?? seq.rules[seq.rules.length - 1];
    if (finalRule === undefined) {
        return { stage: "final-only", mode: "none", source: "unknown" };
    }
    let mode = "none";
    if (finalRule.mode === "down")
        mode = "truncate";
    else if (finalRule.unit === "0.01")
        mode = "nearest-cent";
    else if (finalRule.unit === "1")
        mode = "nearest-dollar";
    const stage = finalRule.stage === "final"
        ? "final-only"
        : finalRule.stage === "after-operation"
            ? "per-operation"
            : finalRule.stage === "after-annual-accrual"
                ? "per-annual-accrual"
                : "per-intermediate";
    return {
        stage,
        mode,
        source: finalRule.source.citation ?? finalRule.source.kind,
    };
}
/** Build the formula CalcContext for a measurement date and plan version. */
function calcContextFor(request, planVersionId) {
    return {
        planVersionId,
        measurementDate: request.measurementDate ?? "",
        rounding: roundingSpecFromConfig(request.roundingConfig),
    };
}
/** Annual decimal dollars to monthly decimal dollars (÷ 12 at scale 10). */
function annualToMonthlyDecimal(annual) {
    return (0, decimal_1.decDivide)(annual, "12", 10);
}
/** Exact decimal dollars for a Money value. */
function moneyToDecimal(money) {
    return (0, decimal_1.moneyMinorToDecimalString)(money.amountMinor);
}
/** Money from an exact decimal, rounding half-up to cents when the value
 *  has fractional cents (representation only — see formulas.ts header). */
function moneyFromExact(value) {
    try {
        return (0, decimal_1.moneyFromDecimalString)(value);
    }
    catch {
        return (0, decimal_1.moneyFromDecimalString)((0, decimal_1.decRound)(value, "0.01", "half-up"));
    }
}
/** Number (from ServiceHistory / BCV fields) → exact DecimalString.
 *  Only exact short decimals are accepted; anything else is refused. */
function numberToDecimal(value) {
    if (!Number.isFinite(value))
        return null;
    const text = String(value);
    try {
        const parsed = (0, decimal_1.decAdd)(text, "0");
        return parsed;
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// §1.4 — Unresolved basis gate (checked before Stage 1)
// ---------------------------------------------------------------------------
function resolveComparisonBasis(request) {
    if (request.measurementDate === null) {
        return {
            basis: "unresolved",
            reason: "measurement date is not established (null); no Δ is computed",
        };
    }
    if (request.measurementBasis === "unresolved") {
        return {
            basis: "unresolved",
            reason: `measurement basis is unresolved for ${request.measurementDate}; the recorded amount's actual measurement date is not established`,
        };
    }
    return { basis: "established", measurementDate: request.measurementDate };
}
// ---------------------------------------------------------------------------
// Initial pipeline state
// ---------------------------------------------------------------------------
function initialState(request) {
    return {
        request,
        provisions: null,
        eligibility: null,
        service: null,
        compensation: null,
        baseBenefit: null,
        protectedBenefit: null,
        restrictedBenefit: null,
        roundedBenefit: null,
        normalRetirementBenefit: null,
        reconciliation: null,
        trace: [],
        missingInputs: [],
    };
}
function appendSteps(state, steps) {
    return { ...state, trace: [...state.trace, ...steps] };
}
function indeterminateOutcome(reason, trace) {
    return { kind: "indeterminate", reason, trace };
}
// ---------------------------------------------------------------------------
// Stage 1 — Identify applicable plan provisions
// ---------------------------------------------------------------------------
function identifyProvisions(state, inputs) {
    void inputs;
    const request = state.request;
    const measurementDate = request.measurementDate;
    if (measurementDate === null) {
        return stageFailure(1, "unresolved-basis", "measurement date is null", "indeterminate");
    }
    const selection = (0, compose_1.selectProvisionsByDate)(request.provisionTimeline, measurementDate);
    if (selection.version === null) {
        return stageFailure(1, "missing-input", `no PlanVersion in force at ${measurementDate}`, "indeterminate");
    }
    const version = selection.version;
    const steps = [];
    steps.push(makeStep("provisions-selected", [
        { field: "measurementDate", value: measurementDate },
        { field: "planVersionId", value: version.versionId },
        { field: "effectiveDate", value: version.effectiveDate.value },
        { field: "adoptionDate", value: version.adoptionDate.value },
    ], version.versionId, `PlanVersion ${version.versionId} §${version.provisionSection.value ?? ""} (effective ${version.effectiveDate.value})`, "fact"));
    for (const rejected of selection.rejectedLater) {
        steps.push(makeStep("provision-rejected", [
            { field: "planVersionId", value: rejected.versionId },
            { field: "effectiveDate", value: rejected.effectiveDate.value },
        ], "not-applied", `PlanVersion ${rejected.versionId} not yet effective at ${measurementDate} — the latest formula is never applied retroactively`, "fact"));
    }
    if (version.formulaIds.length > 0 && !version.formulaIds.includes(request.formulaId)) {
        return stageFailure(1, "rule-refused", `formula ${request.formulaId} is not in force in PlanVersion ${version.versionId}`, "indeterminate");
    }
    if (version.formulaIds.length === 0) {
        steps.push(makeStep("formula-version-unstated", [{ field: "formulaId", value: request.formulaId }], "proceeding-on-request-formula", "PlanVersion carries no formulaIds; proceeding on the requested formula id", "assumption", "the requested formula is the one in force in this version"));
    }
    const freeze = version.freeze.value;
    const provisions = {
        planVersionId: version.versionId,
        formulaId: request.formulaId,
        provisionsAtDate: version,
        amendmentHistory: selection.amendmentHistory,
        freeze,
        statutoryLimits: version.statutoryLimitsInForce.map((limit) => ({
            limitId: limit,
            description: limit,
            sourceCitation: `PlanVersion ${version.versionId} statutoryLimitsInForce`,
        })),
    };
    return { provisions, steps };
}
// ---------------------------------------------------------------------------
// Stage 2 — Determine participation and service eligibility
// ---------------------------------------------------------------------------
function determineEligibility(state, inputs) {
    void inputs;
    const history = state.request.participantHistory;
    const measurementDate = state.request.measurementDate;
    if (measurementDate === null) {
        return stageFailure(2, "unresolved-basis", "measurement date is null", "indeterminate");
    }
    const periods = history.employmentPeriods;
    if (periods.length === 0) {
        return stageFailure(2, "missing-input", "no employment periods in the participant history", "indeterminate");
    }
    const sorted = [...periods].sort((a, b) => (a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0));
    const first = sorted[0];
    if (first === undefined) {
        return stageFailure(2, "missing-input", "no employment periods in the participant history", "indeterminate");
    }
    if (first.periodStart > measurementDate) {
        return stageFailure(2, "inapplicable-rule", `participant's first employment period starts ${first.periodStart}, after the measurement date ${measurementDate}`, "indeterminate");
    }
    const steps = [];
    steps.push(makeStep("participation", [
        { field: "participationDate", value: first.periodStart },
        { field: "employmentPeriods", value: periods.length },
    ], true, "Eligibility: participation from the first employment period start; no exclusion applies on the evidence supplied", "fact"));
    const rehireFinding = periods.length > 1
        ? `${periods.length} employment periods; rehire/restoration per the plan's break rules (see Stage 3)`
        : null;
    if (rehireFinding !== null) {
        steps.push(makeStep("rehire", [{ field: "employmentPeriods", value: periods.length }], rehireFinding, "Rehire: multiple employment periods; pre-break service restoration is determined in Stage 3", "fact"));
    }
    return {
        eligibility: {
            isParticipant: true,
            participationDate: first.periodStart,
            eligibilityRuleRef: "Eligibility: participation from the first employment period start",
            exclusion: null,
            rehireFinding,
        },
        steps,
    };
}
// ---------------------------------------------------------------------------
// Stage 3 — Determine the applicable service measures
// ---------------------------------------------------------------------------
/**
 * Stage 3 via the real service module (Stage 5 fix for the Stage 4 open
 * item 1). The caller supplied a ServiceDefinition and
 * EmploymentPeriodInput[] on the request, so service is derived by
 * service.ts `serviceAtDate` (credited / vesting / eligibility, each
 * under the plan's own rules) instead of the ServiceHistory adapter
 * below. The definition is caller-supplied per-plan input: a quantity
 * the definition cannot derive (method, conversion, accrual start, or
 * a period's hours missing) is refused with the missing definition
 * fields named — never filled with a default (rule D-0). The service
 * cap is the plan's own cap from the definition (a caller-supplied
 * PipelineInputs.serviceCap still wins, as in the adapter). Prescribed
 * credited-service rounding and PipelineInputs.serviceOverride behave
 * exactly as in the adapter, so counterfactuals keep working.
 */
function determineServiceMeasuresFromDefinition(state, def, periods, measurementDate, inputs) {
    const request = state.request;
    const history = request.participantHistory;
    const serviceHistory = history.serviceHistory;
    const steps = [];
    const computed = (0, service_1.serviceAtDate)(periods, measurementDate, def, null);
    let credited;
    let creditedSource;
    if (inputs?.serviceOverride?.creditedService !== undefined) {
        credited = inputs.serviceOverride.creditedService;
        creditedSource = "PipelineInputs.serviceOverride";
    }
    else {
        credited = computed.credited.value;
        creditedSource =
            "ServiceDefinition serviceAtDate (Stage 3 service.ts) — credited service derived from the caller-supplied plan definition";
    }
    if (credited === null) {
        const missing = computed.credited.missingInputs.join("; ");
        return stageFailure(3, "missing-input", `credited service cannot be derived from the supplied ServiceDefinition (${def.planVersionId})` +
            (missing === "" ? "" : `: ${missing}`), "bounds");
    }
    const vestingService = inputs?.serviceOverride?.vestingService !== undefined
        ? inputs.serviceOverride.vestingService
        : computed.vesting.value;
    const eligibilityService = inputs?.serviceOverride?.eligibilityService !== undefined
        ? inputs.serviceOverride.eligibilityService
        : computed.eligibility.value;
    const computedVp = (0, service_1.vestingPercent)(computed.vesting, def, measurementDate, "");
    const vestingPercentage = inputs?.serviceOverride?.vestingPercentage !== undefined
        ? inputs.serviceOverride.vestingPercentage
        : computedVp.vp;
    let serviceCap = null;
    const capDisabled = inputs?.disabledCaps?.includes("service-cap") === true;
    if (!capDisabled) {
        if (inputs?.serviceCap !== undefined && inputs.serviceCap !== null) {
            serviceCap = { capYears: inputs.serviceCap.capYears, ruleRef: inputs.serviceCap.ruleRef };
        }
        else if (def.serviceCap !== null) {
            serviceCap = { capYears: def.serviceCap.maxYears, ruleRef: def.serviceCap.ruleRef };
        }
        if (serviceCap !== null && (0, decimal_1.decCompare)(credited, serviceCap.capYears) > 0) {
            steps.push(makeStep("service-cap", [
                { field: "creditedServiceBeforeCap", value: credited },
                { field: "capYears", value: serviceCap.capYears },
            ], serviceCap.capYears, serviceCap.ruleRef, "fact"));
            credited = serviceCap.capYears;
        }
    }
    steps.push(makeStep("credited-service", [
        { field: "creditedService", value: credited },
        { field: "vestingService", value: vestingService },
        { field: "eligibilityService", value: eligibilityService },
        { field: "source", value: creditedSource },
        { field: "serviceDefinition", value: def.planVersionId },
    ], credited, "Stage 3: credited service through the measurement date from the caller-supplied ServiceDefinition (service.ts serviceAtDate) — no defaults (rule D-0)", "fact"));
    if (vestingPercentage !== null) {
        steps.push(makeStep("vesting-percentage", [
            { field: "vestingPercentage", value: vestingPercentage },
            { field: "scheduleRow", value: computedVp.scheduleRow },
        ], vestingPercentage, "Stage 3: vesting percent VP (fraction, 0–1) from the plan's vesting schedule", "fact"));
    }
    // Prescribed credited-service rounding (Stage 2 output 04 §4.2 target
    // "credited-service") is a Stage 3 rule application, recorded here —
    // same as the ServiceHistory adapter below.
    const serviceRule = request.roundingConfig.prescribedSequence?.rules.find((r) => r.target === "credited-service");
    if (serviceRule !== undefined) {
        const roundedResult = (0, rounding_1.applyServiceRounding)({
            value: credited,
            rational: null,
            periods: [],
            missingInputs: [],
            roundingApplied: [],
        }, serviceRule);
        const rounded = roundedResult.value ?? credited;
        steps.push(makeStep("rounding", [
            { field: "target", value: "credited-service" },
            { field: "before", value: credited },
            { field: "after", value: rounded },
            { field: "unit", value: serviceRule.unit },
            { field: "mode", value: serviceRule.mode },
        ], {
            target: "credited-service",
            before: credited,
            after: rounded,
            unit: serviceRule.unit,
            mode: serviceRule.mode,
            ruleRef: serviceRule.source.citation ?? serviceRule.source.kind,
        }, serviceRule.source.citation ?? serviceRule.source.kind, "fact"));
        credited = rounded;
    }
    const service = {
        creditedService: credited,
        vestingService,
        eligibilityService,
        vestingPercentage,
        servicePeriods: serviceHistory?.servicePeriods ?? [],
        serviceCap,
    };
    return { service, steps };
}
function determineServiceMeasures(state, inputs) {
    const request = state.request;
    const measurementDate = request.measurementDate;
    if (measurementDate === null) {
        return stageFailure(3, "unresolved-basis", "measurement date is null", "indeterminate");
    }
    // Stage 5 (resolves the Stage 4 open item 1): when the caller supplied
    // a ServiceDefinition AND EmploymentPeriodInput[], Stage 3 derives
    // service from the real service module (helper above). When either is
    // absent, the ServiceHistory adapter below runs unchanged. A definition
    // supplied without periods is refused — a definition alone cannot
    // derive service, and guessing periods would invent plan history.
    const suppliedDefinition = request.serviceDefinition ?? null;
    const suppliedPeriods = request.employmentPeriods ?? null;
    if (suppliedDefinition !== null) {
        if (suppliedPeriods === null || suppliedPeriods.length === 0) {
            return stageFailure(3, "missing-input", "ServiceDefinition supplied without EmploymentPeriodInput[] — service cannot be derived from the definition alone", "indeterminate");
        }
        return determineServiceMeasuresFromDefinition(state, suppliedDefinition, suppliedPeriods, measurementDate, inputs);
    }
    const history = request.participantHistory;
    const serviceHistory = history.serviceHistory;
    const steps = [];
    let credited = null;
    let creditedSource = "";
    if (inputs?.serviceOverride?.creditedService !== undefined) {
        credited = inputs.serviceOverride.creditedService;
        creditedSource = "PipelineInputs.serviceOverride";
    }
    else if (serviceHistory !== null) {
        const periods = serviceHistory.servicePeriods.filter((per) => per.end === null || per.end <= measurementDate);
        if (periods.length > 0) {
            let total = "0";
            let usable = true;
            for (const per of periods) {
                const measure = numberToDecimal(per.measure);
                if (measure === null) {
                    usable = false;
                    break;
                }
                total = (0, decimal_1.decAdd)(total, measure);
            }
            if (usable) {
                credited = total;
                creditedSource = "ServiceHistory.servicePeriods (summed, through the measurement date)";
            }
        }
        if (credited === null && serviceHistory.bcvCreditedService.value !== null) {
            credited = numberToDecimal(serviceHistory.bcvCreditedService.value);
            creditedSource = "ServiceHistory.bcvCreditedService (BCV Calculated, cross-check value)";
        }
        if (credited === null && serviceHistory.paCreditedService.value !== null) {
            credited = numberToDecimal(serviceHistory.paCreditedService.value);
            creditedSource = "ServiceHistory.paCreditedService (PA-reported, cross-check value)";
        }
    }
    if (credited === null) {
        return stageFailure(3, "missing-input", "credited service cannot be established from the service history", "bounds");
    }
    const vestingService = inputs?.serviceOverride?.vestingService !== undefined
        ? inputs.serviceOverride.vestingService
        : serviceHistory?.bcvVestingService.value !== null && serviceHistory?.bcvVestingService.value !== undefined
            ? numberToDecimal(serviceHistory.bcvVestingService.value)
            : serviceHistory?.paVestingService.value !== null && serviceHistory?.paVestingService.value !== undefined
                ? numberToDecimal(serviceHistory.paVestingService.value)
                : null;
    const eligibilityService = inputs?.serviceOverride?.eligibilityService !== undefined
        ? inputs.serviceOverride.eligibilityService
        : serviceHistory?.bcvEligibilityService.value !== null && serviceHistory?.bcvEligibilityService.value !== undefined
            ? numberToDecimal(serviceHistory.bcvEligibilityService.value)
            : serviceHistory?.paEligibilityService.value !== null && serviceHistory?.paEligibilityService.value !== undefined
                ? numberToDecimal(serviceHistory.paEligibilityService.value)
                : null;
    const vestingPercentage = inputs?.serviceOverride?.vestingPercentage !== undefined
        ? inputs.serviceOverride.vestingPercentage
        : serviceHistory?.bcvVestingPercent.value ?? serviceHistory?.paVestingPercent.value ?? null;
    let serviceCap = null;
    const capDisabled = inputs?.disabledCaps?.includes("service-cap") === true;
    if (!capDisabled && inputs?.serviceCap !== undefined && inputs.serviceCap !== null) {
        serviceCap = { capYears: inputs.serviceCap.capYears, ruleRef: inputs.serviceCap.ruleRef };
        if ((0, decimal_1.decCompare)(credited, serviceCap.capYears) > 0) {
            steps.push(makeStep("service-cap", [
                { field: "creditedServiceBeforeCap", value: credited },
                { field: "capYears", value: serviceCap.capYears },
            ], serviceCap.capYears, serviceCap.ruleRef, "fact"));
            credited = serviceCap.capYears;
        }
    }
    steps.push(makeStep("credited-service", [
        { field: "creditedService", value: credited },
        { field: "source", value: creditedSource },
    ], credited, "Stage 3: credited service through the measurement date only — never projected past a freeze or termination date", "fact"));
    if (vestingPercentage !== null) {
        steps.push(makeStep("vesting-percentage", [{ field: "vestingPercentage", value: vestingPercentage }], vestingPercentage, "Stage 3: vesting percent VP (fraction, 0–1) from the service history", "fact"));
    }
    // Prescribed credited-service rounding (Stage 2 output 04 §4.2 target
    // "credited-service") is a Stage 3 rule application, recorded here.
    const serviceRule = request.roundingConfig.prescribedSequence?.rules.find((r) => r.target === "credited-service");
    if (serviceRule !== undefined) {
        // R-1 service rounding via the real rounding module (thin adapter:
        // ServiceMeasures → ServiceResult carries the value; the trace step
        // below records before/after/unit/mode as before).
        const roundedResult = (0, rounding_1.applyServiceRounding)({
            value: credited,
            rational: null,
            periods: [],
            missingInputs: [],
            roundingApplied: [],
        }, serviceRule);
        const rounded = roundedResult.value ?? credited;
        steps.push(makeStep("rounding", [
            { field: "target", value: "credited-service" },
            { field: "before", value: credited },
            { field: "after", value: rounded },
            { field: "unit", value: serviceRule.unit },
            { field: "mode", value: serviceRule.mode },
        ], {
            target: "credited-service",
            before: credited,
            after: rounded,
            unit: serviceRule.unit,
            mode: serviceRule.mode,
            ruleRef: serviceRule.source.citation ?? serviceRule.source.kind,
        }, serviceRule.source.citation ?? serviceRule.source.kind, "fact"));
        credited = rounded;
    }
    const service = {
        creditedService: credited,
        vestingService,
        eligibilityService,
        vestingPercentage,
        servicePeriods: serviceHistory?.servicePeriods ?? [],
        serviceCap,
    };
    return { service, steps };
}
// ---------------------------------------------------------------------------
// Stage 4 — Calculate compensation measures
// ---------------------------------------------------------------------------
function determineCompensationMeasures(state, inputs) {
    const request = state.request;
    const measurementDate = request.measurementDate;
    if (measurementDate === null) {
        return stageFailure(4, "unresolved-basis", "measurement date is null", "indeterminate");
    }
    const history = request.participantHistory;
    const compHistory = history.compensationHistory;
    const steps = [];
    if (inputs?.compensationOverride !== undefined) {
        const override = inputs.compensationOverride;
        const compensation = {
            compensationYears: override.compensationYears ?? [],
            averagingPeriod: override.averagingPeriod ?? { description: "override", ruleRef: "PipelineInputs.compensationOverride" },
            averageCompensation: override.averageCompensation ?? null,
            compensationCap: override.compensationCap ?? null,
            alternativeAveragingPeriods: override.alternativeAveragingPeriods ?? [],
        };
        steps.push(makeStep("compensation-override", [{ field: "averageCompensation", value: compensation.averageCompensation?.amountMinor ?? null }], compensation.averageCompensation?.amountMinor ?? null, "Stage 4: compensation measures supplied by the caller", "assumption", "compensation measures supplied as an override, not derived from the history"));
        return { compensation, steps };
    }
    if (compHistory === null) {
        return stageFailure(4, "missing-input", "no compensation history in the participant history", "bounds");
    }
    const averaging = inputs?.averagingPeriod;
    if (averaging === undefined) {
        return stageFailure(4, "missing-input", "averaging period is not stated (no default averaging period is assumed)", "indeterminate");
    }
    const measurementYear = Number(measurementDate.slice(0, 4));
    const years = [...compHistory.salaryByYear].sort((a, b) => a.salaryYear - b.salaryYear);
    let windowYears = [];
    if (averaging.kind === "career") {
        windowYears = years.filter((y) => y.salaryYear <= measurementYear);
    }
    else if (averaging.kind === "final") {
        const eligible = years.filter((y) => y.salaryYear <= measurementYear);
        windowYears = eligible.slice(Math.max(0, eligible.length - averaging.years));
    }
    else {
        // highest: the highest n consecutive years through the measurement date.
        const eligible = years.filter((y) => y.salaryYear <= measurementYear);
        let best = null;
        let bestTotal = -1;
        for (let i = 0; i + averaging.years <= eligible.length; i += 1) {
            const window = eligible.slice(i, i + averaging.years);
            let consecutive = true;
            for (let k = 1; k < window.length; k += 1) {
                const prev = window[k - 1];
                const cur = window[k];
                if (prev === undefined || cur === undefined || cur.salaryYear !== prev.salaryYear + 1)
                    consecutive = false;
            }
            if (!consecutive)
                continue;
            let total = 0;
            let complete = true;
            for (const w of window) {
                if (w.amount === null) {
                    complete = false;
                    break;
                }
                total += w.amount.amountMinor;
            }
            if (complete && total > bestTotal) {
                bestTotal = total;
                best = window;
            }
        }
        windowYears = best ?? eligible.slice(Math.max(0, eligible.length - averaging.years));
    }
    const capDisabled = inputs?.disabledCaps?.includes("compensation-cap") === true;
    const cap = !capDisabled ? inputs?.compensationCap ?? null : null;
    for (const y of windowYears) {
        const capped = y.amount !== null && cap !== null && y.amount.amountMinor > cap.capAnnual.amountMinor
            ? cap.capAnnual
            : y.amount;
        steps.push(makeStep("compensation-year", [
            { field: "salaryYear", value: y.salaryYear },
            { field: "amountMinor", value: y.amount?.amountMinor ?? null },
            { field: "cappedMinor", value: capped?.amountMinor ?? null },
        ], capped?.amountMinor ?? null, cap !== null ? cap.ruleRef : "Stage 4: compensation year read from the history", y.amount === null ? "unknown" : "fact", y.amount === null ? `compensation year ${y.salaryYear} is missing` : null));
    }
    const missingYears = windowYears.filter((y) => y.amount === null);
    if (missingYears.length > 0) {
        const firstMissing = missingYears[0];
        if (firstMissing !== undefined) {
            return stageFailure(4, "missing-input", `CompensationHistory.salaryYear ${firstMissing.salaryYear}`, "bounds");
        }
    }
    const cappedYears = windowYears.map((y) => {
        const amount = y.amount;
        if (amount === null)
            return null;
        if (cap !== null && amount.amountMinor > cap.capAnnual.amountMinor)
            return cap.capAnnual;
        return amount;
    });
    if (cappedYears.some((a) => a === null) || windowYears.length === 0) {
        return stageFailure(4, "missing-input", "averaging window has no compensation years", "bounds");
    }
    const totalMinor = cappedYears.reduce((acc, m) => acc + m.amountMinor, 0);
    // Average in minor units: total minor / n, exact decimal in dollars.
    const averageDollars = (0, decimal_1.decDivide)((0, decimal_1.moneyMinorToDecimalString)(totalMinor), String(windowYears.length), 10);
    const averageCompensation = moneyFromExact(averageDollars);
    steps.push(makeStep("average-compensation", [
        { field: "years", value: windowYears.map((y) => y.salaryYear).join(",") },
        { field: "totalMinor", value: totalMinor },
        { field: "averageDollars", value: averageDollars },
    ], averageDollars, averaging.ruleRef, "fact"));
    // Prescribed average-compensation rounding is a Stage 4 rule application.
    const avgRule = request.roundingConfig.prescribedSequence?.rules.find((r) => r.target === "average-compensation");
    let finalAverage = averageCompensation;
    if (avgRule !== undefined) {
        const before = moneyToDecimal(averageCompensation);
        // R-3 money rounding via the real rounding module.
        const after = (0, rounding_1.applyMoneyRounding)(before, avgRule);
        steps.push(makeStep("rounding", [
            { field: "target", value: "average-compensation" },
            { field: "before", value: before },
            { field: "after", value: after },
            { field: "unit", value: avgRule.unit },
            { field: "mode", value: avgRule.mode },
        ], {
            target: "average-compensation",
            before,
            after,
            unit: avgRule.unit,
            mode: avgRule.mode,
            ruleRef: avgRule.source.citation ?? avgRule.source.kind,
        }, avgRule.source.citation ?? avgRule.source.kind, "fact"));
        finalAverage = moneyFromExact(after);
    }
    const compensation = {
        compensationYears: windowYears,
        averagingPeriod: { description: averaging.description, ruleRef: averaging.ruleRef },
        averageCompensation: finalAverage,
        compensationCap: cap,
        alternativeAveragingPeriods: inputs?.alternativeAveragingPeriods ?? [],
    };
    return { compensation, steps };
}
/**
 * Inject the Stage 3 credited service and Stage 4 average compensation
 * into a formula call's top-level `service` / `avgComp` parameters, so
 * Stage 5 evaluates the formula on the measures Stages 3–4 produced —
 * not on whatever the caller happened to write in the call. This is what
 * makes the service and averaging-period counterfactuals move the benefit:
 * they change the Stage 3/4 measures, and the injection carries the change
 * into the formula. Only scalar top-level parameters are injected.
 * Per-year (compByYear), per-period, and per-group parameters are NOT
 * injected — those formulas read the history through their own parameters
 * and remain caller-supplied. A call with no `service` / `avgComp` field
 * is returned unchanged.
 *
 * The cast is deliberate: FormulaCall is a 34-member union whose members
 * each carry a differently-shaped `params`; the injection only touches
 * the two scalar fields when they are present and string-typed, and the
 * rebuilt object keeps the member's formulaId, so the union is preserved.
 */
function injectStageMeasures(call, service, compensation) {
    const params = call.params;
    const next = { ...params };
    let changed = false;
    if (typeof params.service === "string" && service.creditedService !== null) {
        next.service = service.creditedService;
        changed = true;
    }
    if (typeof params.avgComp === "string" && compensation.averageCompensation !== null) {
        next.avgComp = (0, decimal_1.moneyMinorToDecimalString)(compensation.averageCompensation.amountMinor);
        changed = true;
    }
    if (!changed)
        return call;
    return { ...call, params: next };
}
function calculateBaseBenefit(state, inputs) {
    const request = state.request;
    const provisions = state.provisions;
    const service = state.service;
    const compensation = state.compensation;
    if (provisions === null) {
        return stageFailure(5, "missing-input", "Stage 1 provisions are not available", "indeterminate");
    }
    if (service === null || compensation === null) {
        return stageFailure(5, "missing-input", "Stage 3 service or Stage 4 compensation measures are not available", "indeterminate");
    }
    if (inputs?.formulaCall === undefined) {
        return stageFailure(5, "missing-input", "formulaCall (formula parameters) was not supplied", "indeterminate");
    }
    if (inputs.formulaCall.formulaId !== request.formulaId) {
        return stageFailure(5, "rule-refused", `formulaCall is ${inputs.formulaCall.formulaId} but the request names ${request.formulaId}`, "indeterminate");
    }
    const ctx = calcContextFor(request, provisions.planVersionId);
    // Stage 5 evaluates the formula on the Stage 3 service and Stage 4
    // compensation measures (injected into the call's scalar parameters).
    const formulaResult = (0, formulas_1.evaluateFormulaCall)(ctx, injectStageMeasures(inputs.formulaCall, service, compensation));
    const steps = [];
    if (formulaResult.kind === "exact") {
        const value = formulaResult.value;
        const benefit = {
            ...value,
            formulaId: request.formulaId,
            planVersionId: provisions.planVersionId,
            measurementDate: request.measurementDate,
            measurementBasis: request.measurementBasis,
            status: "calculated",
        };
        steps.push(makeStep("base-formula", [
            { field: "formulaId", value: request.formulaId },
            { field: "periodicity", value: benefit.periodicity },
            { field: "amountMinor", value: benefit.amount?.amountMinor ?? null },
        ], benefit.amount?.amountMinor ?? null, `Formula ${request.formulaId} evaluated on the Stage 3 service and Stage 4 compensation measures`, formulaResult.evidenceGrade));
        return { benefit, formulaResult, steps };
    }
    if (formulaResult.kind === "bound" || formulaResult.kind === "scenarios") {
        steps.push(makeStep("base-formula-inexact", [
            { field: "formulaId", value: request.formulaId },
            { field: "kind", value: formulaResult.kind },
            { field: "missingInputs", value: formulaResult.missingInputs.join("; ") },
        ], formulaResult.kind, `Formula ${request.formulaId} could not be evaluated exactly`, "estimate"));
        return { benefit: null, formulaResult, steps };
    }
    const refusedPredicate = formulaResult.missingInputs.find((m) => m.startsWith("predicate:"));
    if (refusedPredicate !== undefined) {
        return stageFailure(5, "rule-refused", refusedPredicate, "indeterminate");
    }
    return stageFailure(5, "missing-input", formulaResult.missingInputs.join("; "), "bounds");
}
// ---------------------------------------------------------------------------
// Stage 6 — Apply historical accrual, grandfathering, and protection
// ---------------------------------------------------------------------------
function applyAccrualAndProtection(state, inputs) {
    const request = state.request;
    const base = state.baseBenefit;
    if (base === null || base.amount === null) {
        return stageFailure(6, "missing-input", "Stage 5 base benefit is not available", "indeterminate");
    }
    const steps = [];
    const baseMonthly = base.periodicity === "monthly"
        ? moneyToDecimal(base.amount)
        : annualToMonthlyDecimal(moneyToDecimal(base.amount));
    let currentMonthly = baseMonthly;
    let protection = null;
    let comparison = null;
    // Hard freeze: the benefit is the benefit as of the freeze date. The
    // freeze-date benefit is recomputed by re-running Stages 1–5 at the
    // freeze date (the frozen run carries no freeze, so it cannot recurse).
    const freeze = inputs?.freeze !== undefined
        ? inputs.freeze
        : state.provisions?.provisionsAtDate.freeze.value !== undefined
            && state.provisions.provisionsAtDate.freeze.value !== null
            ? {
                freezeDate: state.provisions.provisionsAtDate.freeze.value.freezeDate,
                scope: state.provisions.provisionsAtDate.freeze.value.scope === "full" ? "full" : "accrual-only",
                ruleRef: state.provisions.provisionsAtDate.freeze.value.sourceSection,
            }
            : null;
    if (freeze !== null && freeze.scope === "full" && inputs?.ignoreFreeze !== true
        && request.measurementDate !== null && request.measurementDate > freeze.freezeDate) {
        const frozenRequest = { ...request, measurementDate: freeze.freezeDate };
        const frozenInputs = inputs === undefined
            ? undefined
            : { ...inputs, freeze: null };
        const frozenRun = runExactPath(frozenRequest, frozenInputs);
        if (!frozenRun.ok) {
            return stageFailure(6, "missing-input", `benefit at the freeze date ${freeze.freezeDate} could not be computed`, "indeterminate");
        }
        const frozenBenefit = frozenRun.benefit;
        if (frozenBenefit === null || frozenBenefit.amount === null) {
            return stageFailure(6, "missing-input", "benefit at the freeze date carries no amount", "indeterminate");
        }
        const frozenMonthly = frozenBenefit.periodicity === "monthly"
            ? moneyToDecimal(frozenBenefit.amount)
            : annualToMonthlyDecimal(moneyToDecimal(frozenBenefit.amount));
        steps.push(makeStep("freeze", [
            { field: "freezeDate", value: freeze.freezeDate },
            { field: "benefitAtFreezeMinor", value: frozenBenefit.amount.amountMinor },
            { field: "benefitAtMeasurementMinor", value: base.amount.amountMinor },
        ], frozenBenefit.amount.amountMinor, `Hard freeze at ${freeze.freezeDate} (${freeze.ruleRef}): benefit frozen at the freeze date; post-freeze service and compensation add nothing`, "fact"));
        currentMonthly = frozenMonthly;
    }
    // Grandfathered / protected benefit (IRC §411(d)(6)).
    if (inputs?.protectedBenefitMonthly !== undefined && inputs.protectedBenefitMonthly !== null) {
        const protectedMonthly = inputs.protectedBenefitMonthly;
        const guard = (0, compose_1.checkAntiDecrease)(currentMonthly, protectedMonthly);
        void guard;
        const ctx = calcContextFor(request, state.provisions?.planVersionId ?? "");
        const currentResult = {
            kind: "exact",
            value: { ...base, amount: moneyFromExact(currentMonthly), periodicity: "monthly" },
            evidenceGrade: "fact",
        };
        const protectedResult = {
            kind: "exact",
            value: (0, formulas_1.makeBenefit)(ctx, moneyFromExact(protectedMonthly), "monthly", undefined),
            evidenceGrade: "fact",
        };
        const detail = (0, compose_1.describeComparison)([
            { name: "current-formula", result: currentResult },
            { name: "protected", result: protectedResult },
        ], "greater-of");
        if (detail !== null) {
            comparison = {
                candidates: detail.candidates,
                selected: detail.selected,
                ruleRef: inputs.protectionRuleRef ?? "IRC §411(d)(6)",
            };
        }
        const protectedOutcome = (0, compose_1.applyProtection)(currentResult, protectedResult, {
            method: "greater-of",
            ruleRef: inputs.protectionRuleRef ?? "IRC §411(d)(6)",
        });
        if (protectedOutcome.kind !== "exact") {
            return stageFailure(6, "missing-input", "grandfathered protection could not be evaluated", "indeterminate");
        }
        const protectedAmount = protectedOutcome.value.amount;
        if (protectedAmount === null) {
            return stageFailure(6, "missing-input", "protected benefit carries no amount", "indeterminate");
        }
        currentMonthly = moneyToDecimal(protectedAmount);
        protection = {
            kind: inputs.protectionKind ?? "IRC §411(d)(6) grandfathered floor",
            ruleRef: inputs.protectionRuleRef ?? "IRC §411(d)(6)",
        };
        steps.push(makeStep("protection", [
            { field: "preProtectionMonthly", value: baseMonthly },
            { field: "protectedMonthly", value: protectedMonthly },
            { field: "selectedMonthly", value: currentMonthly },
        ], currentMonthly, inputs.protectionRuleRef ?? "IRC §411(d)(6): protected benefit applied as a floor", "fact"));
    }
    if (protection === null && comparison === null) {
        steps.push(makeStep("protection-evaluated-not-applied", [{ field: "preProtectionMonthly", value: baseMonthly }], baseMonthly, "No grandfathering / greater-of protection applies; evaluated and not applied", "fact"));
    }
    const benefit = {
        ...base,
        amount: moneyFromExact(currentMonthly),
        periodicity: "monthly",
    };
    return {
        benefit,
        protection: { protection, preProtection: base, comparison },
        steps,
    };
}
// ---------------------------------------------------------------------------
// Stage 7 — Apply relevant plan and statutory benefit restrictions
// ---------------------------------------------------------------------------
function applyRestrictions(state, inputs) {
    const protectedBenefit = state.protectedBenefit;
    if (protectedBenefit === null || protectedBenefit.amount === null) {
        return stageFailure(7, "missing-input", "Stage 6 protected benefit is not available", "indeterminate");
    }
    const steps = [];
    const applied = [];
    const notApplied = [];
    let currentMonthly = moneyToDecimal(protectedBenefit.amount);
    const restrictions = inputs?.restrictions ?? [];
    for (const restriction of restrictions) {
        if (restriction.kind === "section-415"
            && inputs?.disabledCaps?.includes("section-415-limit") === true) {
            notApplied.push({ restriction: "IRC §415 limit", reason: "disabled for this run (counterfactual)" });
            steps.push(makeStep("restriction-evaluated-not-applied", [{ field: "restriction", value: "IRC §415 limit" }], "not-applied", "IRC §415 limit disabled for this run (counterfactual)", "fact"));
            continue;
        }
        if (restriction.kind === "section-415") {
            const cap = (0, decimal_1.decCompare)(restriction.dollarLimitMonthly, restriction.compensationLimitMonthly) <= 0
                ? restriction.dollarLimitMonthly
                : restriction.compensationLimitMonthly;
            const before = moneyFromExact(currentMonthly);
            if ((0, decimal_1.decCompare)(currentMonthly, cap) > 0)
                currentMonthly = cap;
            const after = moneyFromExact(currentMonthly);
            applied.push({ restriction: "IRC §415 limit", ruleRef: restriction.ruleRef, before, after });
            steps.push(makeStep("restriction", [
                { field: "restriction", value: "IRC §415 limit" },
                { field: "beforeMinor", value: before.amountMinor },
                { field: "afterMinor", value: after.amountMinor },
            ], after.amountMinor, restriction.ruleRef, "fact"));
        }
        else {
            const before = moneyFromExact(currentMonthly);
            const net = (0, decimal_1.decSubtract)(currentMonthly, restriction.offsetMonthly);
            currentMonthly = (0, decimal_1.decCompare)(net, "0") < 0 ? "0" : net;
            const after = moneyFromExact(currentMonthly);
            applied.push({ restriction: restriction.label, ruleRef: restriction.ruleRef, before, after });
            steps.push(makeStep("restriction", [
                { field: "restriction", value: restriction.label },
                { field: "beforeMinor", value: before.amountMinor },
                { field: "afterMinor", value: after.amountMinor },
            ], after.amountMinor, restriction.ruleRef, "fact"));
        }
    }
    if (restrictions.length === 0) {
        steps.push(makeStep("restrictions-evaluated-not-applied", [{ field: "protectedMonthly", value: moneyToDecimal(protectedBenefit.amount) }], moneyToDecimal(protectedBenefit.amount), "No cap, no offset, no prior distribution applies; evaluated and not applied", "fact"));
    }
    const benefit = {
        ...protectedBenefit,
        amount: moneyFromExact(currentMonthly),
        periodicity: "monthly",
    };
    return { benefit, restrictions: { applied, notApplied }, steps };
}
// ---------------------------------------------------------------------------
// Stage 8 — Apply prescribed rounding
// ---------------------------------------------------------------------------
function applyPrescribedRounding(state, inputs) {
    void inputs;
    const restricted = state.restrictedBenefit;
    if (restricted === null || restricted.amount === null) {
        return stageFailure(8, "missing-input", "Stage 7 restricted benefit is not available", "indeterminate");
    }
    const request = state.request;
    const seq = request.roundingConfig.prescribedSequence;
    const steps = [];
    // Rounding operations already applied at Stages 3/4 (definition-internal
    // rules) are in the trace; collect them into the record.
    const earlierOperations = [];
    for (const step of state.trace) {
        if (step.name === "rounding" && typeof step.output === "object" && step.output !== null) {
            const op = step.output;
            if (op.target !== undefined && op.before !== undefined)
                earlierOperations.push(op);
        }
    }
    const operations = [...earlierOperations];
    let currentDecimal = moneyToDecimal(restricted.amount);
    let periodicity = restricted.periodicity;
    if (seq !== null) {
        for (const rule of seq.rules) {
            if (rule.target === "compensation"
                || rule.target === "average-compensation"
                || rule.target === "credited-service") {
                continue; // applied at Stages 3/4, or not applicable to the benefit
            }
            let before;
            let after;
            if (rule.target === "final-monthly-benefit") {
                before = periodicity === "monthly"
                    ? currentDecimal
                    : annualToMonthlyDecimal(currentDecimal);
                after = (0, rounding_1.applyMoneyRounding)(before, rule);
                currentDecimal = after;
                periodicity = "monthly";
            }
            else {
                before = currentDecimal;
                after = (0, rounding_1.applyMoneyRounding)(before, rule);
                currentDecimal = after;
            }
            operations.push({
                target: rule.target,
                before,
                after,
                unit: rule.unit,
                mode: rule.mode,
                ruleRef: rule.source.citation ?? rule.source.kind,
            });
            steps.push(makeStep("rounding", [
                { field: "target", value: rule.target },
                { field: "before", value: before },
                { field: "after", value: after },
                { field: "unit", value: rule.unit },
                { field: "mode", value: rule.mode },
            ], after, rule.source.citation ?? rule.source.kind, "fact"));
        }
    }
    if (seq === null) {
        steps.push(makeStep("rounding-none-prescribed", [{ field: "benefitMonthly", value: currentDecimal }], currentDecimal, "No rounding rule is documented for this plan version — no rounding applied (not a default)", "fact"));
    }
    // Maximum plausible rounding effect (Stage 2 output 04 §4.3) via the
    // real rounding module. A discrepancy larger than this cannot be
    // explained by rounding alone. Thin adapter: ServiceMeasures →
    // ServiceResult carries the credited-service value (the module skips
    // the service-target stage when it is null). This counts the
    // compensation / average-compensation / credited-service stages the
    // old local sum ignored; money-target stages agree exactly.
    const serviceForRounding = {
        value: state.service?.creditedService ?? null,
        rational: null,
        periods: [],
        missingInputs: [],
        roundingApplied: [],
    };
    const roundingApplied = {
        sequenceId: seq === null ? "none-prescribed" : seq.sequenceId,
        operations,
        maxPlausibleEffect: seq === null
            ? (0, decimal_1.makeMoney)(0)
            : (0, rounding_1.maxPlausibleRoundingEffect)(restricted, request.roundingConfig, serviceForRounding),
    };
    const benefit = {
        ...restricted,
        amount: moneyFromExact(currentDecimal),
        periodicity,
    };
    return { benefit, roundingApplied, steps };
}
// ---------------------------------------------------------------------------
// Stage 9 — Express the result in the required normal-retirement basis
// ---------------------------------------------------------------------------
function expressOnNormalRetirementBasis(state, inputs) {
    const rounded = state.roundedBenefit;
    if (rounded === null || rounded.amount === null) {
        return stageFailure(9, "missing-input", "Stage 8 rounded benefit is not available", "indeterminate");
    }
    const request = state.request;
    const steps = [];
    const conversions = [];
    let currentDecimal = moneyToDecimal(rounded.amount);
    let periodicity = rounded.periodicity;
    let vestingTreatment = rounded.vestingTreatment;
    let annuityForm = rounded.annuityForm;
    let retirementAge = rounded.retirementAge;
    // Annual → monthly (Stage 2 output 04 §3.1 rule R-4). Stage 8 applies
    // the final-monthly rule on the monthly equivalent when one is
    // prescribed; when none is prescribed, the monthly amount is the half-up
    // cents representation of the exact value, recorded here.
    if (periodicity === "annual") {
        const before = currentDecimal;
        const exactMonthly = annualToMonthlyDecimal(before);
        const finalRule = request.roundingConfig.prescribedSequence?.rules.find((r) => r.target === "final-monthly-benefit");
        if (finalRule !== undefined) {
            currentDecimal = (0, rounding_1.applyMoneyRounding)(exactMonthly, finalRule);
        }
        else {
            currentDecimal = (0, decimal_1.decRound)(exactMonthly, "0.01", "half-up");
        }
        periodicity = "monthly";
        conversions.push({
            conversion: "annual-to-monthly",
            factor: "0.0833333333",
            ruleRef: "Stage 9: annual ÷ 12 (exact decimal at scale 10)"
                + (finalRule === undefined ? "; no prescribed final-monthly rule — half-up cents representation recorded" : ""),
            before: moneyFromExact(before),
            after: moneyFromExact(currentDecimal),
        });
        steps.push(makeStep("basis-conversion", [
            { field: "conversion", value: "annual-to-monthly" },
            { field: "beforeAnnual", value: before },
            { field: "afterMonthly", value: currentDecimal },
            { field: "exactMonthly", value: exactMonthly },
        ], currentDecimal, "Stage 9: annual benefit ÷ 12 to the monthly basis", "fact"));
    }
    // Vesting: the formula output is a gross accrued benefit (B1); the
    // comparison basis is the vested benefit (B2) when VP is known.
    const vp = state.service?.vestingPercentage ?? null;
    if (vestingTreatment === "gross" && inputs?.skipVesting !== true) {
        if (vp === null) {
            return stageFailure(9, "unresolved-basis", "vesting percentage VP is not established and the benefit is gross", "indeterminate");
        }
        const before = moneyFromExact(currentDecimal);
        const factor = inputs?.applyVestingTwice === true ? (0, decimal_1.decMultiply)(vp, vp) : vp;
        currentDecimal = (0, decimal_1.decMultiply)(currentDecimal, factor);
        vestingTreatment = "vested";
        conversions.push({
            conversion: inputs?.applyVestingTwice === true ? "vesting-applied-twice-diagnostic" : "vesting",
            factor,
            ruleRef: "Stage 9: VP × gross accrued benefit (BCV VP)",
            before,
            after: moneyFromExact(currentDecimal),
        });
        steps.push(makeStep("basis-conversion", [
            { field: "conversion", value: "vesting" },
            { field: "vestingPercentage", value: vp },
            { field: "beforeMinor", value: before.amountMinor },
            { field: "afterMinor", value: moneyFromExact(currentDecimal).amountMinor },
        ], currentDecimal, "Stage 9: vesting applied (VP × gross)", "fact"));
    }
    else if (inputs?.skipVesting === true) {
        steps.push(makeStep("basis-conversion-skipped", [{ field: "conversion", value: "vesting" }], "skipped-counterfactual", "Stage 9: vesting skipped (counterfactual: vesting not applied)", "fact"));
    }
    // Annuity form and retirement age must be established for the basis.
    if (inputs?.requiredBasis?.annuityForm !== undefined) {
        annuityForm = inputs.requiredBasis.annuityForm;
    }
    if (inputs?.requiredBasis?.retirementAge !== undefined) {
        retirementAge = inputs.requiredBasis.retirementAge;
    }
    if (annuityForm === "unknown") {
        return stageFailure(9, "unresolved-basis", "annuity form is not established (the plan's normal form is not stated)", "indeterminate");
    }
    if (retirementAge === null || retirementAge === undefined) {
        return stageFailure(9, "unresolved-basis", "normal retirement age is not established", "indeterminate");
    }
    const benefit = {
        ...rounded,
        amount: moneyFromExact(currentDecimal),
        periodicity,
        vestingTreatment,
        annuityForm,
        retirementAge,
        commencementBasis: inputs?.requiredBasis?.commencementBasis ?? rounded.commencementBasis ?? "payable at NRD",
    };
    steps.push(makeStep("normal-retirement-basis", [
        { field: "periodicity", value: periodicity },
        { field: "annuityForm", value: annuityForm },
        { field: "retirementAge", value: retirementAge },
        { field: "vestingTreatment", value: vestingTreatment },
        { field: "amountMinor", value: benefit.amount?.amountMinor ?? null },
    ], benefit.amount?.amountMinor ?? null, "Stage 9: benefit expressed on the normal-retirement basis (monthly, normal form, NRA)", "fact"));
    return { benefit, conversions: { conversions }, steps };
}
// ---------------------------------------------------------------------------
// Stage 10 — Reconcile (comparison inputs only; §6.1)
// ---------------------------------------------------------------------------
function emitReconciliationInputs(state, inputs, bounds) {
    const request = state.request;
    const steps = [];
    const reconstructed = state.normalRetirementBenefit;
    const recorded = inputs?.recordedPaAmb ?? null;
    const basisEstablished = request.measurementDate !== null
        && request.measurementBasis !== "unresolved";
    if (!basisEstablished) {
        return stageFailure(10, "unresolved-basis", "comparison basis is unresolved; no Δ is computed", "indeterminate");
    }
    const conversions = state.trace.filter((s) => s.name === "basis-conversion");
    const comparisonBasis = conversions.length > 0 ? "basis-converted" : "same-basis";
    const basisConversion = conversions.length > 0
        ? conversions.map((s) => `${s.inputs.find((i) => i.field === "conversion")?.value ?? "conversion"}`).join("; ")
        : null;
    steps.push(makeStep("comparison-basis", [
        { field: "comparisonBasis", value: comparisonBasis },
        { field: "basisConversion", value: basisConversion },
        { field: "measurementDate", value: request.measurementDate },
    ], comparisonBasis, "Stage 10: comparison basis statement", "fact"));
    steps.push(makeStep("recorded-pa-amb", [
        { field: "recordedMinor", value: recorded?.amount?.amountMinor ?? null },
        { field: "recordedSource", value: "prior-administrator" },
    ], recorded?.amount?.amountMinor ?? null, "Stage 10: recorded PA_AMB and its provenance (blank = missing, never zero)", recorded === null ? "unknown" : "fact"));
    // Denominator flags (Stage 1 output 03 §2.3). R is never computed here;
    // the flag is recorded instead of a relative difference.
    let denominatorFlag = null;
    const epsilonR = inputs?.epsilonRMinor ?? 100;
    if (reconstructed !== null && reconstructed.amount !== null) {
        if (reconstructed.amount.amountMinor === 0) {
            denominatorFlag = "R_UNDEFINED_ZERO_DENOMINATOR";
        }
        else if (reconstructed.amount.amountMinor < epsilonR) {
            denominatorFlag = "R_UNSTABLE_SMALL_DENOMINATOR";
        }
        else if (recorded !== null && recorded.amount !== null && recorded.amount.amountMinor === 0) {
            denominatorFlag = "PA_ZERO";
        }
    }
    // Counterfactual hypotheses (§6.2). Each runs on a copy; the base
    // calculation is untouched.
    const counterfactuals = [];
    const operations = [];
    operations.push({ kind: "service-delta-years", years: "+1" });
    operations.push({ kind: "service-delta-years", years: "-1" });
    const vp = state.service?.vestingPercentage;
    if (vp !== null && vp !== undefined && (0, decimal_1.decCompare)(vp, "1") !== 0) {
        operations.push({ kind: "vesting", mode: "not-applied" });
    }
    for (const alt of request.roundingConfig.alternativeSequences) {
        operations.push({ kind: "rounding-sequence", sequence: alt });
    }
    for (const op of inputs?.counterfactuals ?? [])
        operations.push(op);
    for (const op of operations) {
        const result = testCounterfactual(request, op, inputs);
        counterfactuals.push(result);
        steps.push(makeStep("counterfactual", [
            { field: "operation", value: JSON.stringify(op) },
            { field: "hypothesisCode", value: result.hypothesisCode },
            { field: "supportClass", value: result.supportClass },
            { field: "benefitMinor", value: result.benefit?.amount?.amountMinor ?? null },
            { field: "residualDeltaMinor", value: result.residualDelta?.amountMinor ?? null },
        ], result.supportClass, `Stage 10: counterfactual ${result.hypothesisCode} tested`, "fact"));
    }
    const reconciliation = {
        reconstructed: bounds !== null && bounds !== undefined ? null : reconstructed,
        recorded,
        comparisonBasis,
        basisConversion,
        bounds: bounds ?? null,
        counterfactuals,
        denominatorFlag,
        toleranceApplied: request.tolerance,
    };
    return { reconciliation, steps };
}
/** Map a formula's free-text missing input to a canonical field name. */
function fieldForMissingInput(text) {
    const compYear = /compensation year (\d{4})/.exec(text);
    if (compYear !== null && compYear[1] !== undefined) {
        return `CompensationHistory.salaryYear ${compYear[1]}`;
    }
    if (text.includes("birth year"))
        return "Participant.dob";
    if (text.includes("credited service"))
        return "ServiceHistory.creditedService";
    if (text.includes("vesting schedule"))
        return "Plan.vestingSchedule";
    if (text.includes("averaging period"))
        return "Formula.averagingPeriod";
    return text;
}
function cloneRequest(request) {
    return JSON.parse(JSON.stringify(request));
}
/**
 * Run the exact path in isolation: the step counter is restored
 * afterwards, so a speculative evaluation (a bounds corner, a
 * counterfactual) never consumes step numbers from the trace it is
 * being computed for. Without this, the outer trace's step numbers
 * would have gaps where discarded evaluations ran.
 */
function runExactPathIsolated(request, inputs) {
    const savedCounter = stepCounter;
    const result = runExactPath(request, inputs);
    stepCounter = savedCounter;
    return result;
}
/**
 * Run Stages 1–9. Returns the exact benefit on success, or the stage
 * failure (with the missing inputs that caused it) on failure. Stage 10
 * is NOT run here — it is run by calculateAccruedBenefit after the
 * exact/bounds fork, and testCounterfactual uses this function directly
 * (so counterfactual evaluation never re-enters Stage 10).
 */
function runExactPath(request, inputs) {
    let state = initialState(request);
    const missingInputs = [];
    const fail = (failure, stateSoFar) => ({
        ok: false,
        state: stateSoFar,
        benefit: null,
        exactMonthly: null,
        failure,
        formulaInexact: null,
        missingInputs,
    });
    const basis = resolveComparisonBasis(request);
    if (basis.basis === "unresolved") {
        return fail(stageFailure(1, "unresolved-basis", basis.reason, "indeterminate"), state);
    }
    const s1 = identifyProvisions(state, inputs);
    if (isStageFailure(s1))
        return fail(s1, state);
    state = appendSteps({ ...state, provisions: s1.provisions }, s1.steps);
    const s2 = determineEligibility(state, inputs);
    if (isStageFailure(s2))
        return fail(s2, state);
    state = appendSteps({ ...state, eligibility: s2.eligibility }, s2.steps);
    const s3 = determineServiceMeasures(state, inputs);
    if (isStageFailure(s3)) {
        missingInputs.push(missingItem("ServiceHistory.creditedService", classForField(inputs, "ServiceHistory.creditedService"), "required for exact reconstruction", "the credited service history"));
        state = { ...state, missingInputs };
        return fail(s3, state);
    }
    state = appendSteps({ ...state, service: s3.service }, s3.steps);
    const s4 = determineCompensationMeasures(state, inputs);
    if (isStageFailure(s4)) {
        const field = s4.detail.startsWith("CompensationHistory.salaryYear")
            ? s4.detail
            : "CompensationHistory.salaryByYear";
        missingInputs.push(missingItem(field, classForField(inputs, field), "required for exact reconstruction", "the missing compensation year"));
        state = { ...state, missingInputs };
        return fail(s4, state);
    }
    state = appendSteps({ ...state, compensation: s4.compensation }, s4.steps);
    const s5 = calculateBaseBenefit(state, inputs);
    if (isStageFailure(s5)) {
        if (s5.reason === "missing-input") {
            for (const text of s5.detail.split("; ")) {
                const field = fieldForMissingInput(text);
                missingInputs.push(missingItem(field, classForField(inputs, field), "required for exact reconstruction", "the missing input"));
            }
        }
        state = { ...state, missingInputs };
        return fail(s5, state);
    }
    state = appendSteps(state, s5.steps);
    if (s5.formulaResult.kind === "bound" || s5.formulaResult.kind === "scenarios") {
        return {
            ok: false,
            state,
            benefit: null,
            exactMonthly: null,
            failure: null,
            formulaInexact: s5.formulaResult,
            missingInputs: s5.formulaResult.missingInputs.map((field) => missingItem(fieldForMissingInput(field), classForField(inputs, fieldForMissingInput(field)), "required for exact reconstruction", "the missing input")),
        };
    }
    if (s5.benefit === null) {
        return fail(stageFailure(5, "missing-input", "Stage 5 produced no benefit", "indeterminate"), state);
    }
    state = { ...state, baseBenefit: s5.benefit };
    const s6 = applyAccrualAndProtection(state, inputs);
    if (isStageFailure(s6))
        return fail(s6, state);
    state = appendSteps({ ...state, protectedBenefit: s6.benefit }, s6.steps);
    const s7 = applyRestrictions(state, inputs);
    if (isStageFailure(s7))
        return fail(s7, state);
    state = appendSteps({ ...state, restrictedBenefit: s7.benefit }, s7.steps);
    const s8 = applyPrescribedRounding(state, inputs);
    if (isStageFailure(s8))
        return fail(s8, state);
    state = appendSteps({ ...state, roundedBenefit: s8.benefit }, s8.steps);
    const s9 = expressOnNormalRetirementBasis(state, inputs);
    if (isStageFailure(s9))
        return fail(s9, state);
    state = appendSteps({ ...state, normalRetirementBenefit: s9.benefit }, s9.steps);
    const benefit = s9.benefit;
    const exactMonthly = benefit.amount === null
        ? null
        : benefit.periodicity === "monthly"
            ? moneyToDecimal(benefit.amount)
            : annualToMonthlyDecimal(moneyToDecimal(benefit.amount));
    return {
        ok: true,
        state,
        benefit,
        exactMonthly,
        failure: null,
        formulaInexact: null,
        missingInputs,
    };
}
/** Fill the missing inputs of a request at one evaluation point. */
function fillRequestAtPoint(request, inputs, point) {
    const filledRequest = cloneRequest(request);
    let filledInputs = inputs === undefined
        ? undefined
        : { ...inputs, boundsSpec: undefined };
    for (const entry of point) {
        const salaryYear = /^CompensationHistory\.salaryYear (\d{4})$/.exec(entry.field);
        if (salaryYear !== null && salaryYear[1] !== undefined) {
            const year = Number(salaryYear[1]);
            const history = filledRequest.participantHistory.compensationHistory;
            if (history !== null) {
                const row = history.salaryByYear.find((y) => y.salaryYear === year);
                if (row !== undefined) {
                    row.amount = moneyFromExact(entry.value);
                }
                else {
                    const first = history.salaryByYear[0];
                    if (first !== undefined) {
                        history.salaryByYear.push({
                            salaryYear: year,
                            sourceField: "",
                            amount: moneyFromExact(entry.value),
                            annualized: false,
                            provenance: first.provenance,
                        });
                    }
                }
            }
            continue;
        }
        if (entry.field === "ServiceHistory.creditedService") {
            if (filledInputs === undefined) {
                throw new Error("fillRequestAtPoint: cannot fill credited service without PipelineInputs");
            }
            filledInputs = {
                ...filledInputs,
                serviceOverride: {
                    ...filledInputs.serviceOverride,
                    creditedService: entry.value,
                },
            };
            continue;
        }
        // Any other field cannot be filled by this path.
        throw new Error(`fillRequestAtPoint: cannot fill missing input ${entry.field}`);
    }
    return { request: filledRequest, inputs: filledInputs };
}
/**
 * Derive bounds by running the Stage 1–9 pipeline once per evaluation
 * point (endpoints, kinks, grid points) with the missing inputs fixed at
 * that point's values, and taking the min/max of the results
 * (Stage 2 output 04 §5.2). The pipeline is passed in as the evaluator
 * (dependency injection — this module cannot import the pipeline without
 * a cycle; the pipeline passes runExactPath).
 */
function deriveBoundsForRequest(args) {
    const { request, inputs, missingInputs } = args;
    const ranges = inputs?.boundsSpec?.ranges ?? [];
    if (!(0, bounds_1.isBoundsEstablishable)(missingInputs, ranges))
        return null;
    const points = [];
    const evaluatePoint = (label, point, required) => {
        let filled;
        try {
            filled = fillRequestAtPoint(request, inputs, point);
        }
        catch {
            return { benefit: null, trace: null };
        }
        const run = runExactPathIsolated(filled.request, filled.inputs);
        if (!run.ok || run.benefit === null) {
            if (required)
                throw new Error(`deriveBounds: evaluation point ${label} could not be computed exactly`);
            return { benefit: null, trace: null };
        }
        // Stage 4.5 trace fill (spec §1.6): each evaluation point runs its
        // own pipeline, so this point's trace IS the per-scenario derivation
        // trace of the scenario built from it — carry it through instead of
        // discarding it (see the generateScenarios call below).
        return { benefit: run.benefit, trace: run.state.trace };
    };
    const corners = [];
    const n = ranges.length;
    if (n <= 4) {
        for (let mask = 0; mask < (1 << n); mask += 1) {
            corners.push(ranges.map((r, i) => ({
                field: r.field,
                value: ((mask >> i) & 1) === 1 ? r.high : r.low,
            })));
        }
    }
    else {
        corners.push(ranges.map((r) => ({ field: r.field, value: r.low })));
        corners.push(ranges.map((r) => ({ field: r.field, value: r.high })));
        for (let i = 0; i < n; i += 1) {
            corners.push(ranges.map((r, j) => ({ field: r.field, value: j === i ? r.high : r.low })));
        }
    }
    const evaluatedCorners = [];
    for (let i = 0; i < corners.length; i += 1) {
        const corner = corners[i];
        if (corner === undefined)
            continue;
        const evaluated = evaluatePoint(`corner-${i}`, corner, true);
        if (evaluated.benefit === null)
            return null;
        evaluatedCorners.push({ point: corner, benefit: evaluated.benefit, trace: evaluated.trace });
        points.push({ label: `corner-${i}`, point: corner, benefit: evaluated.benefit });
    }
    // Midpoint (all ranges at midpoint) — the labelled-assumption scenario
    // and the monotonicity check.
    const midpointPoint = ranges.map((r) => ({
        field: r.field,
        value: (0, decimal_1.decDivide)((0, decimal_1.decAdd)(r.low, r.high), "2", 10),
    }));
    const midpointEvaluated = evaluatePoint("midpoint", midpointPoint, false);
    const midpointBenefit = midpointEvaluated.benefit;
    const midpointTrace = midpointEvaluated.trace;
    if (midpointBenefit !== null) {
        points.push({ label: "midpoint", point: midpointPoint, benefit: midpointBenefit });
    }
    // Kink points (cap thresholds, freeze dates, formula-change dates).
    const kinkPoints = [];
    for (const r of ranges) {
        for (const kink of r.kinks ?? []) {
            if ((0, decimal_1.decCompare)(kink, r.low) > 0 && (0, decimal_1.decCompare)(kink, r.high) < 0) {
                kinkPoints.push({ description: `${r.field} kink at ${kink}`, value: kink });
                const kinkPoint = ranges.map((other) => ({
                    field: other.field,
                    value: other.field === r.field ? kink : (0, decimal_1.decDivide)((0, decimal_1.decAdd)(other.low, other.high), "2", 10),
                }));
                const kinkEvaluated = evaluatePoint(`kink-${r.field}-${kink}`, kinkPoint, false);
                const kinkBenefit = kinkEvaluated.benefit;
                if (kinkBenefit !== null) {
                    points.push({ label: `kink-${r.field}-${kink}`, point: kinkPoint, benefit: kinkBenefit });
                }
            }
        }
    }
    const benefits = points
        .map((pt) => pt.benefit)
        .filter((b) => b !== null && b.amount !== null);
    if (benefits.length === 0)
        return null;
    let minBenefit = benefits[0];
    let maxBenefit = benefits[0];
    for (const b of benefits) {
        if (b.amount !== null && minBenefit.amount !== null && b.amount.amountMinor < minBenefit.amount.amountMinor)
            minBenefit = b;
        if (b.amount !== null && maxBenefit.amount !== null && b.amount.amountMinor > maxBenefit.amount.amountMinor)
            maxBenefit = b;
    }
    // Monotonicity per missing input (endpoints + midpoint + kinks).
    const monotonicity = ranges.map((r) => {
        const pts = points
            .map((pt) => {
            const entry = pt.point.find((e) => e.field === r.field);
            if (entry === undefined || pt.benefit === null || pt.benefit.amount === null)
                return null;
            return { inputValue: entry.value, benefitMinor: pt.benefit.amount.amountMinor };
        })
            .filter((pt) => pt !== null);
        return (0, bounds_1.checkMonotonicity)(r.field, pts);
    });
    const allMonotone = monotonicity.every((m) => m.monotone);
    const method = kinkPoints.length > 0
        ? "endpoint-plus-kinks"
        : allMonotone
            ? "endpoint-evaluation"
            : "grid";
    // Width attribution: marginal width per input (others at midpoint).
    const totalMin = minBenefit.amount?.amountMinor ?? 0;
    const totalMax = maxBenefit.amount?.amountMinor ?? 0;
    const totalWidth = totalMax - totalMin;
    const tauAbs = request.tolerance.absoluteMinor ?? null;
    const widthInputs = ranges.map((r) => {
        const lowPoint = ranges.map((other) => ({
            field: other.field,
            value: other.field === r.field ? r.low : (0, decimal_1.decDivide)((0, decimal_1.decAdd)(other.low, other.high), "2", 10),
        }));
        const highPoint = ranges.map((other) => ({
            field: other.field,
            value: other.field === r.field ? r.high : (0, decimal_1.decDivide)((0, decimal_1.decAdd)(other.low, other.high), "2", 10),
        }));
        const lowEvaluated = evaluatePoint(`width-low-${r.field}`, lowPoint, false);
        const highEvaluated = evaluatePoint(`width-high-${r.field}`, highPoint, false);
        const lowBenefit = lowEvaluated.benefit;
        const highBenefit = highEvaluated.benefit;
        const marginal = lowBenefit?.amount !== null && lowBenefit?.amount !== undefined
            && highBenefit?.amount !== null && highBenefit?.amount !== undefined
            ? Math.abs(highBenefit.amount.amountMinor - lowBenefit.amount.amountMinor)
            : 0;
        const narrowedWidth = Math.max(totalWidth - marginal, 0);
        return {
            missingInput: r.field,
            missingClass: r.missingClass,
            narrowedWidthMinor: narrowedWidth,
            couldChangeDisposition: tauAbs !== null && marginal > tauAbs,
        };
    });
    const widthAttribution = (0, bounds_1.attributeWidth)({
        totalMinMinor: totalMin,
        totalMaxMinor: totalMax,
        inputs: widthInputs,
    });
    // Scenarios: lower bound, upper bound, midpoint (labelled assumption).
    const lowCorner = evaluatedCorners.find((c) => c.point.every((e, i) => ranges[i] !== undefined && e.value === ranges[i]?.low));
    const highCorner = evaluatedCorners.find((c) => c.point.every((e, i) => ranges[i] !== undefined && e.value === ranges[i]?.high));
    const scenarios = (0, bounds_1.generateScenarios)({
        endpoints: [
            {
                name: "missing input at lower bound",
                assumptions: ranges.map((r) => `${r.field} at lower bound ${r.low} ${r.unit}`).join("; "),
                benefit: lowCorner?.benefit.amount ?? minBenefit.amount,
                trace: lowCorner?.trace ?? null,
            },
            {
                name: "missing input at upper bound",
                assumptions: ranges.map((r) => `${r.field} at upper bound ${r.high} ${r.unit}`).join("; "),
                benefit: highCorner?.benefit.amount ?? maxBenefit.amount,
                trace: highCorner?.trace ?? null,
            },
            {
                name: "missing input at midpoint (labelled assumption)",
                assumptions: ranges.map((r) => `${r.field} at midpoint ${(0, decimal_1.decDivide)((0, decimal_1.decAdd)(r.low, r.high), "2", 10)} ${r.unit} — assumption, not the benefit`).join("; "),
                benefit: midpointBenefit?.amount ?? null,
                trace: midpointTrace,
            },
        ],
        planVersionId: args.failureState.provisions?.planVersionId ?? null,
        formulaId: request.formulaId,
    });
    const assumptions = [
        ...(inputs?.boundsSpec?.assumptions ?? []),
        `formula ${request.formulaId} applies to all service`,
    ];
    return (0, bounds_1.buildBoundsResult)({
        minBenefit,
        maxBenefit,
        assumptions,
        derivation: {
            method,
            kinkPoints,
            monotonicity,
            feasibleRegion: (0, bounds_1.feasibleRegionDescription)(ranges).description,
        },
        widthAttribution,
        scenarios,
        recordedPaAmb: inputs?.recordedPaAmb ?? null,
    });
}
// ---------------------------------------------------------------------------
// calculateAccruedBenefit — the pipeline entry point (Stage 2 output 04 §1.1)
// ---------------------------------------------------------------------------
function calculateAccruedBenefit(request, inputs) {
    resetStepCounter();
    const gate = resolveComparisonBasis(request);
    if (gate.basis === "unresolved") {
        const gateStep = makeStep("comparison-basis-gate", [{ field: "measurementDate", value: request.measurementDate }], "unresolved", "Stage 2 output 04 §1.4: unresolved comparison basis — no stage runs and no Δ is computed", "unknown");
        return indeterminateOutcome({
            code: "unresolved-comparison-basis",
            detail: gate.reason,
            missingInputs: ["measurement date / measurement basis"],
            wouldResolve: ["the benefit measurement date and how it was established"],
        }, [gateStep]);
    }
    const run = runExactPath(request, inputs);
    if (run.ok && run.benefit !== null) {
        const s10 = emitReconciliationInputs(run.state, inputs, null);
        if (isStageFailure(s10)) {
            return indeterminateOutcome({
                code: s10.reason,
                detail: s10.detail,
                missingInputs: [],
                wouldResolve: [],
            }, run.state.trace);
        }
        const state = appendSteps({ ...run.state, reconciliation: s10.reconciliation }, s10.steps);
        return { kind: "exact", benefit: run.benefit, trace: state.trace };
    }
    if (run.formulaInexact !== null) {
        const inexact = run.formulaInexact;
        // Locals computed up front: the bound/scenarios branches below return,
        // so the fall-through here is the indeterminate case (or scenarios
        // with no values, which carries the same missing-inputs shape).
        const missingInputs = inexact.kind === "exact" ? [] : inexact.missingInputs;
        const wouldResolve = inexact.kind === "indeterminate" ? inexact.wouldResolve : [];
        if (inexact.kind === "bound") {
            const bounds = (0, bounds_1.boundsResultFromCalcResult)({
                bound: inexact,
                assumptions: [
                    ...(inputs?.boundsSpec?.assumptions ?? []),
                    `formula ${request.formulaId} applies to all service`,
                ],
                feasibleRegion: (0, bounds_1.feasibleRegionDescription)(inputs?.boundsSpec?.ranges ?? []),
                recordedPaAmb: inputs?.recordedPaAmb ?? null,
                planVersionId: run.state.provisions?.planVersionId ?? null,
                formulaId: request.formulaId,
            });
            const s10 = emitReconciliationInputs(run.state, inputs, bounds);
            const trace = isStageFailure(s10)
                ? run.state.trace
                : appendSteps({ ...run.state, reconciliation: s10.reconciliation }, s10.steps).trace;
            return { kind: "bounds", bounds, trace };
        }
        // Scenarios → bounds over the scenario range, with the scenarios kept.
        const values = inexact.kind === "scenarios"
            ? inexact.scenarios
                .map((s) => s.value.amount?.amountMinor ?? null)
                .filter((m) => m !== null)
            : [];
        if (values.length > 0 && inexact.kind === "scenarios") {
            const minMinor = Math.min(...values);
            const maxMinor = Math.max(...values);
            const reference = inexact.scenarios[0]?.value;
            if (reference !== undefined) {
                const bounds = (0, bounds_1.buildBoundsResult)({
                    minBenefit: { ...reference, amount: (0, decimal_1.makeMoney)(minMinor), source: "bound" },
                    maxBenefit: { ...reference, amount: (0, decimal_1.makeMoney)(maxMinor), source: "bound" },
                    assumptions: [
                        ...(inputs?.boundsSpec?.assumptions ?? []),
                        `formula ${request.formulaId} applies to all service`,
                    ],
                    derivation: {
                        method: "endpoint-evaluation",
                        kinkPoints: [],
                        monotonicity: inexact.missingInputs.map((input) => ({
                            input,
                            monotone: true,
                            verifiedBy: "formula structure",
                        })),
                        feasibleRegion: (0, bounds_1.feasibleRegionDescription)(inputs?.boundsSpec?.ranges ?? []).description,
                    },
                    widthAttribution: [],
                    // Stage 5 fix for the Stage 4.5 trace gap: formula-level
                    // `NamedScenario`s now carry a per-scenario derivation trace
                    // (formulas.ts `namedScenario`, compose.ts `combineResults`
                    // carries traces through combination). The mapping forwards
                    // whatever trace a formula supplies (`s.trace ?? null`); a
                    // scenario whose trace is genuinely unavailable still maps to
                    // null here and publication reports it as "per-scenario
                    // derivation trace not recorded" — never invented. The shared
                    // pipeline trace (`run.state.trace`, stages 1–5 up to the
                    // formula) is NOT substituted: it is the pre-formula
                    // derivation shared by all scenarios, not a per-scenario
                    // derivation.
                    scenarios: inexact.scenarios.map((s) => ({
                        name: s.name,
                        assumptions: s.basis,
                        benefit: s.value.amount,
                        planVersionId: run.state.provisions?.planVersionId ?? null,
                        formulaId: request.formulaId,
                        trace: s.trace ?? null,
                    })),
                    recordedPaAmb: inputs?.recordedPaAmb ?? null,
                });
                const s10 = emitReconciliationInputs(run.state, inputs, bounds);
                const trace = isStageFailure(s10)
                    ? run.state.trace
                    : appendSteps({ ...run.state, reconciliation: s10.reconciliation }, s10.steps).trace;
                return { kind: "bounds", bounds, trace };
            }
        }
        return indeterminateOutcome({
            code: "indeterminate",
            detail: missingInputs.join("; "),
            missingInputs,
            wouldResolve,
        }, run.state.trace);
    }
    const failure = run.failure;
    if (failure !== null && failure.next === "bounds") {
        const bounds = deriveBoundsForRequest({
            request,
            inputs,
            missingInputs: run.missingInputs,
            failureState: run.state,
        });
        if (bounds !== null) {
            const s10 = emitReconciliationInputs(run.state, inputs, bounds);
            const trace = isStageFailure(s10)
                ? run.state.trace
                : appendSteps({ ...run.state, reconciliation: s10.reconciliation }, s10.steps).trace;
            return { kind: "bounds", bounds, trace };
        }
    }
    const reason = {
        code: failure?.reason ?? "indeterminate",
        detail: failure?.detail ?? "the calculation could not be completed",
        missingInputs: run.missingInputs.map((m) => m.field),
        wouldResolve: run.missingInputs.map((m) => m.resolvesBy ?? "").filter((s) => s !== ""),
    };
    return indeterminateOutcome(reason, run.state.trace);
}
// ---------------------------------------------------------------------------
// Counterfactual-hypothesis interface (Stage 2 output 04 §6.2)
// ---------------------------------------------------------------------------
const HYPOTHESIS_CODES = {
    "service-delta-years": "H2",
    "averaging-period": "H4",
    "formula-version": "H6",
    vesting: "H12",
    "rounding-sequence": "H15",
    cap: "H8",
    freeze: "H9",
    "prior-distribution": "H11",
};
function parseAveragingPeriod(period) {
    const finalMatch = /^final-(\d+)-year$/.exec(period);
    if (finalMatch !== null && finalMatch[1] !== undefined) {
        const years = Number(finalMatch[1]);
        return { kind: "final", years, description: period, ruleRef: "counterfactual: documented alternative averaging period" };
    }
    const highestMatch = /^highest-(\d+)-year$/.exec(period);
    if (highestMatch !== null && highestMatch[1] !== undefined) {
        const years = Number(highestMatch[1]);
        return { kind: "highest", years, description: period, ruleRef: "counterfactual: documented alternative averaging period" };
    }
    if (period === "career") {
        return { kind: "career", years: 0, description: period, ruleRef: "counterfactual: documented alternative averaging period" };
    }
    return null;
}
/**
 * Tests one counterfactual: re-runs the pipeline on a copy of the request
 * with the operation applied, and returns the result. The base calculation
 * is untouched. Support classes: "supported" only when the residual
 * vanishes AND the operation is documented (a documented alternative
 * period / formula version / rounding sequence); "plausible" when the
 * residual vanishes but the operation is undocumented; "coincidence" for
 * diagnostic-only operations (vesting applied twice, freeze not respected,
 * undocumented rounding sequence) — never presented as an explanation and
 * never sufficient to move a disposition to Verified; "refuted" when the
 * residual does not vanish or the counterfactual cannot be evaluated.
 * Ranking belongs to the reconciliation module (Stage 5).
 */
function testCounterfactual(request, operation, inputs) {
    const hypothesisCode = HYPOTHESIS_CODES[operation.kind];
    const recorded = inputs?.recordedPaAmb ?? null;
    const refuted = (reason) => ({
        operation,
        hypothesisCode,
        benefit: null,
        residualDelta: null,
        supportClass: "refuted",
        evidenceFor: [],
        evidenceAgainst: [reason],
    });
    let request2 = cloneRequest(request);
    let inputs2 = inputs === undefined
        ? undefined
        : { ...inputs };
    let documented = false;
    switch (operation.kind) {
        case "service-delta-years": {
            const base = runExactPathIsolated(request, inputs);
            const current = base.state.service?.creditedService;
            if (current === null || current === undefined) {
                return refuted("credited service could not be established for the base calculation");
            }
            const years = operation.years.replace(/^\+/, "");
            inputs2 = {
                ...inputs2,
                serviceOverride: {
                    ...inputs2?.serviceOverride,
                    creditedService: (0, decimal_1.decAdd)(current, years),
                },
            };
            break;
        }
        case "averaging-period": {
            const parsed = parseAveragingPeriod(operation.period);
            if (parsed === null)
                return refuted(`averaging period "${operation.period}" is not a recognised period`);
            documented = (inputs?.alternativeAveragingPeriods ?? []).includes(operation.period);
            inputs2 = { ...inputs2, averagingPeriod: parsed };
            break;
        }
        case "formula-version": {
            const call = inputs?.formulaCallsById?.[operation.formulaId];
            if (call === undefined) {
                return refuted(`no formula parameters supplied for formula version ${operation.formulaId}`);
            }
            documented = request.provisionTimeline.versions.some((v) => v.formulaIds.includes(operation.formulaId));
            request2 = { ...request2, formulaId: operation.formulaId };
            inputs2 = { ...inputs2, formulaCall: call };
            break;
        }
        case "vesting": {
            if (operation.mode === "applied-once") {
                inputs2 = { ...inputs2, skipVesting: false, applyVestingTwice: false };
                documented = true;
            }
            else if (operation.mode === "not-applied") {
                inputs2 = { ...inputs2, skipVesting: true };
            }
            else {
                inputs2 = { ...inputs2, applyVestingTwice: true };
            }
            break;
        }
        case "rounding-sequence": {
            documented = operation.sequence.rules.every((r) => r.source.kind !== "not-documented");
            request2 = {
                ...request2,
                roundingConfig: { ...request2.roundingConfig, prescribedSequence: operation.sequence },
            };
            break;
        }
        case "cap": {
            if (operation.applied === false) {
                const disabled = [...(inputs?.disabledCaps ?? [])];
                if (!disabled.includes(operation.cap))
                    disabled.push(operation.cap);
                inputs2 = { ...inputs2, disabledCaps: disabled };
                if (operation.cap === "section-415-limit") {
                    inputs2 = {
                        ...inputs2,
                        restrictions: (inputs?.restrictions ?? []).filter((r) => r.kind !== "section-415"),
                    };
                }
            }
            else {
                const disabled = (inputs?.disabledCaps ?? []).filter((c) => c !== operation.cap);
                inputs2 = { ...inputs2, disabledCaps: disabled };
                if (operation.cap === "service-cap" && inputs?.serviceCap === undefined) {
                    return refuted("no service cap value supplied to apply");
                }
                if (operation.cap === "compensation-cap" && inputs?.compensationCap === undefined) {
                    return refuted("no compensation cap value supplied to apply");
                }
                if (operation.cap === "section-415-limit"
                    && (inputs?.restrictions ?? []).every((r) => r.kind !== "section-415")) {
                    return refuted("no §415 limit values supplied to apply");
                }
            }
            documented = true;
            break;
        }
        case "freeze": {
            if (operation.respected === false) {
                inputs2 = { ...inputs2, ignoreFreeze: true };
            }
            break;
        }
        case "prior-distribution": {
            if (operation.deducted === false) {
                inputs2 = {
                    ...inputs2,
                    restrictions: (inputs?.restrictions ?? []).filter((r) => !(r.kind === "offset-monthly" && r.label === "prior-distribution")),
                };
            }
            else if ((inputs?.restrictions ?? []).every((r) => !(r.kind === "offset-monthly" && r.label === "prior-distribution"))) {
                return refuted("no prior-distribution offset value supplied to deduct");
            }
            documented = true;
            break;
        }
    }
    const run = runExactPathIsolated(request2, inputs2);
    if (!run.ok || run.benefit === null) {
        return refuted("the counterfactual could not be evaluated exactly");
    }
    const benefit = run.benefit;
    if (benefit.amount === null) {
        return refuted("the counterfactual benefit carries no amount");
    }
    const benefitAmount = benefit.amount;
    const residualDelta = recorded?.amount !== null && recorded?.amount !== undefined
        ? (0, decimal_1.makeMoney)(recorded.amount.amountMinor - benefitAmount.amountMinor)
        : null;
    const residualIsZero = residualDelta !== null && residualDelta.amountMinor === 0;
    let supportClass;
    if (!residualIsZero) {
        supportClass = "refuted";
    }
    else if (operation.kind === "vesting" && operation.mode === "applied-twice-diagnostic") {
        supportClass = "coincidence";
    }
    else if (operation.kind === "freeze" && operation.respected === false) {
        supportClass = "coincidence";
    }
    else if (operation.kind === "rounding-sequence" && !documented) {
        supportClass = "coincidence";
    }
    else if (documented) {
        supportClass = "supported";
    }
    else {
        supportClass = "plausible";
    }
    return {
        operation,
        hypothesisCode,
        benefit,
        residualDelta,
        supportClass,
        evidenceFor: residualIsZero
            ? [`the counterfactual benefit ${(0, decimal_1.moneyMinorToDecimalString)(benefitAmount.amountMinor)} equals the recorded PA_AMB`]
            : [],
        evidenceAgainst: residualIsZero
            ? []
            : [`residual Δ is ${residualDelta === null ? "not computable" : (0, decimal_1.moneyMinorToDecimalString)(residualDelta.amountMinor)}`],
    };
}
