// Import form log TSV: file pick / drop → preview → confirm (new, merge or replace) → open, with Undo.
// All data work goes through the in-page API in js/browser-api.js (/api/import/form-tsv/*).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const app = () => window.ThunderShadowApp;
  const { PATTERNS, SPEED_FLAGS } = window.ThunderShadowReasoning;
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const MAX_BYTES = 5 * 1024 * 1024;

  const dialog = $("tsvImportDialog"), fileInput = $("tsvImportFile"), drop = $("tsvImportDrop"), commitBtn = $("tsvImportCommitBtn");
  if (!dialog || !fileInput) return;
  let preview = null, mode = "new", busy = false;

  async function api(path, body) {
    return app().apiRequest(path, { method: "POST", body: JSON.stringify(body) });
  }
  function setError(message) { const el = $("tsvImportError"); el.textContent = message || ""; el.hidden = !message; }
  function setStage(stage) {
    drop.hidden = stage !== "pick";
    $("tsvImportPreview").hidden = stage !== "preview";
    commitBtn.disabled = stage !== "preview" || busy;
    dialog.classList.toggle("is-preview", stage === "preview");
  }
  function open() {
    preview = null; mode = "new"; setError(""); setStage("pick");
    $("tsvImportTitle").textContent = "Import a TSV log";
    if (!dialog.open) dialog.showModal();
    setTimeout(() => drop.focus(), 30);
  }

  async function loadFile(file) {
    if (!file) return;
    if (!dialog.open) open();
    setError("");
    if (file.size > MAX_BYTES) { setStage("pick"); setError("That file is larger than 5 MB — it is not a single form log."); return; }
    try {
      const text = await file.text();
      const result = await api("/api/import/form-tsv/preview", { text, filename: file.name });
      if (!result.ok) { setStage("pick"); setError(result.error); return; }
      preview = result;
      mode = result.matches.length ? "merge" : "new";
      render();
      setStage("preview");
      commitBtn.focus();
    } catch (error) { setStage("pick"); setError(error.message); }
  }

  const patternIndex = (value) => PATTERNS.findIndex((item) => item.value === value);
  const speedCode = (value) => SPEED_FLAGS.find((item) => item.value === value);

  function render() {
    const p = preview, entries = p.entries;
    const notes = entries.filter((entry) => entry.reasoningNote.trim()).length;
    const problemRows = new Set(p.problems.map((problem) => problem.row));
    $("tsvImportTitle").textContent = p.form.name || "Untitled form";
    $("tsvImportFileName").textContent = `${p.filename || "Pasted log"} · ${plural(p.rowCount, "row")}`;
    $("tsvImportStats").innerHTML = [
      [entries.length, "Entries", ""], [notes, "Notes → cards", ""],
      [problemRows.size, "Need a look", problemRows.size ? "warn" : ""], [p.skipped.length, "Skipped", ""]
    ].map(([value, label, tone]) => `<div class="tsv-stat${tone ? ` tsv-stat--${tone}` : ""}"><strong>${value}</strong><span>${label}</span></div>`).join("");

    const codeCounts = [1, 2, 3, 4, 5, 6, 7].map((code) => entries.filter((entry) => entry.errorCode === String(code)).length);
    const coded = codeCounts.reduce((a, b) => a + b, 0);
    const mix = $("tsvImportMix");
    mix.innerHTML = coded ? codeCounts.map((n, i) => n ? `<span data-code="${i + 1}" style="flex-grow:${n}" title="Code ${i + 1}: ${n}"></span>` : "").join("") : "";
    mix.hidden = !coded;
    mix.setAttribute("aria-label", `Error codes: ${codeCounts.map((n, i) => n ? `code ${i + 1} ×${n}` : "").filter(Boolean).join(", ")}`);

    $("tsvImportName").value = p.form.name;
    $("tsvImportDate").value = p.form.date || new Date().toISOString().slice(0, 10);
    $("tsvImportExamType").value = p.form.examType || "";
    $("tsvImportLength").value = "";

    const match = p.matches[0];
    $("tsvImportMatch").hidden = !match;
    if (match) {
      $("tsvImportMatchText").textContent = `${match.name} · ${match.date} already has ${plural(match.entryCount, "entry", "entries")}${match.matchedBy === "id" ? " and the same form ID" : ""}. Choose how to bring this file in — nothing changes until you confirm.`;
      const describe = (s) => [s.added && `${s.added} new`, s.updated && `${s.updated} updated`, s.unchanged && `${s.unchanged} unchanged`, s.removed && `${s.removed} moved to deleted`].filter(Boolean).join(" · ") || "No changes";
      const options = [
        ["merge", "Merge", "Add new entries and update ones with the same exam item (or the same number when neither has an item). Nothing is removed.", match.plan.merge],
        ["replace", "Replace entries", "Make the form match this file. Entries not in the file move to deleted, where they can still be restored.", match.plan.replace]
      ];
      $("tsvImportModes").innerHTML = options.map(([value, title, text, summary]) => `<button type="button" class="tsv-mode" role="radio" data-mode="${value}" aria-checked="${mode === value}" tabindex="${mode === value ? 0 : -1}"><span class="tsv-mode__radio" aria-hidden="true"></span><span class="tsv-mode__text"><strong>${title}</strong><small>${text}</small><em>${describe(summary)}</em></span></button>`).join("");
    }
    $("tsvImportMeta").hidden = Boolean(match);

    const problems = $("tsvImportProblems");
    const allIssues = [...p.problems.map((item) => ({ ...item, kind: "fix" })), ...p.skipped.map((item) => ({ ...item, kind: "skip" }))].sort((a, b) => a.row - b.row);
    problems.hidden = !allIssues.length;
    problems.open = allIssues.length > 0 && allIssues.length <= 4;
    $("tsvImportProblemsSummary").textContent = `${plural(allIssues.length, "note")} about this file`;
    $("tsvImportProblemList").innerHTML = allIssues.map((item) => `<li class="tsv-problem tsv-problem--${item.kind}"><span>Line ${item.row}</span>${escapeHTML(item.kind === "skip" ? `Skipped — ${item.message}` : item.message)}</li>`).join("");

    $("tsvImportRows").innerHTML = entries.map((entry) => {
      const tone = patternIndex(entry.pattern) + 1;
      const pattern = tone ? `<span class="tsv-badge" data-pattern-tone="${tone}" title="${escapeHTML(PATTERNS[tone - 1].label)}">${PATTERNS[tone - 1].code}</span><span class="tsv-cell-label">${escapeHTML(PATTERNS[tone - 1].label)}</span>` : `<span class="tsv-none">—</span>`;
      const speed = entry.speedFlags.length ? entry.speedFlags.map((flag) => { const item = speedCode(flag); return `<span class="tsv-chip" title="${escapeHTML(item?.label || flag)}">${escapeHTML(item?.code || flag)}</span>`; }).join("") : `<span class="tsv-none">—</span>`;
      const kind = `<span class="note-tag note-tag--static" data-note-kind="${entry.noteKind}">${entry.noteKind === "reasoning" ? "Broad" : "Clinical"}</span>`;
      const note = entry.reasoningNote ? `<span class="tsv-note">${escapeHTML(entry.reasoningNote)}</span>` : `<span class="tsv-none">No note</span>`;
      return `<tr class="${problemRows.has(entry.sourceRow) ? "has-problem" : ""}">
        <td data-label="#"><span class="tsv-num">${entry.entryNumber}</span></td>
        <td data-label="Item">${entry.examItem ? escapeHTML(entry.examItem) : `<span class="tsv-none">—</span>`}</td>
        <td data-label="Code">${entry.errorCode ? `<span class="tsv-badge" data-code="${entry.errorCode}">${entry.errorCode}</span>` : `<span class="tsv-none">—</span>`}</td>
        <td data-label="Pattern"><span class="tsv-cell-flex">${pattern}</span></td>
        <td data-label="Speed"><span class="tsv-cell-flex">${speed}</span></td>
        <td data-label="Note"><span class="tsv-note-cell">${kind}${note}</span></td>
      </tr>`;
    }).join("");

    $("tsvImportSafety").textContent = p.snapshots
      ? "A browser snapshot is saved first, and you can undo right after importing. Notes become review cards automatically; matching cards are reused."
      : "Browser snapshots are unavailable in emergency storage mode — you can still undo right after importing.";
    updateCommitLabel();
  }

  function updateCommitLabel() {
    commitBtn.textContent = mode === "merge" ? "Merge & open" : mode === "replace" ? "Replace & open" : "Import & open";
    commitBtn.classList.toggle("is-replace", mode === "replace");
  }
  function selectMode(value) {
    mode = value;
    document.querySelectorAll("#tsvImportModes .tsv-mode").forEach((button) => { const on = button.dataset.mode === value; button.setAttribute("aria-checked", String(on)); button.tabIndex = on ? 0 : -1; });
    updateCommitLabel();
  }

  async function commit() {
    if (!preview || busy) return;
    const match = preview.matches[0];
    const body = { token: preview.token, mode: match ? mode : "new", targetFormId: match?.id || null };
    if (!match) {
      const name = $("tsvImportName").value.trim(), date = $("tsvImportDate").value;
      if (!name) { setError("Give the form a name."); $("tsvImportName").focus(); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError("Choose the form date."); $("tsvImportDate").focus(); return; }
      const length = $("tsvImportLength").value === "" ? null : Number($("tsvImportLength").value);
      if (length != null && (!Number.isInteger(length) || length < 1 || length > 1000)) { setError("Total questions must be 1–1000."); $("tsvImportLength").focus(); return; }
      if (length != null && length < preview.entries.length) { setError(`Total questions can’t be smaller than the ${preview.entries.length} logged entries.`); $("tsvImportLength").focus(); return; }
      Object.assign(body, { name, date, examType: $("tsvImportExamType").value.trim(), originalFormLength: length });
    }
    busy = true; commitBtn.disabled = true; commitBtn.textContent = "Importing…"; setError("");
    try {
      await app().flushPendingEntry?.();
      const result = await api("/api/import/form-tsv/commit", body);
      dialog.close();
      await app().refreshForms();
      await app().openFormQuestion(result.form.id, result.form.entries.find((entry) => !entry.deleted)?.entryNumber || 1);
      const s = result.summary;
      const what = result.mode === "new" ? `Imported ${plural(s.added, "entry", "entries")} into ${result.form.name}` : `${result.mode === "merge" ? "Merged" : "Replaced"} ${result.form.name}: ${[s.added && `${s.added} new`, s.updated && `${s.updated} updated`, s.removed && `${s.removed} moved to deleted`].filter(Boolean).join(", ") || "no changes"}`;
      const message = `${what}${result.cardsCreated ? ` · ${plural(result.cardsCreated, "new card")}` : ""}.`;
      if (s.added || s.updated || s.removed || result.cardsCreated) undoToast(message, result.undoToken); else app().showToast(message);
    } catch (error) {
      setError(error.message);
      updateCommitLabel();
    } finally { busy = false; if (dialog.open) commitBtn.disabled = false; }
  }

  function undoToast(message, undoToken) {
    const region = $("toastRegion");
    region.querySelectorAll(".toast--action").forEach((older) => older.remove());
    const toast = document.createElement("div");
    toast.className = "toast toast--action";
    toast.setAttribute("role", "status");
    toast.innerHTML = `<span>${escapeHTML(message)}</span><button type="button" class="toast__action">Undo</button>`;
    const button = toast.querySelector("button");
    let timer = setTimeout(() => toast.remove(), 12000);
    toast.addEventListener("pointerenter", () => clearTimeout(timer));
    toast.addEventListener("pointerleave", () => { clearTimeout(timer); timer = setTimeout(() => toast.remove(), 5000); });
    button.addEventListener("click", async () => {
      button.disabled = true; button.textContent = "Undoing…";
      try {
        await app().flushPendingEntry?.();
        await api("/api/import/form-tsv/undo", { undoToken });
        toast.remove();
        app().showLibrary();
        await app().refreshForms();
        app().showToast("Import undone.");
      } catch (error) { toast.remove(); app().showToast(error.message); }
    });
    region.append(toast);
  }

  // Wiring
  [$("importTsvBtn"), $("emptyImportTsvBtn")].forEach((button) => button?.addEventListener("click", () => { open(); }));
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); } });
  $("tsvImportChangeFile").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { const file = fileInput.files?.[0]; fileInput.value = ""; loadFile(file); });
  commitBtn.addEventListener("click", commit);
  $("tsvImportModes").addEventListener("click", (event) => { const button = event.target.closest(".tsv-mode"); if (button) selectMode(button.dataset.mode); });
  $("tsvImportModes").addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = mode === "merge" ? "replace" : "merge";
    selectMode(next); document.querySelector(`#tsvImportModes [data-mode="${next}"]`)?.focus();
  });
  dialog.querySelectorAll("[data-exam-type]").forEach((button) => button.addEventListener("click", () => { $("tsvImportExamType").value = button.dataset.examType; }));
  dialog.querySelectorAll("[data-import-length]").forEach((button) => button.addEventListener("click", () => { $("tsvImportLength").value = button.dataset.importLength; }));
  dialog.addEventListener("close", () => { if (!busy) preview = null; dialog.classList.remove("is-dragging"); });

  // Drag a .tsv onto the dialog or anywhere on the forms library.
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
  for (const [target, cls] of [[dialog, "is-dragging"], [$("libraryView"), "is-tsv-drop"]]) {
    if (!target) continue;
    let depth = 0;
    target.addEventListener("dragenter", (event) => { if (!hasFiles(event)) return; event.preventDefault(); depth += 1; target.classList.add(cls); });
    target.addEventListener("dragover", (event) => { if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; });
    target.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) target.classList.remove(cls); });
    target.addEventListener("drop", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); event.stopPropagation(); depth = 0; target.classList.remove(cls);
      loadFile(event.dataTransfer.files[0]);
    });
  }

  window.ThunderShadowImport = { open, loadFile };
})();
