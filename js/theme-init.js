(() => {
  "use strict";
  const mode = localStorage.getItem("thundershadow:theme") || "system";
  document.documentElement.dataset.themeMode = mode;
  const resolvedTheme = mode === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.dataset.theme = resolvedTheme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", resolvedTheme === "light" ? "#90a9b9" : "#07111f");
  document.documentElement.dataset.uiMode = localStorage.getItem("thundershadow:ui-mode") === "touch" ? "touch" : "desktop";
  document.documentElement.dataset.rainEffect = localStorage.getItem("thundershadow:rain-effect") === "off" ? "off" : "on";
  // Decorative motion releases its animated surfaces in background tabs/PWAs.
  const syncMotionVisibility = () => {
    document.documentElement.dataset.pageHidden = String(document.hidden);
  };
  syncMotionVisibility();
  document.addEventListener("visibilitychange", syncMotionVisibility);
  window.addEventListener("pageshow", syncMotionVisibility);
})();
