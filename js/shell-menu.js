// Header options menu: holds the display/data controls that used to sit in the bar.
(() => {
  "use strict";
  const button = document.getElementById("topbarMenuBtn");
  const panel = document.getElementById("topbarMenuPanel");
  if (!button || !panel) return;
  const setOpen = (open) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("pointerdown", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    setOpen(false);
    button.focus();
  });
  // Actions that open a dialog, file picker or download should not leave the menu behind.
  panel.addEventListener("click", (event) => {
    if (event.target.closest("#backupBtn, #restoreBackupBtn, #uiModeToggleBtn")) setOpen(false);
  });
})();
