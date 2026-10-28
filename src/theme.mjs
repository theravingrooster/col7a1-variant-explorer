export const THEME_STORAGE_KEY = "col7a1-theme";

export function normalizeTheme(value) {
  return value === "light" || value === "dark" ? value : null;
}

export function readStoredTheme(environment) {
  try {
    return normalizeTheme(environment.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function preferredTheme(environment) {
  const stored = readStoredTheme(environment);
  if (stored) return stored;
  try {
    return environment.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function saveTheme(environment, theme) {
  if (!normalizeTheme(theme)) return;
  try {
    environment.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The selected theme still works for this session if storage is blocked.
  }
}

export function applyTheme(document, theme) {
  const value = normalizeTheme(theme) || "light";
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = value === "dark" ? "#101b18" : "#f7f8f4";
}
