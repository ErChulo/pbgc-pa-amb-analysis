/**
 * Onboarding for the PA_AMB Analysis System (Stage 6).
 *
 * First-run welcome, guided tour, contextual help, Help centre.
 * Pure logic plus HTML-string helpers. DOM wiring runs only when
 * `document` exists, so this module is safe to import in Node.
 *
 * Short plain sentences. One idea at a time. (STE 100.)
 * Dark theme by default. Colours come from the theme tokens
 * (PBGC Design System v1.1.0: dark provisional §2.5, light §2.3),
 * via the .onboarding-overlay / .onboarding-panel /
 * .onboarding-text classes in styles.css — no hard-coded colours
 * here, so the theme toggle reaches the tour and the help.
 * All help is skippable, re-openable, and never trapping.
 */

export { DEMO_CASE_PACKAGE } from "./demo";

/** Wizard steps, in order. The tour walks these steps. */
const TOUR_STEPS: ReadonlyArray<{
  id: string;
  title: string;
  text: string;
}> = [
  {
    id: "import",
    title: "Import",
    text: "Load the case file. The app reads the census and the plan documents. Nothing leaves your computer.",
  },
  {
    id: "validate",
    title: "Validate",
    text: "Check the data. The app flags bad dates, bad numbers, and missing fields. It never fills a blank with zero.",
  },
  {
    id: "calculate",
    title: "Calculate",
    text: "Rebuild each benefit from the plan rules. Every step shows its work. No guess is ever shown as a fact.",
  },
  {
    id: "reconcile",
    title: "Reconcile",
    text: "Compare the rebuilt benefit with the prior administrator's amount. The gap is shown as a plain difference.",
  },
  {
    id: "review",
    title: "Review",
    text: "Look at the gaps and the outliers. Test one cause at a time. A match alone proves nothing.",
  },
  {
    id: "decide",
    title: "Decide",
    text: "Record a disposition for each participant. The app recommends. Only a named human approves.",
  },
  {
    id: "export",
    title: "Export",
    text: "Save the report and the case package. The export carries the evidence with it, so the work can be checked later.",
  },
];

/** One short plain-language paragraph per help topic. */
const CONTEXT_HELP: Readonly<Record<string, string>> = {
  import:
    "Import loads the case file: the census, the plan documents, and the prior administrator's benefit schedule. The app keeps the imported values as they were. It never changes a source value. The file-shape guide is on the Import step, above the file picker.",
  validate:
    "Validate checks the data before any calculation runs. It flags bad dates, bad numbers, duplicate records, and missing fields. A blank stays blank. It is never filled with zero.",
  calculate:
    "Calculate rebuilds each accrued benefit from the plan rules in force at the measurement date. Each step shows its inputs, its rule, and its result. If the evidence cannot support an exact benefit, the app gives justified bounds or says it cannot tell.",
  reconcile:
    "Reconcile compares the rebuilt benefit with the prior administrator's amount. The difference is the recorded amount minus the rebuilt amount. A tolerance is applied only if the case sets one.",
  statistics:
    "Statistics describe the whole group: averages, spreads, and outliers. An outlier is a flag to look at, not a verdict. A normal-looking value can still be wrong.",
  decide:
    "Decide records one disposition per participant. The app recommends a disposition from the evidence. Only a named human reviewer can approve it. A recommendation alone changes nothing.",
  export:
    "Export saves the report and the case package as files on your computer. The export carries the evidence, the tolerance, and the audit log with it. Nothing is uploaded anywhere.",
  tolerance:
    "A tolerance is set by the case actuary for this case only. There is no PBGC tolerance for PA_AMB reconciliation, and the app ships with none. The tolerance record names who set it, when, and why.",
  disposition:
    "A disposition is the decision for one participant. The five are: Verified, Supported for acceptance, Requires investigation, Correction recommended, and Indeterminate. These are application states, not official PBGC classifications.",
  bounds:
    "Bounds are the lowest and highest benefit the stated facts allow. They are computed from the plan rules at the ends of the missing range. They are not a guess, and they are not a confidence interval.",
  "missing-data":
    "Missing data is classed by what it blocks. Some gaps can be bounded. Some need a stated assumption. Some make the benefit indeterminate. The app lists what would resolve each gap.",
};

const GENERIC_HELP =
  "This step has no extra help yet. The Help centre explains the workflow, the dispositions, and the export. Ask the case actuary if the question is about a real case.";

/**
 * First-run welcome plus guided tour across the wizard steps.
 * Skippable at any point. Re-openable from Help. Never trapping:
 * every step has Skip and Close, and Escape closes the tour.
 * Calls `onStep` with each step id as the tour advances.
 * Calls `skip` when the user skips or closes the tour early.
 * Does nothing when there is no document (for example, in Node).
 */
export function runOnboarding(opts: {
  onStep: (stepId: string) => void;
  skip: () => void;
}): void {
  if (typeof document === "undefined") return;
  let index = 0;
  let closed = false;

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Welcome tour");
  overlay.setAttribute("class", "onboarding-overlay");
  overlay.setAttribute(
    "style",
    "position:fixed;inset:0;z-index:1000;padding:24px;",
  );

  const close = (skipped: boolean): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    if (skipped) opts.skip();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close(true);
  };

  const render = (): void => {
    const step = TOUR_STEPS[index];
    if (step === undefined) {
      close(false);
      return;
    }
    overlay.innerHTML = "";
    const title = document.createElement("h2");
    title.textContent = `Welcome. Step ${index + 1} of ${TOUR_STEPS.length}: ${step.title}`;
    const progress = document.createElement("p");
    progress.setAttribute("role", "status");
    progress.textContent = `Step ${index + 1} of ${TOUR_STEPS.length}.`;
    const body = document.createElement("p");
    body.textContent = step.text;
    const back = document.createElement("button");
    // T13: a disabled button is not conveyed by opacity alone.
    // At step 1 there is no earlier step, so the label says so.
    back.textContent = index === 0 ? "Back (unavailable)" : "Back";
    back.setAttribute("aria-label", "Go to the previous tour step");
    back.disabled = index === 0;
    back.addEventListener("click", () => {
      index -= 1;
      render();
    });
    const next = document.createElement("button");
    next.textContent = index === TOUR_STEPS.length - 1 ? "Finish" : "Next";
    next.setAttribute("aria-label", index === TOUR_STEPS.length - 1 ? "Finish the tour" : "Go to the next tour step");
    next.addEventListener("click", () => {
      if (index === TOUR_STEPS.length - 1) {
        close(false);
        return;
      }
      index += 1;
      opts.onStep((TOUR_STEPS[index] as { id: string }).id);
      render();
    });
    const skipButton = document.createElement("button");
    skipButton.textContent = "Skip tour";
    skipButton.setAttribute("aria-label", "Skip the tour");
    skipButton.addEventListener("click", () => close(true));
    const closeButton = document.createElement("button");
    closeButton.textContent = "Close";
    closeButton.setAttribute("aria-label", "Close the tour");
    closeButton.addEventListener("click", () => close(true));
    overlay.append(title, progress, body, back, next, skipButton, closeButton);
    next.focus();
  };

  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  opts.onStep((TOUR_STEPS[0] as { id: string }).id);
  render();
}

/** Help centre HTML. Workflow overview, step guide, tolerances, dispositions, export, keys, access notes. */
export function renderHelpCentre(): string {
  const steps = TOUR_STEPS.map(
    (s) => `<li><strong>${s.title}.</strong> ${s.text}</li>`,
  ).join("");
  return [
    '<section aria-label="Help centre" class="onboarding-panel">',
    "<h2>Help centre</h2>",
    "<p>This app helps a case actuary check the prior administrator's accrued monthly benefit. It works offline. Nothing is uploaded.</p>",
    "<h3>Workflow</h3>",
    `<ol>${steps}</ol>`,
    "<h3>Tolerances</h3>",
    "<p>A tolerance is set by the case actuary for this case only. There is no PBGC tolerance for PA_AMB reconciliation. The app ships with none. The tolerance record names who set it, when, and why.</p>",
    "<h3>Dispositions</h3>",
    "<p>Each participant ends with one disposition. These are application states, not official PBGC classifications.</p>",
    "<ul>",
    "<li><strong>Verified.</strong> The rebuilt benefit agrees with the recorded amount within the case tolerance.</li>",
    "<li><strong>Supported for acceptance.</strong> The evidence supports accepting the recorded amount, even though the rebuild is not exact.</li>",
    "<li><strong>Requires investigation.</strong> A gap or missing evidence is still open, and a next step exists.</li>",
    "<li><strong>Correction recommended.</strong> The evidence supports one specific corrected benefit.</li>",
    "<li><strong>Indeterminate.</strong> The evidence cannot support a conclusion. This is a complete answer, not a failure.</li>",
    "</ul>",
    "<h3>Export</h3>",
    "<p>Export saves the report and the case package as files on your computer. The export carries the evidence, the tolerance, and the audit log.</p>",
    "<h3>Keyboard shortcuts</h3>",
    "<p>Tab moves between buttons. Enter activates a button. Escape closes help and the tour.</p>",
    "<h3>Accessibility</h3>",
    "<p>The app uses a dark theme by default, with a light theme toggle. All buttons are keyboard-operable. Step progress is announced to screen readers. Help can be skipped and re-opened at any time.</p>",
    "<p>Try the demo case to walk the full workflow end to end. All demo records are fictional.</p>",
    "</section>",
  ].join("");
}

/**
 * One short plain-language paragraph for a help topic.
 * Unknown topics return a generic help paragraph, never an error.
 */
export function renderContextHelp(topic: string): string {
  const text = CONTEXT_HELP[topic];
  const body = text === undefined ? GENERIC_HELP : text;
  return `<p class="onboarding-text">${body}</p>`;
}
