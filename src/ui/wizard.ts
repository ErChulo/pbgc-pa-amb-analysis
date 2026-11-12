/**
 * Wizard — Stage 6 UI core (Worker A).
 *
 * Guided steps (MASTER_PROMPT §18): Import → Validate → Calculate →
 * Reconcile → Review statistics → Decide → Export. An advanced
 * interface sits alongside the wizard: every step is reachable from it,
 * on the same state (see `ADVANCED_VIEW_NOTE`). Step transitions go
 * through `applyEvent` in state.ts only — this module never changes
 * state itself; it describes steps, lock rules, and what each step
 * shows and runs.
 *
 * Lock rule: a step is locked until the step before it is complete.
 * Import is never locked. A locked step says why, in plain words
 * (ASD STE 100: smallest string that says what is missing). The wizard
 * never invents a result to unlock a step: completion means the engine
 * call for that step ran and its output is stored in state.
 *
 * The UI recommends dispositions and hypotheses; it never decides.
 * The Decide step proposes through the engine state machine
 * (src/decisions.ts); only a human approves.
 */

export type WizardStepId =
  | "import"
  | "validate"
  | "calculate"
  | "reconcile"
  | "statistics"
  | "decide"
  | "export";

export type ViewMode = "wizard" | "advanced";

/** What one wizard step shows, and what engine call it runs. */
export interface WizardStepDef {
  id: WizardStepId;
  /** Short label, plain words. */
  label: string;
  /** What the step shows. */
  shows: string;
  /** Engine call the step runs (module + function, exact names). */
  engineCall: string;
  /** Plain-language note shown while the step is locked. */
  lockedNote: string;
}

/** The seven steps, in order. */
export const WIZARD_STEPS: readonly WizardStepDef[] = [
  {
    id: "import",
    label: "Import",
    shows: "Case file list, import record, quarantined rows.",
    engineCall: "createEmptyCasePackage (src/model.ts); import maps into CasePackage (stage2/02)",
    lockedNote: "",
  },
  {
    id: "validate",
    label: "Validate",
    shows: "Validation findings by rule (S, P, X, M, L, C), severity, what blocks a calculation.",
    engineCall: "validateCasePackage (src/validation.ts, 66 rules)",
    lockedNote: "Import a case first.",
  },
  {
    id: "calculate",
    label: "Calculate",
    shows: "Reconstructed benefit per participant, trace steps, bounds or indeterminate reason.",
    engineCall: "calculateAccruedBenefit (src/pipeline.ts, Stages 1–10)",
    lockedNote: "Validate the case first.",
  },
  {
    id: "reconcile",
    label: "Reconcile",
    shows: "Δ, D, R per participant, tolerance verdict, ranked hypotheses, recommended disposition.",
    engineCall: "reconcileParticipant (src/reconcile.ts)",
    lockedNote: "Calculate benefits first.",
  },
  {
    id: "statistics",
    label: "Review statistics",
    shows: "Population summary, outlier flags, model notes. Statistics suggest; they never decide.",
    engineCall: "describePopulation + detectOutliers (src/statistics.ts)",
    lockedNote: "Reconcile participants first.",
  },
  {
    id: "decide",
    label: "Decide",
    shows: "Recommended disposition, evidence, human approval gate. System proposes; actuary approves.",
    engineCall: "transition via applyCaseEvent (src/decisions.ts, T1–T12)",
    lockedNote: "Review statistics first.",
  },
  {
    id: "export",
    label: "Export",
    shows: "Plan report, participant report, AMB memo, CSV / XLSX / JSON, audit log, case package.",
    engineCall: "publishFindings + assembleContribution (src/publication.ts); download helpers (src/ui/exports)",
    lockedNote: "Decide dispositions first. A case with unassessed participants cannot close.",
  },
];

/** Step order, for lock and navigation checks. */
export const WIZARD_STEP_ORDER: readonly WizardStepId[] = WIZARD_STEPS.map(
  (step) => step.id,
);

/** The advanced interface: all steps reachable, same state as the wizard. */
export const ADVANCED_VIEW_NOTE =
  "Advanced view: all steps open on the same case state. A step still shows its lock reason when its input is missing; the advanced view never runs a step out of order on missing input.";

export interface WizardProgress {
  currentStep: WizardStepId;
  completed: Record<WizardStepId, boolean>;
  mode: ViewMode;
}

/** Fresh wizard progress: at Import, nothing complete, wizard mode. */
export function createInitialWizardProgress(): WizardProgress {
  return {
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
  };
}

/** Definition for a step id, or null when the id is not a step. */
export function wizardStepDef(stepId: WizardStepId): WizardStepDef {
  const found = WIZARD_STEPS.find((step) => step.id === stepId);
  if (found === undefined) throw new Error(`wizardStepDef: unknown step ${stepId}`);
  return found;
}

/** Short label for a step id. */
export function wizardStepLabel(stepId: WizardStepId): string {
  return wizardStepDef(stepId).label;
}

/** The step before this one, or null for Import. */
export function previousStep(stepId: WizardStepId): WizardStepId | null {
  const index = WIZARD_STEP_ORDER.indexOf(stepId);
  return index <= 0 ? null : (WIZARD_STEP_ORDER[index - 1] as WizardStepId);
}

/**
 * Lock state for a step. Import is never locked. Any other step is
 * locked until its previous step is complete. Returns the plain-language
 * reason when locked, else null.
 */
export function stepLock(
  progress: WizardProgress,
  stepId: WizardStepId,
): { locked: boolean; reason: string | null } {
  const prev = previousStep(stepId);
  if (prev === null) return { locked: false, reason: null };
  if (progress.completed[prev] === true) return { locked: false, reason: null };
  return { locked: true, reason: wizardStepDef(stepId).lockedNote };
}

/** True when the wizard may go to this step. */
export function canGoTo(progress: WizardProgress, stepId: WizardStepId): boolean {
  return stepLock(progress, stepId).locked === false;
}

/**
 * Move the wizard to a step. Refusal is a value, never a throw for a
 * locked step: the progress is returned unchanged with the reason.
 * Unknown step ids throw — that is a programming error, not a lock.
 */
export function goToStep(
  progress: WizardProgress,
  stepId: WizardStepId,
): { progress: WizardProgress; refusedReason: string | null } {
  const lock = stepLock(progress, stepId);
  if (lock.locked) {
    return { progress, refusedReason: lock.reason ?? "Step is locked." };
  }
  return { progress: { ...progress, currentStep: stepId }, refusedReason: null };
}

/** Mark a step complete. Returns new progress; the input is untouched. */
export function completeStep(
  progress: WizardProgress,
  stepId: WizardStepId,
): WizardProgress {
  return {
    ...progress,
    completed: { ...progress.completed, [stepId]: true },
  };
}

/** The next incomplete step, or null when all steps are complete. */
export function nextIncompleteStep(progress: WizardProgress): WizardStepId | null {
  for (const stepId of WIZARD_STEP_ORDER) {
    if (progress.completed[stepId] !== true) return stepId;
  }
  return null;
}

/** True when every step is complete. */
export function wizardComplete(progress: WizardProgress): boolean {
  return nextIncompleteStep(progress) === null;
}

/** Switch between wizard and advanced view. Same state either way. */
export function setViewMode(progress: WizardProgress, mode: ViewMode): WizardProgress {
  return { ...progress, mode };
}
