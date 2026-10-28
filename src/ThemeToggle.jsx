import React, { useEffect, useRef, useState } from "react";
import { applyTheme, normalizeTheme, preferredTheme, readStoredTheme, saveTheme, THEME_STORAGE_KEY } from "./theme.mjs";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() =>
    normalizeTheme(document.documentElement.dataset.theme) || preferredTheme(window),
  );
  const hasSessionChoice = useRef(Boolean(readStoredTheme(window)));

  useEffect(() => {
    applyTheme(document, theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const followSystem = () => {
      if (!hasSessionChoice.current) setTheme(preferredTheme(window));
    };
    const followSavedPreference = (event) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      hasSessionChoice.current = Boolean(readStoredTheme(window));
      setTheme(preferredTheme(window));
    };
    media?.addEventListener?.("change", followSystem);
    window.addEventListener("storage", followSavedPreference);
    return () => {
      media?.removeEventListener?.("change", followSystem);
      window.removeEventListener("storage", followSavedPreference);
    };
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} mode`}
      aria-description={`${theme === "dark" ? "Dark" : "Light"} mode is active`}
      title={`${theme === "dark" ? "Dark" : "Light"} mode is on. Switch to ${next} mode.`}
      onClick={() => {
        hasSessionChoice.current = true;
        saveTheme(window, next);
        applyTheme(document, next);
        setTheme(next);
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        {theme === "dark" ? (
          <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>
        ) : (
          <path d="M20.5 13.2A8.7 8.7 0 0 1 10.8 3.5 8.7 8.7 0 1 0 20.5 13.2Z" />
        )}
      </svg>
      <span>{next === "dark" ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}
