/**
 * App entry point — Stage 6 UI core (Worker A).
 *
 * Boots the app, wires the UI modules, and calls the engine. The UI
 * calls the engine, never re-implements it:
 * - import/validate via src/validation.ts (`validateCasePackage`)
 * - calculate via src/pipeline.ts (`calculateAccruedBenefit`)
 * - reconcile via src/reconcile.ts (`reconcileParticipant`)
 * - statistics via src/statistics.ts (`describePopulation`, `detectOutliers`)
 * - decide via src/decisions.ts (`transition`, through `applyEvent`)
 * - publish via src/publication.ts (`publishFindings`, `assembleContribution`)
 *
 * Charts, reports, exports, and onboarding are the other workers'
 * modules, imported here by their real contracts:
 * - charts: renderHistogram / renderScatter / renderCohortBars /
 *   renderBoundsView / renderDispositionBars (plain data in, SVG out)
 * - reports: renderPlanReport / renderParticipantReport / renderAmbMemo
 *   (engine summaries in, printable HTML out)
 * - exports: buildCsv / buildXlsx / buildContributionPackage /
 *   buildAuditLog / downloadCsv / downloadXlsx / downloadJson
 * - onboarding: runOnboarding / renderHelpCentre / renderContextHelp /
 *   DEMO_CASE_PACKAGE (synthetic demo case, src/ui/demo.ts)
 *
 * Guard: every DOM access is behind `typeof document !== "undefined"`,
 * so this module stays importable in Node tests. No fetch, no network,
 * no CDN. No LLM in the calculation path. The UI recommends
 * dispositions; only a human approves (the Decide step proposes through
 * the engine transition; approval is a human act).
 *
 * Sensitive exports (MASTER_PROMPT §19): participant-data downloads
 * show the exports module's warning text and proceed only when the
 * reviewer confirms in the dialog. `confirmSensitiveExport` never
 * auto-approves, so there is no silent path past the warning.
 */

import {
  renderBoundsView,
  renderCohortBars,
  renderDispositionBars,
  renderHistogram,
  renderScatter,
} from "./charts";
import type { BoundsRow, CohortGroup, DispositionCount, ScatterPoint } from "./charts";
import { renderAmbMemo, renderParticipantReport, renderPlanReport } from "./reports";
import type { ParticipantReportInput, PlanReportInput } from "./reports";
import {
  buildAuditLog,
  buildContributionPackage,
  buildCsv,
  buildXlsx,
  downloadCsv,
  downloadJson,
  downloadXlsx,
  sensitiveExportWarningText,
} from "./exports";
import type { AuditEvent as ExportAuditEvent, XlsxSheet } from "./exports";
import {
  DEMO_CASE_PACKAGE,
  renderContextHelp,
  renderHelpCentre,
  runOnboarding,
} from "./onboarding";
import { applyThemeToDocument, loadTheme, setTheme, themeToggleLabel, toggleThemeName } from "./theme";
import { WIZARD_STEPS, stepLock, wizardStepLabel } from "./wizard";
import type { WizardStepId } from "./wizard";
import {
  applyBatch,
  applyEvent,
  checkAllInvariants,
  createCaseAnalysisState,
  createInitialUiState,
  dispositionsByParticipant,
} from "./state";
import type { AppEvent, UiState } from "./state";
import { ENGINE_VERSION } from "../index";
import { validateCasePackage } from "../validation";
import type { ValidationContext, ValidationParticipant } from "../validation";
import { calculateAccruedBenefit, testCounterfactual } from "../pipeline";
import type { PipelineInputs } from "../pipeline";
import { reconcileParticipant } from "../reconcile";
import type { HypothesisEvaluationInput, ParticipantReconciliation, ReconciliationConfig } from "../reconcile";
import { describePopulation, detectOutliers } from "../statistics";
import type { MaterialityThresholds, StatRow } from "../statistics";
import { assembleContribution, publishFindings } from "../publication";
import type { PublishFindingsInput } from "../publication";
import { mapDisposition, toEntryCheckInput } from "../dispositionMapping";
import { datedValue, makeBenefit } from "../formulas";
import { makeMoney } from "../decimal";
import { DEMO_TOLERANCE } from "./demo";
import { buildReconciliationInputs } from "../reconciliation";
import type { CasePackage } from "../types";
import type {
  DispositionEvidence,
  DispositionRecommendation,
} from "../dispositionMapping";
import type { EntryCheckInput } from "../decisions";
import type { WorkProductLog } from "../contribution";
import type {
  CalculationOutcome,
  CalculationRequest,
  CalculationRun,
  CounterfactualOperation,
  Disposition,
  ReconciliationInputs,
  RoundingConfig,
  TypedBenefitQuantity,
} from "../types";
import type { DispositionEvent } from "../decisions";

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

/** Empty UI state: no case loaded yet. */
export function createEmptyUiState(): UiState {
  return createInitialUiState(
    createCaseAnalysisState({
      caseId: "no-case-loaded",
      snapshotHash: "no-case-loaded",
      sourceDocuments: [],
      planVersions: [],
      participantKeys: [],
      toleranceSetId: "no-tolerance-set",
    }),
  );
}

// ---------------------------------------------------------------------------
// Engine calls (each returns the next state via applyEvent only)
// ---------------------------------------------------------------------------

/** Run validation (66 rules) and store the result. */
export function runValidation(
  state: UiState,
  participants: ValidationParticipant[],
  ctx: ValidationContext,
  actor: string,
  occurredAt: string,
): UiState {
  const result = validateCasePackage(participants, ctx);
  return applyEvent(state, {
    kind: "validation-completed",
    result,
    actor,
    occurredAt,
  });
}

/** Run the ten-stage calculation for one participant and store the outcome. */
export function runCalculation(
  state: UiState,
  request: CalculationRequest,
  inputs: PipelineInputs | undefined,
  actor: string,
  occurredAt: string,
): { state: UiState; outcome: CalculationOutcome } {
  const outcome = calculateAccruedBenefit(request, inputs);
  const next = applyEvent(state, {
    kind: "calculation-completed",
    participantKey: request.participantKey,
    outcome,
    actor,
    occurredAt,
  });
  return { state: next, outcome };
}

/** Pure calculation for one participant (no state change). Used by the
 *  batched step runners, which apply one applyBatch per step instead of
 *  one applyEvent per participant (Stage 7 Benchmarks defect 2). */
export function calculateOne(
  request: CalculationRequest,
  inputs: PipelineInputs | undefined,
): CalculationOutcome {
  return calculateAccruedBenefit(request, inputs);
}

/** Reconcile one participant (Δ/D/R, tolerance, ranked hypotheses). */
export function runReconciliation(
  state: UiState,
  participantKey: string,
  inputs: ReconciliationInputs,
  config: ReconciliationConfig,
  actor: string,
  occurredAt: string,
  hypothesisCandidates?: readonly HypothesisEvaluationInput[],
): UiState {
  const reconciliation = reconcileParticipant({
    participantKey,
    inputs,
    config,
    hypothesisCandidates,
  });
  return applyEvent(state, {
    kind: "reconciliation-completed",
    reconciliation,
    actor,
    occurredAt,
  });
}

/** Pure reconciliation for one participant (no state change). Used by
 *  the batched step runners (Stage 7 Benchmarks defect 2). */
export function reconcileOne(
  participantKey: string,
  inputs: ReconciliationInputs,
  config: ReconciliationConfig,
  hypothesisCandidates?: readonly HypothesisEvaluationInput[],
): ParticipantReconciliation {
  return reconcileParticipant({
    participantKey,
    inputs,
    config,
    hypothesisCandidates,
  });
}

/**
 * Test the standard counterfactual candidates for one participant and
 * return them as ranked-hypothesis inputs (Stage 7 Accuracy G-ACC-4).
 * The reconcile path previously ran with no candidates at all, so it
 * could never reach correction-recommended even when a tested
 * counterfactual reproduced the recorded amount exactly — the Node
 * population oracle, which does run them, disagreed. The candidates
 * tested here are the ones the engine can test from the request and
 * inputs alone: service ±1 year (H2) and any documented alternative
 * averaging period the inputs name (H4). A candidate is only ever
 * "supported" when the engine's own testCounterfactual says so (residual
 * vanishes AND the mechanism is documented); an undocumented
 * alternative stays plausible at best, and the anti-coincidence rule
 * in evaluateAndRankHypotheses still applies. No candidate is invented:
 * when the inputs name no alternative averaging period, none is tested.
 */
export function counterfactualCandidates(
  request: CalculationRequest,
  inputs: PipelineInputs | undefined,
): HypothesisEvaluationInput[] {
  const candidates: HypothesisEvaluationInput[] = [];
  const serviceOps: CounterfactualOperation[] = [
    { kind: "service-delta-years", years: "+1" },
    { kind: "service-delta-years", years: "-1" },
  ];
  for (const operation of serviceOps) {
    const result = testCounterfactual(request, operation, inputs);
    candidates.push({
      result,
      documentedMechanism: false,
      resolvesCohort: false,
      material: true,
    });
  }
  for (const period of inputs?.alternativeAveragingPeriods ?? []) {
    const result = testCounterfactual(request, { kind: "averaging-period", period }, inputs);
    candidates.push({
      result,
      documentedMechanism: true,
      resolvesCohort: false,
      material: true,
    });
  }
  return candidates;
}

/** Run population statistics and the outlier screen. Statistics suggest;
 *  they never decide, and no statistic becomes a benefit here. */
export function runStatistics(
  state: UiState,
  rows: readonly StatRow[],
  thresholds: MaterialityThresholds,
  actor: string,
  occurredAt: string,
): UiState {
  const population = describePopulation(rows, thresholds);
  const outliers = detectOutliers(rows, { valueField: "deltaMinor" });
  return applyEvent(state, {
    kind: "statistics-completed",
    population,
    outliers,
    actor,
    occurredAt,
  });
}

/**
 * Propose, approve, reject, or re-open a disposition for one
 * participant. The event goes through the engine transition (T1–T12)
 * via applyEvent; a refused transition changes nothing and is recorded
 * in `lastRefusal`. Approval is a human act: the caller supplies the
 * human actor and the complete determination the engine requires.
 */
export function dispatchDisposition(
  state: UiState,
  participantKey: string,
  dispositionEvent: DispositionEvent,
  actor: string,
  occurredAt: string,
): UiState {
  return applyEvent(state, {
    kind: "analysis-event",
    event: {
      kind: "user-action",
      eventId: `ui-disp-${participantKey}-${occurredAt}`,
      actor,
      occurredAt,
      action:
        dispositionEvent.kind === "approve"
          ? "approve-disposition"
          : dispositionEvent.kind === "reject"
            ? "reject-recommendation"
            : dispositionEvent.kind === "reopen"
              ? "reopen-disposition"
              : "propose-disposition",
      participantKey,
      dispositionEvent,
    },
  });
}

/** Load the synthetic demo case (onboarding worker's DEMO_CASE_PACKAGE). */
export function loadDemoCase(state: UiState, actor: string, occurredAt: string): UiState {
  return applyEvent(state, {
    kind: "import-case-package",
    casePackage: DEMO_CASE_PACKAGE,
    actor,
    occurredAt,
  });
}

// ---------------------------------------------------------------------------
// File import — Stage 7 Robustness D3 (MASTER_PROMPT §6), Stage 8 XLSX.
//
// CSV and structured JSON arrive as text (FileReader readAsText in
// bootApp); XLSX/XLSM arrive as bytes (readAsArrayBuffer, then
// parseXlsx from src/ui/xlsxReader.ts — cached values only, never
// macros, never formulas). Every row path shares one helper
// (importMappedRows): the same dopt rule, the same case-number
// fallback, the same report shape, the same quarantine rules.
// Malformed files are refused with a plain reason and change
// nothing; bad cells are quarantined by S-07/S-08, never guessed.
// ---------------------------------------------------------------------------

import {
  mapImportedRow,
  parseCsv,
  parseJsonImport,
  rowsToCasePackage,
  unknownColumns,
} from "./import";
import type { ImportedRow, ImportReport } from "./import";
import { parseXlsx } from "./xlsxReader";
import type { XlsxParseResult } from "./xlsxReader";

/** Shared row → package → state step for CSV, JSON rows, and XLSX.
// DOPT is required (no date is guessed); the case number comes from
// a caseNumber cell when one is present, else from the file name.
// `extra` carries the XLSX sheet name(s), reader warnings, and the
// file hash; CSV passes reader warnings; JSON passes none of those. */
function importMappedRows(
  state: UiState,
  fileName: string,
  mapped: readonly ImportedRow[],
  headers: readonly string[],
  rowCount: number,
  sourceFileHash: string,
  actor: string,
  occurredAt: string,
  extra?: {
    warnings?: readonly string[];
    sheetName?: string | null;
    sheetNames?: readonly string[];
  },
): { state: UiState; report: ImportReport | null; error: string | null } {
  const dopt = mapped.map((r) => r.dopt).find((d) => d !== null) ?? null;
  if (dopt === null) {
    return {
      state,
      report: null,
      error:
        "Import refused: no dopt value found in the rows. DOPT is a case fact the validation needs, and no date is guessed for it — add a dopt column (YYYY-MM-DD, same on every row).",
    };
  }
  const caseNumber =
    mapped.map((r) => r.raw["caseNumber"]).find((c) => c !== undefined && c.trim() !== "") ??
    fileName.replace(/\.[^.]*$/, "");
  const importedDate = occurredAt.slice(0, 10);
  const { package: pkg, report } = rowsToCasePackage(mapped, {
    caseNumber: (caseNumber as string).trim(),
    planName: "Imported plan — name not supplied in file",
    planNumber: "not supplied",
    dopt,
    importId: `${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}-${rowCount}`,
    importedDate,
    importedBy: actor,
    sourceFileName: fileName,
    sourceFileHash,
  }, unknownColumns(headers), extra);
  const next = applyEvent(state, {
    kind: "import-case-package",
    casePackage: pkg,
    actor,
    occurredAt,
  });
  return { state: next, report, error: null };
}

/** Parse XLSX bytes without importing (sheet list for the chooser).
 *  Throws with a plain message when the file is refused. */
export function previewXlsx(bytes: Uint8Array): XlsxParseResult {
  return parseXlsx(bytes);
}

/** Import one .xlsx/.xlsm file's bytes into state. `sheetName`
 *  names the sheet to import; null imports the first sheet. Returns
 *  the next state plus the import report, or the unchanged state plus
 *  a plain-language error when the file is refused. Never throws. */
export function importFileBytes(
  state: UiState,
  fileName: string,
  bytes: Uint8Array,
  actor: string,
  occurredAt: string,
  sheetName: string | null = null,
): { state: UiState; report: ImportReport | null; error: string | null } {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".xlsm")) {
    return {
      state,
      report: null,
      error: `Import refused: ${fileName} is not a .xlsx or .xlsm file.`,
    };
  }
  try {
    const parsed = parseXlsx(bytes);
    if (parsed.sheets.length === 0) {
      return { state, report: null, error: `XLSX import refused: ${fileName} has no sheets.` };
    }
    const sheet =
      sheetName === null
        ? (parsed.sheets[0] as (typeof parsed.sheets)[number])
        : parsed.sheets.find((s) => s.name === sheetName);
    if (sheet === undefined) {
      return {
        state,
        report: null,
        error: `XLSX import refused: ${fileName} has no sheet named "${sheetName}". Sheets in the file: ${parsed.sheets.map((s) => s.name).join(", ")}.`,
      };
    }
    const mapped = sheet.rows.map(mapImportedRow);
    return importMappedRows(state, fileName, mapped, sheet.headers, sheet.rows.length, parsed.fileHashSha256, actor, occurredAt, {
      warnings: [...parsed.warnings, ...sheet.warnings],
      sheetName: sheet.name,
      sheetNames: parsed.sheets.map((s) => s.name),
    });
  } catch (err) {
    return {
      state,
      report: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Import one file's text into state. Returns the next state plus the
 *  import report, or the unchanged state plus a plain-language error
 *  when the file is refused. Never throws for a malformed file. */
export function importFileText(
  state: UiState,
  fileName: string,
  text: string,
  actor: string,
  occurredAt: string,
): { state: UiState; report: ImportReport | null; error: string | null } {
  const lower = fileName.toLowerCase();
  try {
    if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
      return {
        state,
        report: null,
        error:
          "XLSX import refused: the file must be read as bytes, not text. Choose the file again in the Import step — the file picker reads it as bytes.",
      };
    }
    if (lower.endsWith(".csv")) {
      const { headers, rows, warnings } = parseCsv(text);
      const mapped = rows.map(mapImportedRow);
      return importMappedRows(state, fileName, mapped, headers, rows.length, "not-computed", actor, occurredAt, { warnings });
    }
    if (lower.endsWith(".json")) {
      const parsed = parseJsonImport(text);
      if (parsed.kind === "case-package") {
        const next = applyEvent(state, {
          kind: "import-case-package",
          casePackage: parsed.package,
          actor,
          occurredAt,
        });
        return {
          state: next,
          report: {
            fileName,
            rowsRead: parsed.package.participants.length,
            participantsImported: parsed.package.participants.length,
            quarantinedRows: [],
            unknownFields: [],
            badDates: 0,
            badNumbers: 0,
            snapshotHash: parsed.package.events[parsed.package.events.length - 1]?.snapshotHashAfter ?? "no-snapshot-recorded",
            warnings: [],
            sheetName: null,
            sheetNames: [],
          },
          error: null,
        };
      }
      const mapped = parsed.rows.map(mapImportedRow);
      return importMappedRows(state, fileName, mapped, parsed.headers, parsed.rows.length, "not-computed", actor, occurredAt);
    }
    return {
      state,
      report: null,
      error: `Import refused: ${fileName} is not a .csv, .json, .xlsx, or .xlsm file.`,
    };
  } catch (err) {
    return {
      state,
      report: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Plain-language one-line summary of an import report, for the UI. */
export function importReportSummary(report: ImportReport): string {
  const parts = [
    `${report.fileName}: ${report.participantsImported} participant(s) imported from ${report.rowsRead} row(s).`,
  ];
  if (report.sheetName !== null) {
    parts.push(`Sheet "${report.sheetName}" used.`);
    const others = report.sheetNames.filter((n) => n !== report.sheetName);
    if (others.length > 0) {
      parts.push(`Other sheets in the file (not imported): ${others.join(", ")}.`);
    }
  }
  if (report.warnings.length > 0) {
    parts.push(`Warnings: ${report.warnings.join(" ")}`);
  }
  if (report.quarantinedRows.length > 0) {
    parts.push(
      `${report.quarantinedRows.length} row(s) quarantined: ${report.quarantinedRows.map((r) => `row ${r.rowNumber} (${r.reason})`).join("; ")}.`,
    );
  }
  if (report.badDates > 0 || report.badNumbers > 0) {
    parts.push(
      `${report.badDates} bad date(s) and ${report.badNumbers} bad number(s) — quarantined by S-07/S-08, never guessed.`,
    );
  }
  if (report.unknownFields.length > 0) {
    parts.push(`Unknown fields kept unmapped: ${report.unknownFields.join(", ")}.`);
  }
  return parts.join(" ");
}

/**
 * Map a participant's evidence to its recommendation and the
 * EntryCheckInput the engine transition reads (dispositionMapping:
 * the mapping recommends, decisions.ts guards). Pure: no state change.
 */
export function dispositionEntryInput(evidence: DispositionEvidence): {
  recommendation: DispositionRecommendation;
  entry: EntryCheckInput;
} {
  const recommendation = mapDisposition(evidence);
  return { recommendation, entry: toEntryCheckInput(evidence, recommendation) };
}

/**
 * Attach a participant's evidence state to the UI state, so the Decide
 * step's propose/approve transitions have evidence to guard on. Without
 * this the engine refuses every disposition event for the participant
 * ("no evidence state exists — run a calculation or bounds computation
 * first"). Attaching evidence recommends nothing and approves nothing:
 * the recommendation comes from mapDisposition and approval stays a
 * human T3 transition through dispatchDisposition.
 */
export function recordEvidence(
  state: UiState,
  participantKey: string,
  evidence: DispositionEvidence,
  actor: string,
  occurredAt: string,
): UiState {
  const { entry } = dispositionEntryInput(evidence);
  return applyEvent(state, {
    kind: "evidence-recorded",
    participantKey,
    evidence: entry,
    actor,
    occurredAt,
  });
}

/** Publish findings from a calculation run into a WorkProductLog. */
export function buildPublishedLog(input: PublishFindingsInput): WorkProductLog {
  return publishFindings(input);
}

/**
 * Assemble a versioned contribution package from a published log and
 * store it as the state's last contribution (Export step).
 */
export function publishContribution(
  state: UiState,
  log: WorkProductLog,
  meta: {
    caseId: string;
    productVersion: string;
    producedAt: string;
    publishedBy: string;
    run: CalculationRun;
  },
  actor: string,
  occurredAt: string,
): { state: UiState; contribution: ReturnType<typeof assembleContribution> } {
  const contribution = assembleContribution({ ...meta, log });
  const next = applyEvent(state, {
    kind: "contribution-published",
    contribution,
    actor,
    occurredAt,
  });
  return { state: next, contribution };
}

// ---------------------------------------------------------------------------
// Demo-case step runners — the wizard's Run buttons (Stage 7, item a)
//
// The wizard's Run buttons run each step from the loaded case through the
// same helpers the API flow uses (runValidation / runCalculation /
// runReconciliation / runStatistics / dispatchDisposition). They work on
// the demo case only (case 00098765, the only case the app can load
// today): the step inputs — the validation mapping, each participant's
// formula parameters, the bounds specs, the disposition evidence — are
// the demo case's stated inputs, written here once, mirroring
// test/ui-playwright/wizard-flow.test.mjs and test/demo.test.ts. A real
// case import must supply those inputs per participant before its Run
// buttons can run; the runners refuse any other case rather than
// inventing inputs. Human approval stays human-only: the Decide button
// recommends every participant; it never approves (approval needs a
// full determination, which no button builds).
// ---------------------------------------------------------------------------

/** The demo case number (src/ui/demo.ts). Run buttons refuse any other case. */
export const DEMO_CASE_NUMBER = "00098765";

/** Loaded case package, or a plain-language refusal when it is not the demo case. */
export function requireDemoCase(state: UiState): CasePackage {
  const pkg = state.casePackage;
  if (pkg === null) throw new Error("No case loaded — load the demo case first.");
  if (pkg.case.caseNumber.value !== DEMO_CASE_NUMBER) {
    throw new Error(
      "This case is not the demo case — the Run buttons only run the demo case's stated inputs.",
    );
  }
  return pkg;
}

/** Non-null or a plain error naming what is missing. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`${what} is missing`);
  return value;
}

function demoKeys(pkg: CasePackage): string[] {
  return pkg.participants.map((p) => p.participantKey);
}

function demoRecordedMinor(pkg: CasePackage, key: string): number | null {
  const obs = must(
    pkg.benefitObservations.find((o) => o.participantKey === key),
    `observation for ${key}`,
  );
  return obs.paAmb.value === null ? null : obs.paAmb.value.amountMinor;
}

function demoDote(pkg: CasePackage, key: string): string | null {
  const obs = must(
    pkg.benefitObservations.find((o) => o.participantKey === key),
    `observation for ${key}`,
  );
  return obs.measurementDate;
}

function demoAgeAt(dob: string, date: string): number {
  const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
  return date.slice(5) < dob.slice(5) ? years - 1 : years;
}

function demoNrd(dob: string): string {
  return `${Number(dob.slice(0, 4)) + 65}${dob.slice(4)}`;
}

/** Validation input for one demo participant, mapped from the case package. */
export function demoValidationParticipant(pkg: CasePackage, key: string): ValidationParticipant {
  const p = must(pkg.participants.find((x) => x.participantKey === key), `participant ${key}`);
  const ep = must(pkg.employmentPeriods.find((x) => x.participantKey === key), `employment period for ${key}`);
  const ch = must(pkg.compensationHistories.find((x) => x.participantKey === key), `compensation history for ${key}`);
  const sh = must(pkg.serviceHistories.find((x) => x.participantKey === key), `service history for ${key}`);
  const dob = must(p.dob.value, `dob for ${key}`);
  const dote = ep.dote.value;
  const service = sh.paCreditedService.value;
  const serviceStr = service === null ? null : String(service);
  const knownSalaries = ch.salaryByYear.filter((s) => s.amount !== null);
  const meanAnnualMinor =
    knownSalaries.length === 0
      ? null
      : Math.round(knownSalaries.reduce((s, x) => s + (x.amount?.amountMinor ?? 0), 0) / knownSalaries.length);
  const lastSalary = knownSalaries[knownSalaries.length - 1];
  const formulaCheck: Record<string, number> = { "SYN-001": 150000, "SYN-003": 150000, "SYN-V-01": 84950 };
  const checkValue = formulaCheck[key] ?? null;
  return {
    participantKey: key, bcvRecId: p.bcvRecId.value, caseNumber: DEMO_CASE_NUMBER,
    idType: "1", ssn: null, firstName: p.firstName.value, lastName: p.lastName.value,
    dob, sex: p.sex.value, dateOfDeath: null, retstat: "2", rettyp: null,
    doh: ep.doh.value, dote, dop: ep.dop.value, dobfParticipant: null, dor: null,
    postDoptDote: null, nrd: demoNrd(dob), anb: dote === null ? null : demoAgeAt(dob, dote),
    sanb: null, rbd: demoNrd(dob), rbdDeterminable: true, rbdMissingFields: [],
    inPayAtDopt: null, isPreDoptRetiree: false, isDeferredRecord: true, sbcd: null,
    spouseSsn: null, spouseLastName: null, spouseDob: null, spouseSex: null,
    spouseDateOfDeath: null, benSsn: null, benLastName: null, benDob: null,
    benSex: null, benDateOfDeath: null, apDob: null, apSex: null, apDateOfDeath: null,
    cspa: serviceStr, vspa: serviceStr, espa: serviceStr, cs: serviceStr,
    vs: serviceStr, es: serviceStr, csUnit: "years", vsUnit: "years", vppa: "1",
    paAmb: demoRecordedMinor(pkg, key),
    paAcomp: meanAnnualMinor === null ? null : Math.round(meanAnnualMinor / 12),
    paAcompPeriodicity: "monthly",
    cuComp: lastSalary?.amount === null || lastSalary?.amount === undefined ? null : Math.round((lastSalary.amount.amountMinor ?? 0) / 12),
    pia: null, integrationMethod: "none", firstYear: ch.firstYear.value,
    lastYear: ch.lastYear.value,
    salaryByYear: ch.salaryByYear.map((s) => ({ year: s.salaryYear, amount: s.amount?.amountMinor ?? null })),
    annact: "A", annualizationBasisNoted: true,
    averagingPeriodYears: knownSalaries.map((s) => s.salaryYear),
    formCode: dote === null ? null : "NSF", formCodeNsf: "NSF", formCodeNmf: "NMF",
    formCodeQpsa: null, formCodeArd: null, spcVal: "0", spcNsf: "0", spcArd: "0",
    mths: 0, mthsNsf: 0, mthsArd: 0, formCodeIsJointLife: false,
    recordIsSingleLife: true, lsTerm: "N", xrd: demoNrd(dob), xrdMbTerm: demoRecordedMinor(pkg, key),
    pvReteec: null, measurementDate: dote, recordedDate: dote === null ? null : "2020-03-15",
    measurementDisagreementExplained: false, assertedBasisNrd: false,
    nrdBasisEvidence: false, explicitNoBenefitStatement: false,
    vestingTreatment: "gross", annuityForm: dote === null ? null : "NSF",
    annuityFormConversionDocumented: false, calcMeasurementDate: dote,
    calcAnnuityForm: dote === null ? null : "NSF", calcVestingTreatment: "gross",
    planFreezeDate: null, accrualAfterFreeze: false,
    benefitReflectsPostFreezeAccrual: false, mandcwi: null, volcwi: null,
    cashBalDopt: null, formulaType: "unit-credit",
    contributionTreatmentDocumented: true, cashBalanceExplanationDocumented: true,
    documentedMinimumOrGrandfatherOrPastServiceCredit: false,
    participationBeforeEligibility: false, serviceAccruesBeforeDop: false,
    parseError: null, badDates: [], badNumbers: [], fieldsWithoutProvenance: [],
    supportingEvidenceForScale: true, s001Derivable: true, scheduleProvided: true,
    scheduleRowExists: true, schedulePaAmb: demoRecordedMinor(pkg, key),
    scheduleExplanationDocumented: false, bcvComparison: null,
    paymentAmountMinor: null, convertedPaAmbMinor: null, ardFactorsPresent: false,
    priorDistribution: null, formulaCheckValueMinor: checkValue,
    formulaKnownForX06: true,
    formulaCheckValuesMinor: checkValue === null ? null : [checkValue],
    documentedHypothesis: false, pfFactors: null, proposedDisposition: null,
    evidenceCount: 0, paAmbAccept: null, disposition: null, decisionExists: false,
    rejectionRationaleStated: false, sourcesUsed: [],
    candidateMeasurementDates: dote === null ? [] : [dote],
    establishedMeasurementDate: dote, prior: null,
  };
}

/** Validation context for the demo case. */
export function demoValidationContext(): ValidationContext {
  return {
    dopt: "2024-06-30", today: "2026-11-12", runId: "run-demo-1",
    recordedDate: "2026-11-12", tolerance: DEMO_TOLERANCE,
    serviceTolerance: "0", monthlyBenefitPlausibilityCap: 2500000,
    plausibleBenefitCompRatioRange: null, planServiceCreditRule: null,
    validFormCodes: ["NSF", "NMF", "QPSA", "J&S50", "J&S75", "J&S100"],
    file: { openable: true, truncated: false, hashMatches: true, hashBefore: "demo", hashAfter: "demo", macroRan: false, unknownFields: [] },
    priorExtract: null,
  };
}

/** Demo formula parameters (unit-credit 1.5%, final-3-year; per participant). */
const DEMO_FORMULA_PARAMS: Record<string, { avgComp: string; service: string }> = {
  "SYN-001": { avgComp: "60000", service: "20" },
  "SYN-002": { avgComp: "60000", service: "22" },
  "SYN-003": { avgComp: "60000", service: "20" },
  "SYN-004": { avgComp: "49600", service: "15" },
  "SYN-V-01": { avgComp: "33980", service: "20" },
  "SYN-I-01": { avgComp: "60000", service: "20" },
};

function demoRoundingConfig(): RoundingConfig {
  return {
    configId: "rc-demo", version: "rounding-config v1.0.0",
    planVersionId: "pv-demo-1985",
    prescribedSequence: { sequenceId: "prescribed", rules: [{ target: "final-monthly-benefit", unit: "0.01", mode: "half-up", stage: "final", source: { kind: "plan-provision", citation: "plan §5.01" } }] },
    alternativeSequences: [], setBy: "demo", setDate: "2026-11-12", rationale: "demo fixture",
  };
}

function demoRecordedBenefit(pkg: CasePackage, key: string): TypedBenefitQuantity | null {
  const minor = demoRecordedMinor(pkg, key);
  const dote = demoDote(pkg, key);
  if (minor === null || dote === null) return null;
  return makeBenefit(
    { planVersionId: "pv-demo-1985", measurementDate: dote, rounding: { stage: "final-only", mode: "nearest-cent", source: "demo" } },
    makeMoney(minor), "monthly", undefined, "prior-administrator",
  );
}

function demoBuildRequest(pkg: CasePackage, key: string): CalculationRequest {
  const employmentPeriods = pkg.employmentPeriods.filter((e) => e.participantKey === key);
  const compensationHistory = must(pkg.compensationHistories.find((c) => c.participantKey === key), `compensation history for ${key}`);
  const serviceHistory = must(pkg.serviceHistories.find((s) => s.participantKey === key), `service history for ${key}`);
  const dote = demoDote(pkg, key);
  return {
    participantKey: key,
    participantHistory: { participantKey: key, employmentPeriods, compensationHistory, serviceHistory, benefitObservations: [] },
    provisionTimeline: { planId: "plan-harborview", versions: pkg.planVersions },
    measurementDate: dote, measurementBasis: dote === null ? "unresolved" : "dote",
    calculationKind: "accrued", formulaId: "T-04", roundingConfig: demoRoundingConfig(),
    tolerance: DEMO_TOLERANCE,
    runContext: { engineVersion: "0.1.0", ruleVersion: "2026-11-12", formulaTaxonomyVersion: "1.0", inputSnapshotHash: "demo" },
  };
}

function demoBuildInputs(pkg: CasePackage, key: string): PipelineInputs {
  const params = must(DEMO_FORMULA_PARAMS[key], `formula params for ${key}`);
  const inputs: PipelineInputs = {
    formulaCall: { formulaId: "T-04", params: { accrualRate: datedValue("0.015", "1985-07-01", "pv-demo-1985"), avgComp: params.avgComp, service: params.service } },
    recordedPaAmb: demoRecordedBenefit(pkg, key),
    averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
    requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
  };
  if (key === "SYN-002") {
    inputs.boundsSpec = { ranges: [{ field: "CompensationHistory.salaryYear 2020", missingClass: "c", low: "54000", high: "64800", unit: "annual-compensation-dollars", basis: "prior-year salary bounded by the plan's pay scale" }], assumptions: ["formula T-04 applies to all service"] };
  }
  if (key === "SYN-004") {
    inputs.boundsSpec = { ranges: [{ field: "CompensationHistory.salaryYear 2020", missingClass: "c", low: "45600", high: "55200", unit: "annual-compensation-dollars", basis: "prior-year salary bounded by the plan's pay scale" }], assumptions: ["formula T-04 applies to all service"] };
  }
  return inputs;
}

/** Statistics rows for the demo case, from the reconciliations in state. */
export function demoStatRows(state: UiState): StatRow[] {
  const pkg = requireDemoCase(state);
  return demoKeys(pkg).map((key) => {
    const rec = must(state.reconciliations[key], `reconciliation for ${key}`);
    const p = must(pkg.participants.find((x) => x.participantKey === key), `participant ${key}`);
    const ch = must(pkg.compensationHistories.find((x) => x.participantKey === key), `compensation history for ${key}`);
    const sh = must(pkg.serviceHistories.find((x) => x.participantKey === key), `service history for ${key}`);
    const known = ch.salaryByYear.filter((s) => s.amount !== null);
    const meanAnnual = known.length === 0 ? null : Math.round(known.reduce((s, x) => s + (x.amount?.amountMinor ?? 0), 0) / known.length);
    const dote = demoDote(pkg, key);
    return {
      participantKey: key,
      // Recorded retstat code ("2") as the status string; the demo
      // package carries no status label, and none is coined here.
      status: must(p.retstat.value, `retstat for ${key}`),
      employmentGroup: null, formulaType: "unit-credit", amendmentCohort: null,
      paAmbMinor: demoRecordedMinor(pkg, key),
      reconstructedMinor: rec.reconstructed?.amount?.amountMinor ?? null,
      deltaMinor: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
      absDeltaMinor: rec.comparison.comparable ? rec.comparison.absDelta.amountMinor : null,
      relDelta: rec.comparison.comparable && rec.comparison.relative.kind === "defined" ? rec.comparison.relative.value : null,
      denominatorFlag: rec.comparison.comparable ? rec.comparison.denominatorFlag : null,
      ageYears: dote === null ? null : demoAgeAt(must(p.dob.value, `dob for ${key}`), dote),
      serviceYears: sh.paCreditedService.value,
      compensationMinor: meanAnnual,
      retirementStatus: must(p.retstat.value, `retstat for ${key}`),
      dataCompleteness: null,
      monthsSinceRecorded: dote === null ? null : 80,
      qdro: false, priorDistribution: false,
      employmentPeriods: pkg.employmentPeriods.filter((e) => e.participantKey === key).length,
    };
  });
}

/** Disposition evidence for one demo participant (stated per key, as in the demo driver). */
export function demoDecideEvidence(pkg: CasePackage, key: string): DispositionEvidence {
  const recordedMinor = demoRecordedMinor(pkg, key);
  const base: DispositionEvidence = {
    participantKey: key, caseId: DEMO_CASE_NUMBER, toleranceSetId: "tol-demo",
    completenessGrade: "complete", comparisonBasis: "established",
    basisUnresolvable: false, basisNote: null, reconstructedMinor: null,
    recordedMinor, deltaMinor: null, withinTolerance: null,
    denominatorFlag: null, boundsMinor: null, boundWidthMaterial: false,
    boundWidthJustification: null, boundAssumptionsInDoubt: false,
    hypotheses: [], conflictingCorrections: false, correctedBenefitMinor: null,
    correctionReasonablyCertain: false, correctionDirection: null,
    missingEvidence: [], dataRequests: [], nextSteps: [],
    uninvestigatedFlag: false, blockingValidationOutstanding: false,
    statisticalOnly: false, contradictoryEvidenceUnresolved: false,
    supportedGround: null, indeterminateRationale: null,
    noFurtherRequestReason: null, ruleApplicabilityOk: true, snapshotMatches: true,
  };
  if (key === "SYN-001") {
    return { ...base, reconstructedMinor: 150000, deltaMinor: 0, withinTolerance: true, hypotheses: [{ code: "H2", supportClass: "refuted", material: true }] };
  }
  if (key === "SYN-V-01") {
    // Stage 7 Accuracy D-ACC-1: the demo plan's prescribed rounding is
    // nearest cent, half-up (plan §5.01) — it leaves $849.50 unchanged,
    // so it cannot explain the $0.50 to $850.00. The nearest-dollar rule
    // that would explain it lives in a different fixture (Synthetic
    // Plan A §7.3), not in this plan, and no such rule is invented
    // here. H15 is therefore "plausible", not "supported", and it is
    // immaterial to the disposition: Δ $0.50 is within the $1.00
    // tolerance, so Verified rests on tolerance alone and the rounding
    // match is recorded as a candidate, never as a supported
    // explanation (anti-coincidence rule, Stage 1 §2.7).
    return { ...base, reconstructedMinor: 84950, deltaMinor: 50, withinTolerance: true, hypotheses: [{ code: "H15", supportClass: "plausible", material: false }] };
  }
  if (key === "SYN-003") {
    return { ...base, reconstructedMinor: 150000, deltaMinor: 100000, withinTolerance: false, hypotheses: [{ code: "H2", supportClass: "proposed", material: true }], nextSteps: ["Ask the prior administrator for the workpaper behind $2,500.00."] };
  }
  if (key === "SYN-002") {
    return { ...base, completenessGrade: "partial", boundsMinor: { min: 158400, max: 168300 }, boundWidthMaterial: true, missingEvidence: [{ input: "CompensationHistory.salaryYear 2020", missingClass: "M3", decisionImpact: "Resolving it narrows the bounds by $99.00 and could move the disposition.", uncertaintyContributionMinor: 9900 }], nextSteps: ["Obtain compensation year 2020 from the prior administrator."] };
  }
  if (key === "SYN-004") {
    return { ...base, completenessGrade: "partial", boundsMinor: { min: 90000, max: 96000 }, boundWidthMaterial: true, missingEvidence: [{ input: "CompensationHistory.salaryYear 2020", missingClass: "M3", decisionImpact: "Resolving it narrows the bounds by $60.00 and could move the disposition.", uncertaintyContributionMinor: 6000 }], nextSteps: ["Obtain compensation year 2020 from the prior administrator."] };
  }
  return {
    ...base, completenessGrade: "insufficient", comparisonBasis: "unresolved",
    basisUnresolvable: true,
    basisNote: "DOTE is blank; no PA benefit schedule or plan document establishes the measurement date.",
    recordedMinor: null,
    missingEvidence: [
      { input: "DOTE (measurement date)", missingClass: "M5", decisionImpact: "Without a measurement date no comparison basis exists and no delta can be computed.", uncertaintyContributionMinor: null },
      { input: "PA_AMB", missingClass: "M1", decisionImpact: "Without the recorded amount there is nothing to compare.", uncertaintyContributionMinor: null },
    ],
    dataRequests: [{ requestId: "req-demo-i-01-1", input: "DOTE (measurement date)", participantKeys: ["SYN-I-01"], sourceToAsk: "PA benefit schedule", expectedDecisionEffect: "Establishing the measurement date would resolve the comparison basis.", priority: 1, status: "issued", statusReason: "Issued; awaiting response.", requestedDate: "2026-11-12", answeredDate: null }],
    indeterminateRationale: "The measurement date (DOTE) is blank and cannot be established from available documents, so no comparison basis exists and no delta can be computed.",
  };
}

/** Run the Validate step on the loaded demo case. */
export function runValidateStep(
  state: UiState,
  actor: string,
  occurredAt: string,
): { state: UiState; summary: { participantResults: number; rulesEvaluated: number; findings: number } } {
  const pkg = state.casePackage;
  if (pkg === null) throw new Error("No case loaded — load a case first.");
  // An imported (non-demo) case validates through the generic mapper
  // below; the demo case keeps its own stated inputs.
  if (pkg.case.caseNumber.value !== DEMO_CASE_NUMBER) {
    return runValidateImportedStep(state, actor, occurredAt);
  }
  const next = runValidation(
    state,
    demoKeys(pkg).map((key) => demoValidationParticipant(pkg, key)),
    demoValidationContext(),
    actor,
    occurredAt,
  );
  const validation = must(next.validation, "validation result");
  return {
    state: next,
    summary: {
      participantResults: validation.participantResults.length,
      rulesEvaluated: validation.summary.rulesEvaluated,
      findings: validation.allFindings.length,
    },
  };
}

/**
 * Map any loaded case package to validation participants (Stage 7
 * Robustness D3). Reads the package's own entities — participants,
 * employment periods, compensation and service histories, benefit
 * observations — with no demo-specific inputs (no formula check values:
 * formulaKnownForX06 is false, so X-06 records not-applicable rather
 * than comparing against a value the file never stated).
 */
export function casePackageValidationParticipants(pkg: CasePackage): ValidationParticipant[] {
  return pkg.participants.map((p) => {
    const key = p.participantKey;
    const ep = pkg.employmentPeriods.find((x) => x.participantKey === key);
    const ch = pkg.compensationHistories.find((x) => x.participantKey === key);
    const sh = pkg.serviceHistories.find((x) => x.participantKey === key);
    const obs = pkg.benefitObservations.find((x) => x.participantKey === key);
    const dob = p.dob.value;
    const dote = ep?.dote.value ?? null;
    const service = sh?.paCreditedService.value ?? null;
    const serviceStr = service === null ? null : String(service);
    const knownSalaries = (ch?.salaryByYear ?? []).filter((s) => s.amount !== null);
    const meanAnnualMinor =
      knownSalaries.length === 0
        ? null
        : Math.round(knownSalaries.reduce((s, x) => s + (x.amount?.amountMinor ?? 0), 0) / knownSalaries.length);
    const lastSalary = knownSalaries[knownSalaries.length - 1];
    const nrd = dob === null ? null : `${Number(dob.slice(0, 4)) + 65}${dob.slice(4)}`;
    const recordedMinor = obs?.paAmb.value?.amountMinor ?? null;
    return {
      participantKey: key,
      bcvRecId: p.bcvRecId.value,
      caseNumber: pkg.case.caseNumber.value,
      idType: "1",
      ssn: p.ssn.value,
      firstName: p.firstName.value,
      lastName: p.lastName.value,
      dob,
      sex: p.sex.value,
      dateOfDeath: p.dateOfDeath.value,
      retstat: p.retstat.value,
      rettyp: p.rettyp.value,
      doh: ep?.doh.value ?? null,
      dote,
      dop: ep?.dop.value ?? null,
      dobfParticipant: ep?.dobfParticipant.value ?? null,
      dor: ep?.dor.value ?? null,
      postDoptDote: ep?.postDoptDote.value ?? null,
      nrd,
      anb: dob === null || dote === null ? null : demoAgeAt(dob, dote),
      sanb: null,
      rbd: nrd,
      rbdDeterminable: nrd !== null,
      rbdMissingFields: nrd === null ? ["NRD"] : [],
      inPayAtDopt: null,
      isPreDoptRetiree: false,
      isDeferredRecord: true,
      sbcd: null,
      spouseSsn: null,
      spouseLastName: null,
      spouseDob: null,
      spouseSex: null,
      spouseDateOfDeath: null,
      benSsn: null,
      benLastName: null,
      benDob: null,
      benSex: null,
      benDateOfDeath: null,
      apDob: null,
      apSex: null,
      apDateOfDeath: null,
      cspa: serviceStr,
      vspa: serviceStr,
      espa: serviceStr,
      cs: serviceStr,
      vs: serviceStr,
      es: serviceStr,
      csUnit: service === null ? null : "years",
      vsUnit: service === null ? null : "years",
      vppa: "1",
      paAmb: recordedMinor,
      paAcomp: meanAnnualMinor === null ? null : Math.round(meanAnnualMinor / 12),
      paAcompPeriodicity: "monthly",
      cuComp:
        lastSalary?.amount === null || lastSalary?.amount === undefined
          ? null
          : Math.round((lastSalary.amount.amountMinor ?? 0) / 12),
      pia: null,
      integrationMethod: "none",
      firstYear: ch?.firstYear.value ?? null,
      lastYear: ch?.lastYear.value ?? null,
      salaryByYear: (ch?.salaryByYear ?? []).map((s) => ({ year: s.salaryYear, amount: s.amount?.amountMinor ?? null })),
      annact: "A",
      annualizationBasisNoted: true,
      averagingPeriodYears: knownSalaries.map((s) => s.salaryYear),
      formCode: dote === null ? null : "NSF",
      formCodeNsf: "NSF",
      formCodeNmf: "NMF",
      formCodeQpsa: null,
      formCodeArd: null,
      spcVal: "0",
      spcNsf: "0",
      spcArd: "0",
      mths: 0,
      mthsNsf: 0,
      mthsArd: 0,
      formCodeIsJointLife: false,
      recordIsSingleLife: true,
      lsTerm: "N",
      xrd: nrd,
      xrdMbTerm: recordedMinor,
      pvReteec: null,
      measurementDate: dote,
      recordedDate: obs?.recordedDate.value ?? null,
      measurementDisagreementExplained: false,
      assertedBasisNrd: false,
      nrdBasisEvidence: false,
      explicitNoBenefitStatement: false,
      vestingTreatment: "gross",
      annuityForm: dote === null ? null : "NSF",
      annuityFormConversionDocumented: false,
      calcMeasurementDate: dote,
      calcAnnuityForm: dote === null ? null : "NSF",
      calcVestingTreatment: "gross",
      planFreezeDate: null,
      accrualAfterFreeze: false,
      benefitReflectsPostFreezeAccrual: false,
      mandcwi: null,
      volcwi: null,
      cashBalDopt: null,
      formulaType: "unit-credit",
      contributionTreatmentDocumented: true,
      cashBalanceExplanationDocumented: true,
      documentedMinimumOrGrandfatherOrPastServiceCredit: false,
      participationBeforeEligibility: false,
      serviceAccruesBeforeDop: false,
      parseError: null,
      badDates: [],
      badNumbers: [],
      fieldsWithoutProvenance: [],
      supportingEvidenceForScale: true,
      s001Derivable: true,
      scheduleProvided: true,
      scheduleRowExists: true,
      schedulePaAmb: recordedMinor,
      scheduleExplanationDocumented: false,
      bcvComparison: null,
      paymentAmountMinor: null,
      convertedPaAmbMinor: null,
      ardFactorsPresent: false,
      priorDistribution: null,
      formulaCheckValueMinor: null,
      formulaKnownForX06: false,
      formulaCheckValuesMinor: null,
      documentedHypothesis: false,
      pfFactors: null,
      proposedDisposition: null,
      evidenceCount: 0,
      paAmbAccept: null,
      disposition: null,
      decisionExists: false,
      rejectionRationaleStated: false,
      sourcesUsed: [],
      candidateMeasurementDates: dote === null ? [] : [dote],
      establishedMeasurementDate: dote,
      prior: null,
    };
  });
}

/** Run the Validate step on a loaded imported (non-demo) case. The
 *  validation context carries no tolerance (none is set for an imported
 *  case — the actuary sets it; the engine records not-applicable rather
 *  than comparing without one) and the file facts from the package. */
export function runValidateImportedStep(
  state: UiState,
  actor: string,
  occurredAt: string,
): { state: UiState; summary: { participantResults: number; rulesEvaluated: number; findings: number } } {
  const pkg = state.casePackage;
  if (pkg === null) throw new Error("No case loaded — load a case first.");
  const dopt = pkg.case.dopt.value;
  if (dopt === null) throw new Error("This case has no DOPT — validation needs the date of plan termination.");
  const today = state.calculationDate ?? occurredAt.slice(0, 10);
  const ctx: ValidationContext = {
    dopt,
    today,
    runId: "run-import-1",
    recordedDate: today,
    tolerance: null,
    serviceTolerance: "0",
    monthlyBenefitPlausibilityCap: 2500000,
    plausibleBenefitCompRatioRange: null,
    planServiceCreditRule: null,
    validFormCodes: ["NSF", "NMF", "QPSA", "J&S50", "J&S75", "J&S100"],
    file: {
      openable: true,
      truncated: false,
      hashMatches: true,
      hashBefore: "not-computed",
      hashAfter: "not-computed",
      macroRan: false,
      unknownFields: pkg.unmapped.map((u) => u.path),
    },
    priorExtract: null,
  };
  const next = runValidation(state, casePackageValidationParticipants(pkg), ctx, actor, occurredAt);
  const validation = must(next.validation, "validation result");
  return {
    state: next,
    summary: {
      participantResults: validation.participantResults.length,
      rulesEvaluated: validation.summary.rulesEvaluated,
      findings: validation.allFindings.length,
    },
  };
}

/** Run the Calculate step on the loaded demo case. */
export function runCalculateStep(
  state: UiState,
  actor: string,
  occurredAt: string,
): { state: UiState; summary: Record<string, { kind: string; minor: number | null }> } {
  const pkg = requireDemoCase(state);
  // Stage 7 Benchmarks defect 2: compute every outcome first, then
  // apply one batch (one spread per record, one render) instead of one
  // dispatch per participant.
  const events: AppEvent[] = [];
  const summary: Record<string, { kind: string; minor: number | null }> = {};
  for (const key of demoKeys(pkg)) {
    const outcome = calculateOne(demoBuildRequest(pkg, key), demoBuildInputs(pkg, key));
    events.push({ kind: "calculation-completed", participantKey: key, outcome, actor, occurredAt });
    summary[key] = {
      kind: outcome.kind,
      minor: outcome.kind === "exact" ? (outcome.benefit.amount?.amountMinor ?? null) : null,
    };
  }
  return { state: applyBatch(state, events), summary };
}

/** Run the Reconcile step on the loaded demo case. */
export function runReconcileStep(
  state: UiState,
  actor: string,
  occurredAt: string,
): { state: UiState; summary: Record<string, { delta: number | null; toleranceVerdict: string; recommended: string }> } {
  const pkg = requireDemoCase(state);
  const config: ReconciliationConfig = {
    epsilonRMinor: 100,
    epsilonRSource: "Demo case actuary, set for this demo case only",
    materialityMinor: 100,
    materialitySource: "Demo case tolerance v1 ($1.00)",
  };
  // Stage 7 Benchmarks defect 2: compute every reconciliation first,
  // then apply one batch. Stage 7 Accuracy G-ACC-4: each participant's
  // counterfactual candidates are tested here (service ±1y, documented
  // alternative averaging periods), so the reconcile recommendation is
  // made on the same evidence the Node oracle uses — with no candidates
  // it could never reach correction-recommended.
  const events: AppEvent[] = [];
  const summary: Record<string, { delta: number | null; toleranceVerdict: string; recommended: string }> = {};
  for (const key of demoKeys(pkg)) {
    const outcome = must(state.calculations[key], `calculation for ${key}`);
    const request = demoBuildRequest(pkg, key);
    const inputs = demoBuildInputs(pkg, key);
    const recInputs = buildReconciliationInputs({
      outcome,
      recorded: demoRecordedBenefit(pkg, key),
      toleranceApplied: DEMO_TOLERANCE,
      comparisonBasis: outcome.kind === "indeterminate" ? "unresolved" : "basis-converted",
      basisConversion: outcome.kind === "indeterminate" ? undefined : "vesting",
    });
    const rec = reconcileOne(key, recInputs, config, counterfactualCandidates(request, inputs));
    events.push({ kind: "reconciliation-completed", reconciliation: rec, actor, occurredAt });
    summary[key] = {
      delta: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
      toleranceVerdict: rec.toleranceVerdict,
      recommended: rec.recommendedDisposition,
    };
  }
  return { state: applyBatch(state, events), summary };
}

/** Run the Review statistics step on the loaded demo case. */
export function runStatisticsStep(
  state: UiState,
  actor: string,
  occurredAt: string,
): { state: UiState; summary: { populationN: number; flags: Array<{ key: string; method: string; score: number | null }> } } {
  const rows = demoStatRows(state);
  const thresholds: MaterialityThresholds = { absMinor: 100, relDecimal: "0.01", source: "case tolerance record v1" };
  const next = runStatistics(state, rows, thresholds, actor, occurredAt);
  return {
    state: next,
    summary: {
      populationN: must(next.statistics, "population statistics").pooled.n,
      flags: (next.statisticsOutliers?.flags ?? []).map((f) => ({ key: f.participantKey, method: f.method, score: f.score })),
    },
  };
}

/** Recommend a disposition for every demo participant. Approves nothing. */
export function runDecideRecommendStep(
  state: UiState,
  actor: string,
  occurredAt: string,
): { state: UiState; summary: Record<string, { recommended: string; status: string | null; refusal: string | null }> } {
  const pkg = requireDemoCase(state);
  let next = state;
  const summary: Record<string, { recommended: string; status: string | null; refusal: string | null }> = {};
  for (const key of demoKeys(pkg)) {
    const evidence = demoDecideEvidence(pkg, key);
    next = recordEvidence(next, key, evidence, actor, occurredAt);
    const { recommendation } = dispositionEntryInput(evidence);
    next = dispatchDisposition(
      next,
      key,
      { kind: "propose", actor, target: recommendation.disposition, evidenceChanged: true },
      actor,
      occurredAt,
    );
    const after = next.analysis.participants[key]?.disposition ?? null;
    summary[key] = {
      recommended: recommendation.disposition,
      status: after === null ? null : after.status,
      refusal: next.lastRefusal,
    };
  }
  return { state: next, summary };
}

/** Publish the contribution package (Export step) for the demo case. */
export function runPublishStep(
  state: UiState,
  actor: string,
  occurredAt: string,
): { state: UiState; summary: { findings: number; fragments: number; protocol: string } } {
  const outcome = must(state.calculations["SYN-001"], "calculation for SYN-001");
  const run: CalculationRun = {
    id: "run-demo-1", version: 1, supersedesId: null, sourceRecordIds: [],
    createdDate: "2026-11-12", createdBy: "demo",
    runId: "run-demo-1", caseId: "case-demo", ruleVersion: "0.1.0",
    inputSnapshot: { snapshotHash: "demo-synthetic-no-file", importIds: [], entityVersions: [], planVersionIds: [{ planVersionId: "pv-demo-1985", version: 1 }], formulaIds: [{ formulaId: "T-04", version: 1 }], ruleVersion: "2026-11-12", formulaTaxonomyVersion: "1.0", engineVersion: "0.1.0", toleranceRecordVersion: 1 },
    inputSnapshotHash: "demo-synthetic-no-file", runDate: "2026-11-12",
    runBy: "demo", participantScope: "all demo participants",
    resultsHash: "demo", engineVersion: "0.1.0",
    participantsComputed: 6, participantsChanged: [],
  };
  const log = buildPublishedLog({
    run, outcome, validations: [],
    determination: null, evidence: [], productVersion: "0.1.0",
  });
  const { state: next, contribution } = publishContribution(
    state, log,
    { caseId: "case-demo", productVersion: "0.1.0", producedAt: occurredAt, publishedBy: "demo", run },
    actor, occurredAt,
  );
  return {
    state: next,
    summary: { findings: log.findings.length, fragments: contribution.fragments.length, protocol: "0.1.0" },
  };
}

// ---------------------------------------------------------------------------
// Charts and reports for the current state
// ---------------------------------------------------------------------------

/** A chart that failed renders as a labelled placeholder, never a crash. */
export function renderChartOrPlaceholder(
  render: () => string,
  label: string,
): string {
  try {
    return render();
  } catch {
    return `<p>Chart not available: ${label}.</p>`;
  }
}

/** All five charts for the current state (empty strings when no data yet). */
export function chartsForState(state: UiState): {
  histogram: string;
  scatter: string;
  cohortBars: string;
  bounds: string;
  dispositions: string;
} {
  const reconciliations = Object.values(state.reconciliations);
  const empty = { histogram: "", scatter: "", cohortBars: "", bounds: "", dispositions: "" };
  if (reconciliations.length === 0) return empty;

  const comparable = reconciliations.filter((r) => r.comparison.comparable);
  const deltas = comparable
    .filter((r) => r.comparison.comparable)
    .map((r) => (r.comparison.comparable ? r.comparison.delta.amountMinor : 0));
  const flaggedKeys = new Set(
    (state.statisticsOutliers?.flags ?? []).map((flag) => flag.participantKey),
  );
  const scatterPoints: ScatterPoint[] = comparable
    .filter((r) => r.reconstructed !== null && r.reconstructed.amount !== null)
    .map((r) => ({
      x: r.reconstructed?.amount?.amountMinor ?? 0,
      y: r.comparison.comparable ? r.comparison.delta.amountMinor : 0,
      label: r.participantKey,
      flagged: flaggedKeys.has(r.participantKey),
    }));
  const cohortGroups: CohortGroup[] = (state.statistics?.byFormulaType ?? []).map((group) => ({
    name: group.key,
    n: group.n,
    meanDelta:
      group.delta.meanDollars === null ? 0 : Math.round(Number(group.delta.meanDollars) * 100),
    flagged: (state.statisticsOutliers?.flags ?? []).filter((flag) =>
      flag.cohort.startsWith(`${group.key} |`),
    ).length,
  }));
  const boundsRows: BoundsRow[] = reconciliations
    .filter((r) => r.bounds !== null)
    .map((r) => ({
      label: r.participantKey,
      min: r.bounds?.min.amountMinor ?? 0,
      max: r.bounds?.max.amountMinor ?? 0,
      recorded: r.recorded?.amount?.amountMinor ?? null,
    }));
  const byDisposition = dispositionsByParticipant(state);
  const counts: DispositionCount[] = (
    ["verified", "supported-for-acceptance", "requires-investigation", "correction-recommended", "indeterminate"] as Disposition[]
  ).map((d) => ({
    disposition: d,
    n: Object.values(byDisposition).filter((value) => value === d).length,
  }));
  const unassessed = Object.values(byDisposition).filter((value) => value === null).length;
  const withDisposition = counts.reduce((sum, c) => sum + c.n, 0);

  return {
    histogram: renderChartOrPlaceholder(
      () =>
        renderHistogram(deltas, {
          title: "Δ distribution",
          unit: "$/month",
          subtitle: `n = ${deltas.length} participants compared; unit: $/month (minor units)`,
        }),
      "Δ distribution histogram",
    ),
    scatter: renderChartOrPlaceholder(
      () =>
        renderScatter(scatterPoints, {
          title: "Δ against reconstructed benefit",
          xLabel: "Reconstructed benefit ($/month)",
          yLabel: "Δ ($/month)",
          subtitle: `n = ${scatterPoints.length} participants; flagged points are statistics-module outliers`,
        }),
      "Δ scatterplot",
    ),
    cohortBars: renderChartOrPlaceholder(
      () =>
        renderCohortBars(cohortGroups, {
          title: "Mean Δ by formula type",
          unit: "$/month",
          subtitle: `n = ${cohortGroups.reduce((s, g) => s + g.n, 0)} participants in ${cohortGroups.length} formula groups`,
        }),
      "cohort bars",
    ),
    bounds: renderChartOrPlaceholder(
      () =>
        renderBoundsView(boundsRows, {
          title: "Justified bounds and recorded PA_AMB",
          unit: "$/month",
          subtitle: `n = ${boundsRows.length} participants with justified bounds`,
        }),
      "bounds view",
    ),
    dispositions: renderChartOrPlaceholder(
      () =>
        renderDispositionBars(counts, {
          title: "Dispositions",
          subtitle: `n = ${withDisposition} participants with a disposition; ${unassessed} unassessed`,
        }),
      "disposition bars",
    ),
  };
}

/** Reproducibility pins for reports, from the current state. */
function reproducibilityForState(state: UiState): PlanReportInput["reproducibility"] {
  const toleranceVersion =
    state.casePackage === null
      ? "Not supplied"
      : `v${state.casePackage.case.toleranceRecord.version}`;
  return {
    inputSnapshotHash: state.analysis.inputSnapshot.snapshotHash,
    ruleVersion: state.analysis.ruleVersions.validationRules,
    formulaVersion: state.analysis.ruleVersions.formulaTaxonomy,
    toleranceVersion,
    engineVersion: ENGINE_VERSION,
  };
}

/** Plan-level report HTML for the current state. */
export function planReportForState(state: UiState): string {
  const pkg = state.casePackage;
  const reconciliations = Object.values(state.reconciliations);
  const comparable = reconciliations.filter((r) => r.comparison.comparable);
  const absDeltas = comparable
    .filter((r) => r.comparison.comparable)
    .map((r) => (r.comparison.comparable ? r.comparison.absDelta.amountMinor : 0));
  const meanAbs =
    absDeltas.length === 0
      ? null
      : Math.round(absDeltas.reduce((s, v) => s + v, 0) / absDeltas.length);
  const byDisposition = dispositionsByParticipant(state);
  const population = pkg === null ? null : pkg.participants.length;
  const input: PlanReportInput = {
    casePackage:
      pkg === null
        ? null
        : {
            caseNumber: pkg.case.caseNumber.value,
            planName: pkg.case.planName.value,
            planNumber: pkg.case.planNumber.value,
            dopt: pkg.case.dopt.value,
            participantCount: pkg.participants.length,
            completenessGrade: pkg.case.completenessGrade,
          },
    validationSummary:
      state.validation === null
        ? null
        : {
            totalFindings: state.validation.allFindings.length,
            bySeverity: state.validation.allFindings.reduce<Record<string, number>>(
              (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
              {},
            ),
            blockingCount: state.validation.allFindings.filter(
              (f) => f.blocksCalculation !== "No",
            ).length,
            findings: state.validation.allFindings.map((f) => ({
              ruleId: f.ruleId,
              severity: f.severity,
              discrepancy: f.discrepancy,
              blocksCalculation: f.blocksCalculation,
            })),
          },
    reconciliationSummary: {
      participantsCompared: comparable.length,
      matched: comparable.filter(
        (r) => r.comparison.comparable && r.comparison.delta.amountMinor === 0,
      ).length,
      withinTolerance: reconciliations.filter(
        (r) => r.toleranceVerdict === "within-tolerance",
      ).length,
      materialDifferences: reconciliations.filter(
        (r) => r.toleranceVerdict === "outside-tolerance",
      ).length,
      notComparable: reconciliations.filter((r) => !r.comparison.comparable).length,
      indeterminate: reconciliations.filter(
        (r) => r.recommendedDisposition === "indeterminate",
      ).length,
      blankPaAmb: reconciliations.filter((r) => r.recorded === null).length,
      meanAbsDeltaMinor: meanAbs,
      tolerance:
        pkg === null
          ? "No tolerance set — the app ships with none; the actuary sets the case tolerance."
          : `Case tolerance v${pkg.case.toleranceRecord.version} (${pkg.case.toleranceRecord.application})`,
      byGroup: (state.statistics?.byEmploymentGroup ?? []).map((g) => ({
        group: g.key,
        count: g.n,
        population: g.n,
        units: "participants",
      })),
    },
    statisticsSummary: {
      outliers: [
        {
          label: "Flagged within cohort",
          count: state.statisticsOutliers?.flags.length ?? 0,
          population,
          units: "participants",
        },
        {
          label: "Explained by group (not errors)",
          count: state.statisticsOutliers?.explainedByGroup.length ?? 0,
          population,
          units: "participants",
        },
      ],
      outlierNotes: [
        "Outlier flags are prompts to investigate, never corrections. A pooled flag explained by the participant's cohort is a group difference, not an error.",
      ],
    },
    dispositions: (
      ["verified", "supported-for-acceptance", "requires-investigation", "correction-recommended", "indeterminate"] as Disposition[]
    ).map((d) => ({
      disposition: d,
      count: Object.values(byDisposition).filter((value) => value === d).length,
      population,
    })),
    findings: (state.lastContribution?.findings ?? []).map((f) => ({
      findingId: f.findingId,
      findingStatement: f.findingStatement,
      claimType: f.claimType,
      reviewState: f.reviewState,
      material: f.materiality.material,
    })),
    missingData: (pkg?.participants ?? []).flatMap((p) =>
      p.missingData.map((m) => ({
        field: m.field,
        missingClass: m.missingClass,
        consequence: m.consequence,
        resolvesBy: m.resolvesBy,
      })),
    ),
    reproducibility: reproducibilityForState(state),
  };
  return renderPlanReport(input);
}

/** Participant-level report HTML, or null when nothing is reconciled yet. */
export function participantReportForState(
  state: UiState,
  participantKey: string,
): string | null {
  const reconciliation = state.reconciliations[participantKey];
  if (reconciliation === undefined) return null;
  const pkg = state.casePackage;
  const participant = pkg?.participants.find((p) => p.participantKey === participantKey);
  const observation = pkg?.benefitObservations.find(
    (o) => o.participantKey === participantKey,
  );
  const outcome = state.calculations[participantKey];
  const analysisParticipant = state.analysis.participants[participantKey];
  const disposition = analysisParticipant?.disposition ?? null;
  const input: ParticipantReportInput = {
    participant:
      participant === undefined
        ? { participantKey }
        : {
            participantKey,
            lastName: participant.lastName.value,
            firstName: participant.firstName.value,
            dob: participant.dob.value,
            sex: participant.sex.value,
            retstat: participant.retstat.value,
            completenessGrade: participant.completenessGrade,
          },
    inputs:
      observation === undefined
        ? null
        : [
            {
              field: "PA_AMB",
              value:
                observation.paAmb.value === null
                  ? "blank (missing)"
                  : `$${(observation.paAmb.value.amountMinor / 100).toFixed(2)}`,
              source: observation.sourceScheduleRow,
            },
          ],
    provisions: (pkg?.planVersions ?? []).map((v) => ({
      section: v.provisionSection.value,
      text: v.provisionText.value,
      effectiveDate: v.effectiveDate.value,
      formulaType: v.formulaIds.join(", "),
    })),
    recordedBenefit:
      observation === undefined
        ? null
        : {
            amountMinor: observation.paAmb.value?.amountMinor ?? null,
            measurementDate: observation.measurementDate,
            measurementBasis: observation.measurementBasis,
            annuityForm: observation.annuityForm,
            vestingTreatment: observation.vestingTreatment,
            source: observation.sourceScheduleRow,
            recordedDate: observation.recordedDate.value,
          },
    calculationTrace:
      outcome === undefined
        ? null
        : outcome.trace.map((step) => ({
            step: step.step,
            name: step.name,
            output: String(step.output),
            ruleRef: step.ruleRef,
            evidenceGrade: step.evidenceGrade,
            assumption: step.assumption,
          })),
    events: (pkg?.events ?? [])
      .filter((e) => e.affectedParticipantKeys.includes(participantKey))
      .map((e) => ({ date: e.eventDate, event: e.summary, effect: e.kind })),
    comparison:
      reconciliation.comparison.comparable
        ? {
            deltaMinor: reconciliation.comparison.delta.amountMinor,
            absDeltaMinor: reconciliation.comparison.absDelta.amountMinor,
            relDelta:
              reconciliation.comparison.relative.kind === "defined"
                ? reconciliation.comparison.relative.value
                : reconciliation.comparison.relative.flag,
            withinTolerance: reconciliation.toleranceVerdict === "within-tolerance",
            tolerance: reconciliation.toleranceDetail,
            status: reconciliation.toleranceVerdict,
            basis: "same-basis",
          }
        : {
            deltaMinor: null,
            absDeltaMinor: null,
            relDelta: null,
            withinTolerance: null,
            tolerance: reconciliation.toleranceDetail,
            status: "not-comparable",
            basis: "unresolved",
          },
    hypotheses: reconciliation.hypotheses.map((h, index) => ({
      type: h.hypothesisCode,
      counterfactual: h.operation.kind,
      status: h.supportClass,
      rank: index + 1,
      evidence: h.evidenceFor.join("; "),
    })),
    missingInfo: (participant?.missingData ?? []).map((m) => ({
      field: m.field,
      missingClass: m.missingClass,
      consequence: m.consequence,
      resolvesBy: m.resolvesBy,
    })),
    determination:
      disposition === null
        ? null
        : {
            disposition: disposition.disposition,
            rationale: "Not supplied — the determination rationale lives in the DeterminationRecord, not in UI state.",
            reviewer: disposition.createdBy,
            determinationDate: disposition.createdAt,
            paAmbAccept: disposition.downstreamUse.paAmbAccept,
            correctedBenefitMinor:
              disposition.downstreamUse.valueKind === "corrected"
                ? disposition.downstreamUse.valueCents
                : null,
          },
    reproducibility: reproducibilityForState(state),
  };
  return renderParticipantReport(input);
}

/** AMB memo HTML, or null when no contribution is published yet. */
export function ambMemoForState(state: UiState): string | null {
  const contribution = state.lastContribution;
  if (contribution === null) return null;
  const fragment =
    contribution.fragments.find((f) => f.targetTopicKeys.includes("data_issues")) ?? null;
  return renderAmbMemo({
    contribution,
    dataIssuesFragment: fragment,
    reproducibility: reproducibilityForState(state),
  });
}

// ---------------------------------------------------------------------------
// Exports (audit log, CSV, XLSX, contribution package)
// ---------------------------------------------------------------------------

/** Audit-log text for the current state (engine events, chronological). */
export function exportAuditLogText(state: UiState): string {
  const events: ExportAuditEvent[] = state.analysis.auditLog.map((e) => ({
    at: e.occurredAt,
    actor: e.actor,
    action: e.kind,
    detail: e.summary,
  }));
  return buildAuditLog(events);
}

/** True when the reviewer confirmed a sensitive participant-data export. */
function reviewerConfirmsSensitiveExport(kind: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false;
  }
  return window.confirm(sensitiveExportWarningText(kind));
}

/**
 * Download the reconciliation table as CSV. Shows the §19 sensitive-data
 * warning first; returns false when the reviewer does not confirm.
 * DOM-guarded: false with no document.
 */
export function downloadReconciliationCsv(state: UiState): boolean {
  if (typeof document === "undefined") return false;
  if (!reviewerConfirmsSensitiveExport("participant-data")) return false;
  const header = [
    "participantKey",
    "recordedMinor",
    "reconstructedMinor",
    "deltaMinor",
    "absDeltaMinor",
    "relDelta",
    "toleranceVerdict",
    "recommendedDisposition",
  ];
  const rows: string[][] = [header];
  for (const r of Object.values(state.reconciliations)) {
    rows.push([
      r.participantKey,
      r.recorded?.amount?.amountMinor === undefined
        ? ""
        : String(r.recorded?.amount?.amountMinor ?? ""),
      r.reconstructed?.amount?.amountMinor === undefined
        ? ""
        : String(r.reconstructed?.amount?.amountMinor ?? ""),
      r.comparison.comparable ? String(r.comparison.delta.amountMinor) : "",
      r.comparison.comparable ? String(r.comparison.absDelta.amountMinor) : "",
      r.comparison.comparable && r.comparison.relative.kind === "defined"
        ? r.comparison.relative.value
        : "",
      r.toleranceVerdict,
      r.recommendedDisposition,
    ]);
  }
  const caseNumber = state.casePackage?.case.caseNumber.value ?? "case";
  downloadCsv(`${caseNumber}-reconciliation.csv`, buildCsv(rows));
  return true;
}

/** Download the reconciliation table as XLSX. Same §19 warning gate as CSV. */
export function downloadReconciliationXlsx(state: UiState): boolean {
  if (typeof document === "undefined") return false;
  if (!reviewerConfirmsSensitiveExport("participant-data")) return false;
  const header: Array<string | number> = [
    "participantKey",
    "recordedMinor",
    "reconstructedMinor",
    "deltaMinor",
    "absDeltaMinor",
    "relDelta",
    "toleranceVerdict",
    "recommendedDisposition",
  ];
  const rows: Array<ReadonlyArray<string | number>> = [header];
  for (const r of Object.values(state.reconciliations)) {
    rows.push([
      r.participantKey,
      r.recorded?.amount?.amountMinor ?? "",
      r.reconstructed?.amount?.amountMinor ?? "",
      r.comparison.comparable ? r.comparison.delta.amountMinor : "",
      r.comparison.comparable ? r.comparison.absDelta.amountMinor : "",
      r.comparison.comparable && r.comparison.relative.kind === "defined"
        ? r.comparison.relative.value
        : "",
      r.toleranceVerdict,
      r.recommendedDisposition,
    ]);
  }
  const sheets: XlsxSheet[] = [{ name: "Reconciliation", rows }];
  const caseNumber = state.casePackage?.case.caseNumber.value ?? "case";
  downloadXlsx(`${caseNumber}-reconciliation.xlsx`, buildXlsx(sheets));
  return true;
}

/** Download the last published contribution package as JSON. False when none.
 *  Stage 7 Compliance D2: gated on the §19 sensitive-data warning like
 *  the CSV/XLSX exports — the contribution package carries
 *  participant-level findings. */
export function downloadContributionJson(state: UiState): boolean {
  if (typeof document === "undefined") return false;
  if (!reviewerConfirmsSensitiveExport("participant-data")) return false;
  if (state.lastContribution === null) return false;
  const caseNumber = state.casePackage?.case.caseNumber.value ?? "case";
  downloadJson(
    `${caseNumber}-amb-contribution.json`,
    buildContributionPackage(state.lastContribution),
  );
  return true;
}

/** Download the exported audit log as JSON. False with no document.
 *  Stage 7 Compliance D2: gated on the §19 sensitive-data warning —
 *  the audit log carries participant keys, dispositions, and reviewer
 *  names. Returns false when the reviewer does not confirm. */
export function downloadAuditLogJson(state: UiState): boolean {
  if (typeof document === "undefined") return false;
  if (!reviewerConfirmsSensitiveExport("participant-data")) return false;
  const caseNumber = state.casePackage?.case.caseNumber.value ?? "case";
  downloadJson(
    `${caseNumber}-audit-log.json`,
    JSON.stringify(state.analysis.auditLog, null, 2),
  );
  return true;
}

// ---------------------------------------------------------------------------
// Shell rendering (DOM-guarded)
// ---------------------------------------------------------------------------

export interface BootOptions {
  rootId?: string;
  initialState?: UiState;
  onStateChange?: (state: UiState) => void;
  actor?: string;
}

export interface AppHandle {
  getState: () => UiState;
  dispatch: (event: AppEvent) => void;
  /** Apply many events in one batch, then render once (Stage 7
   *  Benchmarks defect 2: one render per step, not per dispatch). */
  dispatchMany: (events: readonly AppEvent[]) => void;
  render: () => void;
  destroy: () => void;
}

function elementById(root: HTMLElement, id: string): HTMLElement | null {
  const found = root.querySelector(`#${id}`);
  return found instanceof HTMLElement ? found : null;
}

/** Render the shell from state: nav locks, panels, status, invariants, charts, reports. */
export function renderApp(root: HTMLElement, state: UiState): void {
  const themeButton = elementById(root, "theme-toggle");
  if (themeButton !== null) {
    themeButton.textContent = themeToggleLabel(state.theme);
    themeButton.setAttribute("aria-label", themeToggleLabel(state.theme));
  }
  const viewButton = elementById(root, "view-mode-toggle");
  if (viewButton !== null) {
    viewButton.textContent =
      state.wizard.mode === "wizard" ? "Advanced view" : "Wizard view";
  }

  // Wizard navigation: lock state + current step.
  const navButtons = root.querySelectorAll<HTMLElement>("[data-wizard-step]");
  navButtons.forEach((button) => {
    const stepId = button.getAttribute("data-wizard-step") as WizardStepId | null;
    if (stepId === null) return;
    const lock = stepLock(state.wizard, stepId);
    if (button instanceof HTMLButtonElement) button.disabled = lock.locked;
    button.setAttribute("aria-current", state.wizard.currentStep === stepId ? "step" : "false");
    button.setAttribute("aria-disabled", lock.locked ? "true" : "false");
    button.title = lock.locked ? (lock.reason ?? "Locked") : wizardStepLabel(stepId);
  });

  // Step panels: wizard mode shows the current step only.
  const panels = root.querySelectorAll<HTMLElement>("[data-step-panel]");
  panels.forEach((panel) => {
    const stepId = panel.getAttribute("data-step-panel");
    panel.hidden = state.wizard.mode !== "wizard" || stepId !== state.wizard.currentStep;
  });
  // Run buttons: disabled while their step is locked, with the lock reason as the title.
  // A Run button runs its step on the loaded demo case (see the step runners in main.ts).
  const runButtons = root.querySelectorAll<HTMLElement>("[data-run-step]");
  runButtons.forEach((button) => {
    const stepId = button.getAttribute("data-run-step") as WizardStepId | null;
    if (stepId === null) return;
    const lock = stepLock(state.wizard, stepId);
    if (button instanceof HTMLButtonElement) button.disabled = lock.locked;
    button.setAttribute("aria-disabled", lock.locked ? "true" : "false");
    button.title = lock.locked ? (lock.reason ?? "Locked") : `Run ${wizardStepLabel(stepId)} on the loaded demo case`;
  });
  const wizardView = elementById(root, "wizard-view");
  if (wizardView !== null) wizardView.hidden = state.wizard.mode !== "wizard";
  const advancedView = elementById(root, "advanced-view");
  if (advancedView !== null) {
    advancedView.hidden = state.wizard.mode !== "advanced";
    if (state.wizard.mode === "advanced") {
      advancedView.innerHTML = WIZARD_STEPS.map((step) => {
        const lock = stepLock(state.wizard, step.id);
        return (
          `<section><h3>${step.label}</h3>` +
          `<p>${lock.locked ? `Locked: ${lock.reason ?? ""}` : "Open."}</p>` +
          `<p>Shows: ${step.shows}</p>` +
          `<p>Runs: ${step.engineCall}</p></section>`
        );
      }).join("");
    }
  }

  // Status line.
  const status = elementById(root, "status-line");
  if (status !== null) {
    const participantCount = Object.keys(state.analysis.participants).length;
    const refusal = state.lastRefusal === null ? "" : ` Refused: ${state.lastRefusal}`;
    status.textContent =
      `Case ${state.analysis.caseId} | ${participantCount} participants | ` +
      `snapshot ${state.analysis.inputSnapshot.snapshotHash} | ` +
      `step ${state.wizard.currentStep}${refusal}`;
  }

  // Invariants.
  const invariantList = elementById(root, "invariant-list");
  if (invariantList !== null) {
    invariantList.innerHTML = checkAllInvariants(state)
      .map(
        (check) =>
          `<li>${check.holds ? "Pass" : "Fail"} — Invariant ${check.id} ${check.name}: ${check.detail}</li>`,
      )
      .join("");
  }

  // Disposition summary.
  const dispositionSummary = elementById(root, "disposition-summary");
  if (dispositionSummary !== null) {
    const byDisposition = dispositionsByParticipant(state);
    const counts: Record<string, number> = {};
    for (const value of Object.values(byDisposition)) {
      const key = value === null ? "unassessed" : value;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    dispositionSummary.textContent = Object.entries(counts)
      .map(([key, n]) => `${key}: ${n}`)
      .join(" | ");
  }

  // Charts.
  const chartArea = elementById(root, "chart-area");
  if (chartArea !== null) {
    const charts = chartsForState(state);
    const parts = [charts.histogram, charts.scatter, charts.cohortBars, charts.bounds, charts.dispositions].filter(
      (part) => part.length > 0,
    );
    chartArea.innerHTML =
      parts.length === 0
        ? "<p>No charts yet — run Calculate and Reconcile first.</p>"
        : parts.join("");
  }

  // Reports: selected participant report, else the plan report.
  const reportArea = elementById(root, "report-area");
  if (reportArea !== null) {
    if (state.selectedParticipantKey !== null) {
      const participantReport = participantReportForState(state, state.selectedParticipantKey);
      reportArea.innerHTML =
        participantReport ?? "<p>No report for this participant yet — run Calculate and Reconcile first.</p>";
    } else if (state.statistics !== null) {
      reportArea.innerHTML = planReportForState(state);
    } else {
      reportArea.innerHTML = "<p>No report yet — run Validate, Calculate, Reconcile, and Review statistics first.</p>";
    }
  }
}

/** Current time as an ISO string (UI-layer timestamp for events; the engine never reads a clock). */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The timestamp for a UI event (Stage 7 Repro D3). When a calculation
 * date is pinned in state, every event timestamp is derived from it
 * (`<date>T00:00:00.000Z`), so a hand-driven run reproduces
 * byte-identical outputs; the wall clock is then display-only and never
 * enters a calculation, an event id, or an audit record. With no pin,
 * the wall clock is used (the old behaviour, not reproducible by hand).
 */
export function calculationTimestamp(state: UiState): string {
  return state.calculationDate === null ? nowIso() : `${state.calculationDate}T00:00:00.000Z`;
}

/** Pin (or clear, with null) the calculation date for the run. */
export function setCalculationDate(
  state: UiState,
  date: string | null,
  actor: string,
  occurredAt: string,
): UiState {
  return applyEvent(state, { kind: "set-calculation-date", date, actor, occurredAt });
}

/**
 * Boot the app into the element with `rootId` (default "pa-amb-app").
 * Returns null with no document, or when the root element is missing.
 * The theme is loaded from defensive storage and applied on boot.
 */
export function bootApp(options?: BootOptions): AppHandle | null {
  if (typeof document === "undefined") return null;
  const root = document.getElementById(options?.rootId ?? "pa-amb-app");
  if (root === null) return null;

  const actor = options?.actor ?? "user";
  let state: UiState = options?.initialState ?? createEmptyUiState();
  state = { ...state, theme: loadTheme() };
  applyThemeToDocument(state.theme);

  const listeners: Array<{ target: HTMLElement; type: string; handler: EventListener }> = [];
  const listen = (target: HTMLElement | null, type: string, handler: (event: Event) => void): void => {
    if (target === null) return;
    const listener = handler as EventListener;
    target.addEventListener(type, listener);
    listeners.push({ target, type, handler: listener });
  };

  const handle: AppHandle = {
    getState: () => state,
    dispatch: (event: AppEvent) => {
      state = applyEvent(state, event);
      if (event.kind === "set-theme") setTheme(state.theme);
      renderApp(root, state);
      options?.onStateChange?.(state);
    },
    dispatchMany: (events: readonly AppEvent[]) => {
      state = applyBatch(state, events);
      renderApp(root, state);
      options?.onStateChange?.(state);
    },
    render: () => renderApp(root, state),
    destroy: () => {
      for (const { target, type, handler } of listeners) {
        target.removeEventListener(type, handler);
      }
      listeners.length = 0;
    },
  };

  listen(elementById(root, "theme-toggle"), "click", () => {
    handle.dispatch({
      kind: "set-theme",
      theme: toggleThemeName(state.theme),
      actor,
      occurredAt: calculationTimestamp(state),
    });
  });
  listen(elementById(root, "view-mode-toggle"), "click", () => {
    handle.dispatch({
      kind: "set-view-mode",
      mode: state.wizard.mode === "wizard" ? "advanced" : "wizard",
      actor,
      occurredAt: calculationTimestamp(state),
    });
  });
  listen(elementById(root, "help-button"), "click", () => {
    const panel = elementById(root, "help-panel");
    if (panel === null) return;
    if (panel.hidden) {
      panel.innerHTML = renderHelpCentre();
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  });
  listen(elementById(root, "tour-button"), "click", () => {
    runOnboarding({
      onStep: (stepId: string) => {
        const isStep = (WIZARD_STEPS as readonly { id: string }[]).some((s) => s.id === stepId);
        if (!isStep) return;
        handle.dispatch({
          kind: "wizard-go-to",
          step: stepId as WizardStepId,
          actor,
          occurredAt: calculationTimestamp(state),
        });
      },
      skip: () => undefined,
    });
  });
  listen(elementById(root, "demo-button"), "click", () => {
    state = loadDemoCase(state, actor, calculationTimestamp(state));
    renderApp(root, state);
    options?.onStateChange?.(state);
  });
  // File import (Stage 7 Robustness D3, Stage 8 XLSX): the picker
  // hands CSV/JSON text to importFileText and XLSX/XLSM bytes to
  // importFileBytes. A refused file changes nothing and the reason
  // is shown in the import status and the status line. A workbook
  // with more than one sheet waits for the sheet chooser: the file
  // is parsed once, the chooser lists the sheets, and the Import
  // sheet button imports the chosen sheet.
  const importInput = root.querySelector<HTMLInputElement>("#import-file");
  if (importInput !== null) {
    // Parsed workbook waiting for a sheet choice (null when none).
    let pendingXlsx: { fileName: string; parsed: XlsxParseResult } | null = null;
    const showImportResult = (
      result: { state: UiState; report: ImportReport | null; error: string | null },
    ): void => {
      const statusEl = elementById(root, "import-status");
      if (result.error !== null) {
        if (statusEl !== null) statusEl.textContent = result.error;
        renderApp(root, state);
        const status = elementById(root, "status-line");
        if (status !== null) status.textContent = `Could not import: ${result.error}`;
        return;
      }
      state = result.state;
      if (result.report !== null && statusEl !== null) {
        statusEl.textContent = importReportSummary(result.report);
      }
      renderApp(root, state);
      options?.onStateChange?.(state);
    };
    const hideSheetChooser = (): void => {
      pendingXlsx = null;
      const row = elementById(root, "import-sheet-row");
      if (row !== null) row.hidden = true;
    };
    listen(importInput, "change", () => {
      const file = importInput.files?.[0];
      if (file === undefined || file === null) return;
      hideSheetChooser();
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
        const reader = new FileReader();
        reader.onload = () => {
          const buffer = reader.result;
          if (!(buffer instanceof ArrayBuffer)) {
            const statusEl = elementById(root, "import-status");
            if (statusEl !== null) statusEl.textContent = `Could not read ${file.name}.`;
            return;
          }
          let parsed: XlsxParseResult;
          try {
            parsed = previewXlsx(new Uint8Array(buffer));
          } catch (err) {
            showImportResult({
              state,
              report: null,
              error: err instanceof Error ? err.message : String(err),
            });
            return;
          }
          if (parsed.sheets.length === 1) {
            const only = parsed.sheets[0] as (typeof parsed.sheets)[number];
            showImportResult(
              importMappedRows(
                state,
                file.name,
                only.rows.map(mapImportedRow),
                only.headers,
                only.rows.length,
                parsed.fileHashSha256,
                actor,
                calculationTimestamp(state),
                {
                  warnings: [...parsed.warnings, ...only.warnings],
                  sheetName: only.name,
                  sheetNames: parsed.sheets.map((s) => s.name),
                },
              ),
            );
            return;
          }
          pendingXlsx = { fileName: file.name, parsed };
          const select = root.querySelector<HTMLSelectElement>("#import-sheet");
          const row = elementById(root, "import-sheet-row");
          const statusEl = elementById(root, "import-status");
          if (select !== null) {
            select.innerHTML = parsed.sheets
              .map((s) => `<option value="${s.name.replace(/"/g, "&quot;")}">${s.name.replace(/</g, "&lt;")}</option>`)
              .join("");
          }
          if (row !== null) row.hidden = false;
          if (statusEl !== null) {
            statusEl.textContent =
              `${file.name} has ${parsed.sheets.length} sheets. Choose a sheet, then press Import sheet. ` +
              `Only the chosen sheet is imported.`;
          }
        };
        reader.onerror = () => {
          const statusEl = elementById(root, "import-status");
          if (statusEl !== null) statusEl.textContent = `Could not read ${file.name}.`;
        };
        reader.readAsArrayBuffer(file);
        importInput.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        showImportResult(importFileText(state, file.name, text, actor, calculationTimestamp(state)));
      };
      reader.onerror = () => {
        const statusEl = elementById(root, "import-status");
        if (statusEl !== null) statusEl.textContent = `Could not read ${file.name}.`;
      };
      reader.readAsText(file);
      importInput.value = "";
    });
    const sheetConfirm = elementById(root, "import-sheet-confirm");
    if (sheetConfirm !== null) {
      listen(sheetConfirm, "click", () => {
        if (pendingXlsx === null) return;
        const select = root.querySelector<HTMLSelectElement>("#import-sheet");
        const chosen = select === null ? null : select.value;
        if (chosen === null || chosen === "") return;
        // No re-parse: the pending result already holds the chosen
        // sheet's rows. They go through the shared row path, so the
        // same dopt rule, case-number fallback, and quarantine rules
        // apply as for a single-sheet import.
        const sheet = pendingXlsx.parsed.sheets.find((s) => s.name === chosen);
        if (sheet === undefined) return;
        const mapped = sheet.rows.map(mapImportedRow);
        const result = importMappedRows(
          state,
          pendingXlsx.fileName,
          mapped,
          sheet.headers,
          sheet.rows.length,
          pendingXlsx.parsed.fileHashSha256,
          actor,
          calculationTimestamp(state),
          {
            warnings: [...pendingXlsx.parsed.warnings, ...sheet.warnings],
            sheetName: sheet.name,
            sheetNames: pendingXlsx.parsed.sheets.map((s) => s.name),
          },
        );
        hideSheetChooser();
        showImportResult(result);
      });
    }
  }
  // Calculation date (Stage 7 Repro D3): pinning a date makes a
  // hand-driven run reproducible; clearing it returns to wall-clock
  // timestamps. The input shows the pinned date, if any.
  const calcDateInput = root.querySelector<HTMLInputElement>("#calculation-date");
  if (calcDateInput !== null) {
    if (state.calculationDate !== null) calcDateInput.value = state.calculationDate;
    listen(calcDateInput, "change", () => {
      const value = calcDateInput.value.trim();
      state = setCalculationDate(
        state,
        value === "" ? null : value,
        actor,
        calculationTimestamp(state),
      );
      renderApp(root, state);
      options?.onStateChange?.(state);
    });
  }
  // Run buttons: each step runner takes the current state and returns the
  // next state; a refusal (no demo case loaded, a prior step not run) is
  // shown in plain words in the status line and changes nothing.
  const attemptRun = (
    runner: (s: UiState) => { state: UiState },
  ): void => {
    try {
      const result = runner(state);
      state = result.state;
      renderApp(root, state);
      options?.onStateChange?.(state);
    } catch (error) {
      renderApp(root, state);
      const status = elementById(root, "status-line");
      if (status !== null) {
        status.textContent = `Could not run: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  };
  listen(elementById(root, "run-validate"), "click", () => {
    attemptRun((s) => runValidateStep(s, actor, calculationTimestamp(s)));
  });
  listen(elementById(root, "run-calculate"), "click", () => {
    attemptRun((s) => runCalculateStep(s, actor, calculationTimestamp(s)));
  });
  listen(elementById(root, "run-reconcile"), "click", () => {
    attemptRun((s) => runReconcileStep(s, actor, calculationTimestamp(s)));
  });
  listen(elementById(root, "run-statistics"), "click", () => {
    attemptRun((s) => runStatisticsStep(s, actor, calculationTimestamp(s)));
  });
  listen(elementById(root, "run-decide"), "click", () => {
    attemptRun((s) => runDecideRecommendStep(s, actor, calculationTimestamp(s)));
  });
  listen(elementById(root, "run-publish"), "click", () => {
    attemptRun((s) => runPublishStep(s, actor, calculationTimestamp(s)));
  });
  listen(elementById(root, "export-audit-log"), "click", () => {
    downloadAuditLogJson(state);
  });
  listen(elementById(root, "export-reconciliation-csv"), "click", () => {
    downloadReconciliationCsv(state);
  });
  listen(elementById(root, "export-reconciliation-xlsx"), "click", () => {
    downloadReconciliationXlsx(state);
  });
  listen(elementById(root, "export-contribution"), "click", () => {
    downloadContributionJson(state);
  });

  root.querySelectorAll<HTMLElement>("[data-wizard-step]").forEach((button) => {
    listen(button, "click", () => {
      const stepId = button.getAttribute("data-wizard-step") as WizardStepId | null;
      if (stepId === null) return;
      handle.dispatch({ kind: "wizard-go-to", step: stepId, actor, occurredAt: calculationTimestamp(state) });
    });
  });
  root.querySelectorAll<HTMLElement>("[data-help-topic]").forEach((button) => {
    listen(button, "click", () => {
      const panel = elementById(root, "help-panel");
      const topic = button.getAttribute("data-help-topic");
      if (panel === null || topic === null) return;
      panel.innerHTML = renderContextHelp(topic);
      panel.hidden = false;
    });
  });
  root.querySelectorAll<HTMLElement>("[data-select-participant]").forEach((button) => {
    listen(button, "click", () => {
      const key = button.getAttribute("data-select-participant");
      handle.dispatch({
        kind: "select-participant",
        participantKey: key,
        actor,
        occurredAt: calculationTimestamp(state),
      });
    });
  });

  renderApp(root, state);
  return handle;
}
