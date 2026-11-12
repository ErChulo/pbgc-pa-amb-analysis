/**
 * Public entry point for the deterministic actuarial engine core.
 *
 * Stage 4 foundation (Wave 1): canonical types, decimal-safe arithmetic,
 * and the immutable case-package model. The validation, dates, engine,
 * and decisions workers build on this.
 *
 * Stage 5 (reconciliation and statistical engine): the comparison engine
 * (reconcile), statistics (statistics), missing-data framework
 * (missingdata), disposition mapping (dispositionMapping), the
 * reconcile→map disposition seam (dispositionEvidence), and Stage 5
 * publication through the Stage 4.5 contribution protocol
 * (reconciliationFindings).
 *
 * Stage 6 (UI core, Worker A): the remaining Stage 4 engine modules are
 * re-exported here. Stage 7: `rounding.ts` (rounding sequences) and
 * `accrualTests.ts` (3% / 133⅓% / fractional statutory tests) are also
 * re-exported here — they were missed in Stage 6 and are now covered.
 * Name collisions are aliased, never renamed in the
 * engine modules themselves:
 * - `validation.ts` has a `Finding` type (rule-check record) distinct
 *   from `contribution.ts`'s `Finding` (spec §7.2 publishable finding).
 *   The contribution `Finding` keeps the plain name; the validation one
 *   is exported as `ValidationFinding`.
 * - `validation.ts` and `dates.ts` both export `addMonths`. The
 *   `dates.ts` primitive keeps the plain name; the validation helper is
 *   exported as `validationAddMonths`. Both clamp the day; they are
 *   separate implementations in separate modules, neither renamed.
 * - `pipeline.ts` re-exports `daysBetween` from `dates.ts`; the
 *   `dates.ts` export keeps the plain name and the pipeline re-export
 *   is not repeated here.
 * - `compose.ts` re-exports `decAdd` / `decDivide` / `decMultiply` /
 *   `decSubtract` from `decimal.ts`; the `decimal.ts` exports keep the
 *   plain names and the compose re-exports are not repeated here.
 * - `publication.ts` is already re-exported through `contribution.ts`
 *   (`export * from "./publication"` there); it is not repeated here,
 *   because repeating it would re-export the same names a second time.
 * - `dispositionEvidence.ts` was already exported before Stage 6; it is
 *   kept as-is.
 */

export * from "./types";
export * from "./decimal";
export * from "./model";
export * from "./contribution";
export * from "./reconcile";
export * from "./statistics";
export * from "./missingdata";
export * from "./dispositionMapping";
export * from "./reconciliationFindings";
export * from "./dispositionEvidence";
export * from "./dates";
export * from "./decisions";
export * from "./reconciliation";
export * from "./bounds";
export * from "./formulas";
export * from "./service";
export * from "./determination";
export * from "./rounding";
export * from "./accrualTests";

/**
 * Validation-rule catalog (Stage 4, Wave 2). Every export except the two
 * aliased below. `Finding` here is the rule-check record
 * (validation.ts); the spec §7.2 publishable `Finding` is the one from
 * `contribution.ts` exported above.
 */
export {
  BadDateInput,
  BadNumberInput,
  BcvBenefitBasis,
  BcvComparisonInput,
  BlocksCalculation,
  BlocksScope,
  CaseValidationResult,
  FileContextInput,
  IdType,
  IntegrationMethod,
  PriorDistributionInput,
  PriorExtractInput,
  PriorExtractParticipantInput,
  RuleEvaluation,
  RuleId,
  RuleOutcomeKind,
  RuleSource,
  SalaryYearInput,
  ServiceUnit,
  SexCode,
  SourceUsedInput,
  ValidationContext,
  ValidationParticipant,
  ValidationSeverity,
  VestingTreatmentInput,
  CATALOG_VERSION,
  POLICY_5_8_1_REFERENCE,
  RULE_ORDER,
  Retstat,
  elapsedMonths,
  formatMoneyMinor,
  validateCasePackage,
  validateParticipant,
  withinTolerance,
} from "./validation";
export { Finding as ValidationFinding } from "./validation";
export { addMonths as validationAddMonths } from "./validation";

/**
 * Ten-stage deterministic calculation pipeline (Stage 4, Wave 2).
 * Every export except `daysBetween`, which is the `dates.ts` primitive
 * re-exported by the pipeline module.
 */
export {
  AveragingPeriodSpec,
  ExactPathResult,
  PipelineInputs,
  RestrictionInput,
  Stage5Result,
  applyAccrualAndProtection,
  applyPrescribedRounding,
  applyRestrictions,
  calculateAccruedBenefit,
  calculateBaseBenefit,
  deriveBoundsForRequest,
  determineCompensationMeasures,
  determineEligibility,
  determineServiceMeasures,
  emitReconciliationInputs,
  expressOnNormalRetirementBasis,
  identifyProvisions,
  resetStepCounter,
  resolveComparisonBasis,
  roundingSpecFromConfig,
  runExactPath,
  testCounterfactual,
} from "./pipeline";

/**
 * Formula composition, protection, limits, and provision selection
 * (Stage 4). Every export except the `dec*` re-exports from
 * `decimal.ts`, which are exported above under their plain names.
 */
export {
  CombinationRule,
  FormulaOperation,
  ProvisionSelection,
  amountDecimalOf,
  amountMinorOf,
  applyLimit,
  applyProtection,
  checkAntiDecrease,
  combineResults,
  composeFormulas,
  describeComparison,
  normalizeBenefit,
  provisionVersionsForPeriods,
  rebaseBenefit,
  selectProvisionsByDate,
} from "./compose";

/** Engine version pinned on CalculationRun and InputSnapshot (01 §4.3). */
export const ENGINE_VERSION = "0.1.0";
