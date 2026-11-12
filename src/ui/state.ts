/**
 * UI state — Stage 6 UI core (Worker A).
 *
 * MASTER_PROMPT §17: S_{t+1} = T(S_t, E_t). The case-analysis state
 * itself lives in the engine (src/decisions.ts `CaseAnalysisState` and
 * `applyCaseEvent` — the disposition state machine, T1–T12, guards
 * G-INV-1–9, G-IND-1–2). This module does NOT re-implement that
 * machine. It wraps it in the UI state — wizard progress, theme,
 * selection, engine outputs awaiting display, and the UI event log —
 * and defines the UI-level transition `applyEvent`, which delegates
 * every analytic event to the engine and handles UI-only events
 * locally. Sources are immutable: applyEvent never writes a source
 * record; a source change arrives as an engine source-update event
 * with a new snapshot hash, and the old hash stays in the audit log.
 *
 * The UI recommends dispositions and hypotheses; it never decides.
 * Approval stays a human act through the engine transition (T3).
 *
 * Pure functions only. No DOM, no storage, no clock, no network.
 * Ids and timestamps are caller-supplied on every event.
 */

import { ENGINE_VERSION } from "../index";
import {
  CASE_STATE_VERSION,
  DISPOSITION_SCHEMA_VERSION,
  applyCaseEvent,
  checkRunCompleteness,
  makeAuditEvent,
} from "../decisions";
import type {
  AnalysisEvent,
  AuditEvent,
  AuditEventKind,
  CaseAnalysisState,
  EntryCheckInput,
  ParticipantAnalysis,
} from "../decisions";
import type { CasePackage, CompletenessGrade, Disposition } from "../types";
import { CATALOG_VERSION } from "../validation";
import type { CaseValidationResult } from "../validation";
import type { CalculationOutcome } from "../types";
import type { ParticipantReconciliation } from "../reconcile";
import type {
  OutlierDetectionResult,
  PopulationDescription,
} from "../statistics";
import type { WorkProductContribution } from "../contribution";
import {
  WIZARD_STEPS,
  completeStep,
  createInitialWizardProgress,
  goToStep,
  setViewMode,
  wizardStepDef,
} from "./wizard";
import type { ViewMode, WizardProgress, WizardStepId } from "./wizard";
import type { ThemeName } from "./theme";

/** Re-exported engine state types: the UI wraps them, never redefines them. */
export type { AnalysisEvent, AuditEvent, CaseAnalysisState, ParticipantAnalysis } from "../decisions";

/** UI state schema version. Additive changes bump minor; breaking
 *  changes bump major, always with a change note. */
export const UI_STATE_VERSION = "1.0.0";

/**
 * The UI state. `analysis` is the engine case-analysis state (§17 S_t);
 * the rest is workflow and display state. Engine outputs that have no
 * engine-entity form yet (a CalculationOutcome is not a
 * BenefitCalculation record; a ParticipantReconciliation is not a
 * BenefitComparison record) are held here under `calculations` /
 * `reconciliations` until a record-building step exists — they are
 * never converted by hand-waving into engine entities.
 */
export interface UiState {
  version: string;
  /** Engine case-analysis state (src/decisions.ts). */
  analysis: CaseAnalysisState;
  /** Imported case package (immutable source). Null before import. */
  casePackage: CasePackage | null;
  /** Wizard progress (current step, completion, wizard/advanced mode). */
  wizard: WizardProgress;
  /** Display theme. Persisted by main.ts after applyEvent, never here. */
  theme: ThemeName;
  /** Participant under drill-down. Null when none is selected. */
  selectedParticipantKey: string | null;
  /** Last validation run, or null before validation. */
  validation: CaseValidationResult | null;
  /** Calculation outcomes by participant key. */
  calculations: Record<string, CalculationOutcome>;
  /** Reconciliation records by participant key. */
  reconciliations: Record<string, ParticipantReconciliation>;
  /** Last population statistics, or null before the statistics step. */
  statistics: PopulationDescription | null;
  /** Last outlier screen, or null before the statistics step. */
  statisticsOutliers: OutlierDetectionResult | null;
  /** Last published contribution package, or null before export. */
  lastContribution: WorkProductContribution | null;
  /**
   * Pinned calculation date (YYYY-MM-DD), or null when none is set
   * (Stage 7 Repro D3). When set, every event timestamp in the run is
   * derived from it, so a hand-driven run reproduces byte-identical
   * outputs; the wall clock is then display-only and never enters a
   * calculation, an event id, or an audit record. Null means "use the
   * wall clock" (the old behaviour) and is not reproducible by hand.
   */
  calculationDate: string | null;
  /** Append-only UI event log. Every event applyEvent receives is
   *  recorded here, including refused ones. Never edited, never deleted. */
  eventLog: AppEvent[];
  /** Plain-language reason the last event was refused, or null. */
  lastRefusal: string | null;
}

/**
 * App events E_t: the engine's four families (user action, source
 * update, rule revision, calculation event — wrapped as one
 * `analysis-event`), plus UI-only events (wizard navigation,
 * selection, theme, view mode) and engine-output arrivals
 * (validation / calculation / reconciliation / statistics /
 * contribution results, stored for display).
 */
export type AppEvent =
  | { kind: "analysis-event"; event: AnalysisEvent }
  | {
      kind: "import-case-package";
      casePackage: CasePackage;
      actor: string;
      occurredAt: string;
    }
  | {
      kind: "validation-completed";
      result: CaseValidationResult;
      actor: string;
      occurredAt: string;
    }
  | {
      kind: "calculation-completed";
      participantKey: string;
      outcome: CalculationOutcome;
      actor: string;
      occurredAt: string;
    }
  | {
      kind: "reconciliation-completed";
      reconciliation: ParticipantReconciliation;
      actor: string;
      occurredAt: string;
    }
  | {
      kind: "statistics-completed";
      population: PopulationDescription;
      outliers: OutlierDetectionResult | null;
      actor: string;
      occurredAt: string;
    }
  | {
      kind: "contribution-published";
      contribution: WorkProductContribution;
      actor: string;
      occurredAt: string;
    }
  | {
      kind: "evidence-recorded";
      participantKey: string;
      evidence: EntryCheckInput;
      actor: string;
      occurredAt: string;
    }
  | { kind: "wizard-go-to"; step: WizardStepId; actor: string; occurredAt: string }
  | { kind: "wizard-complete-step"; step: WizardStepId; actor: string; occurredAt: string }
  | {
      kind: "select-participant";
      participantKey: string | null;
      actor: string;
      occurredAt: string;
    }
  | { kind: "set-view-mode"; mode: ViewMode; actor: string; occurredAt: string }
  | { kind: "set-theme"; theme: ThemeName; actor: string; occurredAt: string }
  | {
      kind: "set-calculation-date";
      /** Pinned calculation date (YYYY-MM-DD), or null to clear the pin. */
      date: string | null;
      actor: string;
      occurredAt: string;
    };

/** Inputs to build a fresh engine case-analysis state. */
export interface CreateAnalysisStateArgs {
  caseId: string;
  snapshotHash: string;
  sourceDocuments: CaseAnalysisState["inputSnapshot"]["sourceDocuments"];
  planVersions: CaseAnalysisState["planProvisions"];
  participantKeys: readonly string[];
  completenessGrades?: Readonly<Record<string, CompletenessGrade>>;
  toleranceSetId: string;
  formulaTaxonomyVersion?: string;
  validationRulesVersion?: string;
}

/**
 * Build a fresh engine case-analysis state: every in-scope participant
 * unassessed, no evidence yet, empty audit log. This constructs the
 * state value; it does not run the transition function.
 */
export function createCaseAnalysisState(args: CreateAnalysisStateArgs): CaseAnalysisState {
  const participants: Record<string, ParticipantAnalysis> = {};
  for (const key of args.participantKeys) {
    participants[key] = {
      participantKey: key,
      benefitObservation: null,
      benefitCalculation: null,
      bounds: null,
      benefitComparison: null,
      hypotheses: [],
      completenessGrade: args.completenessGrades?.[key] ?? "insufficient",
      disposition: null,
      dataRequests: [],
      evidence: null,
    };
  }
  return {
    stateVersion: CASE_STATE_VERSION,
    caseId: args.caseId,
    inputSnapshot: {
      snapshotHash: args.snapshotHash,
      sourceDocuments: [...args.sourceDocuments],
      importedValues: null,
    },
    planProvisions: [...args.planVersions],
    ruleVersions: {
      validationRules: args.validationRulesVersion ?? CATALOG_VERSION,
      formulaTaxonomy: args.formulaTaxonomyVersion ?? "not stated",
      dispositionSchema: DISPOSITION_SCHEMA_VERSION,
      toleranceSetId: args.toleranceSetId,
    },
    participants,
    auditLog: [],
    advisoryWorkList: [],
    workflow: { currentStep: "import", selectedParticipantKey: null },
  };
}

/** Fresh UI state around an engine case-analysis state. */
export function createInitialUiState(analysis: CaseAnalysisState): UiState {
  return {
    version: UI_STATE_VERSION,
    analysis,
    casePackage: null,
    wizard: {
      currentStep: "import",
      completed: {
        import: false,
        validate: false,
        calculate: false,
        reconcile: false,
        statistics: false,
        decide: false,
        export: false,
      },
      mode: "wizard",
    },
    theme: "dark",
    selectedParticipantKey: null,
    validation: null,
    calculations: {},
    reconciliations: {},
    statistics: null,
    statisticsOutliers: null,
    lastContribution: null,
    calculationDate: null,
    eventLog: [],
    lastRefusal: null,
  };
}

/** Reproducibility pins for a state: input snapshot hash + rule /
 *  formula / tolerance / engine versions (Invariant 2). */
export function stateReproducibility(state: UiState): {
  snapshotHash: string;
  validationRules: string;
  formulaTaxonomy: string;
  dispositionSchema: string;
  toleranceSetId: string;
  engineVersion: string;
  uiStateVersion: string;
} {
  return {
    snapshotHash: state.analysis.inputSnapshot.snapshotHash,
    validationRules: state.analysis.ruleVersions.validationRules,
    formulaTaxonomy: state.analysis.ruleVersions.formulaTaxonomy,
    dispositionSchema: state.analysis.ruleVersions.dispositionSchema,
    toleranceSetId: state.analysis.ruleVersions.toleranceSetId,
    engineVersion: ENGINE_VERSION,
    uiStateVersion: state.version,
  };
}

/** Build a fresh analysis state from an imported case package. */
function analysisStateFromPackage(pkg: CasePackage): CaseAnalysisState {
  const lastEvent = pkg.events[pkg.events.length - 1];
  const snapshotHash =
    lastEvent === undefined ? "no-snapshot-recorded" : lastEvent.snapshotHashAfter;
  const grades: Record<string, CompletenessGrade> = {};
  for (const participant of pkg.participants) {
    grades[participant.participantKey] = participant.completenessGrade;
  }
  return createCaseAnalysisState({
    caseId: pkg.case.id,
    snapshotHash,
    sourceDocuments: pkg.sourceDocuments,
    planVersions: pkg.planVersions,
    participantKeys: pkg.participants.map((p) => p.participantKey),
    completenessGrades: grades,
    toleranceSetId: `tolerance-v${pkg.case.toleranceRecord.version}`,
  });
}

/**
 * Build one UI-level audit event for the exported audit log (Stage 7
 * Compliance D1 / Repro D2). The exported log is `analysis.auditLog`;
 * before this fix it held dispositions only, because step completions
 * (import, validation, calculation, reconciliation, statistics,
 * publication) updated display state and the in-memory event log but
 * never appended to the audit log. Every step completion and every
 * refusal now appends here, with the run id / rule version /
 * participant key in the summary or detail, so the exported log proves
 * which calculations ran, on which inputs, and in which order.
 * The id is deterministic given the caller-supplied timestamp and the
 * log length, so a fixed-calculation-date run reproduces byte-identical
 * audit output (Repro D3). UI-only events (theme, view mode, selection,
 * navigation that succeeds) carry no analytic content and are not
 * audited; a refused navigation is audited as a transition-refused.
 */
export function uiAuditEvent(
  state: UiState,
  actor: string,
  occurredAt: string,
  kind: AuditEventKind,
  participantKeys: string[],
  summary: string,
  detail?: AuditEvent["detail"],
): AuditEvent {
  return makeAuditEvent({
    auditEventId: `ui:${kind}:${occurredAt}:${state.analysis.auditLog.length}`,
    occurredAt,
    actor: actor as AuditEvent["actor"],
    kind,
    participantKeys: [...participantKeys],
    summary,
    detail: detail ?? {
      inputSnapshotHash: state.analysis.inputSnapshot.snapshotHash,
      ruleVersion: state.analysis.ruleVersions.validationRules,
    },
  });
}

/** Append audit events to a state's engine audit log in one spread. */
function withAudit(state: UiState, events: readonly AuditEvent[]): UiState {
  if (events.length === 0) return state;
  return {
    ...state,
    analysis: {
      ...state.analysis,
      auditLog: [...state.analysis.auditLog, ...events],
    },
  };
}

/** The audit event one step-completion AppEvent records, or null when
 *  the event carries no analytic content (UI-only events). */
function auditForStepEvent(state: UiState, event: AppEvent): AuditEvent | null {
  switch (event.kind) {
    case "import-case-package":
      return uiAuditEvent(
        state,
        event.actor,
        event.occurredAt,
        "import",
        event.casePackage.participants.map((p) => p.participantKey),
        `Case ${event.casePackage.case.id} imported (${event.casePackage.participants.length} participants, snapshot ${state.analysis.inputSnapshot.snapshotHash}).`,
      );
    case "validation-completed":
      return uiAuditEvent(
        state,
        event.actor,
        event.occurredAt,
        "calculation-run",
        event.result.participantResults.map((r) => r.participantKey),
        `Validation completed: ${event.result.summary.rulesEvaluated} rules evaluated, ${event.result.allFindings.length} findings across ${event.result.participantResults.length} participants.`,
      );
    case "calculation-completed": {
      const outcome = event.outcome;
      const amount =
        outcome.kind === "exact"
          ? `exact ${outcome.benefit.amount?.amountMinor ?? "null"} minor units`
          : outcome.kind === "bounds"
            ? `bounds ${outcome.bounds.min.amountMinor}–${outcome.bounds.max.amountMinor} minor units`
            : `indeterminate (${outcome.reason})`;
      return uiAuditEvent(
        state,
        event.actor,
        event.occurredAt,
        "calculation-run",
        [event.participantKey],
        `Calculation completed for ${event.participantKey}: ${amount}.`,
      );
    }
    case "reconciliation-completed": {
      const rec = event.reconciliation;
      const delta = rec.comparison.comparable
        ? `Δ ${rec.comparison.delta.amountMinor} minor units, ${rec.toleranceVerdict}, recommended ${rec.recommendedDisposition}`
        : `not comparable (${rec.comparison.reason}), recommended ${rec.recommendedDisposition}`;
      return uiAuditEvent(
        state,
        event.actor,
        event.occurredAt,
        "calculation-run",
        [rec.participantKey],
        `Reconciliation completed for ${rec.participantKey}: ${delta}.`,
      );
    }
    case "statistics-completed":
      return uiAuditEvent(
        state,
        event.actor,
        event.occurredAt,
        "calculation-run",
        [],
        `Statistics completed: population n=${event.population.pooled.n}, outlier flags ${event.outliers?.flags.length ?? 0}.`,
      );
    case "contribution-published":
      return uiAuditEvent(
        state,
        event.actor,
        event.occurredAt,
        "calculation-run",
        [],
        `Contribution package published (${event.contribution.productId} v${event.contribution.productVersion}, ${event.contribution.findings.length} findings).`,
      );
    default:
      return null;
  }
}

/**
 * The UI-level transition T: S_{t+1} = T(S_t, E_t). Pure: the input
 * state is never mutated; a new state is returned. Analytic events are
 * delegated to the engine (`applyCaseEvent`); UI-only events are
 * handled here. A refused event leaves the analytic content unchanged
 * and records the refusal in `lastRefusal` (the event itself is still
 * appended to the append-only event log, so the refusal is auditable).
 * Wizard navigation goes through this function only.
 */
export function applyEvent(state: UiState, event: AppEvent): UiState {
  const logged: UiState = {
    ...state,
    eventLog: [...state.eventLog, event],
    lastRefusal: null,
  };

  switch (event.kind) {
    case "analysis-event": {
      const result = applyCaseEvent(logged.analysis, event.event, {
        newDispositionId: (participantKey: string) =>
          `${event.event.eventId}:disp:${participantKey}`,
        auditEventId: (index: number) => `${event.event.eventId}:audit:${index}`,
      });
      let next: UiState = { ...logged, analysis: result.state };
      if (result.caseRefusal !== null) {
        next = { ...next, lastRefusal: result.caseRefusal.reason };
      } else if (result.refused.length > 0) {
        const first = result.refused[0];
        next = {
          ...next,
          lastRefusal:
            first === undefined ? null : `${first.participantKey}: ${first.reason}`,
        };
      }
      // A completed calculation marks the Calculate step complete.
      if (
        event.event.kind === "calculation-event" &&
        event.event.calculationEvent === "calculation-completed"
      ) {
        next = { ...next, wizard: completeStep(next.wizard, "calculate") };
      }
      // The Decide step is complete when every in-scope participant has
      // a disposition (recommended or approved). Export stays locked
      // while anyone is unassessed: a case with unassessed participants
      // cannot close.
      if (
        Object.values(next.analysis.participants).length > 0 &&
        Object.values(next.analysis.participants).every(
          (p) => p.disposition !== null,
        )
      ) {
        next = { ...next, wizard: completeStep(next.wizard, "decide") };
      }
      return next;
    }

    case "import-case-package": {
      const analysis = analysisStateFromPackage(event.casePackage);
      // Stage 7 Robustness D4: a (re-)import discards every downstream
      // output, so the wizard restarts from fresh progress with only
      // Import complete. Completing Validate on the old case must never
      // survive a re-import and unlock Calculate on nothing.
      const imported: UiState = {
        ...logged,
        analysis,
        casePackage: event.casePackage,
        wizard: completeStep(createInitialWizardProgress(), "import"),
        selectedParticipantKey: null,
        validation: null,
        calculations: {},
        reconciliations: {},
        statistics: null,
        statisticsOutliers: null,
        lastContribution: null,
      };
      const audit = auditForStepEvent(imported, event);
      return audit === null ? imported : withAudit(imported, [audit]);
    }

    case "validation-completed": {
      const next: UiState = {
        ...logged,
        validation: event.result,
        wizard: completeStep(logged.wizard, "validate"),
      };
      const audit = auditForStepEvent(next, event);
      return audit === null ? next : withAudit(next, [audit]);
    }

    case "calculation-completed": {
      const next: UiState = {
        ...logged,
        calculations: { ...logged.calculations, [event.participantKey]: event.outcome },
        wizard: completeStep(logged.wizard, "calculate"),
      };
      const audit = auditForStepEvent(next, event);
      return audit === null ? next : withAudit(next, [audit]);
    }

    case "reconciliation-completed": {
      const next: UiState = {
        ...logged,
        reconciliations: {
          ...logged.reconciliations,
          [event.reconciliation.participantKey]: event.reconciliation,
        },
        wizard: completeStep(logged.wizard, "reconcile"),
      };
      const audit = auditForStepEvent(next, event);
      return audit === null ? next : withAudit(next, [audit]);
    }

    case "statistics-completed": {
      const next: UiState = {
        ...logged,
        statistics: event.population,
        statisticsOutliers: event.outliers,
        wizard: completeStep(logged.wizard, "statistics"),
      };
      const audit = auditForStepEvent(next, event);
      return audit === null ? next : withAudit(next, [audit]);
    }

    case "contribution-published": {
      const next: UiState = {
        ...logged,
        lastContribution: event.contribution,
        wizard: completeStep(logged.wizard, "export"),
      };
      const audit = auditForStepEvent(next, event);
      return audit === null ? next : withAudit(next, [audit]);
    }

    case "evidence-recorded": {
      const participant = logged.analysis.participants[event.participantKey];
      if (participant === undefined) {
        // Stage 7 Compliance D1: a UI-level refusal is itself audited,
        // not only held in the transient lastRefusal.
        const refused: UiState = {
          ...logged,
          lastRefusal: `${event.participantKey}: participant is not in this case`,
        };
        return withAudit(refused, [
          uiAuditEvent(
            refused,
            event.actor,
            event.occurredAt,
            "transition-refused",
            [event.participantKey],
            `Evidence recording refused: ${event.participantKey} is not in this case.`,
            { refusalReason: `${event.participantKey}: participant is not in this case` },
          ),
        ]);
      }
      return {
        ...logged,
        analysis: {
          ...logged.analysis,
          participants: {
            ...logged.analysis.participants,
            [event.participantKey]: { ...participant, evidence: event.evidence },
          },
        },
      };
    }

    case "wizard-go-to": {
      const moved = goToStep(logged.wizard, event.step);
      if (moved.refusedReason !== null) {
        // Stage 7 Compliance D1: a UI-level refusal is itself audited.
        const refused: UiState = { ...logged, lastRefusal: moved.refusedReason };
        return withAudit(refused, [
          uiAuditEvent(
            refused,
            event.actor,
            event.occurredAt,
            "transition-refused",
            [],
            `Navigation to ${event.step} refused: ${moved.refusedReason}`,
            { refusalReason: moved.refusedReason },
          ),
        ]);
      }
      return {
        ...logged,
        wizard: moved.progress,
        analysis: {
          ...logged.analysis,
          workflow: { ...logged.analysis.workflow, currentStep: event.step },
        },
      };
    }

    case "wizard-complete-step": {
      return { ...logged, wizard: completeStep(logged.wizard, event.step) };
    }

    case "select-participant": {
      return {
        ...logged,
        selectedParticipantKey: event.participantKey,
        analysis: {
          ...logged.analysis,
          workflow: {
            ...logged.analysis.workflow,
            selectedParticipantKey: event.participantKey,
          },
        },
      };
    }

    case "set-view-mode": {
      return { ...logged, wizard: setViewMode(logged.wizard, event.mode) };
    }

    case "set-theme": {
      // State change only. Persistence (saveTheme) is main.ts's job,
      // after applyEvent returns — this function does no I/O.
      return { ...logged, theme: event.theme };
    }

    case "set-calculation-date": {
      // Run control only: the pinned date is recorded in state and read
      // by main.ts's eventTimestamp for every later event. It changes
      // no analytic content, so it appends no audit event; the date
      // itself is visible in every event timestamp it pins.
      return { ...logged, calculationDate: event.date };
    }
  }
}

/**
 * Apply many events in one pass (Stage 7 Benchmarks defect 2). The
 * per-dispatch path (applyEvent) spreads the calculations /
 * reconciliations records and the append-only event log on every call,
 * which is O(n) per participant and O(n²) per step at 10k+ participants.
 * applyBatch folds the hot step kinds (validation / calculation /
 * reconciliation / statistics / contribution completions) into a single
 * draft copy — one spread of each record per batch, one audit-log
 * append for the whole batch — and renders once per step, not once per
 * dispatch. Any other event kind flushes the draft through applyEvent,
 * so ordering and audit order are preserved: audit events are appended
 * in event order, and a delegated event sees every earlier batch event
 * already applied. The result is identical to folding applyEvent over
 * the same events in order (same records, same audit events, same
 * wizard completions); only the copying is batched.
 */
export function applyBatch(state: UiState, events: readonly AppEvent[]): UiState {
  const HOT: ReadonlySet<AppEvent["kind"]> = new Set([
    "validation-completed",
    "calculation-completed",
    "reconciliation-completed",
    "statistics-completed",
    "contribution-published",
  ]);
  let next: UiState = state;
  let draft: UiState | null = null;
  let pendingAudit: AuditEvent[] = [];
  const draftOf = (): UiState => {
    if (draft === null) {
      draft = {
        ...next,
        eventLog: [...next.eventLog],
        calculations: { ...next.calculations },
        reconciliations: { ...next.reconciliations },
        wizard: next.wizard,
        analysis: next.analysis,
      };
    }
    return draft;
  };
  const flushDraft = (): void => {
    if (draft !== null) {
      next = draft;
      draft = null;
    }
  };
  const flushAudit = (): void => {
    if (pendingAudit.length > 0) {
      next = withAudit(next, pendingAudit);
      pendingAudit = [];
    }
  };
  for (const event of events) {
    if (!HOT.has(event.kind)) {
      flushDraft();
      flushAudit();
      next = applyEvent(next, event);
      continue;
    }
    const d = draftOf();
    // Audit ids count the events already in the log plus the ones
    // pending in this batch, so ids stay unique and deterministic.
    const auditBase: UiState = {
      ...d,
      analysis: {
        ...d.analysis,
        auditLog: [...d.analysis.auditLog, ...pendingAudit],
      },
    };
    const audit = auditForStepEvent(auditBase, event);
    if (audit !== null) pendingAudit.push(audit);
    d.eventLog.push(event);
    d.lastRefusal = null;
    switch (event.kind) {
      case "validation-completed":
        d.validation = event.result;
        d.wizard = completeStep(d.wizard, "validate");
        break;
      case "calculation-completed":
        d.calculations[event.participantKey] = event.outcome;
        d.wizard = completeStep(d.wizard, "calculate");
        break;
      case "reconciliation-completed":
        d.reconciliations[event.reconciliation.participantKey] = event.reconciliation;
        d.wizard = completeStep(d.wizard, "reconcile");
        break;
      case "statistics-completed":
        d.statistics = event.population;
        d.statisticsOutliers = event.outliers;
        d.wizard = completeStep(d.wizard, "statistics");
        break;
      case "contribution-published":
        d.lastContribution = event.contribution;
        d.wizard = completeStep(d.wizard, "export");
        break;
      default:
        break;
    }
  }
  flushDraft();
  flushAudit();
  return next;
}

// ---------------------------------------------------------------------------
// Invariants (§17; Stage 2 output 05 §6.7; §0 standing requirement = Inv 9)
// ---------------------------------------------------------------------------

export interface InvariantCheck {
  /** Invariant id: "1"–"8" (§17 examples) and "9" (§0 standing requirement). */
  id: string;
  name: string;
  holds: boolean;
  detail: string;
  /** False when a single-state predicate cannot prove the invariant
   *  and it is enforced by construction instead (see detail). */
  enforceable: boolean;
}

function invariant(
  id: string,
  name: string,
  holds: boolean,
  detail: string,
  enforceable: boolean,
): InvariantCheck {
  return { id, name, holds, detail, enforceable };
}

/** Invariant 1 — original source observations remain unchanged. */
export function checkInvariant1(state: UiState): InvariantCheck {
  const docs = state.analysis.inputSnapshot.sourceDocuments;
  const bad = docs.filter(
    (d) => d.documentId.trim().length === 0 || d.fileHash.trim().length === 0,
  );
  const logIntact = state.analysis.auditLog.every(
    (e) => e.actor.trim().length > 0 && e.occurredAt.trim().length > 0,
  );
  return invariant(
    "1",
    "Source observations unchanged",
    bad.length === 0 && logIntact,
    bad.length > 0
      ? `${bad.length} source document(s) lack an id or file hash.`
      : "Every source document carries an id and file hash; the audit log is intact. " +
        "Full immutability is enforced by construction (applyEvent never writes a source record; " +
        "a correction arrives as a source-update event with a new snapshot hash).",
    false,
  );
}

/** Invariant 2 — a calculation is reproducible from its inputs and rules. */
export function checkInvariant2(state: UiState): InvariantCheck {
  const pins = stateReproducibility(state);
  const pinsOk =
    pins.snapshotHash.trim().length > 0 &&
    pins.validationRules.trim().length > 0 &&
    pins.formulaTaxonomy.trim().length > 0 &&
    pins.dispositionSchema.trim().length > 0 &&
    pins.toleranceSetId.trim().length > 0 &&
    pins.engineVersion.trim().length > 0;
  const recordsOk = Object.values(state.analysis.participants).every(
    (p) =>
      p.disposition === null ||
      (p.disposition.inputSnapshotHash.trim().length > 0 &&
        p.disposition.ruleVersion.trim().length > 0),
  );
  return invariant(
    "2",
    "Reproducibility",
    pinsOk && recordsOk,
    pinsOk && recordsOk
      ? `Snapshot ${pins.snapshotHash}, rules ${pins.validationRules}, engine ${pins.engineVersion}; every disposition names its snapshot hash and rule version.`
      : "A reproducibility pin is missing (snapshot hash, rule version, or engine version) or a disposition record names none.",
    true,
  );
}

/** Invariant 3 — benefit quantities retain units and measurement bases. */
export function checkInvariant3(state: UiState): InvariantCheck {
  const problems: string[] = [];
  for (const participant of Object.values(state.analysis.participants)) {
    const comparison = participant.benefitComparison;
    if (
      comparison !== null &&
      comparison.comparisonBasis === "unresolved" &&
      comparison.delta !== null
    ) {
      problems.push(`${participant.participantKey}: Δ recorded on an unresolved basis`);
    }
    const calculation = participant.benefitCalculation;
    if (
      calculation !== null &&
      calculation.calculationStatus === "indeterminate" &&
      calculation.calculatedMonthlyBenefit !== null
    ) {
      problems.push(`${participant.participantKey}: exact benefit on an indeterminate calculation`);
    }
  }
  return invariant(
    "3",
    "Units and measurement bases",
    problems.length === 0,
    problems.length === 0
      ? "No Δ on an unresolved basis; no exact benefit on an indeterminate calculation."
      : problems.join("; "),
    true,
  );
}

/** Invariant 4 — a rule cannot apply outside its applicability conditions. */
export function checkInvariant4(state: UiState): InvariantCheck {
  const versionIds = new Set(
    state.analysis.planProvisions.map((v) => v.versionId),
  );
  const problems: string[] = [];
  for (const participant of Object.values(state.analysis.participants)) {
    const calculation = participant.benefitCalculation;
    if (calculation === null) continue;
    if (calculation.formulaId.trim().length === 0) {
      problems.push(`${participant.participantKey}: calculation with no formula id`);
    }
    if (!versionIds.has(calculation.planVersionId)) {
      problems.push(
        `${participant.participantKey}: calculation names PlanVersion ${calculation.planVersionId}, not in force in this state`,
      );
    }
  }
  return invariant(
    "4",
    "Rule applicability",
    problems.length === 0,
    problems.length === 0
      ? "Every calculation names a formula and a PlanVersion in force in this state."
      : problems.join("; "),
    true,
  );
}

/** Invariant 5 — unverified statistics cannot become approved benefits. */
export function checkInvariant5(state: UiState): InvariantCheck {
  const systemApproved = Object.values(state.analysis.participants).filter(
    (p) => p.disposition !== null && p.disposition.status === "approved" && p.disposition.createdBy === "system",
  );
  return invariant(
    "5",
    "Statistics cannot become benefits",
    systemApproved.length === 0,
    systemApproved.length === 0
      ? "No approved disposition was created by the system; statistical screens write only to the advisory work-list."
      : `${systemApproved.map((p) => p.participantKey).join(", ")}: approved by the system, not a human.`,
    true,
  );
}

/** Invariant 6 — updating one participant must not silently change others. */
export function checkInvariant6(state: UiState): InvariantCheck {
  const bad = state.analysis.auditLog.filter(
    (e) =>
      (e.kind === "source-update" || e.kind === "rule-revision") &&
      e.participantKeys.length === 0,
  );
  return invariant(
    "6",
    "No silent change to others",
    bad.length === 0,
    bad.length === 0
      ? "Every source-update and rule-revision audit event names its affected participants."
      : `${bad.length} source/rule audit event(s) name no affected participants.`,
    true,
  );
}

/** Invariant 7 — every approved determination retains its evidence. */
export function checkInvariant7(state: UiState): InvariantCheck {
  const problems: string[] = [];
  for (const participant of Object.values(state.analysis.participants)) {
    const disposition = participant.disposition;
    if (disposition === null || disposition.status !== "approved") continue;
    if (disposition.evidenceState.toleranceSetId.trim().length === 0) {
      problems.push(`${participant.participantKey}: approved disposition with no tolerance set id`);
    }
    if (disposition.auditEventId.trim().length === 0) {
      problems.push(`${participant.participantKey}: approved disposition with no audit event`);
    }
  }
  return invariant(
    "7",
    "Approved determinations retain evidence",
    problems.length === 0,
    problems.length === 0
      ? "Every approved disposition carries its evidence state (tolerance set id) and audit event."
      : problems.join("; "),
    true,
  );
}

/** Invariant 8 — no silent failure, no invented exactness. */
export function checkInvariant8(state: UiState): InvariantCheck {
  const problems: string[] = [];
  for (const participant of Object.values(state.analysis.participants)) {
    const calculation = participant.benefitCalculation;
    if (
      calculation !== null &&
      calculation.calculationStatus === "indeterminate" &&
      calculation.calculatedMonthlyBenefit !== null
    ) {
      problems.push(`${participant.participantKey}: exact amount on an indeterminate calculation`);
    }
    if (participant.disposition !== null && participant.evidence === null) {
      problems.push(`${participant.participantKey}: disposition with no evidence state`);
    }
  }
  // A blank is missing data, never zero: no stored calculation may rest
  // on a zero-filled blank. The engine refuses zero-fill at entry
  // (G-INV-8); this predicate checks the stored outcomes carry no
  // zero-filled exact benefit where the trace says a step was blocked.
  for (const [key, outcome] of Object.entries(state.calculations)) {
    if (outcome.kind === "exact" && outcome.benefit.amount !== null) {
      const blocked = outcome.trace.some(
        (step) => step.evidenceGrade === "unknown" && step.name === "comparison-basis-gate",
      );
      if (blocked) problems.push(`${key}: exact benefit past a blocked basis gate`);
    }
  }
  return invariant(
    "8",
    "No silent failure, no invented exactness",
    problems.length === 0,
    problems.length === 0
      ? "No exact amount on an indeterminate calculation; no disposition without evidence; no exact benefit past a blocked basis gate."
      : problems.join("; "),
    true,
  );
}

/**
 * Invariant 9 (§0 standing requirement) — the app still produces
 * reliable actuarial calculations and documented acceptance decisions
 * when exact historical reconstruction is impossible: bounds,
 * scenarios, documented dispositions, and a human decision; never a
 * silent failure or a made-up exact number. Checked with the engine's
 * own `checkRunCompleteness`: every in-scope participant needs a
 * calculation, justified bounds, or an explicit no-bounds statement,
 * together with exactly one disposition. Indeterminate is a legitimate
 * terminal disposition — it satisfies this invariant when documented.
 */
export function checkInvariant9(state: UiState): InvariantCheck {
  const completeness = checkRunCompleteness(
    Object.values(state.analysis.participants).map((p) => ({
      participantKey: p.participantKey,
      completenessGrade: p.completenessGrade,
      hasCalculationOrBoundsOrNoBoundsStatement:
        p.benefitCalculation !== null ||
        p.bounds !== null ||
        state.calculations[p.participantKey] !== undefined,
      disposition: p.disposition,
    })),
  );
  return invariant(
    "9",
    "Reliable output when exact reconstruction is impossible",
    completeness.complete,
    completeness.complete
      ? "Every in-scope participant has a calculation, justified bounds, or an explicit no-bounds statement, and a disposition. Indeterminate counts when documented."
      : completeness.missing
          .map((m) => `${m.participantKey}: lacks ${m.missing.join("; ")}`)
          .join("; "),
    true,
  );
}

/** All nine invariants, in order. */
export function checkAllInvariants(state: UiState): InvariantCheck[] {
  return [
    checkInvariant1(state),
    checkInvariant2(state),
    checkInvariant3(state),
    checkInvariant4(state),
    checkInvariant5(state),
    checkInvariant6(state),
    checkInvariant7(state),
    checkInvariant8(state),
    checkInvariant9(state),
  ];
}

/** True when every enforceable invariant holds. */
export function invariantsHold(state: UiState): boolean {
  return checkAllInvariants(state)
    .filter((check) => check.enforceable)
    .every((check) => check.holds);
}

/** Dispositions in this state, by participant key. Null = unassessed. */
export function dispositionsByParticipant(
  state: UiState,
): Record<string, Disposition | null> {
  const out: Record<string, Disposition | null> = {};
  for (const participant of Object.values(state.analysis.participants)) {
    out[participant.participantKey] =
      participant.disposition === null ? null : participant.disposition.disposition;
  }
  return out;
}

/** Wizard step labels, in order, for the shell navigation. */
export function wizardLabels(): Array<{ id: WizardStepId; label: string }> {
  return WIZARD_STEPS.map((step) => ({ id: step.id, label: wizardStepDef(step.id).label }));
}
