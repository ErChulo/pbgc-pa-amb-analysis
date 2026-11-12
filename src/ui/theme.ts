/**
 * Theme — Stage 6 UI core (Worker A).
 *
 * Dark by default, with a toggle (MASTER_PROMPT §18).
 * Tokens are the PBGC Design System v1.1.0 DRAFT values (fetched
 * 2026-11-12 from ErChulo/pbgc-design-system @ 84a7149d).
 * The P-09 probe tokens (dark bg #000000, fg #f2f0e9, muted #b8b5ac,
 * accent #7fb3ff, header #0a1f44) are SUPERSEDED by the design
 * system's own provisional dark theme (DS v1.1.0 §2.5,
 * OPEN-QUESTIONS Q6, not COLA-approved) and are not kept alongside.
 * Light bg #ffffff, fg #1a1a1a, accent #002d72 are DS values.
 * These tokens must not drift from src/ui/styles.css.
 *
 * Storage: the DEL precedent (del-generator.html `delSafeStorage`):
 * every localStorage access is inside try/catch, with a null /
 * no-persistence fallback. Browser storage is never the source of truth
 * (Stage 3 §2.2): the theme is a display preference only, and a blocked
 * store means the app runs unpersisted, never broken. No top-level
 * localStorage access anywhere in this module.
 */

export type ThemeName = "dark" | "light";

/** Storage key for the theme preference. Display only. */
export const THEME_STORAGE_KEY = "pa-amb-theme";

/** Default theme (MASTER_PROMPT §18: true dark theme by default). */
export const DEFAULT_THEME: ThemeName = "dark";

/** Dark-theme tokens: DS v1.1.0 provisional dark theme (§2.5, Q6,
 *  not COLA-approved). Header #002D72 is DS-defined, both themes. */
export const DARK_THEME_TOKENS = {
  bg: "#0B1B36",
  fg: "#F2F2F2",
  muted: "#D2D2D2",
  accent: "#BEC6DF",
  rowAlt: "#12294D",
  border: "#8B9FC7",
  headerBg: "#002D72",
} as const;

/** Light-theme tokens: DS v1.1.0 §2.3. Accent and header use PBGC blue #002D72. */
export const LIGHT_THEME_TOKENS = {
  bg: "#FFFFFF",
  fg: "#1A1A1A",
  muted: "#58585B",
  accent: "#002D72",
  rowAlt: "#F2F2F2",
  border: "#81807F",
  headerBg: "#002D72",
} as const;

/** Theme tokens: one colour per role, in either theme. */
export interface ThemeTokens {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  rowAlt: string;
  border: string;
  headerBg: string;
}

/** Tokens for a theme name. */
export function themeTokens(theme: ThemeName): ThemeTokens {
  return theme === "dark" ? DARK_THEME_TOKENS : LIGHT_THEME_TOKENS;
}

/** True only for the exact string "dark" or "light". Anything else is
 *  not a theme and resolves to the default. */
export function isThemeName(value: unknown): value is ThemeName {
  return value === "dark" || value === "light";
}

/** Resolve a stored value (or null) to a theme. Unknown or missing
 *  values fall back to dark, never to an invented third theme. */
export function resolveTheme(stored: string | null): ThemeName {
  return isThemeName(stored) ? stored : DEFAULT_THEME;
}

/** The other theme. */
export function toggleThemeName(theme: ThemeName): ThemeName {
  return theme === "dark" ? "light" : "dark";
}

/**
 * Defensive storage wrapper (DEL `delSafeStorage` pattern). Returns the
 * storage object, or null when there is none or when merely touching it
 * throws (opaque origin, blocked storage). Never throws.
 */
export function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Read the stored theme, or null when nothing is stored or storage is
 *  unavailable. Never throws. */
export function loadStoredTheme(): string | null {
  const storage = safeStorage();
  if (storage === null) return null;
  try {
    return storage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Load the theme: stored value when valid, else the default. Never throws. */
export function loadTheme(): ThemeName {
  return resolveTheme(loadStoredTheme());
}

/** Save the theme preference. Silent no-op when storage is unavailable.
 *  Never throws. */
export function saveTheme(theme: ThemeName): void {
  const storage = safeStorage();
  if (storage === null) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // No persistence available. The theme still applies in this session.
  }
}

/** Remove the stored theme preference. Silent no-op when unavailable.
 *  Never throws. */
export function clearStoredTheme(): void {
  const storage = safeStorage();
  if (storage === null) return;
  try {
    storage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Apply a theme to the document (`data-theme` on <html>). DOM-guarded:
 * no-op when there is no document (Node tests). Never throws.
 */
export function applyThemeToDocument(theme: ThemeName): void {
  if (typeof document === "undefined") return;
  try {
    if (document.documentElement !== null && document.documentElement !== undefined) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    // The document is not writable. The CSS default (dark) stands.
  }
}

/**
 * Apply a theme and persist the preference. Returns the theme applied.
 * DOM-guarded and storage-guarded; never throws.
 */
export function setTheme(theme: ThemeName): ThemeName {
  applyThemeToDocument(theme);
  saveTheme(theme);
  return theme;
}

/** Toggle the current theme, apply it, and persist it. */
export function toggleTheme(current: ThemeName): ThemeName {
  return setTheme(toggleThemeName(current));
}

/** Label for the theme toggle button, in plain words. */
export function themeToggleLabel(theme: ThemeName): string {
  return theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
}
