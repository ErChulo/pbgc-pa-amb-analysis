// Stage 7 robustness — browser probes (NEW file, verification only).
//
// Drives the real single-file app (pa-amb-analysis.html) through Chromium
// via file://, using Playwright 1.65.0 from stage3/live-test/ (same
// pattern as test/ui-playwright/*). Verifies interaction robustness:
// double import, re-import after downstream steps, reload mid-wizard,
// adversarial validation through the in-page engine, and whether any
// file-import surface exists at all.
//
// Usage: node stage7/robustness-browser.mjs
// Exit 0 = every case passed; exit 1 = at least one case failed.
// Synthetic data only; every participant key starts with "SYN-".

import {
  openApp,
  assertBooted,
  check,
  stepButton,
  wizardState,
} from "../test/ui-playwright/helpers.mjs";

const TS = "2026-11-12T00:00:00.000Z";

// --- In-page driver: validation participants mapped from the demo package.
// Copied from test/ui-playwright/wizard-flow.test.mjs (the canonical UI
// driver for the same demo case); mutations are applied per case.
function drive(action) {
  const TS = "2026-11-12T00:00:00.000Z";
  const App = window.PaAmbApp;
  const handle = window.__paAmbHandle;
  const pkg = () => handle.getState().casePackage;
  const must = (v, what) => {
    if (v === undefined || v === null) throw new Error(what + " is missing");
    return v;
  };
  const keys = () => pkg().participants.map((p) => p.participantKey);
  const recordedMinor = (key) => {
    const obs = must(
      pkg().benefitObservations.find((o) => o.participantKey === key),
      "observation for " + key,
    );
    return obs.paAmb.value === null ? null : obs.paAmb.value.amountMinor;
  };
  const doteOf = (key) => {
    const obs = must(
      pkg().benefitObservations.find((o) => o.participantKey === key),
      "observation for " + key,
    );
    return obs.measurementDate;
  };
  const ageAt = (dob, date) => {
    const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
    return date.slice(5) < dob.slice(5) ? years - 1 : years;
  };
  const nrdOf = (dob) => `${Number(dob.slice(0, 4)) + 65}${dob.slice(4)}`;

  function toValidationParticipant(key) {
    const p = must(pkg().participants.find((x) => x.participantKey === key), "participant " + key);
    const ep = must(pkg().employmentPeriods.find((x) => x.participantKey === key), "employment period for " + key);
    const ch = must(pkg().compensationHistories.find((x) => x.participantKey === key), "compensation history for " + key);
    const sh = must(pkg().serviceHistories.find((x) => x.participantKey === key), "service history for " + key);
    const dob = must(p.dob.value, "dob for " + key);
    const dote = ep.dote.value;
    const service = sh.paCreditedService.value;
    const serviceStr = service === null ? null : String(service);
    const knownSalaries = ch.salaryByYear.filter((s) => s.amount !== null);
    const meanAnnualMinor =
      knownSalaries.length === 0
        ? null
        : Math.round(knownSalaries.reduce((s, x) => s + (x.amount?.amountMinor ?? 0), 0) / knownSalaries.length);
    const lastSalary = knownSalaries[knownSalaries.length - 1];
    const formulaCheck = { "SYN-001": 150000, "SYN-003": 150000, "SYN-V-01": 84950 };
    const checkValue = formulaCheck[key] ?? null;
    return {
      participantKey: key, bcvRecId: p.bcvRecId.value, caseNumber: "00098765",
      idType: "1", ssn: null, firstName: p.firstName.value, lastName: p.lastName.value,
      dob, sex: p.sex.value, dateOfDeath: null, retstat: "2", rettyp: null,
      doh: ep.doh.value, dote, dop: ep.dop.value, dobfParticipant: null, dor: null,
      postDoptDote: null, nrd: nrdOf(dob), anb: dote === null ? null : ageAt(dob, dote),
      sanb: null, rbd: nrdOf(dob), rbdDeterminable: true, rbdMissingFields: [],
      inPayAtDopt: null, isPreDoptRetiree: false, isDeferredRecord: true, sbcd: null,
      spouseSsn: null, spouseLastName: null, spouseDob: null, spouseSex: null,
      spouseDateOfDeath: null, benSsn: null, benLastName: null, benDob: null,
      benSex: null, benDateOfDeath: null, apDob: null, apSex: null, apDateOfDeath: null,
      cspa: serviceStr, vspa: serviceStr, espa: serviceStr, cs: serviceStr,
      vs: serviceStr, es: serviceStr, csUnit: "years", vsUnit: "years", vppa: "1",
      paAmb: recordedMinor(key),
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
      recordIsSingleLife: true, lsTerm: "N", xrd: nrdOf(dob), xrdMbTerm: recordedMinor(key),
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
      scheduleRowExists: true, schedulePaAmb: recordedMinor(key),
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
  function validationContext() {
    return {
      dopt: "2024-06-30", today: "2026-11-12", runId: "run-demo-1",
      recordedDate: "2026-11-12", tolerance: App.DEMO_TOLERANCE,
      serviceTolerance: "0", monthlyBenefitPlausibilityCap: 2500000,
      plausibleBenefitCompRatioRange: null, planServiceCreditRule: null,
      validFormCodes: ["NSF", "NMF", "QPSA", "J&S50", "J&S75", "J&S100"],
      file: { openable: true, truncated: false, hashMatches: true, hashBefore: "demo", hashAfter: "demo", macroRan: false, unknownFields: [] },
      priorExtract: null,
    };
  }
  const ruleOutcome = (evals, ruleId) => {
    const e = evals.find((x) => x.ruleId === ruleId);
    return e ? e.outcome : "MISSING-RULE";
  };

  if (action.name === "validate") {
    const state = handle.getState();
    const next = App.runValidation(state, keys().map(toValidationParticipant), validationContext(), "demo", TS);
    handle.dispatch({ kind: "validation-completed", result: next.validation, actor: "demo", occurredAt: TS });
    return { participantResults: next.validation.participantResults.length };
  }

  if (action.name === "validateMutated") {
    // Validate ONE mutated SYN-001 through the real in-page path, and
    // report the outcomes of the rules the mutation should trip.
    const p = toValidationParticipant("SYN-001");
    if (action.mutation === "impossible-dob") p.dob = "2020-02-30";
    if (action.mutation === "month13-dob") p.dob = "2020-13-01";
    if (action.mutation === "string-paAmb") { p.paAmb = "150000"; p.xrdMbTerm = "150000"; }
    if (action.mutation === "blank-paAmb") { p.paAmb = null; p.schedulePaAmb = null; p.xrdMbTerm = null; }
    if (action.mutation === "negative-service") { p.cs = "-5"; p.vs = "-5"; p.es = "-5"; p.cspa = "-5"; p.vspa = "-5"; p.espa = "-5"; }
    const state = handle.getState();
    const next = App.runValidation(state, [p], validationContext(), "demo", TS);
    const evals = next.validation.participantResults[0].evaluations;
    const out = { rules: {} };
    for (const r of action.watch) out.rules[r] = ruleOutcome(evals, r);
    out.notRun = evals.filter((e) => e.outcome === "not-run").map((e) => e.ruleId);
    out.fails = evals.filter((e) => e.outcome === "fail").map((e) => e.ruleId);
    return out;
  }

  if (action.name === "state") {
    const s = handle.getState();
    const keysNow = s.casePackage === null ? [] : s.casePackage.participants.map((p) => p.participantKey);
    return {
      participantCount: keysNow.length,
      uniqueKeys: new Set(keysNow).size,
      wizard: s.wizard,
      validationNull: s.validation === null,
      calculations: Object.keys(s.calculations).length,
      reconciliations: Object.keys(s.reconciliations).length,
      lastRefusal: s.lastRefusal,
      statusLine: document.getElementById("status-line")?.textContent ?? "",
    };
  }

  if (action.name === "importSurface") {
    const panel = document.querySelector('[data-step-panel="import"]');
    return {
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      textareas: document.querySelectorAll("textarea").length,
      importPanelText: panel ? panel.textContent : "NO IMPORT PANEL",
      importPanelButtons: [...(panel?.querySelectorAll("button") ?? [])].map((b) => b.id || b.textContent),
    };
  }

  throw new Error("unknown drive action: " + action.name);
}

const results = [];
function record(id, title, expected, actual, pass) {
  results.push({ id, title, pass, expected, actual });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${title}`);
  console.log(`     expected: ${expected}`);
  console.log(`     actual:   ${actual}`);
}

async function main() {
  const { browser, page, errors, failedRequests } = await openApp();
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);

    // D05 — file-import surface: is there any way to load a real file?
    const surface = await page.evaluate(drive, { name: "importSurface" });
    record(
      "D05",
      "a file-import surface exists (CSV/XLSX/JSON upload, per MASTER_PROMPT §6)",
      "≥1 file input (or paste/drop target) on the Import step",
      `file inputs=${surface.fileInputs}, textareas=${surface.textareas}, import panel buttons=${JSON.stringify(surface.importPanelButtons)}, panel text=${JSON.stringify(surface.importPanelText.slice(0, 120))}`,
      surface.fileInputs > 0 || surface.textareas > 0,
    );

    // D01 — import the same demo file twice: no duplicate participants, no double-counting.
    await page.locator("#demo-button").click();
    let st = await page.evaluate(drive, { name: "state" });
    const first = { ...st };
    await page.locator("#demo-button").click();
    st = await page.evaluate(drive, { name: "state" });
    record(
      "D01",
      "import the same file twice: still 6 unique participants, no duplicates, no double-counting",
      "participantCount=6, uniqueKeys=6 after both imports",
      `after 1st import: count=${first.participantCount} unique=${first.uniqueKeys}; after 2nd import: count=${st.participantCount} unique=${st.uniqueKeys}; status=${JSON.stringify(st.statusLine)}`,
      st.participantCount === 6 && st.uniqueKeys === 6,
    );

    // D02 — import, validate, then re-import: downstream state is cleared, old basis does not linger.
    await page.evaluate(drive, { name: "validate" });
    st = await page.evaluate(drive, { name: "state" });
    const validated = { ...st };
    await page.locator("#demo-button").click();
    st = await page.evaluate(drive, { name: "state" });
    const calcDisabledAfterReimport = await stepButton(page, "calculate").isDisabled();
    const calcTitleAfterReimport = await stepButton(page, "calculate").getAttribute("title");
    record(
      "D02",
      "re-import after validate clears the old validation (new run uses the new basis)",
      "validationNull=true, calculations=0, wizard.validate=false, Calculate button locked ('Validate the case first.')",
      `before re-import: validationNull=${validated.validationNull}, wizard.validate=${validated.wizard.completed.validate}; after re-import: validationNull=${st.validationNull}, calculations=${st.calculations}, wizard.validate=${st.wizard.completed.validate}, count=${st.participantCount}, Calculate disabled=${calcDisabledAfterReimport}, Calculate title=${JSON.stringify(calcTitleAfterReimport)}`,
      st.validationNull === true && st.calculations === 0 && st.wizard.completed.validate === false && st.participantCount === 6 && calcDisabledAfterReimport === true,
    );

    // D04 — adversarial validation through the in-page engine (same cases as Node A02/A14/B01/A05).
    const mutated = await page.evaluate(drive, { name: "validateMutated", mutation: "impossible-dob", watch: ["S-07", "P-02"] });
    record(
      "D04a",
      "in-page: impossible dob 2020-02-30 is flagged by S-07 or P-02",
      "S-07 fail or P-02 fail; no page error",
      `S-07=${mutated.rules["S-07"]}, P-02=${mutated.rules["P-02"]}; fails=${mutated.fails.join(",") || "none"}`,
      mutated.rules["S-07"] === "fail" || mutated.rules["P-02"] === "fail",
    );
    const month13 = await page.evaluate(drive, { name: "validateMutated", mutation: "month13-dob", watch: ["S-07", "P-02"] });
    record(
      "D04b",
      "in-page: dob 2020-13-01 is flagged by S-07 or P-02",
      "S-07 fail or P-02 fail",
      `S-07=${month13.rules["S-07"]}, P-02=${month13.rules["P-02"]}; fails=${month13.fails.join(",") || "none"}`,
      month13.rules["S-07"] === "fail" || month13.rules["P-02"] === "fail",
    );
    const strPa = await page.evaluate(drive, { name: "validateMutated", mutation: "string-paAmb", watch: ["S-08", "S-02", "C-02"] });
    record(
      "D04c",
      "in-page: string paAmb '150000' is flagged by S-08/S-02 (never silently accepted)",
      "S-08 fail or S-02 fail",
      `S-08=${strPa.rules["S-08"]}, S-02=${strPa.rules["S-02"]}, C-02=${strPa.rules["C-02"]}; fails=${strPa.fails.join(",") || "none"}; not-run=${strPa.notRun.join(",") || "none"}`,
      strPa.rules["S-08"] === "fail" || strPa.rules["S-02"] === "fail",
    );
    const blankPa = await page.evaluate(drive, { name: "validateMutated", mutation: "blank-paAmb", watch: ["P-13"] });
    record(
      "D04d",
      "in-page: blank PA_AMB is flagged by P-13 (missing, never zero)",
      "P-13 fail",
      `P-13=${blankPa.rules["P-13"]}; fails=${blankPa.fails.join(",") || "none"}`,
      blankPa.rules["P-13"] === "fail",
    );
    const negSvc = await page.evaluate(drive, { name: "validateMutated", mutation: "negative-service", watch: ["P-06"] });
    record(
      "D04e",
      "in-page: negative service cs='-5' is flagged by P-06",
      "P-06 fail",
      `P-06=${negSvc.rules["P-06"]}; fails=${negSvc.fails.join(",") || "none"}`,
      negSvc.rules["P-06"] === "fail",
    );

    // D03 — close/reopen mid-wizard: reload after import+validate.
    await page.evaluate(drive, { name: "validate" });
    st = await page.evaluate(drive, { name: "state" });
    check(st.validationNull === false, "pre-reload state should carry a validation");
    await page.reload();
    await page.waitForSelector("#pa-amb-app");
    await page.waitForTimeout(300);
    st = await page.evaluate(drive, { name: "state" });
    record(
      "D03",
      "reload mid-wizard: app reboots cleanly, no corruption, no stale state, no page error",
      "participantCount=0, status 'No case loaded', currentStep=import, no page errors",
      `count=${st.participantCount}, status=${JSON.stringify(st.statusLine)}, step=${st.wizard.currentStep}, validationNull=${st.validationNull}, pageErrors=${errors.length}`,
      st.participantCount === 0 && st.wizard.currentStep === "import" && errors.length === 0,
    );

    assertBooted(errors, failedRequests);
    const passed = results.filter((r) => r.pass).length;
    console.log(`ROBUSTNESS-BROWSER: ${passed}/${results.length} cases passed.`);
    if (passed !== results.length) {
      console.log(`FAILING: ${results.filter((r) => !r.pass).map((r) => r.id).join(", ")}`);
      process.exit(1);
    }
    console.log("ROBUSTNESS-BROWSER: all cases passed.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL robustness-browser: ${err.message}`);
  process.exit(1);
});
