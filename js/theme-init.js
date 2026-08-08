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
})();
