/**
 * Theme — Stage 6 UI core (Worker A).
 *
 * Dark by default, with a toggle (MASTER_PROMPT §18; Stage 3 P-09).
 * Tokens are the P-09 probe tokens (stage3/poc/poc-p09-dark-theme.html):
 * dark bg #000000, fg #f2f0e9, muted #b8b5ac, accent #7fb3ff,
 * header #0a1f44; light bg #ffffff, fg #1a1a1a, accent #002d72.
 *
 * GAP (flagged, not invented around): PBGC Design System v1.1.0 defines
 * no dark theme. The dark tokens below come from the P-09 probe, not
 * from the design system. Where the design system defines a token
 * (PBGC blue #002D72, Helvetica Neue/Arial), the light theme uses it.
 * If the design system later adds a dark theme, these tokens should be
 * replaced with its tokens, not kept alongside them.
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

/** P-09 dark-theme tokens. */
export const DARK_THEME_TOKENS = {
  bg: "#000000",
  fg: "#f2f0e9",
  muted: "#b8b5ac",
  accent: "#7fb3ff",
  rowAlt: "#141414",
  border: "#333333",
  headerBg: "#0a1f44",
} as const;

/** Light-theme tokens. Accent and header use PBGC blue #002D72. */
export const LIGHT_THEME_TOKENS = {
  bg: "#ffffff",
  fg: "#1a1a1a",
  muted: "#555555",
  accent: "#002d72",
  rowAlt: "#f2f2f2",
  border: "#cccccc",
  headerBg: "#002d72",
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
