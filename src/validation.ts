/**
 * Validation-rule catalog as executable predicates (Stage 4, Wave 2).
 *
 * Implements stage2/03-validation-catalog.md v0.1.0 — all 66 rules
 * (S 12, P 16, X 14, M 6, L 8, C 10), Stage 1 IDs unchanged.
 *
 * Governing rules (MASTER_PROMPT §7; catalog §1–§3):
 * - Layered evaluation in order structural → P → X → M → L → C,
 *   ID order within a layer. Findings accumulate; nothing short-circuits
 *   except quarantine (catalog §3.1).
 * - A blank is `null`, never 0. No missing datum is replaced with zero.
 * - No comparison without a recorded case tolerance (dataset item M-7).
 *   Policy 5.8-1 $1/$5 figures are reference data only
 *   (POLICY_5_8_1_REFERENCE below) and are never read as a tolerance.
 * - Conflicts are flagged, not resolved: BCV-224 vs BCV-225 stay
 *   `not-applicable` ("conflict C-1 unresolved") under P-04.
 * - BCV-276 is restated as APP in P-06 (disabled official predicate).
 *
 * Pure functions only. No clock (dates are caller-supplied), no network,
 * no fetch, no side effects. Synthetic data only in tests.
 *
 * Inputs are flat, nullable participant records (ValidationParticipant)
 * plus a case context (ValidationContext). Money is integer minor units;
 * service is DecimalString; dates are ISO YYYY-MM-DD strings (lexicographic
 * comparison is valid for that format).
 */

import type {
  DateString,
  DecimalString,
  MoneyMinor,
  ToleranceRecord,
} from "./types";
import {
  decAdd,
  decCompare,
  decDivide,
  decMultiply,
  decSubtract,
  moneyMinorToDecimalString,
} from "./decimal";
import { daysSinceEpoch, validateDateString } from "./dates";

/**
 * Calendar-day number for a value, or null when it is not a valid ISO
 * calendar date (Stage 7 Robustness D1). Chronological rules compare
 * parsed days, never raw strings: an impossible date such as
 * "2020-02-30" must be named by S-07, never silently ordered against
 * other dates by lexicographic comparison.
 */
function dateDays(value: unknown): number | null {
  if (typeof value !== "string") return null;
  try {
    return daysSinceEpoch(validateDateString(value));
  } catch {
    return null;
  }
}

/** True when the value is a valid ISO calendar date. */
function isCalendarDate(value: unknown): boolean {
  return dateDays(value) !== null;
}

/** Catalog version implemented (stage2/03-validation-catalog.md). */
export const CATALOG_VERSION = "0.1.0";

/**
 * Policy 5.8-1 Benefit Corrections ($1.00 / $5.00, 10/02/2014) — REFERENCE
 * DATA ONLY. It governs correcting PBGC benefit determinations and
 * payments; it does NOT govern whether PA_AMB is accepted, and these
 * figures must never be used as the reconciliation tolerance. No predicate
 * in this file reads this constant; it exists so the separation is
 * explicit and auditable. The "reasonably certain" standard from 5.8-1
 * carries over as a decision principle (rule C-08).
 */
export const POLICY_5_8_1_REFERENCE = {
  oneDollarMinor: 100,
  fiveDollarMinor: 500,
  policy: "PBGC Operating Policy 5.8-1 Benefit Corrections (10/02/2014)",
  role: "reference-only — never the reconciliation tolerance",
} as const;

// ---------------------------------------------------------------------------
// Result types (catalog §2)
// ---------------------------------------------------------------------------

export type ValidationSeverity = "Critical" | "Error" | "Warning" | "Info";
export type BlocksCalculation = "Yes" | "Exact-only" | "No";
export type BlocksScope =
  | "import"
  | "participant-calculation"
  | "exact-calculation"
  | "comparison"
  | "decision"
  | "none";
export type RuleSource = "OFFICIAL" | "APP" | "MIXED" | "OFFICIAL_REFERENCE_ONLY";
export type RuleOutcomeKind = "pass" | "fail" | "not-applicable" | "not-run";

export type RuleId =
  | "S-01" | "S-02" | "S-03" | "S-04" | "S-05" | "S-06"
  | "S-07" | "S-08" | "S-09" | "S-10" | "S-11" | "S-12"
  | "P-01" | "P-02" | "P-03" | "P-04" | "P-05" | "P-06"
  | "P-07" | "P-08" | "P-09" | "P-10" | "P-11" | "P-12"
  | "P-13" | "P-14" | "P-15" | "P-16"
  | "X-01" | "X-02" | "X-03" | "X-04" | "X-05" | "X-06" | "X-07"
  | "X-08" | "X-09" | "X-10" | "X-11" | "X-12" | "X-13" | "X-14"
  | "M-01" | "M-02" | "M-03" | "M-04" | "M-05" | "M-06"
  | "L-01" | "L-02" | "L-03" | "L-04" | "L-05" | "L-06" | "L-07" | "L-08"
  | "C-01" | "C-02" | "C-03" | "C-04" | "C-05" | "C-06" | "C-07"
  | "C-08" | "C-09" | "C-10";

/** Evaluation order (catalog §3.1): structural first, then P → X → M → L → C. */
export const RULE_ORDER: readonly RuleId[] = [
  "S-01", "S-02", "S-03", "S-04", "S-05", "S-06",
  "S-07", "S-08", "S-09", "S-10", "S-11", "S-12",
  "P-01", "P-02", "P-03", "P-04", "P-05", "P-06",
  "P-07", "P-08", "P-09", "P-10", "P-11", "P-12",
  "P-13", "P-14", "P-15", "P-16",
  "X-01", "X-02", "X-03", "X-04", "X-05", "X-06", "X-07",
  "X-08", "X-09", "X-10", "X-11", "X-12", "X-13", "X-14",
  "M-01", "M-02", "M-03", "M-04", "M-05", "M-06",
  "L-01", "L-02", "L-03", "L-04", "L-05", "L-06", "L-07", "L-08",
  "C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07",
  "C-08", "C-09", "C-10",
];

/** One validation record (catalog §2.1). A `pass` produces no Finding;
 *  `fail`, `not-applicable`, and `not-run` are all recorded. */
export interface Finding {
  resultId: string;
  ruleId: RuleId;
  bcvPredicateId: string | null;
  bcvPredicateType: string | null;
  ruleSource: RuleSource;
  participantKey: string | null;
  runId: string | null;
  recordedDate: DateString | null;
  fieldsExamined: string[];
  actual: string;
  expected: string;
  discrepancy: string;
  severity: ValidationSeverity;
  investigation: string;
  blocksCalculation: BlocksCalculation;
  blocksScope: BlocksScope;
  dispositionRoute: string;
  outcome: "fail" | "not-applicable" | "not-run";
}

/** One rule's evaluation for one participant (or one scope). */
export interface RuleEvaluation {
  ruleId: RuleId;
  outcome: RuleOutcomeKind;
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type Retstat = "1" | "2" | "3" | "4" | "5";
export type IdType = "1" | "2" | "4";
export type SexCode = "M" | "F" | "U";
export type ServiceUnit = "years" | "months" | "other";
export type IntegrationMethod = "none" | "excess" | "offset" | "covered-comp" | "pia-offset";
export type VestingTreatmentInput = "gross" | "vested" | "unknown";
export type BcvBenefitBasis = "dote" | "erd" | "eurd" | "nrd" | "xrd";

export interface SalaryYearInput {
  year: number;
  amount: MoneyMinor | null;
}

export interface BadDateInput {
  field: string;
  raw: string;
  ambiguous: boolean;
}

export interface BadNumberInput {
  field: string;
  raw: string;
  reason: string;
}

export interface PriorDistributionInput {
  exists: boolean;
  reflectedInPaAmb: boolean;
  documentedAsNotAffecting: boolean;
  inCensus: boolean;
  inSchedule: boolean;
}

export interface SourceUsedInput {
  documentId: string;
  reliabilityGrade: "high" | "medium" | "low" | "unassessed";
  limitationNoted: boolean;
}

export interface BcvComparisonInput {
  basis: BcvBenefitBasis;
  conversionApplied: boolean;
}

/** The participant's values in the prior extract (for L-02–L-08). */
export interface PriorExtractParticipantInput {
  asOfDate: DateString;
  /** Present in the prior extract at all. */
  present: boolean;
  /** Same person appears under a different key across extracts. */
  crossExtractDuplicateKey: boolean;
  retstat: Retstat | null;
  dote: DateString | null;
  doh: DateString | null;
  dob: DateString | null;
  salaryByYear: SalaryYearInput[];
  paAmb: MoneyMinor | null;
  cspa: DecimalString | null;
  vs: DecimalString | null;
  revisionEventForDates: boolean;
  revisionEventForSalary: boolean;
  statusChangeExplained: boolean;
  paAmbChangeExplained: boolean;
}

/**
 * One participant record, flat and nullable. Every field is the normalised
 * value (or null when blank — never 0 for a blank). Fields the caller
 * cannot establish are null; rules that need them record `not-applicable`
 * rather than guessing. Boolean "evidence" flags (e.g.
 * `documentedMinimumOrGrandfatherOrPastServiceCredit`) are caller-supplied
 * facts about the case file, not defaults.
 */
export interface ValidationParticipant {
  participantKey: string;
  bcvRecId: number | null;
  caseNumber: string | null;
  idType: IdType | string | null;
  ssn: string | null;
  firstName: string | null;
  lastName: string | null;
  dob: DateString | null;
  sex: SexCode | string | null;
  dateOfDeath: DateString | null;
  retstat: Retstat | string | null;
  rettyp: string | null;
  doh: DateString | null;
  dote: DateString | null;
  dop: DateString | null;
  dobfParticipant: DateString | null;
  dor: DateString | null;
  postDoptDote: DateString | null;
  nrd: DateString | null;
  anb: number | null;
  sanb: number | null;
  rbd: DateString | null;
  rbdDeterminable: boolean;
  rbdMissingFields: string[];
  inPayAtDopt: boolean | null;
  isPreDoptRetiree: boolean;
  isDeferredRecord: boolean;
  sbcd: string | null;
  spouseSsn: string | null;
  spouseLastName: string | null;
  spouseDob: DateString | null;
  spouseSex: SexCode | string | null;
  spouseDateOfDeath: DateString | null;
  benSsn: string | null;
  benLastName: string | null;
  benDob: DateString | null;
  benSex: SexCode | string | null;
  benDateOfDeath: DateString | null;
  apDob: DateString | null;
  apSex: SexCode | string | null;
  apDateOfDeath: DateString | null;
  cspa: DecimalString | null;
  vspa: DecimalString | null;
  espa: DecimalString | null;
  cs: DecimalString | null;
  vs: DecimalString | null;
  es: DecimalString | null;
  csUnit: ServiceUnit | null;
  vsUnit: ServiceUnit | null;
  vppa: DecimalString | null;
  paAmb: MoneyMinor | null;
  paAcomp: MoneyMinor | null;
  paAcompPeriodicity: "monthly" | "annual" | null;
  cuComp: MoneyMinor | null;
  pia: MoneyMinor | null;
  integrationMethod: IntegrationMethod | null;
  firstYear: number | null;
  lastYear: number | null;
  salaryByYear: SalaryYearInput[];
  annact: "A" | "B" | null;
  annualizationBasisNoted: boolean;
  averagingPeriodYears: number[];
  formCode: string | null;
  formCodeNsf: string | null;
  formCodeNmf: string | null;
  formCodeQpsa: string | null;
  formCodeArd: string | null;
  spcVal: DecimalString | null;
  spcNsf: DecimalString | null;
  spcArd: DecimalString | null;
  mths: number | null;
  mthsNsf: number | null;
  mthsArd: number | null;
  formCodeIsJointLife: boolean | null;
  recordIsSingleLife: boolean;
  lsTerm: string | null;
  xrd: DateString | null;
  xrdMbTerm: MoneyMinor | null;
  pvReteec: MoneyMinor | null;
  measurementDate: DateString | null;
  recordedDate: DateString | null;
  measurementDisagreementExplained: boolean;
  assertedBasisNrd: boolean;
  nrdBasisEvidence: boolean;
  explicitNoBenefitStatement: boolean;
  vestingTreatment: VestingTreatmentInput;
  annuityForm: string | null;
  annuityFormConversionDocumented: boolean;
  calcMeasurementDate: DateString | null;
  calcAnnuityForm: string | null;
  calcVestingTreatment: VestingTreatmentInput | null;
  planFreezeDate: DateString | null;
  accrualAfterFreeze: boolean;
  benefitReflectsPostFreezeAccrual: boolean;
  mandcwi: MoneyMinor | null;
  volcwi: MoneyMinor | null;
  cashBalDopt: MoneyMinor | null;
  formulaType: string | null;
  contributionTreatmentDocumented: boolean;
  cashBalanceExplanationDocumented: boolean;
  documentedMinimumOrGrandfatherOrPastServiceCredit: boolean;
  participationBeforeEligibility: boolean;
  serviceAccruesBeforeDop: boolean;
  parseError: string | null;
  badDates: BadDateInput[];
  badNumbers: BadNumberInput[];
  fieldsWithoutProvenance: string[];
  supportingEvidenceForScale: boolean;
  s001Derivable: boolean;
  scheduleProvided: boolean;
  scheduleRowExists: boolean;
  schedulePaAmb: MoneyMinor | null;
  scheduleExplanationDocumented: boolean;
  bcvComparison: BcvComparisonInput | null;
  paymentAmountMinor: MoneyMinor | null;
  convertedPaAmbMinor: MoneyMinor | null;
  ardFactorsPresent: boolean;
  priorDistribution: PriorDistributionInput | null;
  formulaCheckValueMinor: MoneyMinor | null;
  formulaKnownForX06: boolean;
  formulaCheckValuesMinor: MoneyMinor[] | null;
  documentedHypothesis: boolean;
  pfFactors: {
    paFactor: DecimalString;
    pfFactor: DecimalString;
    era: string;
    form: string;
    differenceDocumented: boolean;
  } | null;
  proposedDisposition: string | null;
  evidenceCount: number;
  paAmbAccept: "Y" | "N" | null;
  disposition: string | null;
  decisionExists: boolean;
  rejectionRationaleStated: boolean;
  sourcesUsed: SourceUsedInput[];
  candidateMeasurementDates: DateString[];
  establishedMeasurementDate: DateString | null;
  prior: PriorExtractParticipantInput | null;
}

export interface FileContextInput {
  openable: boolean;
  truncated: boolean;
  hashMatches: boolean;
  hashBefore: string | null;
  hashAfter: string | null;
  macroRan: boolean;
  unknownFields: string[];
}

export interface PriorExtractInput {
  asOfDate: DateString;
  participantKeys: string[];
  /** Prior-extract participants who disappeared with no movement record. */
  missingMovementKeys: string[];
  /** Keys duplicated across extracts (same person, different keys). */
  duplicateKeys: string[];
  statusCounts: Partial<Record<Retstat, number>>;
  movements: {
    newParticipants: number;
    terminations: number;
    deaths: number;
    disabilities: number;
    retirees: number;
  };
  movementsExplained: boolean;
}

/** Case-level inputs every predicate reads. */
export interface ValidationContext {
  /** APP.dopt — Date of Plan Termination (app-level case fact, not a BCV field). */
  dopt: DateString;
  /** Run date, caller-supplied (the core never calls a clock). */
  today: DateString;
  runId: string | null;
  recordedDate: DateString | null;
  /** Case tolerance record (dataset item M-7). Null = no recorded tolerance:
   *  X-06, C-04, C-06 record `not-applicable` — the engine refuses to compare. */
  tolerance: ToleranceRecord | null;
  /** |PA service − BCV service| tolerance; default "0" (catalog §1.6). */
  serviceTolerance?: DecimalString;
  /** Monthly-benefit screening bound; default $25,000/month (catalog §1.6). */
  monthlyBenefitPlausibilityCap?: MoneyMinor;
  /** Plausible PA_AMB ÷ PA_ACOMP range, set by the case actuary from the
   *  plan's formula. Null = unset → X-04 is `not-applicable` (never a pass). */
  plausibleBenefitCompRatioRange?: { min: DecimalString; max: DecimalString } | null;
  /** The plan's service-credit rule. Null credits = not established: P-15
   *  can then fire only on the gross comparison (service > elapsed time
   *  with zero documented credits). */
  planServiceCreditRule?: {
    creditsAllowedYears: DecimalString | null;
    maxVestingExcessYears: DecimalString | null;
  } | null;
  /** BCV FORM_CODE values accepted for this case (caller-supplied). Null =
   *  no list supplied → the "not in the valid list" leg of X-11 is
   *  `not-applicable` rather than guessed. */
  validFormCodes?: string[] | null;
  file: FileContextInput;
  /** The prior extract, or null when the case file has none (every L rule
   *  then records `not-applicable`). */
  priorExtract: PriorExtractInput | null;
}

export interface CaseValidationResult {
  fileEvaluations: RuleEvaluation[];
  participantResults: Array<{ participantKey: string; evaluations: RuleEvaluation[] }>;
  populationEvaluations: RuleEvaluation[];
  /** Every recorded Finding (fail + not-applicable + not-run), in evaluation order. */
  allFindings: Finding[];
  summary: {
    rulesEvaluated: number;
    pass: number;
    fail: number;
    notApplicable: number;
    notRun: number;
  };
}

// ---------------------------------------------------------------------------
// Rule metadata (catalog §§4–9; severity / blocking / scope / route)
// ---------------------------------------------------------------------------

interface RuleMeta {
  source: RuleSource;
  severity: ValidationSeverity;
  blocksCalculation: BlocksCalculation;
  blocksScope: BlocksScope;
  dispositionRoute: string;
  investigation: string;
}

const ROUTE_QUARANTINE =
  "Quarantined — resolve identity/status and re-import; no disposition until resolved.";
const ROUTE_BOUNDS =
  "Bounds/scenario path if the input is class (b)/(c)/(d); otherwise requires-investigation / indeterminate.";
const ROUTE_REVIEW = "None — review before any acceptance disposition.";
const ROUTE_REIMPORT = "File not loaded; all rules for its records not-run; re-import required.";

const RULE_META: Record<RuleId, RuleMeta> = {
  "S-01": { source: "APP", severity: "Critical", blocksCalculation: "Yes", blocksScope: "import", dispositionRoute: ROUTE_REIMPORT, investigation: "Re-obtain the file from the source; check transfer / storage." },
  "S-02": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Inspect the source row; fix the extract, never hand-edit the quarantined row into the data." },
  "S-03": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Confirm whether it is a PA-specific column (map it as _unmapped with provenance, retained verbatim, never dropped) or a typo (confirm with the source)." },
  "S-04": { source: "OFFICIAL", severity: "Critical", blocksCalculation: "Yes", blocksScope: "import", dispositionRoute: ROUTE_QUARANTINE, investigation: "Check the census extract; a record with no status cannot be placed in or out of the valuation population." },
  "S-05": { source: "MIXED", severity: "Critical", blocksCalculation: "Yes", blocksScope: "import", dispositionRoute: ROUTE_QUARANTINE, investigation: "Verify record type against the DOPT-death rule in the dictionary (ID=2 vs 1); resolve key collisions by identity review, never by deleting a record." },
  "S-06": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Re-import with CASE forced to text; confirm the case number against the case file." },
  "S-07": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Confirm the source format (US MM/DD/YYYY vs ISO) from the file's own evidence; ambiguous dates are quarantined, never guessed." },
  "S-08": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Check the source's units (dollars vs cents, years vs months); confirm against the PA schedule." },
  "S-09": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Confirm units and decimals against the PA schedule; do not rescale on assumption." },
  "S-10": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Reconcile against the census extract; a gap inside the span is missing data (P-14), a span mismatch is a structural error." },
  "S-11": { source: "APP", severity: "Critical", blocksCalculation: "Yes", blocksScope: "import", dispositionRoute: ROUTE_REIMPORT, investigation: "Abort the import; investigate how the file was opened; re-import read-only." },
  "S-12": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Reject the batch or attach provenance from the import record; a value without provenance is not loadable into a calculation." },
  "P-01": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Compare names, DOB, DOH, DOTE across the duplicates; merge only on documented identity evidence, never on name alone." },
  "P-02": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Verify against the plan's enrollment/employment records (Answer Book Ch. 16 Q 16:2 / Q 16:5 — DOB errors are the highest-impact census errors)." },
  "P-03": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Verify against employment records; a DOH after DOTE usually means a rehire was recorded as the hire date." },
  "P-04": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "See conflict note C-1 (BCV-224 vs BCV-225). For actives (RETSTAT=3) DOTE is legitimately blank or after DOPT." },
  "P-05": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Verify retirement date against payment records and the PA schedule; a DOR before DOPT for a deferred record usually means the record is a retiree misclassified." },
  "P-06": { source: "MIXED", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Compare with CSPA/VSPA (rule X-07); verify service against EmploymentPeriod and plan records; VS = 0 with a positive PA_AMB is a vesting question (X-09), not automatically an error." },
  "P-07": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Recompute age nearest birthday at DOPT from DOB; a mismatch points to a DOB error (rule P-02)." },
  "P-08": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "NRD is Calculated (add-in RETDATE) — a blank NRD means the BCV calculation did not run or lacked inputs; check DOB and the plan normal-retirement definition." },
  "P-09": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Fix the underlying field(s) via their own rules; RBD failure is a symptom, not a root cause — never 'fix' it by inventing a date." },
  "P-10": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Verify against the QDRO / beneficiary designation / death records; an ID=2 record without a beneficiary DOB cannot produce a survivor benefit." },
  "P-11": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Resolve from plan records. U is permitted by the dictionary and does not block a calculation (unisex mortality, Answer Book Ch. 16 Q 16:11), but it blocks any sex-dependent PA factor check." },
  "P-12": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Check the plan's eligibility provision (R5) and Answer Book Ch. 7; pre-participation service is usually a plan-records question." },
  "P-13": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Blank = missing, never zero. Classify per Stage 1 §A.6; a blank PA_AMB for a RETSTAT=4 participant may be a legitimate zero benefit — but that is a documented determination (rule X-09), not a default." },
  "P-14": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Recover from payroll/W-2 records (class b) or bound it (class c — adjacent years and the §401(a)(17) cap for that year); PA_ACOMP may substitute only if its own provenance and averaging period are documented." },
  "P-15": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Verify against plan records; past-service credits and special credits must be documented (plan document §), not assumed." },
  "P-16": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Identity review against employment records; possible causes: SSN typo, remarriage name change, or a genuine duplicate. Merge only on documented identity evidence." },
  "X-01": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "RETSTAT = 5 with a benefit usually means the record belongs in the population (status error) or the benefit belongs to a different record; check the census extract and the PA schedule." },
  "X-02": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Verify employment status against plan records; status errors cascade into every benefit comparison, so fix status before calculating." },
  "X-03": { source: "OFFICIAL", severity: "Error", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Check the contributions record; a nonvested participant with MANDCWI > 0 still owns the contributions — this affects the benefit floor, not the PA_AMB itself." },
  "X-04": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "HEURISTIC ONLY — a heuristic never overrides the governing formula. Investigate; do not auto-correct. Plausible causes: high accrual rate, grandfathered floor, or a data error in PA_ACOMP/CSPA." },
  "X-05": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Check for a minimum-benefit provision, grandfathered floor, or past-service credit in the plan document; if none exists, the PA_AMB is unsupported on its face." },
  "X-06": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Recompute from the PA's own inputs; a mismatch here means the PA's schedule used different inputs than the census carries — the schedule is the next document to read (rule C-01)." },
  "X-07": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Determine which service-credit rule each side used (plan document §, Answer Book Ch. 7); the difference is itself a diagnostic hypothesis (service) for the reconciliation." },
  "X-08": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Obtain the PIA from the PA schedule or SSA records (class b); if unrecoverable, class (d) assumption with sensitivity — an integrated formula cannot be reconstructed without it." },
  "X-09": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Establish from the PA schedule whether PA_AMB is gross or vested. Never assume: applying VPPA twice (once by the PA, once by the app) is a known error mode." },
  "X-10": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Obtain the form from the PA schedule; a comparison between different annuity forms without conversion is invalid (rule M-05)." },
  "X-11": { source: "OFFICIAL", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Verify the form against the plan document and the PA schedule; form errors usually indicate the wrong normal form was loaded, which affects every benefit on that form." },
  "X-12": { source: "OFFICIAL", severity: "Error", blocksCalculation: "No", blocksScope: "none", dispositionRoute: "None for the PA_AMB calculation; the affected cross-source check (C-03) records not-applicable for that participant, with this finding referenced.", investigation: "Adopted for cross-source scope only (rule C-03) — this system does not calculate XRD benefits. A blank here blocks a cross-source check, not the PA_AMB calculation itself." },
  "X-13": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Check the plan's contribution provisions (Answer Book Ch. 9) and whether the formula is cash-balance (Answer Book Ch. 18)." },
  "X-14": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Verify the freeze provision (plan document / amendment) and the freeze date; post-freeze accrual is a diagnostic hypothesis (freeze) — see also Answer Book Ch. 26 (frozen plans)." },
  "M-01": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: "Requires-investigation (obtain DOTE / as-of statement) or indeterminate; no Δ is computed while the basis is unresolved.", investigation: "Obtain DOTE from employment records (class b) or the PA schedule's as-of statement. Until then the measurement basis is unresolved. Do NOT use the DOPT-default note in the DOTE dictionary entry to assign DOPT as the measurement date." },
  "M-02": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: "Requires-investigation or indeterminate; no Δ is computed.", investigation: "Read the schedule's heading / as-of language; if the schedule states no as-of date, the basis is unresolved — do not infer it from the file date or the valuation date." },
  "M-03": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Determine which date the PA actually used (schedule arithmetic, salary-through date); the comparison must use the PA's date, and the independent calculation must be run at the same date (rule M-05)." },
  "M-04": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: "Requires-investigation until the claim is evidenced or rejected; no Δ is computed on an NRD basis without the evidence and a basis conversion (M-05).", investigation: "Obtain the evidence; without it the claim is rejected and the basis stays DOTE (or unresolved if DOTE is blank)." },
  "M-05": { source: "APP", severity: "Critical", blocksCalculation: "Yes", blocksScope: "comparison", dispositionRoute: "No Δ is computed. Requires-investigation (convert and re-run) or indeterminate. The independent calculation at its own basis is retained and reported as such.", investigation: "Convert (re-run the calculation at the observation's date/form) or hold the comparison. A comparison across unequal bases is never computed as if it were valid." },
  "M-06": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Working-retirement / post-DOPT employment cases need the plan's rule on post-DOPT accrual; frozen plans need the freeze-date rule. Record the decision; do not average candidate dates." },
  "L-01": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: "Affected participants → requires-investigation until the movement is accounted for; the population reconciliation gap is reported at plan level.", investigation: "Obtain the missing movement records (new hires, deaths, retirements) from plan records; an unreconciled population means participants may be missing from the PA_AMB analysis entirely." },
  "L-02": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Trace the participant through plan records; a disappearance without a movement is usually a data error, not a real exit." },
  "L-03": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Verify against employment/payment records; a backwards move is usually a status-correction (record it as a correction with evidence) or a misclassification." },
  "L-04": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Check for a rehire (new period) vs a data correction; a changed DOTE changes the measurement date and therefore the comparison basis (rule M-03)." },
  "L-05": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Determine whether the restatement is a payroll correction (accept with evidence) or an error; restated pay changes PA_ACOMP and the reconstructed benefit." },
  "L-06": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Check for a plan amendment, a PA correction letter, or a measurement-date change; an unexplained change is itself a diagnostic hypothesis (administrator-error)." },
  "L-07": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Verify against EmploymentPeriod; a service decrease usually means a break-in-service rule was applied (Answer Book Ch. 7) or a prior error was corrected — either way it must be documented." },
  "L-08": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Verify against the earliest source (enrollment/employment records); a changed DOB changes age, NRD, service, and the benefit — the single most consequential longitudinal finding." },
  "C-01": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Obtain the schedule; without it the measurement basis can only be DOTE-by-definition, never evidenced." },
  "C-02": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "exact-calculation", dispositionRoute: ROUTE_BOUNDS, investigation: "Determine which is later / which the PA stands behind; the schedule usually governs (it is the PA's own arithmetic) — record the decision and the reason." },
  "C-03": { source: "OFFICIAL_REFERENCE_ONLY", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: "None; the invalid comparison is discarded (not stored as a BenefitComparison), and a valid one is produced if conversion is possible.", investigation: "Convert bases first (rule M-05) or do not compare. A raw PA_AMB-vs-TERM_MB_NRD_NSF difference is not a discrepancy — it is a category error." },
  "C-04": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Reconstruct the ARD conversion from the PA's own factors (BCV3 fields); a mismatch points to a different commencement date or form than the one recorded." },
  "C-05": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Obtain the distribution record; an unreflected distribution is a diagnostic hypothesis (distribution). Answer Book Ch. 16 Q 16:7 — past distributions are essential takeover data, especially for rehires." },
  "C-06": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Check whether the wrong PlanVersion was applied (a later formula applied retroactively), whether the participant belongs to a different employment group, or whether a grandfathered floor applies." },
  "C-07": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: ROUTE_REVIEW, investigation: "Compare against the PF output for the case; factor disagreements are usually era mismatches (factors from the wrong historical regime)." },
  "C-08": { source: "APP", severity: "Error", blocksCalculation: "Exact-only", blocksScope: "decision", dispositionRoute: "The correction disposition is refused at entry; the participant routes to requires-investigation until evidence exists.", investigation: "Gather the evidence (schedule arithmetic, plan provision, service record). Without it the disposition is requires-investigation, never correction-recommended." },
  "C-09": { source: "APP", severity: "Critical", blocksCalculation: "Yes", blocksScope: "decision", dispositionRoute: "The decision record is refused until a consistent human decision exists.", investigation: "The accept flag is an outcome, not an input. Remove or correct it through a decision record; never edit the flag directly." },
  "C-10": { source: "APP", severity: "Warning", blocksCalculation: "No", blocksScope: "none", dispositionRoute: "None; the disposition cap applies at decision entry (a verified disposition on an uncorroborated low-reliability source is refused, with this finding cited).", investigation: "Assess internal controls per CASE_PROCESSING.txt. A low-reliability source does not invalidate the analysis — it caps the disposition." },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalised context: defaults applied, never silently invented as PBGC rules. */
interface NormalizedContext {
  dopt: DateString;
  today: DateString;
  runId: string | null;
  recordedDate: DateString | null;
  tolerance: ToleranceRecord | null;
  serviceTolerance: DecimalString;
  monthlyBenefitPlausibilityCap: MoneyMinor;
  plausibleBenefitCompRatioRange: { min: DecimalString; max: DecimalString } | null;
  planServiceCreditRule: {
    creditsAllowedYears: DecimalString | null;
    maxVestingExcessYears: DecimalString | null;
  } | null;
  validFormCodes: string[] | null;
  file: FileContextInput;
  priorExtract: PriorExtractInput | null;
}

function normalizeContext(ctx: ValidationContext): NormalizedContext {
  return {
    dopt: ctx.dopt,
    today: ctx.today,
    runId: ctx.runId,
    recordedDate: ctx.recordedDate,
    tolerance: ctx.tolerance,
    serviceTolerance: ctx.serviceTolerance ?? "0",
    monthlyBenefitPlausibilityCap: ctx.monthlyBenefitPlausibilityCap ?? 2500000,
    plausibleBenefitCompRatioRange: ctx.plausibleBenefitCompRatioRange ?? null,
    planServiceCreditRule: ctx.planServiceCreditRule ?? null,
    validFormCodes: ctx.validFormCodes ?? null,
    file: ctx.file,
    priorExtract: ctx.priorExtract,
  };
}

/** A tolerance is usable for a comparison only when at least one limb is set. */
function usableTolerance(tol: ToleranceRecord | null): tol is ToleranceRecord {
  return tol !== null && (tol.absoluteMinor !== null || tol.relativeDecimal !== null);
}

/**
 * |Δ| in minor units against a tolerance, with `referenceMinor` as the
 * denominator for the relative limb. Decimal-safe; no binary float.
 * `application`: "either" (any limb passes), "both" (every set limb passes),
 * "larger-of" (|Δ| ≤ the largest set limb).
 */
export function withinTolerance(
  deltaMinor: number,
  referenceMinor: number,
  tol: ToleranceRecord,
): boolean {
  const absDelta = Math.abs(deltaMinor);
  const absLimb: boolean | null =
    tol.absoluteMinor === null ? null : absDelta <= tol.absoluteMinor;
  let relLimb: boolean | null = null;
  if (tol.relativeDecimal !== null) {
    const deltaDollars = moneyMinorToDecimalString(absDelta);
    const thresholdDollars = decMultiply(
      moneyMinorToDecimalString(Math.abs(referenceMinor)),
      tol.relativeDecimal,
    );
    relLimb = decCompare(deltaDollars, thresholdDollars) <= 0;
  }
  const limbs = [absLimb, relLimb].filter(
    (l): l is boolean => l !== null,
  );
  if (limbs.length === 0) return false;
  if (tol.application === "either") return limbs.some(Boolean);
  if (tol.application === "both") return limbs.every(Boolean);
  // "larger-of": passes when the delta is within the largest set limb.
  if (absLimb === true || relLimb === true) {
    // A limb passes only if it is the larger one when both are set.
    if (absLimb !== null && relLimb !== null) {
      const absThreshold = moneyMinorToDecimalString(tol.absoluteMinor as number);
      const relThreshold = decMultiply(
        moneyMinorToDecimalString(Math.abs(referenceMinor)),
        tol.relativeDecimal as string,
      );
      const largerIsAbs = decCompare(absThreshold, relThreshold) >= 0;
      return largerIsAbs ? absLimb : relLimb;
    }
    return true;
  }
  return false;
}

/** Render integer minor units as dollars, e.g. 124000 → "$1240.00", -13500 → "-$135.00". */
export function formatMoneyMinor(minor: number): string {
  const dollars = moneyMinorToDecimalString(minor);
  const negative = dollars.startsWith("-");
  const unsigned = negative ? dollars.slice(1) : dollars;
  const [intPart, fracPart = ""] = unsigned.split(".");
  const frac = (fracPart + "00").slice(0, 2);
  return `${negative ? "-" : ""}$${intPart}.${frac}`;
}

/** Whole calendar months from `start` to `end` (day-adjusted).
 *  This is the engine's elapsed-time measure for service comparisons
 *  (P-15, L-07): calendar months, never days/365. It is an implementation
 *  measure for the comparison, not a PBGC service-credit rule. */
export function elapsedMonths(start: DateString, end: DateString): number {
  const s = start.split("-").map(Number);
  const e = end.split("-").map(Number);
  const y1 = s[0] as number;
  const m1 = s[1] as number;
  const d1 = s[2] as number;
  const y2 = e[0] as number;
  const m2 = e[1] as number;
  const d2 = e[2] as number;
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

/** Add `months` calendar months to an ISO date, clamping the day. */
export function addMonths(date: DateString, months: number): DateString {
  const parts = date.split("-").map(Number);
  const y = parts[0] as number;
  const m = parts[1] as number;
  const d = parts[2] as number;
  const total = (y * 12 + (m - 1) + months);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${ny}-${pad(nm)}-${pad(nd)}`;
}

interface FindingArgs {
  ruleId: RuleId;
  participantKey: string | null;
  ctx: NormalizedContext;
  bcvPredicateId?: string | null;
  bcvPredicateType?: string | null;
  ruleSource?: RuleSource;
  fieldsExamined: string[];
  actual: string;
  expected: string;
  discrepancy: string;
  severity?: ValidationSeverity;
  blocksCalculation?: BlocksCalculation;
  blocksScope?: BlocksScope;
  dispositionRoute?: string;
  investigation?: string;
  outcome: "fail" | "not-applicable" | "not-run";
  resultKey?: string;
}

function buildFinding(args: FindingArgs): Finding {
  const meta = RULE_META[args.ruleId];
  const key = args.bcvPredicateId ?? args.resultKey ?? "rule";
  return {
    resultId: `${args.participantKey ?? "file"}:${args.ruleId}:${key}`,
    ruleId: args.ruleId,
    bcvPredicateId: args.bcvPredicateId ?? null,
    bcvPredicateType: args.bcvPredicateType ?? null,
    ruleSource: args.ruleSource ?? meta.source,
    participantKey: args.participantKey,
    runId: args.ctx.runId,
    recordedDate: args.ctx.recordedDate,
    fieldsExamined: args.fieldsExamined,
    actual: args.actual,
    expected: args.expected,
    discrepancy: args.discrepancy,
    severity: args.severity ?? meta.severity,
    investigation: args.investigation ?? meta.investigation,
    blocksCalculation: args.blocksCalculation ?? meta.blocksCalculation,
    blocksScope: args.blocksScope ?? meta.blocksScope,
    dispositionRoute: args.dispositionRoute ?? meta.dispositionRoute,
    outcome: args.outcome,
  };
}

/** Shorthand for a `not-applicable` finding: severity/blocks of the rule
 *  are kept for the record, but nothing is blocked (blocks No / none) —
 *  a rule that cannot be evaluated blocks nothing. */
function naFinding(
  ruleId: RuleId,
  participantKey: string | null,
  ctx: NormalizedContext,
  reason: string,
  fieldsExamined: string[],
  bcvPredicateId?: string | null,
  bcvPredicateType?: string | null,
): Finding {
  return buildFinding({
    ruleId,
    participantKey,
    ctx,
    bcvPredicateId: bcvPredicateId ?? null,
    bcvPredicateType: bcvPredicateType ?? null,
    fieldsExamined,
    actual: reason,
    expected: "Rule evaluated for this record/run.",
    discrepancy: `Not applicable: ${reason}`,
    blocksCalculation: "No",
    blocksScope: "none",
    dispositionRoute: "None — not evaluated; reason recorded.",
    outcome: "not-applicable",
  });
}

/** A `not-run` finding for a quarantined scope (catalog §3.1). */
function notRunFinding(
  ruleId: RuleId,
  participantKey: string | null,
  ctx: NormalizedContext,
  quarantinedBy: string,
): Finding {
  const meta = RULE_META[ruleId];
  return buildFinding({
    ruleId,
    participantKey,
    ctx,
    fieldsExamined: [],
    actual: `Not evaluated: quarantined by ${quarantinedBy}.`,
    expected: "Rule evaluated for this record/run.",
    discrepancy: `Not run: scope quarantined by ${quarantinedBy}.`,
    severity: "Info",
    blocksCalculation: "No",
    blocksScope: "none",
    dispositionRoute: `Not run — quarantined by ${quarantinedBy}.`,
    outcome: "not-run",
    investigation: meta.investigation,
  });
}

function evaluation(ruleId: RuleId, findings: Finding[]): RuleEvaluation {
  if (findings.length === 0) return { ruleId, outcome: "pass", findings: [] };
  if (findings.every((f) => f.outcome === "not-applicable")) {
    return { ruleId, outcome: "not-applicable", findings };
  }
  if (findings.every((f) => f.outcome === "not-run")) {
    return { ruleId, outcome: "not-run", findings };
  }
  return { ruleId, outcome: "fail", findings };
}

/** RETSTAT = 5 records are out of the valuation population (§3.4): the
 *  in-scope participant rules record `not-applicable` for them. Structural
 *  rules, X-01 (which tests RETSTAT = 5 itself), and the decision-level
 *  rules C-09/C-10 still apply. */
const RETSTAT_5_NA_RULES: ReadonlySet<RuleId> = new Set([
  "P-02", "P-03", "P-04", "P-05", "P-06", "P-07", "P-08", "P-09",
  "P-10", "P-11", "P-12", "P-13", "P-14", "P-15",
  "X-02", "X-03", "X-04", "X-05", "X-06", "X-07", "X-08", "X-09",
  "X-10", "X-11", "X-12", "X-13", "X-14",
  "M-01", "M-02", "M-03", "M-04", "M-05", "M-06",
  "L-02", "L-03", "L-04", "L-05", "L-06", "L-07", "L-08",
  "C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07", "C-08",
]);

function retstat5Na(
  ruleId: RuleId,
  p: ValidationParticipant,
  ctx: NormalizedContext,
  fieldsExamined: string[],
): Finding[] {
  return [
    naFinding(
      ruleId,
      p.participantKey,
      ctx,
      "RETSTAT = 5 — not in valuation population (out of scope; graded separately as excluded).",
      fieldsExamined,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Layer 1 — Structural (S-01–S-12)
// ---------------------------------------------------------------------------

type RuleFn = (p: ValidationParticipant, ctx: NormalizedContext) => Finding[];

/** File-scope rules are evaluated by validateCasePackage, not per participant. */
function fileScopeNa(
  ruleId: RuleId,
  p: ValidationParticipant,
  ctx: NormalizedContext,
): Finding[] {
  return [
    naFinding(
      ruleId,
      p.participantKey,
      ctx,
      "File-scope rule; evaluated by validateCasePackage.",
      [],
    ),
  ];
}

/** Cross-record rules are evaluated by validateCasePackage, not per participant. */
function crossRecordNa(
  ruleId: RuleId,
  p: ValidationParticipant,
  ctx: NormalizedContext,
  reason: string,
): Finding[] {
  return [naFinding(ruleId, p.participantKey, ctx, reason, [])];
}

function ruleS01(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  return fileScopeNa("S-01", p, ctx);
}

function ruleS02(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.parseError === null) return [];
  return [
    buildFinding({
      ruleId: "S-02",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: [],
      actual: `Row fails to parse: ${p.parseError}`,
      expected: "Every row parses or is quarantined with its raw text.",
      discrepancy: `Row parse failure: ${p.parseError}`,
      outcome: "fail",
    }),
  ];
}

function ruleS03(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  return fileScopeNa("S-03", p, ctx);
}

function ruleS04(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat !== null && ["1", "2", "3", "4", "5"].includes(p.retstat)) return [];
  return [
    buildFinding({
      ruleId: "S-04",
      participantKey: p.participantKey,
      ctx,
      bcvPredicateId: "BCV-1000007",
      bcvPredicateType: "4",
      fieldsExamined: ["RETSTAT"],
      actual: `RETSTAT = ${p.retstat === null ? "blank" : p.retstat}`,
      expected: "RETSTAT ∈ {1, 2, 3, 4, 5}.",
      discrepancy: `RETSTAT ${p.retstat === null ? "blank" : `invalid (${p.retstat})`}; record cannot be placed in or out of the valuation population.`,
      outcome: "fail",
    }),
  ];
}

function ruleS05(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  // Leg (a) only — the participantKey-collision leg (b) is cross-record and
  // is evaluated by validateCasePackage.
  if (p.idType !== null && ["1", "2", "4"].includes(p.idType)) return [];
  return [
    buildFinding({
      ruleId: "S-05",
      participantKey: p.participantKey,
      ctx,
      bcvPredicateId: "BCV-1000006",
      bcvPredicateType: "4",
      fieldsExamined: ["ID"],
      actual: `ID = ${p.idType === null ? "blank" : p.idType}`,
      expected: "ID ∈ {1, 2, 4}.",
      discrepancy: `ID ${p.idType === null ? "blank" : `invalid (${p.idType})`}.`,
      outcome: "fail",
    }),
  ];
}

function ruleS06(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  // Blank / wrong-length leg only; within-file inconsistency is case-level
  // (validateCasePackage).
  if (p.caseNumber !== null && p.caseNumber.length === 8) return [];
  return [
    buildFinding({
      ruleId: "S-06",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["CASE"],
      actual: `CASE = ${p.caseNumber === null ? "blank" : JSON.stringify(p.caseNumber)}`,
      expected: "CASE is 8 characters, leading zeros kept, text type.",
      discrepancy:
        p.caseNumber === null
          ? "CASE blank."
          : `CASE length ${p.caseNumber.length}, expected 8.`,
      outcome: "fail",
    }),
  ];
}

function ruleS07(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  // Stage 7 Robustness D1: S-07 is the detector, not only a reporter
  // for the importer's badDates array. Every populated date field is
  // itself validated as a calendar date; an impossible date
  // (2020-02-30, 2021-02-29, 2020-13-01) fails here with the field and
  // raw value named, and is never silently accepted. badDates stays as
  // the importer's channel for ambiguous (parseable-but-unclear) dates.
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const failFor = (field: string, raw: unknown): void => {
    if (seen.has(field)) return;
    seen.add(field);
    findings.push(
      buildFinding({
        ruleId: "S-07",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: [field],
        actual: `${field} raw value ${JSON.stringify(raw)}`,
        expected: "Valid calendar date, stored ISO-8601.",
        discrepancy: `${field}: unparseable or ambiguous date ${JSON.stringify(raw)} — quarantined, never guessed.`,
        outcome: "fail",
        resultKey: field,
      }),
    );
  };
  for (const d of p.badDates) {
    findings.push(
      buildFinding({
        ruleId: "S-07",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: [d.field],
        actual: `${d.field} raw value ${JSON.stringify(d.raw)}${d.ambiguous ? " (ambiguous day/month)" : ""}`,
        expected: "Valid calendar date, stored ISO-8601.",
        discrepancy: `${d.field}: unparseable or ambiguous date ${JSON.stringify(d.raw)} — quarantined, never guessed.`,
        outcome: "fail",
        resultKey: d.field,
      }),
    );
    seen.add(d.field);
  }
  const dateFields: Array<[string, unknown]> = [
    ["DOB", p.dob],
    ["DOD", p.dateOfDeath],
    ["DOH", p.doh],
    ["DOTE", p.dote],
    ["DOP", p.dop],
    ["DOBF", p.dobfParticipant],
    ["DOR", p.dor],
    ["POST_DOPT_DOTE", p.postDoptDote],
    ["NRD", p.nrd],
    ["RBD", p.rbd],
    ["MEASUREMENT_DATE", p.measurementDate],
    ["RECORDED_DATE", p.recordedDate],
    ["CALC_MEASUREMENT_DATE", p.calcMeasurementDate],
    ["ESTABLISHED_MEASUREMENT_DATE", p.establishedMeasurementDate],
    ["SPOUSE_DOB", p.spouseDob],
    ["SPOUSE_DOD", p.spouseDateOfDeath],
    ["BEN_DOB", p.benDob],
    ["BEN_DOD", p.benDateOfDeath],
    ["AP_DOB", p.apDob],
    ["AP_DOD", p.apDateOfDeath],
  ];
  for (const [field, value] of dateFields) {
    if (value !== null && !isCalendarDate(value)) failFor(field, value);
  }
  for (const d of p.candidateMeasurementDates) {
    if (!isCalendarDate(d)) failFor("CANDIDATE_MEASUREMENT_DATE", d);
  }
  if (p.prior !== null) {
    if (p.prior.dote !== null && !isCalendarDate(p.prior.dote)) failFor("PRIOR_DOTE", p.prior.dote);
    if (p.prior.doh !== null && !isCalendarDate(p.prior.doh)) failFor("PRIOR_DOH", p.prior.doh);
    if (p.prior.dob !== null && !isCalendarDate(p.prior.dob)) failFor("PRIOR_DOB", p.prior.dob);
  }
  return findings;
}

const DECIMAL_STRING_RE = /^-?\d+(\.\d+)?$/;

function ruleS08(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  // Stage 7 Robustness D2: S-08 is the detector, not only a reporter
  // for the importer's badNumbers array. Every numeric field is
  // type-checked here: a MoneyMinor field must hold an integer number,
  // a DecimalString field must hold a decimal string, an integer field
  // must hold an integer. A wrong-typed value (e.g. paAmb = "150000",
  // a string in a NUMBER field) fails here with the field, the received
  // type, and the raw value named — never silently accepted, never
  // coerced. badNumbers stays as the importer's channel for values
  // that could not be parsed at import time.
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const failFor = (field: string, raw: unknown, expected: string): void => {
    if (seen.has(field)) return;
    seen.add(field);
    findings.push(
      buildFinding({
        ruleId: "S-08",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: [field],
        actual: `${field} raw value ${JSON.stringify(raw)} (type ${raw === null ? "null" : typeof raw})`,
        expected,
        discrepancy: `${field}: wrong type or non-numeric value (raw ${JSON.stringify(raw)}, type ${raw === null ? "null" : typeof raw}) — quarantined, never coerced.`,
        outcome: "fail",
        resultKey: field,
      }),
    );
  };
  for (const n of p.badNumbers) {
    findings.push(
      buildFinding({
        ruleId: "S-08",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: [n.field],
        actual: `${n.field} raw value ${JSON.stringify(n.raw)}: ${n.reason}`,
        expected: "Numeric, in the dictionary's units.",
        discrepancy: `${n.field}: ${n.reason} (raw ${JSON.stringify(n.raw)}).`,
        outcome: "fail",
        resultKey: n.field,
      }),
    );
    seen.add(n.field);
  }
  const moneyFields: Array<[string, unknown]> = [
    ["PA_AMB", p.paAmb],
    ["PA_ACOMP", p.paAcomp],
    ["CUCOMP", p.cuComp],
    ["PIA", p.pia],
    ["MANDCWI", p.mandcwi],
    ["VOLCWI", p.volcwi],
    ["CASH_BAL_DOPT", p.cashBalDopt],
    ["FORMULA_CHECK_VALUE", p.formulaCheckValueMinor],
    ["PAYMENT_AMOUNT", p.paymentAmountMinor],
    ["CONVERTED_PA_AMB", p.convertedPaAmbMinor],
    ["XRD_MB_TERM", p.xrdMbTerm],
    ["PV_RETEEC", p.pvReteec],
    ["SCHEDULE_PA_AMB", p.schedulePaAmb],
  ];
  for (const [field, value] of moneyFields) {
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value))) {
      failFor(field, value, "Integer minor units (number).");
    }
  }
  for (const [index, value] of (p.formulaCheckValuesMinor ?? []).entries()) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      failFor(`FORMULA_CHECK_VALUES[${index}]`, value, "Integer minor units (number).");
    }
  }
  const decimalFields: Array<[string, unknown]> = [
    ["CSPA", p.cspa],
    ["VSPA", p.vspa],
    ["ESPA", p.espa],
    ["CS", p.cs],
    ["VS", p.vs],
    ["ES", p.es],
    ["VPPA", p.vppa],
    ["SPC_VAL", p.spcVal],
    ["SPC_NSF", p.spcNsf],
    ["SPC_ARD", p.spcArd],
  ];
  for (const [field, value] of decimalFields) {
    if (value !== null && (typeof value !== "string" || !DECIMAL_STRING_RE.test(value))) {
      failFor(field, value, "Decimal string (e.g. \"12.5\").");
    }
  }
  const intFields: Array<[string, unknown]> = [
    ["BCV_REC_ID", p.bcvRecId],
    ["ANB", p.anb],
    ["SANB", p.sanb],
    ["FRSTYEAR", p.firstYear],
    ["LASTYEAR", p.lastYear],
    ["MTHS", p.mths],
    ["MTHS_NSF", p.mthsNsf],
    ["MTHS_ARD", p.mthsArd],
  ];
  for (const [field, value] of intFields) {
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value))) {
      failFor(field, value, "Integer (number).");
    }
  }
  for (const [index, s] of p.salaryByYear.entries()) {
    if (s.amount !== null && (typeof s.amount !== "number" || !Number.isInteger(s.amount))) {
      failFor(`SALARY[${s.year}]`, s.amount, "Integer minor units (number).");
    }
    if (typeof s.year !== "number" || !Number.isInteger(s.year)) {
      failFor(`SALARY_YEAR[${index}]`, s.year, "Integer year (number).");
    }
  }
  if (p.prior !== null) {
    if (p.prior.paAmb !== null && (typeof p.prior.paAmb !== "number" || !Number.isInteger(p.prior.paAmb))) {
      failFor("PRIOR_PA_AMB", p.prior.paAmb, "Integer minor units (number).");
    }
    for (const s of p.prior.salaryByYear) {
      if (s.amount !== null && (typeof s.amount !== "number" || !Number.isInteger(s.amount))) {
        failFor(`PRIOR_SALARY[${s.year}]`, s.amount, "Integer minor units (number).");
      }
    }
  }
  return findings;
}

function ruleS09(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.supportingEvidenceForScale) return [];
  const findings: Finding[] = [];
  const cap = ctx.monthlyBenefitPlausibilityCap;
  const checks: Array<[string, MoneyMinor | null]> = [
    ["PA_AMB", p.paAmb],
    ["PA_ACOMP", p.paAcomp],
    ["CUCOMP", p.cuComp],
  ];
  for (const [field, value] of checks) {
    if (value !== null && value > cap) {
      findings.push(
        buildFinding({
          ruleId: "S-09",
          participantKey: p.participantKey,
          ctx,
          fieldsExamined: [field],
          actual: `${field} = ${formatMoneyMinor(value)}`,
          expected: `Monthly dollars, 2 decimal places; screening bound ${formatMoneyMinor(cap)}/month.`,
          discrepancy: `${field} = ${formatMoneyMinor(value)} exceeds the ${formatMoneyMinor(cap)}/month screening bound with no supporting evidence.`,
          outcome: "fail",
          resultKey: field,
        }),
      );
    }
  }
  return findings;
}

function ruleS10(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.firstYear === null || p.lastYear === null) {
    return [
      naFinding(
        "S-10",
        p.participantKey,
        ctx,
        "FRSTYEAR/LASTYEAR missing — the salary-year span cannot be derived.",
        ["FRSTYEAR", "LASTYEAR", "S001-S050"],
      ),
    ];
  }
  const first = p.firstYear as number;
  const last = p.lastYear as number;
  const span = last - first + 1;
  const populated = p.salaryByYear.filter((s) => s.amount !== null);
  const outOfSpan = p.salaryByYear.filter(
    (s) => s.year < first || s.year > last,
  );
  if (span === populated.length && p.s001Derivable && outOfSpan.length === 0) return [];
  return [
    buildFinding({
      ruleId: "S-10",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["FRSTYEAR", "LASTYEAR", "S001-S050"],
      actual: `FRSTYEAR=${p.firstYear}, LASTYEAR=${p.lastYear}, populated S-years=${populated.length}, S001 derivable=${p.s001Derivable}, years outside span=${outOfSpan.length}`,
      expected: `S00n maps to year LASTYEAR − (n−1); populated span matches FRSTYEAR–LASTYEAR (${span} years).`,
      discrepancy:
        span !== populated.length
          ? `Span mismatch: FRSTYEAR–LASTYEAR spans ${span} years but ${populated.length} S-years are populated.`
          : !p.s001Derivable
            ? "Year of S001 cannot be derived."
            : `${outOfSpan.length} salary year(s) outside FRSTYEAR–LASTYEAR.`,
      outcome: "fail",
    }),
  ];
}

function ruleS11(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  return fileScopeNa("S-11", p, ctx);
}

function ruleS12(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  return p.fieldsWithoutProvenance.map((field) =>
    buildFinding({
      ruleId: "S-12",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: [field],
      actual: `${field} has no provenance (no file/row/cell, document/page, or JSON path).`,
      expected: "Every value carries provenance.",
      discrepancy: `${field} imported without provenance; not loadable into a calculation.`,
      outcome: "fail",
      resultKey: field,
    }),
  );
}

// ---------------------------------------------------------------------------
// Layer 2 — Participant-level (P-01–P-16)
// ---------------------------------------------------------------------------

function ruleP01(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  return crossRecordNa(
    "P-01",
    p,
    ctx,
    "Cross-record rule; evaluated by validateCasePackage.",
  );
}

function ruleP02(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (RETSTAT_5_NA_RULES.has("P-02") && p.retstat === "5") {
    return retstat5Na("P-02", p, ctx, ["DOB"]);
  }
  const findings: Finding[] = [];
  const fail = (
    id: string,
    actual: string,
    discrepancy: string,
  ): void => {
    findings.push(
      buildFinding({
        ruleId: "P-02",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: id,
        bcvPredicateType: "3",
        fieldsExamined: ["DOB"],
        actual,
        expected: "DOB populated, ≥ 1900-01-01, < DOPT.",
        discrepancy,
        outcome: "fail",
      }),
    );
  };
  if (p.dob === null) fail("BCV-360", "DOB blank.", "DOB blank.");
  else {
    // Stage 7 Robustness D1: parse the date, never compare the raw
    // string. An impossible date ("2020-02-30") is owned by S-07 and
    // produces no P-02 finding here — it must not be ordered against
    // 1900-01-01 or DOPT by lexicographic accident.
    const dobDays = dateDays(p.dob);
    const doptDays = dateDays(ctx.dopt);
    if (dobDays !== null && doptDays !== null) {
      if (dobDays < (dateDays("1900-01-01") as number)) {
        fail("BCV-361", `DOB = ${p.dob}.`, `DOB ${p.dob} is before 1900-01-01.`);
      }
      if (dobDays >= doptDays) {
        fail("BCV-362", `DOB = ${p.dob}, DOPT = ${ctx.dopt}.`, `DOB ${p.dob} is on/after DOPT ${ctx.dopt}.`);
      }
    }
  }
  return findings;
}

function ruleP03(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-03", p, ctx, ["DOH", "DOB", "DOTE", "DOD", "DOR"]);
  const findings: Finding[] = [];
  const fields = ["DOH", "DOB", "DOTE", "DOD", "DOR"];
  const expected = "DOB ≤ DOH ≤ min(DOTE, DOR, DOD, DOPT) where those dates are populated.";
  const fail = (
    id: string,
    actual: string,
    discrepancy: string,
    severity: ValidationSeverity,
    blocks: BlocksCalculation,
    scope: BlocksScope,
  ): void => {
    findings.push(
      buildFinding({
        ruleId: "P-03",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: id,
        bcvPredicateType: null,
        fieldsExamined: fields,
        actual,
        expected,
        discrepancy,
        severity,
        blocksCalculation: blocks,
        blocksScope: scope,
        outcome: "fail",
      }),
    );
  };
  if (p.doh === null) {
    fail("BCV-214", "DOH blank.", "DOH blank.", "Error", "Exact-only", "exact-calculation");
    return findings;
  }
  if (isCalendarDate(p.doh) && p.doh < "1930-01-01") {
    fail("BCV-215", `DOH = ${p.doh}.`, `DOH ${p.doh} is before 1930-01-01.`, "Warning", "No", "none");
  }
  if (isCalendarDate(p.doh) && p.doh < "1800-01-01") {
    fail("BCV-246", `DOH = ${p.doh}.`, `DOH ${p.doh} is before 1800-01-01.`, "Warning", "No", "none");
  }
  if (p.dob !== null && isCalendarDate(p.dob) && isCalendarDate(p.doh) && p.doh < p.dob) {
    fail("BCV-216", `DOH = ${p.doh}, DOB = ${p.dob}.`, `DOH ${p.doh} is before DOB ${p.dob}.`, "Error", "Exact-only", "exact-calculation");
  }
  if (p.dote !== null && isCalendarDate(p.dote) && isCalendarDate(p.doh) && p.doh > p.dote) {
    fail("BCV-217", `DOH = ${p.doh}, DOTE = ${p.dote}.`, `DOH ${p.doh} is after DOTE ${p.dote}.`, "Error", "Exact-only", "exact-calculation");
  }
  if (isCalendarDate(p.doh) && isCalendarDate(ctx.dopt) && p.doh >= ctx.dopt) {
    fail("BCV-218", `DOH = ${p.doh}, DOPT = ${ctx.dopt}.`, `DOH ${p.doh} is on/after DOPT ${ctx.dopt}.`, "Error", "Exact-only", "exact-calculation");
  }
  if (p.dateOfDeath !== null && isCalendarDate(p.dateOfDeath) && isCalendarDate(p.doh) && p.doh > p.dateOfDeath) {
    fail("BCV-219", `DOH = ${p.doh}, DOD = ${p.dateOfDeath}.`, `DOH ${p.doh} is after DOD ${p.dateOfDeath}.`, "Error", "Exact-only", "exact-calculation");
  }
  if (p.dor !== null && isCalendarDate(p.dor) && isCalendarDate(p.doh) && p.doh > p.dor) {
    fail("BCV-220", `DOH = ${p.doh}, DOR = ${p.dor}.`, `DOH ${p.doh} is after DOR ${p.dor}.`, "Error", "Exact-only", "exact-calculation");
  }
  if (isCalendarDate(p.doh) && isCalendarDate(ctx.today) && p.doh > ctx.today) {
    fail("BCV-259", `DOH = ${p.doh}, today = ${ctx.today}.`, `DOH ${p.doh} is after today.`, "Warning", "No", "none");
  }
  return findings;
}

function ruleP04(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-04", p, ctx, ["DOTE", "DOB", "DOD", "DOR"]);
  const findings: Finding[] = [];
  const fields = ["DOTE", "DOB", "DOD", "DOR"];
  const expected = "DOB ≤ DOTE, DOTE ≤ DOD, DOTE ≤ DOR where applicable.";
  const fail = (
    id: string,
    actual: string,
    discrepancy: string,
    severity: ValidationSeverity,
    blocks: BlocksCalculation,
    scope: BlocksScope,
  ): void => {
    findings.push(
      buildFinding({
        ruleId: "P-04",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: id,
        bcvPredicateType: null,
        fieldsExamined: fields,
        actual,
        expected,
        discrepancy,
        severity,
        blocksCalculation: blocks,
        blocksScope: scope,
        outcome: "fail",
      }),
    );
  };
  if (p.dote === null) {
    fail("BCV-221", "DOTE blank.", "DOTE blank.", "Error", "Exact-only", "exact-calculation");
  } else {
    if (isCalendarDate(p.dote) && p.dote < "1930-01-01") {
      fail("BCV-222", `DOTE = ${p.dote}.`, `DOTE ${p.dote} is before 1930-01-01.`, "Warning", "No", "none");
    }
    if (p.dob !== null && isCalendarDate(p.dob) && isCalendarDate(p.dote) && p.dote < p.dob) {
      fail("BCV-223", `DOTE = ${p.dote}, DOB = ${p.dob}.`, `DOTE ${p.dote} is before DOB ${p.dob}.`, "Error", "Exact-only", "exact-calculation");
    }
    if (p.dateOfDeath !== null && isCalendarDate(p.dateOfDeath) && isCalendarDate(p.dote) && p.dote > p.dateOfDeath) {
      fail("BCV-226", `DOTE = ${p.dote}, DOD = ${p.dateOfDeath}.`, `DOTE ${p.dote} is after DOD ${p.dateOfDeath}.`, "Error", "Exact-only", "exact-calculation");
    }
    if (p.dor !== null && isCalendarDate(p.dor) && isCalendarDate(p.dote) && p.dote > p.dor) {
      fail("BCV-227", `DOTE = ${p.dote}, DOR = ${p.dor}.`, `DOTE ${p.dote} is after DOR ${p.dor}.`, "Warning", "No", "none");
    }
    if (isCalendarDate(p.dote) && isCalendarDate(ctx.today) && p.dote > ctx.today) {
      fail("BCV-363", `DOTE = ${p.dote}, today = ${ctx.today}.`, `DOTE ${p.dote} is after today.`, "Warning", "No", "none");
    }
  }
  // CONFLICT C-1 (§10.1): BCV-224 fires when DOTE ≥ DOPT; BCV-225 fires
  // when DOTE < DOPT. Taken literally together, every populated DOTE fails
  // one of them. Both are preserved verbatim and recorded `not-applicable`
  // with reason "conflict C-1 unresolved" — neither is implemented, and
  // neither is dropped.
  for (const id of ["BCV-224", "BCV-225"]) {
    findings.push(
      naFinding(
        "P-04",
        p.participantKey,
        ctx,
        p.dote === null
          ? "Conflict C-1 unresolved; DOTE is blank so neither predicate's condition can be evaluated in any case."
          : "Conflict C-1 unresolved (BCV-224 vs BCV-225).",
        fields,
        id,
        "3",
      ),
    );
  }
  return findings;
}

function ruleP05(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-05", p, ctx, ["DOR", "SBCD", "FORM_CODE_ARD"]);
  const findings: Finding[] = [];
  const fields = ["DOR", "SBCD", "FORM_CODE_ARD"];
  const expected = "DOR consistent with RETSTAT and pay status.";
  const fail = (
    id: string,
    actual: string,
    discrepancy: string,
    severity: ValidationSeverity,
    blocks: BlocksCalculation,
    scope: BlocksScope,
  ): void => {
    findings.push(
      buildFinding({
        ruleId: "P-05",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: id,
        bcvPredicateType: null,
        fieldsExamined: fields,
        actual,
        expected,
        discrepancy,
        severity,
        blocksCalculation: blocks,
        blocksScope: scope,
        outcome: "fail",
      }),
    );
  };
  if (p.dor !== null && p.dor < "1930-01-01") {
    fail("BCV-247", `DOR = ${p.dor}.`, `DOR ${p.dor} is before 1930-01-01.`, "Warning", "No", "none");
  }
  if (p.dor !== null && p.dor > addMonths(ctx.today, 4)) {
    fail("BCV-248", `DOR = ${p.dor}, today + 4 months = ${addMonths(ctx.today, 4)}.`, `DOR ${p.dor} is more than 4 months after today.`, "Warning", "No", "none");
  }
  if (p.dor === null && p.isPreDoptRetiree) {
    fail("BCV-249", "DOR blank; participant is a pre-DOPT retiree.", "DOR blank for a pre-DOPT retiree.", "Error", "Exact-only", "exact-calculation");
  }
  if (p.dor !== null && p.dor >= ctx.dopt && p.isPreDoptRetiree) {
    fail("BCV-250", `DOR = ${p.dor}, DOPT = ${ctx.dopt}; pre-DOPT retiree.`, `DOR ${p.dor} is on/after DOPT for a pre-DOPT retiree.`, "Error", "Exact-only", "exact-calculation");
  }
  if (p.dor !== null && p.dor < ctx.dopt && p.isDeferredRecord) {
    fail("BCV-251", `DOR = ${p.dor}, DOPT = ${ctx.dopt}; deferred record.`, `DOR ${p.dor} is before DOPT for a deferred record.`, "Error", "Exact-only", "exact-calculation");
  }
  if (p.formCodeArd !== null && p.dor === null && p.isDeferredRecord) {
    fail("BCV-252", `FORM_CODE_ARD = ${p.formCodeArd}, DOR blank; deferred record.`, "FORM_CODE_ARD populated with DOR blank for a deferred record.", "Error", "Exact-only", "exact-calculation");
  }
  if (p.sbcd !== null && p.dor === null) {
    fail("BCV-261", "SBCD populated, DOR blank.", "SBCD populated with DOR blank.", "Warning", "No", "none");
  }
  return findings;
}

function ruleP06(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-06", p, ctx, ["CS", "VS"]);
  const findings: Finding[] = [];
  const expected = "CS/VS populated, in years, 0 ≤ service ≤ 83.25 years (999 months).";
  const fail = (
    id: string,
    actual: string,
    discrepancy: string,
    source?: RuleSource,
    type?: string | null,
  ): void => {
    findings.push(
      buildFinding({
        ruleId: "P-06",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: id,
        bcvPredicateType: type ?? null,
        ruleSource: source,
        fieldsExamined: ["CS", "VS"],
        actual,
        expected,
        discrepancy,
        outcome: "fail",
      }),
    );
  };
  // BCV-276 is DISABLED in the predicates workbook (ENABLE_FL = N). It is
  // re-stated here as an APP rule (conflict C-2, §10.2); it is NOT presented
  // as an official predicate.
  if (p.cs === null) {
    fail("BCV-276", "CS blank.", "Credited service not populated; reconstruction cannot proceed without it.", "APP", null);
  } else {
    if (p.csUnit === null) {
      findings.push(
        naFinding("P-06", p.participantKey, ctx, "CS unit not stated — BCV-277 (CS not in years) cannot be evaluated.", ["CS"], "BCV-277", null),
      );
    } else if (p.csUnit !== "years") {
      fail("BCV-277", `CS = ${p.cs} (${p.csUnit}).`, `CS stored in ${p.csUnit}, not years.`);
    }
    const months = decMultiply(p.cs, "12");
    if (decCompare(months, "0") < 0 || decCompare(months, "999") > 0) {
      fail("BCV-278", `CS = ${p.cs} years (${months} months).`, `CS × 12 = ${months} months, outside [0, 999].`);
    }
  }
  if (p.vs === null) {
    fail("BCV-279", "VS blank.", "Vesting service not populated.");
  } else {
    if (p.vsUnit === null) {
      findings.push(
        naFinding("P-06", p.participantKey, ctx, "VS unit not stated — BCV-280 (VS not in years) cannot be evaluated.", ["VS"], "BCV-280", null),
      );
    } else if (p.vsUnit !== "years") {
      fail("BCV-280", `VS = ${p.vs} (${p.vsUnit}).`, `VS stored in ${p.vsUnit}, not years.`);
    }
    const months = decMultiply(p.vs, "12");
    if (decCompare(months, "0") < 0 || decCompare(months, "999") > 0) {
      fail("BCV-281", `VS = ${p.vs} years (${months} months).`, `VS × 12 = ${months} months, outside [0, 999].`);
    }
    if (decCompare(p.vs, "0") === 0) {
      fail("BCV-420", `VS = 0, PA_AMB = ${p.paAmb === null ? "blank" : formatMoneyMinor(p.paAmb)}.`, "VS = 0 with a positive PA_AMB is a vesting question (rule X-09), not automatically an error in the benefit.");
    }
  }
  return findings;
}

function ruleP07(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-07", p, ctx, ["ANB", "SANB"]);
  const findings: Finding[] = [];
  const fail = (id: string, actual: string, discrepancy: string): void => {
    findings.push(
      buildFinding({
        ruleId: "P-07",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: id,
        bcvPredicateType: "3",
        fieldsExamined: ["ANB", "SANB"],
        actual,
        expected: "ANB/SANB populated, 0–999.",
        discrepancy,
        outcome: "fail",
      }),
    );
  };
  if (p.anb === null) fail("BCV-283", "ANB blank.", "ANB blank.");
  else if (p.anb < 0 || p.anb > 999) fail("BCV-284", `ANB = ${p.anb}.`, `ANB ${p.anb} outside [0, 999].`);
  if (p.sanb === null) fail("BCV-285", "SANB blank.", "SANB blank.");
  else if (p.sanb < 0 || p.sanb > 999) fail("BCV-286", `SANB = ${p.sanb}.`, `SANB ${p.sanb} outside [0, 999].`);
  return findings;
}

function ruleP08(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-08", p, ctx, ["NRD"]);
  const findings: Finding[] = [];
  if (p.nrd === null) {
    findings.push(
      buildFinding({
        ruleId: "P-08",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: "BCV-305",
        bcvPredicateType: "3",
        fieldsExamined: ["NRD"],
        actual: "NRD blank.",
        expected: "NRD populated, > 1800-01-01.",
        discrepancy: "NRD blank.",
        outcome: "fail",
      }),
    );
  } else if (p.nrd <= "1800-01-01") {
    findings.push(
      buildFinding({
        ruleId: "P-08",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: "BCV-304",
        bcvPredicateType: "3",
        fieldsExamined: ["NRD"],
        actual: `NRD = ${p.nrd}.`,
        expected: "NRD populated, > 1800-01-01.",
        discrepancy: `NRD ${p.nrd} is on/before 1800-01-01.`,
        outcome: "fail",
      }),
    );
  }
  return findings;
}

function ruleP09(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-09", p, ctx, ["DOB", "DOD", "DOTE", "ID", "NON_SPOUSE_BENF", "RETSTAT"]);
  if (p.rbdDeterminable) return [];
  return [
    buildFinding({
      ruleId: "P-09",
      participantKey: p.participantKey,
      ctx,
      bcvPredicateId: "BCV-308",
      bcvPredicateType: "3",
      fieldsExamined: ["DOB", "DOD", "DOTE", "ID", "NON_SPOUSE_BENF", "RETSTAT"],
      actual: `RBD cannot be determined; missing/bad: ${p.rbdMissingFields.length === 0 ? "unspecified" : p.rbdMissingFields.join(", ")}.`,
      expected: "RBD determinable.",
      discrepancy: "RBD cannot be determined — a symptom of the underlying field failure(s), not a root cause.",
      outcome: "fail",
    }),
  ];
}

function ruleP10(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-10", p, ctx, ["BSSN", "BDOB", "APDOB"]);
  if (p.idType !== "2" && p.idType !== "4") return [];
  const findings: Finding[] = [];
  const fields = ["BSSN", "SSSN", "BLNAME", "SLNAME", "BDOB", "SDOB", "APDOB", "BSEX", "SSEX", "APSEX", "BDOD", "SDOD", "APDOD"];
  const expected = "Complete, chronologically consistent beneficiary/AP identity.";
  const fail = (
    actual: string,
    discrepancy: string,
    severity: ValidationSeverity,
    blocks: BlocksCalculation,
    scope: BlocksScope,
    resultKey: string,
  ): void => {
    findings.push(
      buildFinding({
        ruleId: "P-10",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual,
        expected,
        discrepancy,
        severity,
        blocksCalculation: blocks,
        blocksScope: scope,
        outcome: "fail",
        resultKey,
      }),
    );
  };
  // (a) required identity field missing.
  const missing: string[] = [];
  if (p.idType === "2") {
    if (p.benSsn === null) missing.push("BSSN");
    if (p.benLastName === null) missing.push("BLNAME");
    if (p.benDob === null) missing.push("BDOB");
  } else {
    if (p.apDob === null) missing.push("APDOB");
  }
  if (missing.length > 0) {
    fail(`Missing beneficiary/AP identity field(s): ${missing.join(", ")}.`, `Required beneficiary/AP identity field(s) missing: ${missing.join(", ")}.`, "Error", "Exact-only", "exact-calculation", "missing-identity");
  }
  // (b) beneficiary/AP DOB before 1900-01-01 or after DOPT.
  const dobChecks: Array<[string, DateString | null]> = [
    ["BDOB", p.benDob],
    ["SDOB", p.spouseDob],
    ["APDOB", p.apDob],
  ];
  const badDob = dobChecks.filter(
    ([, v]) => v !== null && (v < "1900-01-01" || v > ctx.dopt),
  );
  if (badDob.length > 0) {
    fail(
      `Beneficiary/AP DOB out of range: ${badDob.map(([f, v]) => `${f}=${v}`).join(", ")}; DOPT=${ctx.dopt}.`,
      "Beneficiary/AP DOB before 1900-01-01 or after DOPT.",
      "Error", "Exact-only", "exact-calculation", "dob-range",
    );
  }
  // (c) death on/before birth. (d) death populated but birth blank.
  const lifeChecks: Array<[string, DateString | null, DateString | null]> = [
    ["beneficiary", p.benDob, p.benDateOfDeath],
    ["spouse", p.spouseDob, p.spouseDateOfDeath],
    ["alternate payee", p.apDob, p.apDateOfDeath],
  ];
  for (const [who, birth, death] of lifeChecks) {
    if (death !== null && birth === null) {
      fail(`${who}: death ${death} recorded but birth blank.`, `${who} death populated but birth blank.`, "Error", "Exact-only", "exact-calculation", `${who}-death-no-birth`);
    } else if (death !== null && birth !== null && death <= birth) {
      fail(`${who}: death ${death} on/before birth ${birth}.`, `${who} death on/before birth.`, "Error", "Exact-only", "exact-calculation", `${who}-death-before-birth`);
    }
  }
  // (e) beneficiary/AP sex unknown.
  const unknownSex: string[] = [];
  if (p.benSex === "U") unknownSex.push("BSEX");
  if (p.spouseSex === "U") unknownSex.push("SSEX");
  if (p.apSex === "U") unknownSex.push("APSEX");
  if (unknownSex.length > 0) {
    fail(`Beneficiary/AP sex unknown: ${unknownSex.join(", ")}.`, "Beneficiary/AP sex unknown.", "Warning", "No", "none", "sex-unknown");
  }
  return findings;
}

function ruleP11(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-11", p, ctx, ["PSEX"]);
  const findings: Finding[] = [];
  if (p.sex === null) {
    findings.push(
      buildFinding({
        ruleId: "P-11",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: "BCV-389",
        bcvPredicateType: null,
        fieldsExamined: ["PSEX"],
        actual: "PSEX blank.",
        expected: "PSEX ∈ {M, F, U}.",
        discrepancy: "PSEX blank.",
        outcome: "fail",
      }),
    );
  } else if (p.sex === "U") {
    findings.push(
      buildFinding({
        ruleId: "P-11",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: "BCV-388",
        bcvPredicateType: null,
        fieldsExamined: ["PSEX"],
        actual: "PSEX = U (Unknown).",
        expected: "PSEX M or F (U is permitted by the dictionary but is a Warning).",
        discrepancy: "PSEX = U (Unknown).",
        severity: "Warning",
        blocksCalculation: "No",
        blocksScope: "none",
        outcome: "fail",
      }),
    );
  } else if (p.sex !== "M" && p.sex !== "F") {
    findings.push(
      buildFinding({
        ruleId: "P-11",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: "BCV-390",
        bcvPredicateType: null,
        fieldsExamined: ["PSEX"],
        actual: `PSEX = ${p.sex}.`,
        expected: "PSEX ∈ {M, F, U}.",
        discrepancy: `PSEX ${p.sex} not in {M, F, U}.`,
        outcome: "fail",
      }),
    );
  }
  return findings;
}

function ruleP12(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-12", p, ctx, ["DOP", "DOH"]);
  const findings: Finding[] = [];
  const fail = (actual: string, discrepancy: string, resultKey = "rule"): void => {
    findings.push(
      buildFinding({
        ruleId: "P-12",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["DOP", "DOH"],
        actual,
        expected: "DOH ≤ DOP ≤ accrual start; service consistent with the plan's eligibility rule.",
        discrepancy,
        outcome: "fail",
        resultKey,
      }),
    );
  };
  if (p.dop !== null && p.doh !== null && p.dop < p.doh) {
    fail(`DOP = ${p.dop}, DOH = ${p.doh}.`, `DOP ${p.dop} is before DOH ${p.doh}.`, "dop-before-doh");
  }
  if (p.participationBeforeEligibility) {
    fail("Participation begins before eligibility is met under the plan's rules.", "Participation before eligibility.", "before-eligibility");
  }
  if (p.serviceAccruesBeforeDop) {
    fail("Credited service accrues before DOP.", "Service accrues before participation.", "service-before-dop");
  }
  return findings;
}

function ruleP13(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-13", p, ctx, ["PA_AMB"]);
  if (p.paAmb !== null || p.explicitNoBenefitStatement) return [];
  return [
    buildFinding({
      ruleId: "P-13",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB"],
      actual: `PA_AMB blank; RETSTAT = ${p.retstat}; CSPA = ${p.cspa ?? "blank"}; no explicit documented statement that the PA reported no benefit.`,
      expected: "A populated amount, OR an explicit documented statement that the PA reported no benefit for this participant.",
      discrepancy: "PA_AMB blank with no explicit statement — missing data, never zero.",
      outcome: "fail",
    }),
  ];
}

function ruleP14(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-14", p, ctx, ["S001-S050", "FRSTYEAR", "LASTYEAR", "PA_ACOMP"]);
  const findings: Finding[] = [];
  const fields = ["S001-S050", "FRSTYEAR", "LASTYEAR", "PA_ACOMP"];
  const byYear = new Map<number, MoneyMinor | null>();
  for (const s of p.salaryByYear) byYear.set(s.year, s.amount);
  const spanYears: number[] =
    p.firstYear !== null && p.lastYear !== null
      ? Array.from({ length: p.lastYear - p.firstYear + 1 }, (_, i) => (p.firstYear as number) + i)
      : [];
  // (a) gap inside the averaging period — Error.
  const avgMissing = p.averagingPeriodYears.filter(
    (y) => !byYear.has(y) || byYear.get(y) === null,
  );
  if (avgMissing.length > 0) {
    findings.push(
      buildFinding({
        ruleId: "P-14",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual: `Missing salary year(s) in the averaging period: ${avgMissing.join(", ")}.`,
        expected: "Every year in the averaging period populated, or its absence classified per Stage 1 §A.6.",
        discrepancy: `Salary year(s) ${avgMissing.join(", ")} blank inside the averaging period.`,
        outcome: "fail",
        resultKey: "averaging-gap",
      }),
    );
  }
  // (b) gap inside the span but outside the averaging period — Warning.
  const avgSet = new Set(p.averagingPeriodYears);
  const outsideMissing = spanYears.filter(
    (y) => !avgSet.has(y) && (!byYear.has(y) || byYear.get(y) === null),
  );
  if (outsideMissing.length > 0) {
    findings.push(
      buildFinding({
        ruleId: "P-14",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual: `Missing salary year(s) outside the averaging period: ${outsideMissing.join(", ")}.`,
        expected: "Every year in the averaging period populated, or its absence classified per Stage 1 §A.6.",
        discrepancy: `Salary year(s) ${outsideMissing.join(", ")} blank outside the averaging period.`,
        severity: "Warning",
        blocksCalculation: "No",
        blocksScope: "none",
        outcome: "fail",
        resultKey: "outside-gap",
      }),
    );
  }
  // (c) all salary years blank while the formula needs average pay — Error.
  if (p.salaryByYear.length === 0) {
    findings.push(
      naFinding("P-14", p.participantKey, ctx, "No salary history in the record — P-14(c) cannot be evaluated.", fields),
    );
  } else if (p.salaryByYear.every((s) => s.amount === null)) {
    findings.push(
      buildFinding({
        ruleId: "P-14",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual: `All ${p.salaryByYear.length} salary year(s) blank; formula type ${p.formulaType ?? "not stated"}.`,
        expected: "Salary history populated where the formula needs average pay.",
        discrepancy: "All salary years blank while the formula needs average pay.",
        outcome: "fail",
        resultKey: "all-blank",
      }),
    );
  }
  // (d) ANNACT = 'B' (annualized) with no note of the annualization basis — Warning.
  if (p.annact === "B" && !p.annualizationBasisNoted) {
    findings.push(
      buildFinding({
        ruleId: "P-14",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual: "ANNACT = B (annualized); no note of the annualization basis.",
        expected: "Annualized salary carries a note of the annualization basis.",
        discrepancy: "ANNACT = B with no documented annualization basis.",
        severity: "Warning",
        blocksCalculation: "No",
        blocksScope: "none",
        outcome: "fail",
        resultKey: "annualized",
      }),
    );
  }
  return findings;
}

function ruleP15(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("P-15", p, ctx, ["CSPA", "VSPA", "ESPA", "DOH", "DOTE"]);
  if (p.doh === null || p.dote === null) {
    return [
      naFinding(
        "P-15",
        p.participantKey,
        ctx,
        "DOH/DOTE missing — elapsed time cannot be computed.",
        ["CSPA", "VSPA", "ESPA", "DOH", "DOTE"],
      ),
    ];
  }
  const findings: Finding[] = [];
  const fields = ["CSPA", "VSPA", "ESPA", "DOH", "DOTE"];
  const elapsed = elapsedMonths(p.doh, p.dote);
  const credits = ctx.planServiceCreditRule?.creditsAllowedYears ?? null;
  // Credits in months; when the plan rule is not established the credits
  // term is unknown and only the gross comparison fires (catalog §1.7).
  const creditsMonths: DecimalString = credits === null ? "0" : decMultiply(credits, "12");
  const allowedMonths = decAddMonths(String(elapsed), creditsMonths);
  const fail = (actual: string, discrepancy: string, resultKey: string): void => {
    findings.push(
      buildFinding({
        ruleId: "P-15",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual,
        expected: `Each service measure ≤ elapsed time (${elapsed} months DOH→DOTE) + documented credits${credits === null ? " (credits term unknown — gross comparison only)" : ` (${credits} years)`}.`,
        discrepancy,
        outcome: "fail",
        resultKey,
      }),
    );
  };
  const checkExceeds = (service: DecimalString | null, label: string, key: string): void => {
    if (service === null) return;
    const months = decMultiply(service, "12");
    if (decCompare(months, allowedMonths) > 0) {
      fail(
        `${label} = ${service} years (${months} months); elapsed DOH→DOTE = ${elapsed} months; credits allowed = ${credits ?? "unknown (0 applied)"} years.`,
        `${label} ${service} years exceeds elapsed time plus documented credits.`,
        key,
      );
    }
  };
  checkExceeds(p.cspa, "CSPA", "cspa");
  checkExceeds(p.espa, "ESPA", "espa");
  // VSPA vs CSPA: fires only when the plan's allowed excess is established.
  // With no established rule the leg is not-applicable, not a pass.
  const maxExcess = ctx.planServiceCreditRule?.maxVestingExcessYears ?? null;
  if (p.vspa !== null && p.cspa !== null) {
    const excess = decSubtract(p.vspa, p.cspa);
    if (maxExcess === null) {
      if (decCompare(excess, "0") > 0) {
        findings.push(
          naFinding(
            "P-15",
            p.participantKey,
            ctx,
            `VSPA exceeds CSPA by ${excess} years but the plan's allowed excess is not established — the VSPA-vs-CSPA leg cannot be evaluated.`,
            fields,
          ),
        );
      }
    } else if (decCompare(excess, maxExcess) > 0) {
      fail(
        `VSPA − CSPA = ${excess} years; allowed excess = ${maxExcess} years.`,
        `VSPA exceeds CSPA by ${excess} years, more than the plan's rules allow (${maxExcess}).`,
        "vspa-excess",
      );
    }
  }
  return findings;
}

function ruleP16(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  return crossRecordNa(
    "P-16",
    p,
    ctx,
    "Cross-record rule; evaluated by validateCasePackage.",
  );
}

/** Exact decimal addition of two month counts (DecimalStrings). */
function decAddMonths(a: DecimalString, b: DecimalString): DecimalString {
  return decAdd(a, b);
}

// ---------------------------------------------------------------------------
// Layer 3 — Cross-field (X-01–X-14)
// ---------------------------------------------------------------------------

function ruleX01(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  // X-01 tests RETSTAT = 5 itself, so the RETSTAT-5 gate does not apply.
  if (p.retstat === "5" && p.paAmb !== null) {
    return [
      buildFinding({
        ruleId: "X-01",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["RETSTAT", "PA_AMB"],
        actual: `RETSTAT = 5; PA_AMB = ${formatMoneyMinor(p.paAmb)}.`,
        expected: "RETSTAT = 5 → no PA_AMB in the valuation population.",
        discrepancy: "RETSTAT = 5 (not in valuation population) with a populated PA_AMB.",
        outcome: "fail",
        resultKey: "retstat-5",
      }),
    ];
  }
  if (
    p.retstat !== null &&
    ["1", "2", "3", "4"].includes(p.retstat) &&
    p.paAmb === null &&
    !p.explicitNoBenefitStatement
  ) {
    return [
      buildFinding({
        ruleId: "X-01",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["RETSTAT", "PA_AMB"],
        actual: `RETSTAT = ${p.retstat}; PA_AMB blank; no explicit statement.`,
        expected: "RETSTAT 1–4 → PA_AMB present or explicitly stated absent.",
        discrepancy: "PA_AMB blank for a participant in the valuation population (see also P-13).",
        outcome: "fail",
        resultKey: "blank-benefit",
      }),
    ];
  }
  return [];
}

function ruleX02(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-02", p, ctx, ["DOTE", "RETSTAT", "DOB", "DOD"]);
  const findings: Finding[] = [];
  const fields = ["DOTE", "RETSTAT", "DOB", "DOD"];
  // BCV-350 — expected status/date pattern (Warning).
  let patternOk: boolean | null = null;
  let patternActual = "";
  if (p.retstat === "1") {
    patternActual = `RETSTAT = 1; in pay at DOPT: ${p.inPayAtDopt === null ? "unknown" : String(p.inPayAtDopt)}.`;
    patternOk = p.inPayAtDopt;
  } else if (p.retstat === "2") {
    patternActual = `RETSTAT = 2; DOTE = ${p.dote ?? "blank"}, DOPT = ${ctx.dopt}.`;
    patternOk = p.dote !== null && p.dote < ctx.dopt;
  } else if (p.retstat === "3") {
    patternActual = `RETSTAT = 3; DOTE = ${p.dote ?? "blank"}, DOPT = ${ctx.dopt}.`;
    patternOk = p.dote === null || p.dote >= ctx.dopt;
  } else if (p.retstat === "4") {
    patternOk = true;
    patternActual = "RETSTAT = 4 (nonvested); no DOTE pattern applies.";
  }
  if (patternOk === false) {
    findings.push(
      buildFinding({
        ruleId: "X-02",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: "BCV-350",
        bcvPredicateType: "2",
        fieldsExamined: fields,
        actual: patternActual,
        expected: "RETSTAT = 1 → in pay at DOPT; RETSTAT = 2 → separated, DOTE < DOPT; RETSTAT = 3 → active, DOTE blank or ≥ DOPT; RETSTAT = 4 → nonvested.",
        discrepancy: `RETSTAT/DOTE combination contradicts the expected pattern: ${patternActual}`,
        severity: "Warning",
        blocksCalculation: "No",
        blocksScope: "none",
        outcome: "fail",
      }),
    );
  } else if (patternOk === null) {
    findings.push(
      naFinding("X-02", p.participantKey, ctx, "RETSTAT missing or in-pay status unknown — the BCV-350 status/date pattern cannot be evaluated.", fields, "BCV-350", "2"),
    );
  }
  // BCV-351 — RBD ≤ DOPT with RETSTAT ≠ 1 (Error).
  if (p.rbd !== null && p.rbd <= ctx.dopt && p.retstat !== null && p.retstat !== "1") {
    findings.push(
      buildFinding({
        ruleId: "X-02",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: "BCV-351",
        bcvPredicateType: "4",
        fieldsExamined: fields,
        actual: `RBD = ${p.rbd}, DOPT = ${ctx.dopt}, RETSTAT = ${p.retstat}.`,
        expected: "RBD ≤ DOPT only for RETSTAT = 1 (retired).",
        discrepancy: `RBD ${p.rbd} is on/before DOPT but RETSTAT is ${p.retstat}, not 1.`,
        outcome: "fail",
      }),
    );
  }
  return findings;
}

function ruleX03(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-03", p, ctx, ["MANDCWI", "RETSTAT", "PVRETEEC"]);
  const findings: Finding[] = [];
  const fields = ["MANDCWI", "RETSTAT", "PVRETEEC"];
  // BCV-282 (Warning). The Stage 1 text states the predicate only as
  // "record status inconsistent with mandatory-contribution balance at
  // DOPT". Implemented as: a nonvested participant (RETSTAT = 4) holding a
  // mandatory-contribution balance at DOPT — the balance should have been
  // returned or the status is wrong. This reading is recorded here, not in
  // the catalog; see the delivery report.
  if (p.mandcwi !== null && p.mandcwi > 0 && p.retstat === "4") {
    findings.push(
      buildFinding({
        ruleId: "X-03",
        participantKey: p.participantKey,
        ctx,
        bcvPredicateId: "BCV-282",
        bcvPredicateType: "3",
        fieldsExamined: fields,
        actual: `MANDCWI = ${formatMoneyMinor(p.mandcwi)}; RETSTAT = 4 (nonvested).`,
        expected: "Participants are always fully vested in their own contributions; RETSTAT consistent with MANDCWI > 0.",
        discrepancy: "Nonvested participant holds a mandatory-contribution balance at DOPT.",
        severity: "Warning",
        blocksCalculation: "No",
        blocksScope: "none",
        outcome: "fail",
      }),
    );
  }
  // BCV-333 / BCV-416 (Error, blocks nothing). BCV type preserved as
  // written in Stage 1 ("4/7"); a type "7" is unexplained (catalog OD-03).
  // Implemented as: contributions held while VPPA < 1 (not fully vested in
  // the participant's own contributions).
  if (p.mandcwi !== null && p.mandcwi > 0) {
    if (p.vppa === null) {
      findings.push(
        naFinding("X-03", p.participantKey, ctx, "MANDCWI > 0 but VPPA missing — vesting in employee contributions cannot be determined.", fields, "BCV-333/BCV-416", "4/7"),
      );
    } else if (decCompare(p.vppa, "1") < 0) {
      findings.push(
        buildFinding({
          ruleId: "X-03",
          participantKey: p.participantKey,
          ctx,
          bcvPredicateId: "BCV-333/BCV-416",
          bcvPredicateType: "4/7",
          fieldsExamined: fields,
          actual: `MANDCWI = ${formatMoneyMinor(p.mandcwi)}; VPPA = ${p.vppa}.`,
          expected: "Participants are always fully vested in their own contributions (VPPA = 1 where MANDCWI > 0).",
          discrepancy: `Participant not fully vested in employee contributions (VPPA = ${p.vppa}) while MANDCWI = ${formatMoneyMinor(p.mandcwi)}.`,
          severity: "Error",
          blocksCalculation: "No",
          blocksScope: "none",
          outcome: "fail",
        }),
      );
    }
  }
  return findings;
}

function ruleX04(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-04", p, ctx, ["DOB", "CSPA", "PA_ACOMP", "PA_AMB", "RETSTAT"]);
  const range = ctx.plausibleBenefitCompRatioRange;
  if (range === null) {
    // Parameterized rule (catalog §1.7, OD-09): until the case actuary sets
    // the range from the plan's formula, X-04 is not-applicable — never a
    // pass and never a fire.
    return [
      naFinding(
        "X-04",
        p.participantKey,
        ctx,
        "No plausibleBenefitCompRatioRange set for the case — the rule cannot fire until the case actuary sets it from the plan's formula (accrual rate × service). Until then it is never a pass and never a fire.",
        ["DOB", "CSPA", "PA_ACOMP", "PA_AMB", "RETSTAT"],
      ),
    ];
  }
  if (p.paAmb === null || p.paAcomp === null) {
    return [
      naFinding("X-04", p.participantKey, ctx, "PA_AMB or PA_ACOMP missing — the benefit-to-compensation ratio cannot be computed.", ["PA_ACOMP", "PA_AMB"]),
    ];
  }
  const paAcompMonthly =
    p.paAcompPeriodicity === "annual"
      ? decDivide(moneyMinorToDecimalString(p.paAcomp), "12", 10)
      : moneyMinorToDecimalString(p.paAcomp);
  if (decCompare(paAcompMonthly, "0") === 0) {
    return [
      naFinding("X-04", p.participantKey, ctx, "PA_ACOMP is zero — the benefit-to-compensation ratio is undefined.", ["PA_ACOMP", "PA_AMB"]),
    ];
  }
  const ratio = decDivide(moneyMinorToDecimalString(p.paAmb), paAcompMonthly, 10);
  if (decCompare(ratio, range.min) >= 0 && decCompare(ratio, range.max) <= 0) return [];
  return [
    buildFinding({
      ruleId: "X-04",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["DOB", "CSPA", "PA_ACOMP", "PA_AMB", "RETSTAT"],
      actual: `PA_AMB ÷ PA_ACOMP = ${ratio} (PA_AMB = ${formatMoneyMinor(p.paAmb)}, PA_ACOMP monthly = ${formatMoneyMinor(p.paAcompPeriodicity === "annual" ? Math.round(p.paAcomp / 12) : p.paAcomp)}).`,
      expected: `Ratio within [${range.min}, ${range.max}] for the plan's formula.`,
      discrepancy: `Benefit-to-compensation ratio ${ratio} outside the plausible range [${range.min}, ${range.max}]. Heuristic only — never evidence PA_AMB is wrong.`,
      outcome: "fail",
    }),
  ];
}

function ruleX05(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-05", p, ctx, ["PA_AMB", "CSPA"]);
  const zeroService = p.cspa === null || decCompare(p.cspa, "0") === 0;
  if (!zeroService || p.paAmb === null || p.paAmb <= 0) return [];
  if (p.documentedMinimumOrGrandfatherOrPastServiceCredit) return [];
  return [
    buildFinding({
      ruleId: "X-05",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB", "CSPA"],
      actual: `CSPA = ${p.cspa ?? "blank"}; PA_AMB = ${formatMoneyMinor(p.paAmb)}.`,
      expected: "Zero credited service → zero formula benefit, unless a documented minimum benefit, grandfathered benefit, or past-service credit applies.",
      discrepancy: "Positive administrator benefit with zero credited service and no documented floor/credit.",
      outcome: "fail",
    }),
  ];
}

function ruleX06(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-06", p, ctx, ["PA_AMB", "PA_ACOMP", "CSPA"]);
  if (!usableTolerance(ctx.tolerance)) {
    return [
      naFinding("X-06", p.participantKey, ctx, "No case tolerance record (M-7) — the engine refuses to compare without a recorded tolerance.", ["PA_AMB", "PA_ACOMP", "CSPA"]),
    ];
  }
  if (!p.formulaKnownForX06 || p.formulaCheckValueMinor === null || p.paAcomp === null || p.cspa === null) {
    return [
      naFinding("X-06", p.participantKey, ctx, "Governing formula or a PA input (PA_ACOMP / CSPA) missing — the PA arithmetic check cannot run for this participant.", ["PA_AMB", "PA_ACOMP", "CSPA"]),
    ];
  }
  if (p.paAmb === null) {
    return [
      naFinding("X-06", p.participantKey, ctx, "PA_AMB missing — nothing to check against the PA's own inputs.", ["PA_AMB", "PA_ACOMP", "CSPA"]),
    ];
  }
  const tol = ctx.tolerance as ToleranceRecord;
  const delta = p.paAmb - p.formulaCheckValueMinor;
  if (withinTolerance(delta, p.formulaCheckValueMinor, tol)) return [];
  return [
    buildFinding({
      ruleId: "X-06",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB", "PA_ACOMP", "CSPA"],
      actual: `PA_AMB = ${formatMoneyMinor(p.paAmb)}; formula on PA's own inputs = ${formatMoneyMinor(p.formulaCheckValueMinor)} (PA_ACOMP = ${formatMoneyMinor(p.paAcomp)}, CSPA = ${p.cspa}); difference = ${formatMoneyMinor(delta)}.`,
      expected: "The PA's own arithmetic reconciles within the case tolerance.",
      discrepancy: `PA_AMB differs from the plan formula applied to the PA's own inputs by ${formatMoneyMinor(Math.abs(delta))}, more than the case tolerance.`,
      outcome: "fail",
    }),
  ];
}

function ruleX07(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-07", p, ctx, ["CSPA", "CS", "VSPA", "VS", "ESPA", "ES"]);
  const findings: Finding[] = [];
  const pairs: Array<[string, DecimalString | null, DecimalString | null]> = [
    ["CSPA/CS", p.cspa, p.cs],
    ["VSPA/VS", p.vspa, p.vs],
    ["ESPA/ES", p.espa, p.es],
  ];
  for (const [label, pa, bcv] of pairs) {
    const [paField, bcvField] = label.split("/");
    if (pa === null || bcv === null) {
      // A missing side is that field's own rule (P-06), not this rule —
      // recorded as not-applicable for the pair (catalog Example 1).
      findings.push(
        naFinding(
          "X-07",
          p.participantKey,
          ctx,
          `${label} cannot be compared — ${pa === null ? paField : bcvField} missing (that field's own rule applies).`,
          [paField as string, bcvField as string],
          null,
          null,
        ),
      );
      continue;
    }
    const diff = decSubtract(pa, bcv);
    const absDiff = decCompare(diff, "0") < 0 ? decSubtract("0", diff) : diff;
    if (decCompare(absDiff, ctx.serviceTolerance) > 0) {
      findings.push(
        buildFinding({
          ruleId: "X-07",
          participantKey: p.participantKey,
          ctx,
          fieldsExamined: [paField as string, bcvField as string],
          actual: `${paField} = ${pa}, ${bcvField} = ${bcv}; difference = ${absDiff} years.`,
          expected: `PA-reported and BCV-calculated service agree within the service tolerance (${ctx.serviceTolerance} years).`,
          discrepancy: `|${paField} − ${bcvField}| = ${absDiff} years, exceeding the service tolerance ${ctx.serviceTolerance}.`,
          outcome: "fail",
          resultKey: label,
        }),
      );
    }
  }
  return findings;
}

function ruleX08(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-08", p, ctx, ["PIA", "PA_AMB"]);
  if (p.integrationMethod === null) {
    return [
      naFinding("X-08", p.participantKey, ctx, "Integration method not established — cannot tell whether PIA is required.", ["PIA", "PA_AMB"]),
    ];
  }
  // Integrated per the catalog's parenthetical: offset / covered-comp.
  // "pia-offset" is the same family (a Social Security offset); "excess"
  // is also an integrated design, but the catalog names offset/covered-comp,
  // so excess is treated as integrated here only when the PIA is the offset
  // input — it is not: excess formulas use covered compensation, not PIA.
  // PIA is therefore required for offset / covered-comp / pia-offset.
  const integrated =
    p.integrationMethod === "offset" ||
    p.integrationMethod === "covered-comp" ||
    p.integrationMethod === "pia-offset";
  if (integrated && p.pia === null) {
    return [
      buildFinding({
        ruleId: "X-08",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["PIA", "PA_AMB"],
        actual: `Integration method = ${p.integrationMethod}; PIA blank.`,
        expected: "PIA present when the governing formula uses a Social Security offset.",
        discrepancy: "PIA missing for an integrated formula.",
        outcome: "fail",
        resultKey: "pia-missing",
      }),
    ];
  }
  if (!integrated && p.pia !== null) {
    return [
      buildFinding({
        ruleId: "X-08",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["PIA", "PA_AMB"],
        actual: `Integration method = ${p.integrationMethod}; PIA = ${formatMoneyMinor(p.pia)}.`,
        expected: "PIA present iff the governing formula uses a Social Security offset.",
        discrepancy: "PIA populated although the governing formula is not integrated.",
        severity: "Warning",
        blocksCalculation: "No",
        blocksScope: "none",
        outcome: "fail",
        resultKey: "pia-unexpected",
      }),
    ];
  }
  return [];
}

function ruleX09(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-09", p, ctx, ["PA_AMB", "VPPA", "VS", "VSPA", "RETSTAT"]);
  if (p.paAmb === null || p.paAmb <= 0) return [];
  const nonvested =
    p.retstat === "4" || (p.vppa !== null && decCompare(p.vppa, "1") < 0);
  if (!nonvested || p.vestingTreatment !== "unknown") return [];
  return [
    buildFinding({
      ruleId: "X-09",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB", "VPPA", "VS", "VSPA", "RETSTAT"],
      actual: `PA_AMB = ${formatMoneyMinor(p.paAmb)}; VPPA = ${p.vppa ?? "blank"}; VS = ${p.vs ?? "blank"}; RETSTAT = ${p.retstat}; vesting treatment of PA_AMB = unknown.`,
      expected: "The vesting treatment of PA_AMB is established (gross / vested) before any comparison; a nonvested participant's vested benefit is zero, but the gross accrued benefit may be positive.",
      discrepancy: "PA_AMB > 0 for a nonvested participant with unknown vesting treatment.",
      outcome: "fail",
    }),
  ];
}

function ruleX10(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-10", p, ctx, ["PA_AMB", "FORM_CODE_NSF", "FORM_CODE_NMF"]);
  if (p.annuityForm === null) {
    return [
      buildFinding({
        ruleId: "X-10",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["PA_AMB", "FORM_CODE_NSF", "FORM_CODE_NMF"],
        actual: "Annuity form of PA_AMB unknown.",
        expected: "The annuity form of PA_AMB is recorded; if it differs from the normal form, the conversion factor and its source are recorded.",
        discrepancy: "Annuity form of PA_AMB unknown.",
        outcome: "fail",
        resultKey: "form-unknown",
      }),
    ];
  }
  const normalForms = [p.formCodeNsf, p.formCodeNmf].filter(
    (f): f is string => f !== null,
  );
  if (
    normalForms.length > 0 &&
    !normalForms.includes(p.annuityForm) &&
    !p.annuityFormConversionDocumented
  ) {
    return [
      buildFinding({
        ruleId: "X-10",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["PA_AMB", "FORM_CODE_NSF", "FORM_CODE_NMF"],
        actual: `PA_AMB form = ${p.annuityForm}; normal forms = ${normalForms.join(", ")}; conversion documented: ${p.annuityFormConversionDocumented}.`,
        expected: "The annuity form of PA_AMB is recorded; if it differs from the normal form, the conversion factor and its source are recorded.",
        discrepancy: `PA schedule states form ${p.annuityForm}, not the plan's normal form, with no conversion documented.`,
        outcome: "fail",
        resultKey: "form-non-normal",
      }),
    ];
  }
  return [];
}

function ruleX11(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-11", p, ctx, ["FORM_CODE", "FORM_CODE_NSF", "FORM_CODE_NMF"]);
  const findings: Finding[] = [];
  const fields = ["FORM_CODE", "FORM_CODE_NSF", "FORM_CODE_NMF", "FORM_CODE_QPSA", "FORM_CODE_ARD", "SPC_VAL", "SPCNSF", "SPC_ARD", "MTHS", "MTHSNSF", "MTHS_ARD"];
  const expected = "Codes, survivor %, and months-certain mutually consistent and within the dictionary's permitted values.";
  const fail = (
    actual: string,
    discrepancy: string,
    severity: ValidationSeverity,
    blocks: BlocksCalculation,
    scope: BlocksScope,
    resultKey: string,
  ): void => {
    findings.push(
      buildFinding({
        ruleId: "X-11",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual,
        expected,
        discrepancy,
        severity,
        blocksCalculation: blocks,
        blocksScope: scope,
        outcome: "fail",
        resultKey,
      }),
    );
  };
  // Invalid code / required code not populated — Error (BCV-200, 266, 274).
  if (p.formCode === null) {
    fail("FORM_CODE blank.", "Required form code FORM_CODE not populated.", "Error", "Exact-only", "exact-calculation", "form-code-blank");
  } else if (ctx.validFormCodes !== null && !ctx.validFormCodes.includes(p.formCode)) {
    fail(`FORM_CODE = ${p.formCode} not in the valid form-code list.`, `FORM_CODE ${p.formCode} not in the valid list.`, "Error", "Exact-only", "exact-calculation", "form-code-invalid");
  } else if (ctx.validFormCodes === null) {
    findings.push(
      naFinding("X-11", p.participantKey, ctx, "No valid form-code list supplied — the 'not in the valid list' leg cannot be evaluated.", fields, "BCV-200", null),
    );
  }
  if (p.formCodeNsf === null) {
    fail("FORM_CODE_NSF blank.", "Required form code FORM_CODE_NSF not populated.", "Error", "Exact-only", "exact-calculation", "form-code-nsf-blank");
  }
  // ARD form inconsistent with the valid list — Warning (BCV-201–203, 267–269).
  if (
    p.formCodeArd !== null &&
    ctx.validFormCodes !== null &&
    !ctx.validFormCodes.includes(p.formCodeArd)
  ) {
    fail(`FORM_CODE_ARD = ${p.formCodeArd} not in the valid form-code list.`, `ARD form ${p.formCodeArd} inconsistent with the valid form-code list.`, "Warning", "No", "none", "ard-form");
  }
  // Survivor % outside 0–1 — Error.
  const spcChecks: Array<[string, DecimalString | null]> = [
    ["SPC_VAL", p.spcVal],
    ["SPCNSF", p.spcNsf],
    ["SPC_ARD", p.spcArd],
  ];
  for (const [field, value] of spcChecks) {
    if (value !== null && (decCompare(value, "0") < 0 || decCompare(value, "1") > 0)) {
      fail(`${field} = ${value}.`, `Survivor % ${field} = ${value} outside [0, 1].`, "Error", "Exact-only", "exact-calculation", `${field}-range`);
    }
  }
  // Months-certain > 180 — Error.
  const mthsChecks: Array<[string, number | null]> = [
    ["MTHS", p.mths],
    ["MTHSNSF", p.mthsNsf],
    ["MTHS_ARD", p.mthsArd],
  ];
  for (const [field, value] of mthsChecks) {
    if (value !== null && value > 180) {
      fail(`${field} = ${value}.`, `Months-certain ${field} = ${value} exceeds 180.`, "Error", "Exact-only", "exact-calculation", `${field}-range`);
    }
  }
  // Joint-life code on a single-life record — Warning (consistency mismatch).
  if (p.formCodeIsJointLife === true && p.recordIsSingleLife) {
    fail("Joint-life form code on a single-life record.", "Joint-life code on a single-life record.", "Warning", "No", "none", "joint-on-single");
  }
  return findings;
}

function ruleX12(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-12", p, ctx, ["FORM_CODE", "LS_TERM", "XRD", "XRD_MB_TERM"]);
  if (p.retstat === null || !["1", "2", "3", "4"].includes(p.retstat)) {
    return [
      naFinding("X-12", p.participantKey, ctx, "RETSTAT missing — valuation-population membership cannot be established.", ["FORM_CODE", "LS_TERM", "XRD", "XRD_MB_TERM"]),
    ];
  }
  const blank: string[] = [];
  if (p.formCode === null) blank.push("FORM_CODE");
  if (p.lsTerm === null) blank.push("LS_TERM");
  if (p.xrd === null) blank.push("XRD");
  if (p.xrdMbTerm === null) blank.push("XRD_MB_TERM");
  if (blank.length === 0) return [];
  return [
    buildFinding({
      ruleId: "X-12",
      participantKey: p.participantKey,
      ctx,
      bcvPredicateId: "BCV-434",
      bcvPredicateType: "4",
      fieldsExamined: ["FORM_CODE", "LS_TERM", "XRD", "XRD_MB_TERM"],
      actual: `Critical valuation field(s) blank: ${blank.join(", ")}; RETSTAT = ${p.retstat}.`,
      expected: "FORM_CODE, LS_TERM, XRD, XRD_MB_TERM populated for records in the valuation population.",
      discrepancy: `Critical valuation field(s) not populated: ${blank.join(", ")}. Blocks a cross-source check (C-03), not the PA_AMB calculation.`,
      severity: "Error",
      blocksCalculation: "No",
      blocksScope: "none",
      outcome: "fail",
    }),
  ];
}

function ruleX13(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-13", p, ctx, ["MANDCWI", "VOLCWI", "PA_AMB", "CASH_BAL_DOPT"]);
  const findings: Finding[] = [];
  const fields = ["MANDCWI", "VOLCWI", "PA_AMB", "CASH_BAL_DOPT"];
  if (
    ((p.mandcwi !== null && p.mandcwi > 0) || (p.volcwi !== null && p.volcwi > 0)) &&
    !p.contributionTreatmentDocumented
  ) {
    findings.push(
      buildFinding({
        ruleId: "X-13",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual: `MANDCWI = ${p.mandcwi === null ? "blank" : formatMoneyMinor(p.mandcwi)}; VOLCWI = ${p.volcwi === null ? "blank" : formatMoneyMinor(p.volcwi)}; no contribution treatment documented.`,
        expected: "Contributions and cash-balance amounts are either reflected in the benefit or explicitly documented as not applicable.",
        discrepancy: "Employee-contribution balance with no corresponding benefit floor or return-of-contributions treatment documented.",
        outcome: "fail",
        resultKey: "contributions",
      }),
    );
  }
  if (p.cashBalDopt !== null && p.cashBalDopt > 0 && !p.cashBalanceExplanationDocumented) {
    if (p.formulaType === null) {
      findings.push(
        naFinding("X-13", p.participantKey, ctx, "CASH_BAL_DOPT > 0 but the formula type is not established — the cash-balance leg cannot be evaluated.", fields),
      );
    } else if (p.formulaType !== "cash-balance") {
      findings.push(
        buildFinding({
          ruleId: "X-13",
          participantKey: p.participantKey,
          ctx,
          fieldsExamined: fields,
          actual: `CASH_BAL_DOPT = ${formatMoneyMinor(p.cashBalDopt)}; formula type = ${p.formulaType}; no explanation documented.`,
          expected: "Contributions and cash-balance amounts are either reflected in the benefit or explicitly documented as not applicable.",
          discrepancy: `CASH_BAL_DOPT > 0 for a non-cash-balance formula (${p.formulaType}) with no explanation.`,
          outcome: "fail",
          resultKey: "cash-balance",
        }),
      );
    }
  }
  return findings;
}

function ruleX14(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("X-14", p, ctx, ["DOBF", "DOTE", "PA_AMB"]);
  const fields = ["DOBF", "DOTE", "PA_AMB"];
  const freezeAfterDote =
    p.dobfParticipant !== null && p.dote !== null && p.dobfParticipant < p.dote;
  if (
    (freezeAfterDote && p.accrualAfterFreeze) ||
    (p.planFreezeDate !== null && p.accrualAfterFreeze) ||
    p.benefitReflectsPostFreezeAccrual
  ) {
    return [
      buildFinding({
        ruleId: "X-14",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual: `DOBF (participant) = ${p.dobfParticipant ?? "blank"}; plan freeze date = ${p.planFreezeDate ?? "blank"}; DOTE = ${p.dote ?? "blank"}; accrual after freeze: ${p.accrualAfterFreeze}; benefit reflects post-freeze accrual: ${p.benefitReflectsPostFreezeAccrual}.`,
        expected: "No accrual after the benefit freeze date; DOBF ≤ DOTE for frozen participants.",
        discrepancy: "Benefit/service accrues past the benefit freeze date.",
        outcome: "fail",
      }),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Layer 4 — Measurement-date resolution (M-01–M-06)
// ---------------------------------------------------------------------------

function ruleM01(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("M-01", p, ctx, ["DOTE", "PA_AMB", "RETSTAT"]);
  if (p.paAmb === null || p.dote !== null) return [];
  const isActive = p.retstat === "3";
  return [
    buildFinding({
      ruleId: "M-01",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["DOTE", "PA_AMB", "RETSTAT"],
      actual: `PA_AMB = ${formatMoneyMinor(p.paAmb)}; DOTE blank; RETSTAT = ${p.retstat ?? "blank"}.`,
      expected: "DOTE populated for RETSTAT 1, 2, 4; for RETSTAT 3 (active) DOTE blank is legitimate and the measurement date must be established another way.",
      discrepancy: "PA_AMB populated with DOTE blank — measurement basis unresolved.",
      severity: isActive ? "Warning" : "Error",
      blocksCalculation: isActive ? "No" : "Exact-only",
      blocksScope: isActive ? "none" : "exact-calculation",
      outcome: "fail",
    }),
  ];
}

function ruleM02(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("M-02", p, ctx, ["APP.recordedDate", "APP.measurementDate", "PA_AMB"]);
  if (p.measurementDate !== null) return [];
  return [
    buildFinding({
      ruleId: "M-02",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["APP.recordedDate", "APP.measurementDate", "PA_AMB"],
      actual: `Measurement date unknown; recorded/filed date = ${p.recordedDate ?? "unknown"}.`,
      expected: "Measurement date and recorded date stored as separate fields; a recorded date is never used as a measurement date.",
      discrepancy: "Benefit amount with no established date through which it was calculated.",
      outcome: "fail",
    }),
  ];
}

function ruleM03(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("M-03", p, ctx, ["APP.measurementDate", "DOTE"]);
  if (
    p.measurementDate === null ||
    p.dote === null ||
    p.measurementDate === p.dote ||
    p.measurementDisagreementExplained
  ) {
    return [];
  }
  return [
    buildFinding({
      ruleId: "M-03",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["APP.measurementDate", "DOTE"],
      actual: `Established measurement date = ${p.measurementDate}; census DOTE = ${p.dote}; disagreement not documented.`,
      expected: "Measurement date = DOTE, or the disagreement is documented with the reason.",
      discrepancy: `Established measurement date ${p.measurementDate} disagrees with census DOTE ${p.dote}, unexplained.`,
      outcome: "fail",
    }),
  ];
}

function ruleM04(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("M-04", p, ctx, ["PA_AMB", "NRD", "DOTE"]);
  if (!p.assertedBasisNrd || p.nrdBasisEvidence) return [];
  return [
    buildFinding({
      ruleId: "M-04",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB", "NRD", "DOTE"],
      actual: "PA_AMB asserted to be 'as of NRD' with no documentary evidence.",
      expected: "PA_AMB basis is DOTE per the dictionary; an NRD-basis claim requires documentary evidence and, if accepted, the basis is recorded as other-stated with the evidence linked.",
      discrepancy: "NRD-basis claim for PA_AMB asserted without evidence.",
      outcome: "fail",
    }),
  ];
}

function ruleM05(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("M-05", p, ctx, ["APP.measurementDate", "APP.annuityForm", "APP.vestingTreatment"]);
  const mismatches: string[] = [];
  if (p.measurementDate === null || p.calcMeasurementDate === null) {
    mismatches.push(
      `measurement date: observation ${p.measurementDate ?? "unknown"} vs calculation ${p.calcMeasurementDate ?? "unknown"}`,
    );
  } else if (p.measurementDate !== p.calcMeasurementDate) {
    mismatches.push(
      `measurement date: observation ${p.measurementDate} vs calculation ${p.calcMeasurementDate}`,
    );
  }
  if (p.annuityForm === null || p.calcAnnuityForm === null) {
    mismatches.push(
      `annuity form: observation ${p.annuityForm ?? "unknown"} vs calculation ${p.calcAnnuityForm ?? "unknown"}`,
    );
  } else if (p.annuityForm !== p.calcAnnuityForm) {
    mismatches.push(
      `annuity form: observation ${p.annuityForm} vs calculation ${p.calcAnnuityForm}`,
    );
  }
  if (p.calcVestingTreatment === null) {
    mismatches.push(
      `vesting treatment: observation ${p.vestingTreatment} vs calculation unknown`,
    );
  } else if (p.vestingTreatment !== p.calcVestingTreatment) {
    mismatches.push(
      `vesting treatment: observation ${p.vestingTreatment} vs calculation ${p.calcVestingTreatment}`,
    );
  }
  if (mismatches.length === 0) return [];
  return [
    buildFinding({
      ruleId: "M-05",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["APP.measurementDate", "APP.annuityForm", "APP.vestingTreatment"],
      actual: `Bases not equivalent — ${mismatches.join("; ")}.`,
      expected: "Bases equivalent before any comparison; otherwise the comparison is stored with comparisonBasis = unresolved and is not comparable.",
      discrepancy: "Observation and calculation bases are not equivalent; no Δ is computed.",
      outcome: "fail",
    }),
  ];
}

function ruleM06(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("M-06", p, ctx, ["DOTE", "POST_DOPT_DOTE", "DOBF"]);
  if (p.candidateMeasurementDates.length <= 1) return [];
  if (p.establishedMeasurementDate !== null) return [];
  return [
    buildFinding({
      ruleId: "M-06",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["DOTE", "POST_DOPT_DOTE", "DOBF"],
      actual: `Candidate measurement dates: ${p.candidateMeasurementDates.join(", ")}; none established with evidence.`,
      expected: "One measurement date is established with evidence, and the rejected candidates are recorded with the reason they were rejected.",
      discrepancy: `More than one candidate measurement date (${p.candidateMeasurementDates.length}) and none established with evidence.`,
      outcome: "fail",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Layer 5 — Longitudinal (L-01–L-08)
// ---------------------------------------------------------------------------

/** Whole-layer applicability: every L rule needs at least one prior extract. */
function noPriorExtract(
  ruleId: RuleId,
  p: ValidationParticipant,
  ctx: NormalizedContext,
): Finding[] {
  return [
    naFinding(
      ruleId,
      p.participantKey,
      ctx,
      "No prior extract in the case file — the population reconciliation has not been performed.",
      [],
    ),
  ];
}

function ruleL01(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  return crossRecordNa(
    "L-01",
    p,
    ctx,
    "Population-level rule; evaluated by validateCasePackage.",
  );
}

function ruleL02(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("L-02", p, ctx, ["SSN", "DOB"]);
  if (p.prior === null) return noPriorExtract("L-02", p, ctx);
  // Disappearance leg and duplicate-keys leg are population-level
  // (validateCasePackage). The per-participant leg is the cross-extract
  // duplicate-key leg.
  if (p.prior.crossExtractDuplicateKey) {
    return [
      buildFinding({
        ruleId: "L-02",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["SSN", "DOB"],
        actual: "Same person appears under different participant keys across extracts.",
        expected: "Identity is stable across extracts.",
        discrepancy: "Participant appears twice across extracts with different keys.",
        outcome: "fail",
      }),
    ];
  }
  return [];
}

function ruleL03(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("L-03", p, ctx, ["RETSTAT"]);
  if (p.prior === null) return noPriorExtract("L-03", p, ctx);
  const from = p.prior.retstat;
  const to = p.retstat;
  const backwards =
    (from === "1" && to === "3") ||
    (from === "1" && to === "2") ||
    (from === "2" && to === "3");
  if (!backwards || p.prior.statusChangeExplained) return [];
  return [
    buildFinding({
      ruleId: "L-03",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["RETSTAT"],
      actual: `RETSTAT moved ${from} → ${to} between extracts, unexplained.`,
      expected: "Status transitions follow the plan's rules (active → separated/retired; separated → retired).",
      discrepancy: `Status moved backwards (${from} → ${to}) without explanation.`,
      outcome: "fail",
    }),
  ];
}

function ruleL04(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("L-04", p, ctx, ["DOTE", "DOH"]);
  if (p.prior === null) return noPriorExtract("L-04", p, ctx);
  if (p.prior.revisionEventForDates) return [];
  const changes: string[] = [];
  if (p.dote !== p.prior.dote) {
    changes.push(`DOTE ${p.prior.dote ?? "blank"} → ${p.dote ?? "blank"}`);
  }
  if (p.doh !== p.prior.doh) {
    changes.push(`DOH ${p.prior.doh ?? "blank"} → ${p.doh ?? "blank"}`);
  }
  if (changes.length === 0) return [];
  return [
    buildFinding({
      ruleId: "L-04",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["DOTE", "DOH"],
      actual: `Changed between extracts with no documented correction: ${changes.join("; ")}.`,
      expected: "Historical dates are stable; a change is a revision event with evidence, never a silent edit.",
      discrepancy: `DOTE/DOH changed between extracts without a documented correction: ${changes.join("; ")}.`,
      outcome: "fail",
    }),
  ];
}

function ruleL05(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("L-05", p, ctx, ["S001-S050", "LASTYEAR"]);
  if (p.prior === null) return noPriorExtract("L-05", p, ctx);
  const findings: Finding[] = [];
  const fields = ["S001-S050", "LASTYEAR"];
  if (!p.prior.revisionEventForSalary) {
    const priorByYear = new Map<number, MoneyMinor | null>();
    for (const s of p.prior.salaryByYear) priorByYear.set(s.year, s.amount);
    const restated: string[] = [];
    for (const s of p.salaryByYear) {
      if (priorByYear.has(s.year) && priorByYear.get(s.year) !== s.amount) {
        restated.push(
          `${s.year}: ${priorByYear.get(s.year) === null ? "blank" : formatMoneyMinor(priorByYear.get(s.year) as number)} → ${s.amount === null ? "blank" : formatMoneyMinor(s.amount)}`,
        );
      }
    }
    if (restated.length > 0) {
      findings.push(
        buildFinding({
          ruleId: "L-05",
          participantKey: p.participantKey,
          ctx,
          fieldsExamined: fields,
          actual: `Restated salary year(s): ${restated.join("; ")}.`,
          expected: "Historical salary years are stable; restatements are revision events with the reason recorded.",
          discrepancy: `Salary history changed between extracts (restated pay): ${restated.join("; ")}.`,
          outcome: "fail",
          resultKey: "restated",
        }),
      );
    }
  }
  // Span shift without a new year passing: LASTYEAR grew by more than the
  // whole years elapsed between the prior extract's as-of date and today.
  const priorYears = p.prior.salaryByYear.map((s) => s.year);
  const currentYears = p.salaryByYear.map((s) => s.year);
  if (priorYears.length > 0 && currentYears.length > 0) {
    const priorLast = Math.max(...priorYears);
    const currentLast = Math.max(...currentYears);
    const elapsedYears = Math.floor(elapsedMonths(p.prior.asOfDate, ctx.today) / 12);
    if (currentLast - priorLast > elapsedYears) {
      findings.push(
        buildFinding({
          ruleId: "L-05",
          participantKey: p.participantKey,
          ctx,
          fieldsExamined: fields,
          actual: `LASTYEAR ${priorLast} → ${currentLast} (${currentLast - priorLast} year(s)) with ${elapsedYears} whole year(s) elapsed since the prior extract (${p.prior.asOfDate} → ${ctx.today}).`,
          expected: "The salary span shifts only as new years pass.",
          discrepancy: "Salary span shifted without a new year passing.",
          outcome: "fail",
          resultKey: "span-shift",
        }),
      );
    }
  }
  return findings;
}

function ruleL06(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("L-06", p, ctx, ["PA_AMB"]);
  if (p.prior === null) return noPriorExtract("L-06", p, ctx);
  if (p.paAmb === p.prior.paAmb) return [];
  if (p.prior.paAmbChangeExplained) return [];
  return [
    buildFinding({
      ruleId: "L-06",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB"],
      actual: `PA_AMB ${p.prior.paAmb === null ? "blank" : formatMoneyMinor(p.prior.paAmb)} → ${p.paAmb === null ? "blank" : formatMoneyMinor(p.paAmb)} between extracts, no amendment, correction, or measurement-date change.`,
      expected: "PA_AMB is stable across extracts unless a documented event explains the change.",
      discrepancy: "PA_AMB changed between extracts without an explaining event.",
      outcome: "fail",
    }),
  ];
}

function ruleL07(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("L-07", p, ctx, ["CSPA", "VS"]);
  if (p.prior === null) return noPriorExtract("L-07", p, ctx);
  const findings: Finding[] = [];
  const fields = ["CSPA", "VS"];
  const elapsedYears = decDivide(
    String(elapsedMonths(p.prior.asOfDate, ctx.today)),
    "12",
    10,
  );
  const credits = ctx.planServiceCreditRule?.creditsAllowedYears ?? "0";
  const maxGrowth = decAdd(elapsedYears, credits);
  const check = (
    label: string,
    current: DecimalString | null,
    prior: DecimalString | null,
  ): void => {
    if (current === null || prior === null) return;
    const growth = decSubtract(current, prior);
    if (decCompare(growth, "0") < 0) {
      findings.push(
        buildFinding({
          ruleId: "L-07",
          participantKey: p.participantKey,
          ctx,
          fieldsExamined: fields,
          actual: `${label} ${prior} → ${current} between extracts (decrease of ${decSubtract("0", growth)} years).`,
          expected: "Service is non-decreasing and grows by at most the elapsed time (plus documented credits).",
          discrepancy: `${label} decreased between extracts.`,
          outcome: "fail",
          resultKey: `${label}-decrease`,
        }),
      );
    } else if (decCompare(growth, maxGrowth) > 0) {
      findings.push(
        buildFinding({
          ruleId: "L-07",
          participantKey: p.participantKey,
          ctx,
          fieldsExamined: fields,
          actual: `${label} ${prior} → ${current} (growth ${growth} years); elapsed between extracts ${elapsedYears} years plus ${credits} years documented credits = ${maxGrowth} years allowed.`,
          expected: "Service is non-decreasing and grows by at most the elapsed time (plus documented credits).",
          discrepancy: `${label} grew by ${growth} years, more than the elapsed time plus documented credits (${maxGrowth}).`,
          outcome: "fail",
          resultKey: `${label}-growth`,
        }),
      );
    }
  };
  check("CSPA", p.cspa, p.prior.cspa);
  check("VS", p.vs, p.prior.vs);
  return findings;
}

function ruleL08(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("L-08", p, ctx, ["DOB", "DOH", "DOTE"]);
  if (p.prior === null) return noPriorExtract("L-08", p, ctx);
  // Unlike L-04, this rule fires even when a revision event exists — the
  // change itself is the finding, because of its impact.
  const changes: string[] = [];
  if (p.dob !== p.prior.dob) {
    changes.push(`DOB ${p.prior.dob ?? "blank"} → ${p.dob ?? "blank"}`);
  }
  if (p.doh !== p.prior.doh) {
    changes.push(`DOH ${p.prior.doh ?? "blank"} → ${p.doh ?? "blank"}`);
  }
  if (p.dote !== p.prior.dote) {
    changes.push(`DOTE ${p.prior.dote ?? "blank"} → ${p.dote ?? "blank"}`);
  }
  if (changes.length === 0) return [];
  return [
    buildFinding({
      ruleId: "L-08",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["DOB", "DOH", "DOTE"],
      actual: `High-impact date(s) changed between extracts: ${changes.join("; ")}${p.prior.revisionEventForDates ? " (revision event exists — the change itself is still the finding)." : ""}`,
      expected: "Stable; any change is a revision event.",
      discrepancy: `High-impact date changed between extracts: ${changes.join("; ")}.`,
      outcome: "fail",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Layer 6 — Cross-source (C-01–C-10)
// ---------------------------------------------------------------------------

function ruleC01(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("C-01", p, ctx, ["PA_AMB"]);
  if (p.paAmb === null) return [];
  if (!p.scheduleProvided) {
    return [
      buildFinding({
        ruleId: "C-01",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["PA_AMB"],
        actual: `PA_AMB = ${formatMoneyMinor(p.paAmb)}; no PA schedule was provided at all.`,
        expected: "Every census PA_AMB traces to a schedule row/cell/page.",
        discrepancy: "Census PA_AMB has no matching PA schedule row — no schedule was provided at all.",
        severity: "Warning",
        blocksCalculation: "No",
        blocksScope: "none",
        outcome: "fail",
      }),
    ];
  }
  if (!p.scheduleRowExists) {
    return [
      buildFinding({
        ruleId: "C-01",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["PA_AMB"],
        actual: `PA_AMB = ${formatMoneyMinor(p.paAmb)}; a schedule exists but lacks this participant.`,
        expected: "Every census PA_AMB traces to a schedule row/cell/page.",
        discrepancy: "Census PA_AMB has no matching PA schedule row — the schedule exists but lacks the participant.",
        outcome: "fail",
      }),
    ];
  }
  return [];
}

function ruleC02(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("C-02", p, ctx, ["PA_AMB"]);
  if (p.paAmb === null || p.schedulePaAmb === null) {
    return [
      naFinding("C-02", p.participantKey, ctx, "No schedule PA_AMB to compare — equality is checked by C-02 only when both values exist (absence is C-01's territory).", ["PA_AMB"]),
    ];
  }
  // Stage 7 Robustness D2: a wrong-typed PA_AMB must surface here as a
  // finding, not as a throw swallowed into a not-run. S-08 already
  // fails the type error; C-02 records that it cannot compare the
  // values instead of throwing inside formatMoneyMinor.
  if (
    typeof p.paAmb !== "number" ||
    !Number.isInteger(p.paAmb) ||
    typeof p.schedulePaAmb !== "number" ||
    !Number.isInteger(p.schedulePaAmb)
  ) {
    return [
      buildFinding({
        ruleId: "C-02",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: ["PA_AMB"],
        actual: `Census PA_AMB = ${JSON.stringify(p.paAmb)} (type ${typeof p.paAmb}); schedule PA_AMB = ${JSON.stringify(p.schedulePaAmb)} (type ${typeof p.schedulePaAmb}).`,
        expected: "Equal (exact decimal equality; no tolerance on a transcription comparison), or the difference is explained.",
        discrepancy: "Census PA_AMB and schedule PA_AMB cannot be compared: one is not an integer number of minor units. See S-08 for the type error.",
        outcome: "fail",
      }),
    ];
  }
  if (p.paAmb === p.schedulePaAmb || p.scheduleExplanationDocumented) return [];
  return [
    buildFinding({
      ruleId: "C-02",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB"],
      actual: `Census PA_AMB = ${formatMoneyMinor(p.paAmb)}; schedule PA_AMB = ${formatMoneyMinor(p.schedulePaAmb)}; difference = ${formatMoneyMinor(p.paAmb - p.schedulePaAmb)}.`,
      expected: "Equal (exact decimal equality; no tolerance on a transcription comparison), or the difference is explained.",
      discrepancy: `Census PA_AMB ≠ schedule PA_AMB by ${formatMoneyMinor(Math.abs(p.paAmb - p.schedulePaAmb))}, unexplained.`,
      outcome: "fail",
    }),
  ];
}

function ruleC03(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("C-03", p, ctx, ["PA_AMB"]);
  if (p.bcvComparison === null) {
    return [
      naFinding("C-03", p.participantKey, ctx, "No BCV-benefit comparison attempted — this rule fires on the comparison, not on the data.", ["PA_AMB"]),
    ];
  }
  if (p.bcvComparison.basis === "dote" || p.bcvComparison.conversionApplied) return [];
  return [
    buildFinding({
      ruleId: "C-03",
      participantKey: p.participantKey,
      ctx,
      bcvPredicateId: null,
      bcvPredicateType: null,
      ruleSource: "OFFICIAL_REFERENCE_ONLY",
      fieldsExamined: ["PA_AMB", "XRD_MB_TERM", "TERM_MB_ERD_NSF", "TERM_MB_EURD_NSF", "TERM_MB_NRD_NSF", "AMB"],
      actual: `PA_AMB compared directly to a BCV-calculated benefit at ${p.bcvComparison.basis.toUpperCase()} with no basis conversion.`,
      expected: "BCV-calculated benefits are used only as cross-checks after conversion to the PA_AMB basis (DOTE, same form, same vesting treatment).",
      discrepancy: "PA_AMB compared to a different-basis BCV benefit without conversion — a category error, not a discrepancy.",
      outcome: "fail",
    }),
  ];
}

function ruleC04(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("C-04", p, ctx, ["PA_AMB", "PAY_AMT1", "PAY_AMT2", "DOR"]);
  if (p.retstat !== "1" || p.dor === null) return [];
  if (!p.ardFactorsPresent || !usableTolerance(ctx.tolerance)) {
    return [
      naFinding("C-04", p.participantKey, ctx, "ARD factors or the case tolerance record (M-7) missing — the engine refuses to compare without them.", ["PA_AMB", "PAY_AMT1", "PAY_AMT2", "DOR"]),
    ];
  }
  if (p.paymentAmountMinor === null || p.convertedPaAmbMinor === null) {
    return [
      naFinding("C-04", p.participantKey, ctx, "No payment amount (or no converted PA_AMB) in the case file for this participant.", ["PA_AMB", "PAY_AMT1", "PAY_AMT2", "DOR"]),
    ];
  }
  const tol = ctx.tolerance as ToleranceRecord;
  const delta = p.paymentAmountMinor - p.convertedPaAmbMinor;
  if (withinTolerance(delta, p.convertedPaAmbMinor, tol)) return [];
  return [
    buildFinding({
      ruleId: "C-04",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB", "PAY_AMT1", "PAY_AMT2", "DOR"],
      actual: `Payment = ${formatMoneyMinor(p.paymentAmountMinor)}; PA_AMB converted to ARD = ${formatMoneyMinor(p.convertedPaAmbMinor)}; difference = ${formatMoneyMinor(delta)}.`,
      expected: "Payment = PA_AMB converted to the ARD form/date within the case tolerance, or the difference is explained.",
      discrepancy: `Payment differs from converted PA_AMB by ${formatMoneyMinor(Math.abs(delta))}, more than the case tolerance.`,
      outcome: "fail",
    }),
  ];
}

function ruleC05(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("C-05", p, ctx, ["PA_AMB", "LS_EST_AMT", "PARTIAL_DIST_AMT", "MANDCWI"]);
  const d = p.priorDistribution;
  if (d === null || !d.exists) return [];
  const findings: Finding[] = [];
  const fields = ["PA_AMB", "LS_EST_AMT", "PARTIAL_DIST_AMT", "MANDCWI"];
  if (!d.reflectedInPaAmb && !d.documentedAsNotAffecting) {
    findings.push(
      buildFinding({
        ruleId: "C-05",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual: "Prior lump-sum / partial distribution exists but PA_AMB shows no offset/reduction for it.",
        expected: "Distributions are reflected in the accrued benefit or explicitly documented as not affecting it.",
        discrepancy: "Prior distribution not reflected in PA_AMB.",
        outcome: "fail",
        resultKey: "unreflected",
      }),
    );
  }
  if (d.inCensus !== d.inSchedule) {
    findings.push(
      buildFinding({
        ruleId: "C-05",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual: `Distribution recorded in ${d.inCensus ? "census" : "schedule"} but not in ${d.inCensus ? "schedule" : "census"}.`,
        expected: "A distribution present in one source is present in the other, or the absence is explained.",
        discrepancy: "Distribution recorded in one source but not the other.",
        outcome: "fail",
        resultKey: "source-mismatch",
      }),
    );
  }
  return findings;
}

function ruleC06(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("C-06", p, ctx, ["PA_AMB"]);
  if (!usableTolerance(ctx.tolerance)) {
    return [
      naFinding("C-06", p.participantKey, ctx, "No case tolerance record (M-7) — the engine refuses to compare without a recorded tolerance.", ["PA_AMB"]),
    ];
  }
  if (p.formulaCheckValuesMinor === null) {
    return [
      naFinding("C-06", p.participantKey, ctx, "No identified governing formula version — a completeness failure (grade Insufficient), not a C-06 firing.", ["PA_AMB"]),
    ];
  }
  if (p.paAmb === null) {
    return [
      naFinding("C-06", p.participantKey, ctx, "PA_AMB missing — nothing to check against the governing formula versions.", ["PA_AMB"]),
    ];
  }
  if (p.documentedHypothesis) return [];
  const tol = ctx.tolerance as ToleranceRecord;
  const within = p.formulaCheckValuesMinor.some((v) =>
    withinTolerance((p.paAmb as number) - v, v, tol),
  );
  if (within) return [];
  return [
    buildFinding({
      ruleId: "C-06",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB"],
      actual: `PA_AMB = ${formatMoneyMinor(p.paAmb)}; applicable formula version(s) produce ${p.formulaCheckValuesMinor.map(formatMoneyMinor).join(", ")} — none within the case tolerance.`,
      expected: "At least one applicable formula version produces a benefit in the neighbourhood of PA_AMB (within the case tolerance, or explainable by a documented hypothesis).",
      discrepancy: "PA_AMB cannot be produced by any governing formula version within tolerance, and no documented hypothesis explains the difference.",
      outcome: "fail",
    }),
  ];
}

function ruleC07(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("C-07", p, ctx, ["PA_AMB", "ERF_ARD", "BFCF_ARD"]);
  if (p.pfFactors === null) {
    return [
      naFinding("C-07", p.participantKey, ctx, "No PF generator output for the case — the factor comparison cannot run.", ["PA_AMB", "ERF_ARD", "BFCF_ARD"]),
    ];
  }
  if (decCompare(p.pfFactors.paFactor, p.pfFactors.pfFactor) === 0) return [];
  if (p.pfFactors.differenceDocumented) return [];
  return [
    buildFinding({
      ruleId: "C-07",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB", "ERF_ARD", "BFCF_ARD"],
      actual: `PA factor = ${p.pfFactors.paFactor}; PF factor = ${p.pfFactors.pfFactor}; era = ${p.pfFactors.era}; form = ${p.pfFactors.form}.`,
      expected: "Agreement, or a documented difference (different mortality/interest basis, different era).",
      discrepancy: `PA's ARD conversion factors disagree with the PF generator's factors for era ${p.pfFactors.era}, form ${p.pfFactors.form}.`,
      outcome: "fail",
    }),
  ];
}

function ruleC08(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  if (p.retstat === "5") return retstat5Na("C-08", p, ctx, ["PA_AMB"]);
  if (p.proposedDisposition !== "correction-recommended") return [];
  if (p.evidenceCount > 0) return [];
  return [
    buildFinding({
      ruleId: "C-08",
      participantKey: p.participantKey,
      ctx,
      fieldsExamined: ["PA_AMB"],
      actual: "Correction (disposition correction-recommended) proposed with an empty evidence list.",
      expected: "Correction-recommended requires the reviewer to be reasonably certain an error occurred — a difference plus a documented cause, not a difference alone.",
      discrepancy: "Correction proposed on a numerical difference alone, with no documentary evidence of an error.",
      outcome: "fail",
    }),
  ];
}

function ruleC09(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  // Decision-level rule: applies regardless of RETSTAT (including 5).
  if (p.paAmbAccept === null) return [];
  const findings: Finding[] = [];
  const fields = ["PA_AMB_ACCEPT"];
  const fail = (actual: string, discrepancy: string, resultKey = "rule"): void => {
    findings.push(
      buildFinding({
        ruleId: "C-09",
        participantKey: p.participantKey,
        ctx,
        fieldsExamined: fields,
        actual,
        expected: "PA_AMB_ACCEPT is set only by a recorded human decision, and is consistent with it: Y ⟺ verified / supported-for-acceptance; N ⟺ correction-recommended / indeterminate-with-rejection.",
        discrepancy,
        outcome: "fail",
        resultKey,
      }),
    );
  };
  if (p.paAmbAccept === "Y" && !p.decisionExists) {
    fail("PA_AMB_ACCEPT = Y with no ActuarialDecision on file.", "PA_AMB_ACCEPT = Y with no decision on file.");
  }
  if (
    p.paAmbAccept === "Y" &&
    p.disposition !== null &&
    ["requires-investigation", "indeterminate"].includes(p.disposition)
  ) {
    fail(`PA_AMB_ACCEPT = Y while disposition = ${p.disposition}.`, `PA_AMB_ACCEPT = Y while disposition is ${p.disposition}.`);
  }
  if (p.paAmbAccept === "Y" && p.disposition === "correction-recommended") {
    fail("PA_AMB_ACCEPT = Y while disposition = correction-recommended.", "PA_AMB_ACCEPT = Y while disposition is correction-recommended (consistency rule: Y ⟺ verified / supported-for-acceptance).");
  }
  if (p.paAmbAccept === "N" && p.disposition === "verified") {
    fail("PA_AMB_ACCEPT = N while disposition = verified.", "PA_AMB_ACCEPT = N while disposition is verified.");
  }
  if (
    p.paAmbAccept === "N" &&
    p.disposition === "indeterminate" &&
    !p.rejectionRationaleStated
  ) {
    fail("PA_AMB_ACCEPT = N with disposition = indeterminate and no rejection rationale stated.", "PA_AMB_ACCEPT = N with an indeterminate disposition requires the rationale to state a rejection.");
  }
  return findings;
}

function ruleC10(p: ValidationParticipant, ctx: NormalizedContext): Finding[] {
  // Decision-level rule: applies regardless of RETSTAT (including 5).
  const findings: Finding[] = [];
  for (const s of p.sourcesUsed) {
    if (
      (s.reliabilityGrade === "unassessed" || s.reliabilityGrade === "low") &&
      !s.limitationNoted
    ) {
      findings.push(
        buildFinding({
          ruleId: "C-10",
          participantKey: p.participantKey,
          ctx,
          fieldsExamined: ["APP.reliabilityGrade"],
          actual: `Source document ${s.documentId} (grade ${s.reliabilityGrade}) used in a calculation/decision with no note of the limitation.`,
          expected: "Every source used in a decision carries a reliability grade; low sources are corroborated by a second source or the limitation is stated in the decision.",
          discrepancy: `Source ${s.documentId} used while its reliability grade is ${s.reliabilityGrade}, with no limitation noted.`,
          outcome: "fail",
          resultKey: s.documentId,
        }),
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const RULE_FNS: Record<RuleId, RuleFn> = {
  "S-01": ruleS01, "S-02": ruleS02, "S-03": ruleS03, "S-04": ruleS04,
  "S-05": ruleS05, "S-06": ruleS06, "S-07": ruleS07, "S-08": ruleS08,
  "S-09": ruleS09, "S-10": ruleS10, "S-11": ruleS11, "S-12": ruleS12,
  "P-01": ruleP01, "P-02": ruleP02, "P-03": ruleP03, "P-04": ruleP04,
  "P-05": ruleP05, "P-06": ruleP06, "P-07": ruleP07, "P-08": ruleP08,
  "P-09": ruleP09, "P-10": ruleP10, "P-11": ruleP11, "P-12": ruleP12,
  "P-13": ruleP13, "P-14": ruleP14, "P-15": ruleP15, "P-16": ruleP16,
  "X-01": ruleX01, "X-02": ruleX02, "X-03": ruleX03, "X-04": ruleX04,
  "X-05": ruleX05, "X-06": ruleX06, "X-07": ruleX07, "X-08": ruleX08,
  "X-09": ruleX09, "X-10": ruleX10, "X-11": ruleX11, "X-12": ruleX12,
  "X-13": ruleX13, "X-14": ruleX14,
  "M-01": ruleM01, "M-02": ruleM02, "M-03": ruleM03, "M-04": ruleM04,
  "M-05": ruleM05, "M-06": ruleM06,
  "L-01": ruleL01, "L-02": ruleL02, "L-03": ruleL03, "L-04": ruleL04,
  "L-05": ruleL05, "L-06": ruleL06, "L-07": ruleL07, "L-08": ruleL08,
  "C-01": ruleC01, "C-02": ruleC02, "C-03": ruleC03, "C-04": ruleC04,
  "C-05": ruleC05, "C-06": ruleC06, "C-07": ruleC07, "C-08": ruleC08,
  "C-09": ruleC09, "C-10": ruleC10,
};

/** Layers for quarantine: everything except the structural layer. */
const NON_STRUCTURAL_LAYERS: ReadonlySet<string> = new Set([
  "P", "X", "M", "L", "C",
]);

function layerOf(ruleId: RuleId): string {
  return ruleId.slice(0, 1);
}

/**
 * Evaluate all 66 rules for one participant, in catalog order
 * (S → P → X → M → L → C, ID order within a layer). Findings accumulate —
 * no rule short-circuits another. File-scope rules (S-01, S-03, S-11) and
 * cross-record rules (P-01, P-16, L-01) record `not-applicable` here with
 * the reason; they are evaluated for real by validateCasePackage.
 *
 * A rule function that throws (malformed caller input, e.g. a non-decimal
 * service string) records a `not-run` finding naming the throw, so one bad
 * input cannot kill the run. The throw is an input-contract violation, not
 * a data finding.
 */
export function validateParticipant(
  p: ValidationParticipant,
  ctxInput: ValidationContext,
): RuleEvaluation[] {
  const ctx = normalizeContext(ctxInput);
  const evaluations: RuleEvaluation[] = [];
  for (const ruleId of RULE_ORDER) {
    const fn = RULE_FNS[ruleId];
    let findings: Finding[];
    try {
      findings = fn(p, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Stage 7 Robustness D2: a rule that throws on an input-contract
      // violation is an Error, not a silent Info. The throw means the
      // record cannot be evaluated as supplied; S-07/S-08 name the
      // offending field, and this finding names the rule that could not
      // run because of it. The outcome stays not-run (the rule did not
      // evaluate), but it is no longer invisible.
      findings = [
        buildFinding({
          ruleId,
          participantKey: p.participantKey,
          ctx,
          fieldsExamined: [],
          actual: `Rule evaluation threw: ${message}`,
          expected: "Rule evaluated for this record/run.",
          discrepancy: `Not run: rule evaluation threw (${message}) — input-contract violation; fix the caller input and re-run. See S-07/S-08 for the offending field.`,
          severity: "Error",
          blocksCalculation: "Exact-only",
          blocksScope: "exact-calculation",
          dispositionRoute: "Not run — fix the caller input and re-run.",
          outcome: "not-run",
        }),
      ];
    }
    evaluations.push(evaluation(ruleId, findings));
  }
  return evaluations;
}

// --- File-scope evaluations (S-01, S-03, S-11) ---------------------------

function evaluateFileRules(ctx: NormalizedContext): RuleEvaluation[] {
  const out: RuleEvaluation[] = [];
  // S-01 — file unreadable, truncated, or hash mismatch.
  const s01: Finding[] = [];
  if (!ctx.file.openable || ctx.file.truncated || !ctx.file.hashMatches) {
    s01.push(
      buildFinding({
        ruleId: "S-01",
        participantKey: null,
        ctx,
        fieldsExamined: [],
        actual: `File openable=${ctx.file.openable}, truncated=${ctx.file.truncated}, hash matches import record=${ctx.file.hashMatches}.`,
        expected: "File opens; hash matches the import record.",
        discrepancy: !ctx.file.openable
          ? "File unreadable."
          : ctx.file.truncated
            ? "File truncated."
            : "File hash does not match the import record.",
        outcome: "fail",
      }),
    );
  }
  out.push(evaluation("S-01", s01));
  // S-03 — unknown field name (one finding per unknown name).
  const s03 = ctx.file.unknownFields.map((name) =>
    buildFinding({
      ruleId: "S-03",
      participantKey: null,
      ctx,
      fieldsExamined: [name],
      actual: `Unknown field name ${JSON.stringify(name)}.`,
      expected: "Every field name resolves to a dictionary field or a declared app field.",
      discrepancy: `Unknown field name ${JSON.stringify(name)} — retained in _unmapped, never dropped.`,
      outcome: "fail",
      resultKey: name,
    }),
  );
  out.push(evaluation("S-03", s03));
  // S-11 — XLSM hash changed or macro ran.
  const s11: Finding[] = [];
  const hashChanged =
    ctx.file.hashBefore !== null &&
    ctx.file.hashAfter !== null &&
    ctx.file.hashBefore !== ctx.file.hashAfter;
  if (ctx.file.macroRan || hashChanged) {
    s11.push(
      buildFinding({
        ruleId: "S-11",
        participantKey: null,
        ctx,
        fieldsExamined: [],
        actual: `Macro ran=${ctx.file.macroRan}; hash before=${ctx.file.hashBefore ?? "unknown"}; hash after=${ctx.file.hashAfter ?? "unknown"}.`,
        expected: "Hash identical; macros neither executed nor modified.",
        discrepancy: ctx.file.macroRan
          ? "A macro ran during import."
          : "XLSM hash changed during import.",
        outcome: "fail",
      }),
    );
  }
  out.push(evaluation("S-11", s11));
  return out;
}

// --- Population / cross-record evaluations ---------------------------------

function evaluatePopulationRules(
  participants: ValidationParticipant[],
  ctx: NormalizedContext,
): RuleEvaluation[] {
  const out: RuleEvaluation[] = [];

  // S-06 — CASE inconsistent within one file (one file = one case).
  const cases = new Set(
    participants.map((p) => p.caseNumber).filter((c): c is string => c !== null),
  );
  const s06: Finding[] = [];
  if (cases.size > 1) {
    s06.push(
      buildFinding({
        ruleId: "S-06",
        participantKey: null,
        ctx,
        fieldsExamined: ["CASE"],
        actual: `CASE differs between records within one file: ${[...cases].join(", ")}.`,
        expected: "One file = one case; CASE identical on every record.",
        discrepancy: `CASE inconsistent within one file: ${[...cases].join(", ")}.`,
        outcome: "fail",
      }),
    );
  }
  out.push(evaluation("S-06", s06));

  // S-05(b) — participantKey collision.
  const byKey = new Map<string, ValidationParticipant[]>();
  for (const p of participants) {
    const list = byKey.get(p.participantKey) ?? [];
    list.push(p);
    byKey.set(p.participantKey, list);
  }
  const s05b: Finding[] = [];
  for (const [key, list] of byKey) {
    if (list.length > 1) {
      s05b.push(
        buildFinding({
          ruleId: "S-05",
          participantKey: key,
          ctx,
          fieldsExamined: ["APP.participantKey"],
          actual: `${list.length} records share participantKey ${key}.`,
          expected: "participantKey unique.",
          discrepancy: `participantKey collision: ${list.length} records share ${key}.`,
          outcome: "fail",
          resultKey: key,
        }),
      );
    }
  }
  out.push(evaluation("S-05", s05b));

  // P-01 — duplicate BCV_REC_ID within one load; one participantKey with
  // two different SSN/DOB pairs.
  const p01: Finding[] = [];
  const byRecId = new Map<number, ValidationParticipant[]>();
  for (const p of participants) {
    if (p.bcvRecId === null) continue;
    const list = byRecId.get(p.bcvRecId) ?? [];
    list.push(p);
    byRecId.set(p.bcvRecId, list);
  }
  for (const [recId, list] of byRecId) {
    if (list.length > 1) {
      p01.push(
        buildFinding({
          ruleId: "P-01",
          participantKey: (list[0] as ValidationParticipant).participantKey,
          ctx,
          fieldsExamined: ["BCV_REC_ID", "APP.participantKey"],
          actual: `BCV_REC_ID ${recId} appears ${list.length} times in one load.`,
          expected: "One record per participant per load; identity stable.",
          discrepancy: `Duplicate BCV_REC_ID ${recId} within one load.`,
          outcome: "fail",
          resultKey: `rec-${recId}`,
        }),
      );
    }
  }
  for (const [key, list] of byKey) {
    const identities = new Set(list.map((p) => `${p.ssn ?? ""}|${p.dob ?? ""}`));
    if (list.length > 1 && identities.size > 1) {
      p01.push(
        buildFinding({
          ruleId: "P-01",
          participantKey: key,
          ctx,
          fieldsExamined: ["BCV_REC_ID", "APP.participantKey"],
          actual: `participantKey ${key} carries ${identities.size} different SSN/DOB pairs.`,
          expected: "One record per participant per load; identity stable.",
          discrepancy: `One participantKey with two different SSN/DOB pairs (${key}).`,
          outcome: "fail",
          resultKey: `key-${key}`,
        }),
      );
    }
  }
  out.push(evaluation("P-01", p01));

  // P-16 — conflicting identity across records (possible duplicate person).
  // ID=2/4 records linked by family are not duplicates under this rule.
  // Stage 7 Benchmarks defect 1: the old nested pairwise loop over all
  // ID=1 records was O(n²) (4.3 s @10k, 38.7 s @30k, 211 s @100k in the
  // browser). It is now indexed: group by SSN and by name+DOB with
  // Maps, and compare only within a group. A conflict is a property of
  // a record against its group, so one finding is emitted per
  // conflicting record (naming the first conflicting counterpart),
  // which preserves the rule's meaning — every conflicting record is
  // flagged — without the quadratic pair scan. Groups are small in
  // practice; a group is compared pairwise only when it is small
  // enough that the pair scan is cheaper than the bookkeeping.
  const p16: Finding[] = [];
  const people = participants.filter((p) => p.idType === "1");
  const bySsn = new Map<string, ValidationParticipant[]>();
  const byNameDob = new Map<string, ValidationParticipant[]>();
  for (const p of people) {
    if (p.ssn !== null) {
      const list = bySsn.get(p.ssn) ?? [];
      list.push(p);
      bySsn.set(p.ssn, list);
    }
    if (p.firstName !== null && p.lastName !== null && p.dob !== null) {
      const key = `${p.firstName}|${p.lastName}|${p.dob}`;
      const list = byNameDob.get(key) ?? [];
      list.push(p);
      byNameDob.set(key, list);
    }
  }
  const p16Seen = new Set<string>();
  const p16Fail = (
    a: ValidationParticipant,
    b: ValidationParticipant,
    ssnConflict: boolean,
  ): void => {
    const resultKey = `${a.participantKey}-${b.participantKey}`;
    if (p16Seen.has(resultKey)) return;
    p16Seen.add(resultKey);
    p16.push(
      buildFinding({
        ruleId: "P-16",
        participantKey: a.participantKey,
        ctx,
        fieldsExamined: ["SSN", "DOB", "FNAME", "LNAME", "DOH"],
        actual: `${a.participantKey} (SSN ${a.ssn ?? "blank"}, DOB ${a.dob ?? "blank"}) vs ${b.participantKey} (SSN ${b.ssn ?? "blank"}, DOB ${b.dob ?? "blank"}).`,
        expected: "One person, one record (plus separate ID=2/4 records linked by family, not duplicated as participants).",
        discrepancy: ssnConflict
          ? "Two records share SSN but differ in DOB/name."
          : "Two records share name + DOB but differ in SSN.",
        outcome: "fail",
        resultKey,
      }),
    );
  };
  // Same SSN, different DOB/name. Sub-group by identity; a member
  // conflicts when another identity sub-group exists, and the finding
  // names that sub-group's first member. Fully linear in group size.
  for (const group of bySsn.values()) {
    if (group.length < 2) continue;
    const byIdentity = new Map<string, ValidationParticipant[]>();
    for (const p of group) {
      const key = `${p.dob ?? ""}|${p.firstName ?? ""}|${p.lastName ?? ""}`;
      const list = byIdentity.get(key) ?? [];
      list.push(p);
      byIdentity.set(key, list);
    }
    if (byIdentity.size < 2) continue;
    const identityGroups = [...byIdentity.values()];
    for (let g = 0; g < identityGroups.length; g += 1) {
      const others = identityGroups[(g + 1) % identityGroups.length] as ValidationParticipant[];
      const other = others[0] as ValidationParticipant;
      for (const a of identityGroups[g] as ValidationParticipant[]) {
        p16Fail(a, other, true);
      }
    }
  }
  // Same name + DOB, different SSN. Sub-group by SSN; a member
  // conflicts when another SSN sub-group exists. Fully linear.
  for (const group of byNameDob.values()) {
    if (group.length < 2) continue;
    const bySsnInGroup = new Map<string, ValidationParticipant[]>();
    for (const p of group) {
      const key = p.ssn ?? "";
      const list = bySsnInGroup.get(key) ?? [];
      list.push(p);
      bySsnInGroup.set(key, list);
    }
    if (bySsnInGroup.size < 2) continue;
    const ssnGroups = [...bySsnInGroup.values()];
    for (let g = 0; g < ssnGroups.length; g += 1) {
      const others = ssnGroups[(g + 1) % ssnGroups.length] as ValidationParticipant[];
      const other = others[0] as ValidationParticipant;
      for (const a of ssnGroups[g] as ValidationParticipant[]) {
        p16Fail(a, other, false);
      }
    }
  }
  out.push(evaluation("P-16", p16));

  // L-01 — population reconciliation between extracts.
  const l01: Finding[] = [];
  if (ctx.priorExtract === null) {
    l01.push(
      naFinding("L-01", null, ctx, "No prior extract in the case file — the population reconciliation has not been performed.", []),
    );
  } else {
    const closingActives = participants.filter((p) => p.retstat === "3").length;
    const openingActives = ctx.priorExtract.statusCounts["3"] ?? 0;
    const m = ctx.priorExtract.movements;
    const expected =
      openingActives + m.newParticipants - m.terminations - m.deaths - m.disabilities - m.retirees;
    if (closingActives !== expected && !ctx.priorExtract.movementsExplained) {
      l01.push(
        buildFinding({
          ruleId: "L-01",
          participantKey: null,
          ctx,
          fieldsExamined: [],
          actual: `Closing actives = ${closingActives}; opening actives = ${openingActives}; new = ${m.newParticipants}; terminations = ${m.terminations}; deaths = ${m.deaths}; disabilities = ${m.disabilities}; retirees = ${m.retirees}; expected closing = ${expected}.`,
          expected: "Full reconciliation with every movement accounted for.",
          discrepancy: `Population does not reconcile: closing actives ${closingActives} ≠ expected ${expected}; unexplained difference ${closingActives - expected}.`,
          outcome: "fail",
        }),
      );
    }
  }
  out.push(evaluation("L-01", l01));

  // L-02 — disappearance / duplicate-keys legs (population scope).
  const l02: Finding[] = [];
  if (ctx.priorExtract === null) {
    l02.push(
      naFinding("L-02", null, ctx, "No prior extract in the case file.", []),
    );
  } else {
    for (const key of ctx.priorExtract.missingMovementKeys) {
      l02.push(
        buildFinding({
          ruleId: "L-02",
          participantKey: key,
          ctx,
          fieldsExamined: ["SSN", "DOB"],
          actual: `Participant ${key} appears in the prior extract but not the current one, with no movement record.`,
          expected: "Every disappearance has a movement (termination, death, retirement, exclusion with reason).",
          discrepancy: `Participant ${key} disappears across extracts with no movement record.`,
          outcome: "fail",
          resultKey: key,
        }),
      );
    }
    for (const key of ctx.priorExtract.duplicateKeys) {
      l02.push(
        buildFinding({
          ruleId: "L-02",
          participantKey: key,
          ctx,
          fieldsExamined: ["SSN", "DOB"],
          actual: `Participant ${key} appears twice across extracts with different keys.`,
          expected: "Identity is stable across extracts.",
          discrepancy: `Participant ${key} appears twice across extracts with different keys.`,
          outcome: "fail",
          resultKey: `dup-${key}`,
        }),
      );
    }
  }
  out.push(evaluation("L-02", l02));

  return out;
}

/**
 * Validate a whole case package: file-scope rules, every participant
 * (evaluation order S → P → X → M → L → C), and the population /
 * cross-record rules. Findings accumulate; the only short-circuit is
 * quarantine (catalog §3.1):
 * - S-01 or S-11 fails → the file is not loaded; every rule for every
 *   record in that file is `not-run`.
 * - S-04 or S-05 fails for a record (or its participantKey collides) →
 *   no P/X/M/L/C rule is evaluated for that record (`not-run`).
 * Quarantined records still appear in every report — they are never
 * omitted from counts or denominators.
 */
export function validateCasePackage(
  participants: ValidationParticipant[],
  ctxInput: ValidationContext,
): CaseValidationResult {
  const ctx = normalizeContext(ctxInput);
  const fileEvaluations = evaluateFileRules(ctx);
  const fileQuarantined = fileEvaluations.some(
    (e) => (e.ruleId === "S-01" || e.ruleId === "S-11") && e.outcome === "fail",
  );
  const quarantiningFileRule = fileEvaluations.find(
    (e) => (e.ruleId === "S-01" || e.ruleId === "S-11") && e.outcome === "fail",
  )?.ruleId;

  const participantResults: CaseValidationResult["participantResults"] = [];
  let populationEvaluations: RuleEvaluation[] = [];

  if (fileQuarantined) {
    // The file is not loaded: every rule for every record is not-run.
    for (const p of participants) {
      const evaluations = RULE_ORDER.map((ruleId) => ({
        ruleId,
        outcome: "not-run" as RuleOutcomeKind,
        findings: [
          notRunFinding(ruleId, p.participantKey, ctx, quarantiningFileRule as string),
        ],
      }));
      participantResults.push({ participantKey: p.participantKey, evaluations });
    }
    populationEvaluations = ["S-06", "S-05", "P-01", "P-16", "L-01", "L-02"].map(
      (ruleId) => ({
        ruleId: ruleId as RuleId,
        outcome: "not-run" as RuleOutcomeKind,
        findings: [notRunFinding(ruleId as RuleId, null, ctx, quarantiningFileRule as string)],
      }),
    );
  } else {
    populationEvaluations = evaluatePopulationRules(participants, ctx);

    // Colliding keys quarantine their records (S-05 leg b).
    const collidingKeys = new Set(
      populationEvaluations
        .filter((e) => e.ruleId === "S-05")
        .flatMap((e) => e.findings)
        .map((f) => f.participantKey as string),
    );

    for (const p of participants) {
      const evaluations = validateParticipant(p, ctxInput);
      const s04 = evaluations.find((e) => e.ruleId === "S-04");
      const s05 = evaluations.find((e) => e.ruleId === "S-05");
      const quarantined =
        s04?.outcome === "fail" ||
        s05?.outcome === "fail" ||
        collidingKeys.has(p.participantKey);
      const quarantinedBy = s04?.outcome === "fail"
        ? "S-04"
        : s05?.outcome === "fail"
          ? "S-05"
          : collidingKeys.has(p.participantKey)
            ? "S-05 (participantKey collision)"
            : null;
      if (quarantined && quarantinedBy !== null) {
        for (const e of evaluations) {
          if (NON_STRUCTURAL_LAYERS.has(layerOf(e.ruleId))) {
            e.outcome = "not-run";
            e.findings = [notRunFinding(e.ruleId, p.participantKey, ctx, quarantinedBy)];
          }
        }
      }
      participantResults.push({ participantKey: p.participantKey, evaluations });
    }
  }

  // allFindings in evaluation order: file, participants, population.
  const ordered: Finding[] = [];
  for (const e of fileEvaluations) ordered.push(...e.findings);
  for (const r of participantResults) {
    for (const e of r.evaluations) ordered.push(...e.findings);
  }
  for (const e of populationEvaluations) ordered.push(...e.findings);

  const summary = { rulesEvaluated: 0, pass: 0, fail: 0, notApplicable: 0, notRun: 0 };
  const count = (e: RuleEvaluation): void => {
    summary.rulesEvaluated += 1;
    if (e.outcome === "pass") summary.pass += 1;
    else if (e.outcome === "fail") summary.fail += 1;
    else if (e.outcome === "not-applicable") summary.notApplicable += 1;
    else summary.notRun += 1;
  };
  for (const e of fileEvaluations) count(e);
  for (const r of participantResults) for (const e of r.evaluations) count(e);
  for (const e of populationEvaluations) count(e);

  return {
    fileEvaluations,
    participantResults,
    populationEvaluations,
    allFindings: ordered,
    summary,
  };
}
