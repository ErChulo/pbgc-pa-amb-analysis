"use strict";
/**
 * Canonical shared types for the PA_AMB Analysis System (Stage 4 foundation).
 *
 * Transcribed from the Stage 2 / Stage 3 specifications. Nothing here is
 * renamed, redefined, or invented: where the spec is silent, the gap is
 * marked with an "OPEN:" note instead of a coined value.
 *
 * Sources (section numbers are the spec's own):
 * - stage2/01-data-model.md — §1 common foundations, §2 provenance,
 *   §3 immutable vs normalised, §4 event/revision, §5 typed benefit,
 *   §6 temporal model, §7 the 15 entities, §9 invariants.
 * - stage2/04-calculation-functions.md — §0–§3 pipeline/outcome/decimal
 *   types, §4 rounding types, §5 bounds types, §6 reconciliation hook,
 *   §11.1 common formula types (CalcResult, CalcContext, RoundingSpec).
 * - stage3/02-date-calculations.md — §5.1 ServiceResult, §5.5 decision
 *   D-5.1 (canonical DecimalString; rational retained alongside).
 *
 * Rules that govern this file:
 * - Money is integer minor units, never a binary float (01 §1.2).
 * - A blank is `null`, never 0 (01 §1.2 rule 2).
 * - "Unknown" is a value, not an absence (01 §0.2).
 * - BCV field names are copied exactly from the dictionary; app-only
 *   fields are snake_case in prose and never presented as BCV fields
 *   (01 §1.1).
 * - TypedBenefitQuantity is defined exactly once, here (01 §5).
 */
Object.defineProperty(exports, "__esModule", { value: true });
