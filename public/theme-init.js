// Run before CSS loads so a saved dark preference never flashes the light UI.
(() => {
  let theme;
  try {
    const stored = window.localStorage.getItem("col7a1-theme");
    if (stored === "dark" || stored === "light") theme = stored;
  } catch { /* Storage may be unavailable in private or restricted browsing. */ }
  if (!theme) {
    try {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch { theme = "light"; }
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#101b18" : "#f7f8f4";
})();
