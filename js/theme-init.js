(() => {
  "use strict";
  const mode = localStorage.getItem("thundershadow:theme") || "system";
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = mode === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.dataset.uiMode = localStorage.getItem("thundershadow:ui-mode") === "touch" ? "touch" : "desktop";
})();
