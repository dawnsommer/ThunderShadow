(() => {
  "use strict";

  const ZOOM_LEVELS = [80, 85, 90, 95, 100, 105, 110, 115, 120];
  const ERROR_CODES = [
    ["1", "Careless / misread", "Missed wording, negation, task, units, or a visible clue."],
    ["2", "Knowledge gap", "Required fact, diagnosis, or management step was not known."],
    ["3", "Misapplied / trapped", "Concept was known, but applied incorrectly or a distractor won."],
    ["4", "Differential confusion", "Could not separate two clinically close choices."],
    ["5", "Correct but between two", "Correct answer with unresolved differential uncertainty."],
    ["6", "Lucky correct / no idea", "Correct answer without a reliable reasoning pathway."],
    ["7", "Shaky / trap-prone", "Correct, but the reasoning was unstable or vulnerable to a trap."]
  ];
  const RULE_PATTERNS = [
    ["task_target", "TASK", "Solved a different question from the one NBME asked.", "P1", "Translate the final question into a 2–4 word command before evaluating options.", "What did the question ask, and what did you answer instead?"],
    ["stability_urgency", "STABILITY", "Failed to classify instability, acuity, or an immediate threat before choosing the pathway.", "P2", "Ask whether an immediate threat overrides the normal diagnostic or management pathway.", "Which instability or emergency clue did you miss?"],
    ["sequence_nbs", "SEQUENCE", "Recognized the clinical problem but selected the wrong stage of diagnosis or management.", "P3", "Locate the current node: stabilize → evaluate → confirm → treat → escalate → definitive management.", "Which step did you choose, and which step was actually required?"],
    ["frame_assumption", "FRAME", "Built the wrong illness script or added an unsupported assumption before comparing choices.", "P4", "Restate the case neutrally using only supplied facts; require a real contradiction before rejecting an option.", "What illness script or unsupported assumption changed the case?"],
    ["hinge_discriminator", "HINGE", "The candidate answers were reasonable, but the decisive discriminator was missed or underweighted.", "P5", "Ask which single finding is hardest for the selected answer to explain.", "Which option won, and what clue should have separated it?"],
    ["timeline_course", "TIMELINE", "The timing, onset, duration, progression, event order, or treatment exposure determined the answer.", "P6", "Convert the stem into: trigger → interval → presentation.", "Which timing relationship did you overlook?"],
    ["modifier_constraint", "MODIFIER", "Knew the usual rule but failed to adjust it for a patient-specific constraint or context.", "P7", "State: Normally X; because of modifier Y, choose Z.", "Which patient-specific factor changed the usual pathway?"]
  ];
  const SPEED_FLAGS = [
    ["rushed", "RUSHED", "S1"], ["overthought", "OVERTHOUGHT", "S2"], ["reread_loop", "RE-READ LOOP", "S3"],
    ["changed_answer", "CHANGED ANSWER", "S4"], ["slow_recall", "SLOW RECALL", "S5"], ["fatigue_attention", "FATIGUE/ATTENTION", "S6"]
  ];
  const LEGACY_PATTERN_MAP = { task_recognition: "task_target", exact_task: "task_target", diagnose_vs_treat: "task_target", diagnose_treat: "task_target", stability_emergency: "stability_urgency", stability: "stability_urgency", clinical_sequence: "sequence_nbs", sequence: "sequence_nbs", use_given_facts: "frame_assumption", given_facts: "frame_assumption", hinge_vs_distractor: "hinge_discriminator", differential_discrimination: "hinge_discriminator", hinge: "hinge_discriminator", differential: "hinge_discriminator", timeline: "timeline_course", modifier: "modifier_constraint" };
  const LEGACY_SPEED_MAP = { rushed: "rushed", overthought: "overthought", overanalysis: "overthought", reread_loop: "reread_loop", reread: "reread_loop", changed_answer: "changed_answer", changed_wrong: "changed_answer", answer_changing: "changed_answer", slow_recall: "slow_recall", fatigue_attention: "fatigue_attention" };
  const $ = (id) => document.getElementById(id);
  const el = {
    appShell: $("appShell"), libraryView: $("libraryView"), loggerView: $("loggerView"), formsGrid: $("formsGrid"),
    emptyLibrary: $("emptyLibrary"), formSearchInput: $("formSearchInput"), libraryTopActions: $("libraryTopActions"),
    loggerTopActions: $("loggerTopActions"), homeBtn: $("homeBtn"), questionGrid: $("questionNumberGrid"),
    rangeTabs: $("questionRangeTabs"), errorRows: $("errorCodeRows"), patternRows: $("patternRows"), speedButtons: $("speedFlagButtons"),
    note: $("manualRuleInput"), saveState: $("saveState"), currentNumber: $("currentQuestionNumber"),
    topNumber: $("topQuestionNumber"), topTotal: $("topQuestionTotal"), progress: $("loggerProgressText"), progressBar: $("loggerProgressBar"),
    formName: $("loggerFormName"), formSubject: $("loggerFormSubject"), formDialog: $("formDialog"), formCreate: $("formCreateForm"),
    formNameInput: $("newFormName"), lengthInput: $("newFormQuestionCount"), dateInput: $("newFormDate"), subjectInput: $("newFormSubject"),
    examTypeInput: $("newFormExamType"), expectedInput: $("newFormExpectedScreenshots"), formDialogTitle: $("formDialogTitle"),
    formDialogEyebrow: $("formDialogEyebrow"), formSubmit: $("formDialogSubmitBtn"), confirmDialog: $("confirmDialog"),
    confirmTitle: $("confirmTitle"), confirmMessage: $("confirmMessage"), confirmAction: $("confirmActionBtn"), confirmCancel: $("confirmCancelBtn"),
    exportDialog: $("exportDialog"), exportBody: $("exportValidationBody"), exportConfirm: $("confirmExportBtn"),
    toastRegion: $("toastRegion"), theme: $("themeModeSelect")
  };
  const TOUCH_SECTION_PREF_KEY = "thundershadow:touch-section-defaults";
  function loadTouchSectionPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(TOUCH_SECTION_PREF_KEY) || "{}");
      return { pattern: stored.pattern === true, note: stored.note === true, speed: stored.speed === true };
    } catch {
      return { pattern: false, note: false, speed: false };
    }
  }
  const state = { forms: [], currentForm: null, currentEntryNumber: null, selected: new Set(), selectionMode: false, anchor: null, filter: "active", search: "", saveTimer: null, formTimer: null, pendingConfirm: null, editingForm: null, conflict: null, conflicts: [], zoom: 100, uiMode: localStorage.getItem("thundershadow:ui-mode") === "touch" ? "touch" : "desktop", entryRailExpanded: false, touchSections: loadTouchSectionPreferences() };
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const isEditable = (target) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
  const isLogged = (entry) => Boolean(entry && !entry.deleted && (entry.errorCode || entry.pattern || entry.reasoningNote?.trim() || entry.speedFlags?.length));
  const blankEntry = (number) => ({ number, entryNumber: number, errorCode: "", pattern: "", speedFlags: [], reasoningNote: "", manualRule: "", deleted: false, revision: 0 });
  const normalizeEntry = (entry) => { const rawPattern = entry?.pattern || ""; const rawSpeed = Array.isArray(entry?.speedFlags) ? entry.speedFlags : []; return ({ ...blankEntry(entry?.entryNumber || entry?.number || 1), ...entry, entryNumber: entry?.entryNumber || entry?.number || 1, reasoningNote: entry?.reasoningNote ?? entry?.manualRule ?? "", pattern: RULE_PATTERNS.some(([value]) => value === rawPattern) ? rawPattern : (LEGACY_PATTERN_MAP[rawPattern] || ""), speedFlags: [...new Set(rawSpeed.map((value) => LEGACY_SPEED_MAP[value]).filter(Boolean))], deleted: Boolean(entry?.deleted) }); };
  const normalizeForm = (form) => {
    // Drive/IndexedDB migration can briefly surface sparse records on iOS.
    // Never dereference a missing form; callers can safely filter null values.
    if (!form || typeof form !== "object") return null;
    const sourceEntries = Array.isArray(form.entries) ? form.entries : (Array.isArray(form.questions) ? form.questions : []);
    const entries = sourceEntries.filter((entry) => entry && typeof entry === "object").map(normalizeEntry).sort((a, b) => a.entryNumber - b.entryNumber);
    const lastEntryNumber = entries.length ? Number(entries[entries.length - 1]?.entryNumber || 0) : 0;
    return { ...form, entries, questions: entries, currentEntry: Number(form.currentEntry || form.currentQuestion || lastEntryNumber || 1), originalFormLength: form.originalFormLength ?? null, expectedScreenshotCount: form.expectedScreenshotCount ?? null, maxEntryNumber: Math.max(Number(form.maxEntryNumber || 0), lastEntryNumber), finished: Boolean(form.finished) };
  };
  const normalizeForms = (forms) => (Array.isArray(forms) ? forms : []).map(normalizeForm).filter(Boolean);
  const activeEntries = (form = state.currentForm) => (form?.entries || []).filter((entry) => !entry.deleted);
  const loggedEntries = (form = state.currentForm) => activeEntries(form).filter(isLogged);
  const currentEntry = () => state.currentForm?.entries.find((entry) => entry.entryNumber === state.currentEntryNumber) || null;

  function showToast(message) { const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = message; el.toastRegion.append(toast); setTimeout(() => toast.remove(), 2800); }
  async function rawApiRequest(path, options = {}) { return window.ThunderShadowBrowserApi.request(path, { ...options, headers: { ...(options.body && !(options.body instanceof ArrayBuffer) ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } }); }
  async function apiRequest(path, options = {}) { const response = await rawApiRequest(path, options); if (!response.ok) { let message = `Request failed (${response.status})`; try { message = (await response.json()).error?.message || message; } catch {} throw new Error(message); } return response.status === 204 ? null : response.json(); }
  async function mutate(path, { method, body, entity }) { return window.ThunderShadowSync.mutate(path, { method, body, entity }); }
  async function downloadFromApi(path, filename) { const response = await rawApiRequest(path); if (!response.ok) throw new Error("Download failed."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

  function applyTheme(mode) { const systemDark = matchMedia("(prefers-color-scheme: dark)").matches; document.documentElement.dataset.themeMode = mode; document.documentElement.dataset.theme = mode === "system" ? (systemDark ? "dark" : "light") : mode; localStorage.setItem("thundershadow:theme", mode); if (el.theme) el.theme.value = mode; document.querySelectorAll("[data-theme-choice]").forEach((button) => button.classList.toggle("is-active", button.dataset.themeChoice === mode)); }
  function applyUiMode(mode) {
    state.uiMode = mode === "touch" ? "touch" : "desktop";
    document.documentElement.dataset.uiMode = state.uiMode;
    localStorage.setItem("thundershadow:ui-mode", state.uiMode);
    $("uiModeToggleBtn").setAttribute("aria-pressed", String(state.uiMode === "touch"));
    $("uiModeToggleText").textContent = state.uiMode === "touch" ? "Desktop UI" : "Touch UI";
    document.querySelectorAll("[data-ui-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.uiMode === state.uiMode));
    if (state.uiMode !== "touch") setEntryRailExpanded(false);
    syncTouchLayout();
    if (el.appShell) setZoom(state.zoom, false);
  }
  function isPhoneTouch() { return state.uiMode === "touch" && matchMedia("(max-width: 640px), (max-height: 500px) and (orientation: landscape) and (max-width: 950px)").matches; }
  function syncTouchPreferenceControls() {
    document.querySelectorAll("[data-touch-section-pref]").forEach((button) => {
      const key = button.dataset.touchSectionPref;
      const expanded = button.dataset.expanded === "true";
      const active = Boolean(state.touchSections[key]) === expanded;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  function persistTouchSectionPreferences() {
    localStorage.setItem(TOUCH_SECTION_PREF_KEY, JSON.stringify(state.touchSections));
    syncTouchPreferenceControls();
  }
  function setTouchSectionPreference(key, expanded) {
    if (!["pattern", "note", "speed"].includes(key)) return;
    state.touchSections[key] = Boolean(expanded);
    persistTouchSectionPreferences();
    syncTouchLayout();
  }
  function syncTouchLayout() {
    const root = document.documentElement;
    root.dataset.touchLayout = isPhoneTouch() ? "phone" : matchMedia("(orientation: portrait)").matches ? "tablet-portrait" : "tablet-landscape";
    const rail = $("questionRail");
    if (rail) rail.classList.toggle("is-expanded", Boolean(state.entryRailExpanded));
    const toggle = $("entryRailToggleBtn");
    if (toggle) toggle.setAttribute("aria-expanded", String(Boolean(state.entryRailExpanded)));
    for (const key of ["pattern", "note", "speed"]) {
      const map = { pattern: ["patternSection", "patternCollapseBtn"], note: ["noteArea", "noteCollapseBtn"], speed: ["speedArea", "speedCollapseBtn"] }[key];
      const section = $(map[0]), button = $(map[1]);
      if (!section || !button) continue;
      const expanded = !isPhoneTouch() || Boolean(state.touchSections[key]);
      section.classList.toggle("is-touch-collapsed", !expanded);
      button.setAttribute("aria-expanded", String(expanded));
    }
    syncTouchPreferenceControls();
  }
  function setEntryRailExpanded(expanded) { state.entryRailExpanded = Boolean(expanded); if (!state.entryRailExpanded && state.selectionMode) { state.selectionMode = false; state.selected.clear(); state.anchor = null; if (state.currentForm) renderNavigator(); } syncTouchLayout(); }
  function toggleTouchSection(key) { setTouchSectionPreference(key, !state.touchSections[key]); }
  function setActiveView(view) { document.documentElement.dataset.activeView = view; }
  function hideAuxiliaryViews() {
    ["ruleLibraryView", "analysisView", "reviewView", "settingsView"].forEach((id) => {
      const view = $(id);
      if (view) view.hidden = true;
    });
  }
  let viewportTimer = 0;
  let lastViewportHeight = 0;
  function syncVisualViewport(immediate = false) {
    clearTimeout(viewportTimer);
    const apply = () => {
      viewportTimer = 0;
      const height = Math.round(window.visualViewport?.height || window.innerHeight || 0);
      if (!height || Math.abs(height - lastViewportHeight) < 2) return;
      lastViewportHeight = height;
      document.documentElement.style.setProperty("--touch-viewport-height", `${height}px`);
    };
    if (immediate) apply();
    else viewportTimer = setTimeout(apply, 90);
  }
  let layoutTimer = 0;
  function scheduleViewportLayout() {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      layoutTimer = 0;
      if (state.uiMode !== "touch") setZoom(state.zoom, false);
      syncTouchLayout();
      syncVisualViewport(true);
    }, 90);
  }
  function setSaveState(text) { el.saveState.textContent = text; const touch = $("touchEntrySaveState"); if (touch) touch.textContent = text; }
  function syncTouchSummaries(entry = currentEntry()) {
    if (!entry) return;
    const pattern = RULE_PATTERNS.find(([id]) => id === entry.pattern);
    $("touchEntryNumber").textContent = String(entry.entryNumber);
    $("patternCollapseSummary").textContent = pattern ? pattern[1] : "Optional";
    $("noteCollapseSummary").textContent = entry.reasoningNote?.trim() ? "Added" : "Optional";
    $("speedCollapseSummary").textContent = entry.speedFlags?.length ? `${entry.speedFlags.length} selected` : "Optional";
    $("touchDeleteEntryBtn").textContent = entry.deleted ? "Restore Entry" : "Delete Entry";
    $("touchPermanentDeleteEntryBtn").hidden = !entry.deleted;
    if (state.currentForm) $("touchFinishFormBtn").textContent = state.currentForm.finished ? "Reopen / append" : "Finish Form";
  }
  function setZoom(value, persist = true) { const zoom = Math.max(80, Math.min(120, value)); state.zoom = zoom; const touch = state.uiMode === "touch"; el.appShell.style.zoom = String(touch || matchMedia("(max-width: 900px)").matches ? 1 : zoom / 100); el.appShell.dataset.scale = touch ? "100" : String(zoom); $("zoomFitBtn").textContent = `${zoom}%`; if (persist) apiRequest("/api/settings", { method: "PUT", body: JSON.stringify({ uiScale: zoom }) }).catch(() => {}); }
  function changeZoom(direction) { const index = Math.max(0, ZOOM_LEVELS.indexOf(state.zoom)); setZoom(ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction))]); }
  function fitZoom() { const width = innerWidth; setZoom(width < 1200 ? 85 : width < 1450 ? 90 : 100); }

  function counts(form) { const logged = loggedEntries(form); return { logged: logged.length, codes: logged.filter((e) => e.errorCode).length, deleted: form.entries.filter((e) => e.deleted).length }; }
  function renderLibrary() {
    const query = state.search.toLowerCase(); const forms = state.forms.filter((form) => !query || `${form.name} ${form.examType} ${form.subject}`.toLowerCase().includes(query));
    el.emptyLibrary.hidden = state.forms.length > 0;
    el.formsGrid.innerHTML = forms.map((form) => { const c = counts(form); return `<article class="form-card" data-form-id="${escapeHTML(form.id)}"><div class="form-card__top"><div><span class="badge">${escapeHTML(form.examType || form.subject || "Form")}</span><h2>${escapeHTML(form.name)}</h2><p>${escapeHTML(form.date)} · ${form.originalFormLength ? `${form.originalFormLength} original questions · ` : ""}${c.logged} active entr${c.logged === 1 ? "y" : "ies"} · ${form.finished ? "Finished" : "Open"}</p></div></div><div class="form-card__actions"><button class="form-card__action form-card__action--open" data-action="open">Open</button><button class="form-card__action" data-action="export">TSV</button><button class="form-card__action" data-action="edit">Edit</button><button class="form-card__action form-card__action--delete" data-action="delete">Delete</button></div></article>`; }).join("");
    renderFrequencies();
  }
  function renderFrequencies() { const all = state.forms.flatMap((f) => f.entries).filter(isLogged); const render = (items, value, target) => { const values = items.map(([id, label], index) => [label, all.filter((e) => value(e, id)).length, index]); const max = Math.max(1, ...values.map(([, n]) => n)); $(target).innerHTML = values.map(([label, n, index]) => `<div class="frequency-item${target === "patternFrequencyList" ? ` pattern-analytics--${index + 1}` : ""}"><div class="frequency-item__body"><div class="frequency-item__label"><span>${escapeHTML(label)}</span></div><div class="frequency-item__bar"><i style="width:${n ? Math.max(5, n * 100 / max) : 0}%"></i></div></div><strong>${n}</strong></div>`).join(""); }; render(ERROR_CODES, (e, id) => e.errorCode === id, "errorFrequencyList"); render(RULE_PATTERNS, (e, id) => e.pattern === id, "patternFrequencyList"); render(SPEED_FLAGS, (e, id) => e.speedFlags.includes(id), "speedFrequencyList"); }

  function recoverEntryDraft(entry) {
    const entity = { type: "entry", formId: state.currentForm.id, entryNumber: entry.entryNumber };
    const draft = window.ThunderShadowSync.getDraft(entity);
    if (!draft?.value) return entry;
    showToast(`Recovered unsent work for Entry ${entry.entryNumber}.`);
    return normalizeEntry({ ...entry, ...draft.value });
  }
  async function openForm(form) { hideAuxiliaryViews(); state.currentForm = normalizeForm(await apiRequest(`/api/forms/${encodeURIComponent(form.id)}`)); if (!state.currentForm) throw new Error("Form data is incomplete. Sync again or restore a backup."); replaceForm(state.currentForm); state.entryRailExpanded = false; if (!state.currentForm.entries.length) await newEntry(); else { state.currentEntryNumber = state.currentForm.entries.some((e) => e.entryNumber === state.currentForm.currentEntry) ? state.currentForm.currentEntry : state.currentForm.entries.at(-1).entryNumber; const entity = { type: "entry", formId: state.currentForm.id, entryNumber: state.currentEntryNumber }, recovered = Boolean(window.ThunderShadowSync.getDraft(entity)); replaceEntry(recoverEntryDraft(currentEntry())); renderLogger(); if (recovered) saveEntry(); } el.libraryView.hidden = true; el.loggerView.hidden = false; el.libraryTopActions.hidden = true; el.loggerTopActions.hidden = false; el.homeBtn.hidden = false; setActiveView("logger"); syncTouchLayout(); document.querySelectorAll("[data-area]").forEach((b) => b.classList.toggle("is-active", b.dataset.area === "logger")); }
  function showLibrary() { hideAuxiliaryViews(); el.loggerView.hidden = true; el.libraryView.hidden = false; el.loggerTopActions.hidden = true; el.libraryTopActions.hidden = false; el.homeBtn.hidden = true; state.currentForm = null; state.selected.clear(); state.entryRailExpanded = false; setActiveView("library"); renderLibrary(); syncTouchLayout(); document.querySelectorAll("[data-area]").forEach((b) => b.classList.toggle("is-active", b.dataset.area === "logger")); }
  function replaceForm(form) { const index = state.forms.findIndex((f) => f.id === form.id); if (index >= 0) state.forms[index] = form; else state.forms.push(form); }
  function replaceEntry(entry) { const normalized = normalizeEntry(entry); const index = state.currentForm.entries.findIndex((e) => e.entryNumber === normalized.entryNumber); if (index >= 0) state.currentForm.entries[index] = normalized; else state.currentForm.entries.push(normalized); state.currentForm.entries.sort((a, b) => a.entryNumber - b.entryNumber); state.currentForm.maxEntryNumber = Math.max(state.currentForm.maxEntryNumber, normalized.entryNumber); state.currentForm.questions = state.currentForm.entries; replaceForm(state.currentForm); }

  async function newEntry() { if (currentEntry()) await saveEntry(true); const trailing = activeEntries().find((e) => !isLogged(e)); if (trailing) { state.currentEntryNumber = trailing.entryNumber; renderLogger(); return trailing; } const provisionalEntryNumber = state.currentForm.maxEntryNumber + 1; let entry; try { const result = await mutate(`/api/forms/${encodeURIComponent(state.currentForm.id)}/entries`, { method: "POST", body: {}, entity: { type: "entry-allocation", formId: state.currentForm.id, provisionalEntryNumber } }); entry = result.data; if (!entry) { entry = { ...blankEntry(provisionalEntryNumber), revision: 1 }; showToast("New entry is offline; it will sync when reconnected."); } } catch { entry = { ...blankEntry(provisionalEntryNumber), revision: 1 }; showToast("New entry is offline; it will sync when reconnected."); } replaceEntry(entry); state.currentEntryNumber = entry.entryNumber; state.filter = "active"; renderLogger(); return entry; }
  async function saveEntry(immediate = false) { clearTimeout(state.saveTimer); const active = currentEntry(); if (!active || !state.currentForm) return; const formId = state.currentForm.id, snapshot = { ...active, speedFlags: [...active.speedFlags] }; const perform = async () => { setSaveState("Saving…"); const body = { ...snapshot, manualRule: undefined }; const entity = { type: "entry", formId, entryNumber: snapshot.entryNumber }; try { const result = await mutate(`/api/forms/${encodeURIComponent(formId)}/entries/${snapshot.entryNumber}`, { method: "PUT", body, entity }); if (result.data && state.currentForm?.id === formId) { replaceEntry(result.data); if (state.currentEntryNumber === snapshot.entryNumber) renderChoiceState(); } setSaveState(result.queued ? "Pending sync" : result.conflict ? "Needs review" : "Saved"); } catch (error) { setSaveState("Pending sync"); showToast(error.message); } if (state.currentForm?.id === formId) { renderNavigatorEntry(snapshot.entryNumber); renderProgress(); } }; if (immediate) return perform(); state.saveTimer = setTimeout(perform, 240); }
  async function saveForm(patch = {}) { const form = { ...state.currentForm, ...patch, currentEntry: state.currentEntryNumber || state.currentForm.currentEntry }; delete form.entries; delete form.questions; try { const result = await mutate(`/api/forms/${encodeURIComponent(form.id)}`, { method: "PUT", body: form, entity: { type: "form", formId: form.id } }); if (result.data) { const saved = normalizeForm({ ...state.currentForm, ...result.data, entries: state.currentForm.entries }); state.currentForm = saved; replaceForm(saved); } } catch (error) { showToast(error.message); } }
  async function saveAndNext() { await saveEntry(true); const active = activeEntries(); const index = active.findIndex((e) => e.entryNumber === state.currentEntryNumber); if (index >= 0 && index < active.length - 1) changeEntry(active[index + 1].entryNumber); else await newEntry(); await saveForm(); }
  function changeEntry(number) { if (!state.currentForm.entries.some((e) => e.entryNumber === number)) return; saveEntry(true); state.currentEntryNumber = number; state.currentForm.currentEntry = number; saveForm(); renderLogger(); }

  function renderChoices() { const entry = currentEntry(); el.errorRows.innerHTML = ERROR_CODES.map(([id, label, detail]) => `<button class="option-row option-row--error option-row--error-${id}${entry?.errorCode === id ? " is-selected" : ""}" data-error-code="${id}" aria-pressed="${entry?.errorCode === id}"><span class="option-row__index">${id}</span><span class="option-row__text"><strong>${escapeHTML(label)}</strong><small>${escapeHTML(detail)}</small></span><kbd class="shortcut-badge">${id}</kbd><span class="option-row__check" aria-hidden="true">✓</span></button>`).join(""); el.patternRows.innerHTML = RULE_PATTERNS.map(([id, label, detail, code, fix], index) => `<button class="option-row option-row--pattern option-row--pattern-${index + 1}${entry?.pattern === id ? " is-selected" : ""}" data-pattern="${id}" aria-pressed="${entry?.pattern === id}" title="${escapeHTML(`${label} — ${detail} Fix: ${fix} Shortcut: Shift+${index + 1}.`)}"><span class="pattern-dot" aria-hidden="true"></span><span class="option-row__index">${code}</span><span class="option-row__text"><strong>${escapeHTML(label)}</strong></span><kbd class="shortcut-badge">⇧${index + 1}</kbd><span class="option-row__check" aria-hidden="true">✓</span></button>`).join("") + `<button class="option-clear" type="button" data-clear-pattern><span>No pattern / Clear</span><kbd>⇧0</kbd></button>`; el.speedButtons.innerHTML = SPEED_FLAGS.map(([id, label, code], index) => `<button class="speed-button speed-button--tone-${index}${entry?.speedFlags.includes(id) ? " is-selected" : ""}" data-speed-flag="${id}" aria-pressed="${entry?.speedFlags.includes(id)}"><span>${code} ${escapeHTML(label)}</span><kbd>⌥${index + 1}</kbd><span class="selected-mark" aria-hidden="true">✓</span></button>`).join("") + `<button class="option-clear option-clear--speed" type="button" data-clear-speed><span>Clear speed flags</span><kbd>⌥0</kbd></button>`; }
  function renderChoiceState(entry = currentEntry()) {
    if (!entry) return;
    el.errorRows.querySelectorAll("[data-error-code]").forEach((button) => { const selected = button.dataset.errorCode === entry.errorCode; button.classList.toggle("is-selected", selected); button.setAttribute("aria-pressed", String(selected)); });
    el.patternRows.querySelectorAll("[data-pattern]").forEach((button) => { const selected = button.dataset.pattern === entry.pattern; button.classList.toggle("is-selected", selected); button.setAttribute("aria-pressed", String(selected)); });
    el.speedButtons.querySelectorAll("[data-speed-flag]").forEach((button) => { const selected = entry.speedFlags.includes(button.dataset.speedFlag); button.classList.toggle("is-selected", selected); button.setAttribute("aria-pressed", String(selected)); });
    const pattern = RULE_PATTERNS.find(([id]) => id === entry.pattern);
    el.note.placeholder = pattern ? pattern[5] : "Record only what the screenshot cannot show.";
    syncTouchSummaries(entry);
  }
  function renderNavigatorEntry(entryNumber) {
    const entry = state.currentForm?.entries.find((item) => item.entryNumber === entryNumber);
    const button = el.questionGrid.querySelector(`[data-entry-number="${entryNumber}"]`);
    if (!entry || !button) return;
    const patternIndex = RULE_PATTERNS.findIndex(([id]) => id === entry.pattern);
    const patternLabel = patternIndex >= 0 ? RULE_PATTERNS[patternIndex][1] : "";
    button.classList.toggle("is-logged", isLogged(entry));
    button.classList.toggle("is-draft", !isLogged(entry));
    button.classList.toggle("is-deleted", entry.deleted);
    button.classList.toggle("is-current", entry.entryNumber === state.currentEntryNumber);
    button.classList.toggle("is-selected", state.selected.has(entry.entryNumber));
    button.setAttribute("aria-label", `Entry ${entry.entryNumber}${entry.deleted ? ", deleted" : ""}${patternLabel ? `, pattern ${patternLabel}` : ""}`);
    button.setAttribute("aria-pressed", String(state.selectionMode && state.selected.has(entry.entryNumber)));
    const markers = button.querySelector(".question-number__markers");
    if (markers) markers.innerHTML = `${patternIndex >= 0 ? `<i class="navigator-pattern navigator-pattern--${patternIndex + 1}" title="${patternLabel}" aria-hidden="true"></i>` : ""}${entry.errorCode ? `<b>${entry.errorCode}</b>` : ""}`;
  }
  function renderNavigator() { const entries = state.currentForm.entries.filter((e) => state.filter === "deleted" ? e.deleted : !e.deleted); el.questionGrid.innerHTML = entries.map((entry) => { const patternIndex = RULE_PATTERNS.findIndex(([id]) => id === entry.pattern); const patternLabel = patternIndex >= 0 ? RULE_PATTERNS[patternIndex][1] : ""; const classes = ["question-number", isLogged(entry) ? "is-logged" : "is-draft", entry.deleted ? "is-deleted" : "", entry.entryNumber === state.currentEntryNumber ? "is-current" : "", state.selected.has(entry.entryNumber) ? "is-selected" : ""].filter(Boolean).join(" "); return `<button class="${classes}" data-entry-number="${entry.entryNumber}" aria-label="Entry ${entry.entryNumber}${entry.deleted ? ", deleted" : ""}${patternLabel ? `, pattern ${patternLabel}` : ""}" aria-pressed="${state.selectionMode ? state.selected.has(entry.entryNumber) : "false"}"><span><i>Entry</i> ${entry.entryNumber}</span><span class="question-number__markers">${patternIndex >= 0 ? `<i class="navigator-pattern navigator-pattern--${patternIndex + 1}" title="${patternLabel}" aria-hidden="true"></i>` : ""}${entry.errorCode ? `<b>${entry.errorCode}</b>` : ""}</span></button>`; }).join("") || `<p class="muted">No ${state.filter} entries.</p>`; el.rangeTabs.querySelectorAll("[data-entry-filter]").forEach((b) => b.classList.toggle("is-active", b.dataset.entryFilter === state.filter)); const bar = $("mobileSelectionBar"); if (bar) { bar.hidden = !state.selectionMode; $("mobileSelectionCount").textContent = `${state.selected.size} selected`; $("selectEntriesBtn").setAttribute("aria-pressed", String(state.selectionMode)); $("selectEntriesBtn").textContent = state.selectionMode ? "Done" : "Select"; } }
  function renderProgress() { const count = counts(state.currentForm); el.progress.textContent = `${count.logged} entr${count.logged === 1 ? "y" : "ies"}`; const expected = state.currentForm.expectedScreenshotCount || state.currentForm.originalFormLength || Math.max(count.logged, 1); el.progressBar.style.width = `${Math.min(100, count.logged * 100 / expected)}%`; el.topTotal.textContent = String(activeEntries().length); $("finishFormBtn").textContent = state.currentForm.finished ? "Reopen / append" : "Finish Form"; if ($("touchFinishFormBtn")) $("touchFinishFormBtn").textContent = state.currentForm.finished ? "Reopen / append" : "Finish Form"; }
  function renderLogger() { const entry = currentEntry(); if (!entry) return; el.formName.textContent = state.currentForm.name; el.formSubject.textContent = [state.currentForm.examType, state.currentForm.subject].filter(Boolean).join(" · ") || "Ordered review log"; el.currentNumber.textContent = entry.entryNumber; el.topNumber.textContent = `Entry ${entry.entryNumber}`; el.note.value = entry.reasoningNote || ""; const pattern = RULE_PATTERNS.find(([id]) => id === entry.pattern); el.note.placeholder = pattern ? pattern[5] : "Record only what the screenshot cannot show."; renderChoices(); renderNavigator(); renderProgress(); syncTouchSummaries(entry); syncTouchLayout(); autoExpandNote(); const active = activeEntries(); const index = active.findIndex((e) => e.entryNumber === entry.entryNumber); const atEnd = index >= 0 && index === active.length - 1; $("topPrevBtn").disabled = index <= 0; $("bottomPrevBtn").disabled = index <= 0; $("topNextBtn").disabled = index < 0; $("topNextBtn").innerHTML = atEnd ? `New entry <span aria-hidden="true">＋</span>` : `Next <span aria-hidden="true">→</span>`; $("topNextBtn").setAttribute("aria-label", atEnd ? "Create new entry" : "Next entry"); $("clearQuestionBtn").textContent = entry.deleted ? "Restore Entry" : "Delete Entry"; $("permanentDeleteEntryBtn").hidden = !entry.deleted; setSaveState("Saved"); }
  function autoExpandNote() { el.note.style.height = "auto"; const minimum = isPhoneTouch() ? 112 : state.uiMode === "touch" ? 132 : 132; const cap = isPhoneTouch() ? 220 : 300; const height = Math.max(minimum, Math.min(el.note.scrollHeight, cap)); el.note.style.height = `${height}px`; el.note.style.overflowY = el.note.scrollHeight > cap ? "auto" : "hidden"; }
  function persistCurrentDraft() { const entry = currentEntry(); if (entry && state.currentForm) window.ThunderShadowSync.saveDraft({ type: "entry", formId: state.currentForm.id, entryNumber: entry.entryNumber }, { ...entry }); }
  function updateEntry(mutator) { const entry = currentEntry(); if (!entry || entry.deleted) return; mutator(entry); entry.updatedAt = new Date().toISOString(); persistCurrentDraft(); renderChoiceState(entry); renderNavigatorEntry(entry.entryNumber); renderProgress(); saveEntry(); }

  function selectRange(from, to, additive = false) { if (!additive) state.selected.clear(); const numbers = state.currentForm.entries.filter((e) => !e.deleted).map((e) => e.entryNumber); const a = numbers.indexOf(from), b = numbers.indexOf(to); if (a < 0 || b < 0) return; for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) state.selected.add(numbers[i]); }
  function handleSelection(number, event) { if (event.shiftKey && state.anchor !== null) selectRange(state.anchor, number); else if (event.metaKey || event.ctrlKey) { state.selected.has(number) ? state.selected.delete(number) : state.selected.add(number); state.anchor = number; } else { state.selected.clear(); state.selected.add(number); state.anchor = number; } renderNavigator(); }
  function clearSelection() { state.selected.clear(); state.anchor = null; renderNavigator(); }
  function setSelectionMode(enabled) { state.selectionMode = Boolean(enabled); if (!state.selectionMode) state.selected.clear(); state.anchor = null; renderNavigator(); }
  async function copyCodes() { const codes = state.currentForm.entries.filter((e) => state.selected.has(e.entryNumber) && isLogged(e) && e.errorCode).sort((a, b) => a.entryNumber - b.entryNumber).map((e) => e.errorCode); if (!codes.length) { showToast("No logged error codes in selection"); return; } const text = codes.join(", "); try { await navigator.clipboard.writeText(text); } catch { const area = document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.opacity = "0"; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); } showToast(`${codes.length} error code${codes.length === 1 ? "" : "s"} copied`); }

  async function deleteOrRestoreEntry() { const entry = currentEntry(); if (!entry) return; if (entry.deleted) { const restored = await apiRequest(`/api/forms/${encodeURIComponent(state.currentForm.id)}/entries/${entry.entryNumber}/restore`, { method: "POST", body: "{}" }); replaceEntry(restored); state.filter = "active"; renderLogger(); showToast(`Entry ${entry.entryNumber} restored`); return; } requestConfirm(`Delete Entry ${entry.entryNumber}?`, "It will keep its number and can be restored from Deleted Entries.", async () => { await mutate(`/api/forms/${encodeURIComponent(state.currentForm.id)}/entries/${entry.entryNumber}`, { method: "DELETE", body: { revision: entry.revision }, entity: { type: "entry", formId: state.currentForm.id, entryNumber: entry.entryNumber } }); entry.deleted = true; state.selected.delete(entry.entryNumber); const next = activeEntries()[0]; if (next) state.currentEntryNumber = next.entryNumber; else await newEntry(); renderLogger(); }); }
  async function permanentlyDeleteEntry() { const entry = currentEntry(); if (!entry?.deleted) return; const confirmation = window.prompt(`Type DELETE ENTRY ${entry.entryNumber} to permanently remove it.`); if (confirmation !== `DELETE ENTRY ${entry.entryNumber}`) { if (confirmation !== null) showToast("Permanent deletion cancelled: confirmation did not match."); return; } await apiRequest(`/api/forms/${encodeURIComponent(state.currentForm.id)}/entries/${entry.entryNumber}/permanent`, { method: "DELETE", body: JSON.stringify({ confirmation }) }); state.currentForm.entries = state.currentForm.entries.filter((item) => item.entryNumber !== entry.entryNumber); state.currentForm.questions = state.currentForm.entries; const next = activeEntries()[0]; if (next) { state.currentEntryNumber = next.entryNumber; state.filter = "active"; renderLogger(); } else await newEntry(); showToast(`Entry ${entry.entryNumber} permanently deleted.`); }
  function requestConfirm(title, message, action, label = "Delete") { state.pendingConfirm = action; el.confirmTitle.textContent = title; el.confirmMessage.textContent = message; el.confirmAction.textContent = label; el.confirmDialog.showModal(); }

  function exportForm(form) { const c = counts(form); const expected = form.expectedScreenshotCount; const match = expected == null ? "Not set" : expected === c.logged ? "Match" : "Mismatch"; el.exportBody.innerHTML = `<dl class="export-check"><div><dt>Active exported entry count</dt><dd>${c.logged}</dd></div><div><dt>Entries with error codes</dt><dd>${c.codes}</dd></div><div><dt>Expected screenshot count</dt><dd>${expected ?? "Not set"}</dd></div><div><dt>Status</dt><dd class="${match === "Mismatch" ? "is-mismatch" : "is-match"}">${match}</dd></div></dl>${match === "Mismatch" ? "<p class=\"export-warning\">Counts differ. Review the entries or explicitly export despite the mismatch.</p>" : ""}`; el.exportConfirm.textContent = match === "Mismatch" ? "Export despite mismatch" : "Export TSV"; el.exportConfirm.onclick = () => downloadFromApi(`/api/forms/${encodeURIComponent(form.id)}/export.tsv`, `${form.name}.tsv`).then(() => showToast(`Exported ${c.logged} active entries.`)).catch((e) => showToast(e.message)); el.exportDialog.showModal(); }

  function openFormDialog(form = null) { state.editingForm = form; el.formDialogTitle.textContent = form ? "Edit form" : "Create form"; el.formDialogEyebrow.textContent = form ? "Form metadata" : "New session"; el.formSubmit.textContent = form ? "Save" : "Create & open"; el.formNameInput.value = form?.name || ""; el.lengthInput.value = form?.originalFormLength || ""; el.dateInput.value = form?.date || todayISO(); el.subjectInput.value = form?.subject || ""; el.examTypeInput.value = form?.examType || ""; el.expectedInput.value = form?.expectedScreenshotCount ?? ""; el.formDialog.showModal(); setTimeout(() => el.formNameInput.focus(), 30); }
  async function submitForm(event) { event.preventDefault(); const length = el.lengthInput.value === "" ? null : Number(el.lengthInput.value); const expected = el.expectedInput.value === "" ? null : Number(el.expectedInput.value); const data = { id: state.editingForm?.id || window.ThunderShadowSync.uuid(), name: el.formNameInput.value, date: el.dateInput.value || todayISO(), subject: el.subjectInput.value, examType: el.examTypeInput.value, originalFormLength: length, expectedScreenshotCount: expected, revision: state.editingForm?.revision || 0, currentEntry: state.editingForm?.currentEntry || 1, finished: state.editingForm?.finished || false }; try { const saved = normalizeForm(await apiRequest(state.editingForm ? `/api/forms/${encodeURIComponent(data.id)}` : "/api/forms", { method: state.editingForm ? "PUT" : "POST", body: JSON.stringify(data) })); if (!saved) throw new Error("Saved form data is incomplete."); replaceForm(saved); el.formDialog.close(); if (state.editingForm) renderLibrary(); else await openForm(saved); } catch (error) { showToast(error.message); } }

  async function backupAllForms() { const payload = await apiRequest("/api/backup"); const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `ThunderShadow_Backup_${todayISO()}.json`; a.click(); URL.revokeObjectURL(url); }
  async function restoreBackup(file) { if (!file) return; requestConfirm("Restore this backup?", "The current library will be replaced after validation.", async () => { const result = await apiRequest("/api/restore", { method: "POST", body: await file.text() }); state.forms = normalizeForms(await apiRequest("/api/forms")); renderLibrary(); showToast(`Restored ${result.restored} forms.`); }, "Restore"); }
  function showNextConflict() {
    if (state.conflict || !state.conflicts.length) return;
    const mutation = state.conflicts.shift(); state.conflict = mutation;
    const server = mutation.conflict?.server || {}, device = mutation.conflict?.device || mutation.body || {};
    const format = (value) => [`Code: ${value.errorCode || "(empty)"}`, `Pattern: ${value.pattern || "(empty)"}`, `Speed flags: ${(value.speedFlags || []).join(", ") || "(none)"}`, `Reasoning Note:\n${value.reasoningNote ?? value.manualRule ?? "(empty)"}`].join("\n");
    $("conflictServerText").textContent = format(server); $("conflictDeviceText").textContent = format(device);
    const option = (source, value) => `<option value="${source}">${source === "server" ? "Cloud" : "Browser"}: ${escapeHTML(value || "(empty)")}</option>`;
    $("conflictErrorChoice").innerHTML = option("server", server.errorCode) + option("device", device.errorCode); $("conflictErrorChoice").value = "device";
    $("conflictPatternChoice").innerHTML = option("server", server.pattern) + option("device", device.pattern); $("conflictPatternChoice").value = "device";
    $("conflictUnionSpeed").checked = true;
    const serverNote = server.reasoningNote ?? server.manualRule ?? "", deviceNote = device.reasoningNote ?? device.manualRule ?? "";
    $("conflictMergeInput").value = serverNote && deviceNote && serverNote !== deviceNote ? `${serverNote}\n\n--- Browser version ---\n${deviceNote}` : deviceNote || serverNote;
    $("conflictDialog").showModal();
  }
  function showConflict(mutation) { if (!state.conflicts.some((item) => item.mutationId === mutation.mutationId) && state.conflict?.mutationId !== mutation.mutationId) state.conflicts.push(mutation); showNextConflict(); }
  async function resolveConflict(choice) { if (!state.conflict) return; const mutation = state.conflict, server = mutation.conflict.server, device = mutation.conflict.device || mutation.body; let merged = null; if (choice === "merge") merged = { ...device, errorCode: $("conflictErrorChoice").value === "server" ? server.errorCode : device.errorCode, pattern: $("conflictPatternChoice").value === "server" ? server.pattern : device.pattern, speedFlags: $("conflictUnionSpeed").checked ? [...new Set([...(server.speedFlags || []), ...(device.speedFlags || [])])] : (device.speedFlags || []), reasoningNote: $("conflictMergeInput").value, manualRule: $("conflictMergeInput").value }; const value = await window.ThunderShadowSync.resolveConflict(mutation.mutationId, choice, merged); state.conflict = null; $("conflictDialog").close(); if (value?.entryNumber && state.currentForm?.id === mutation.entity?.formId) { replaceEntry(value); state.currentEntryNumber = value.entryNumber; renderLogger(); } showToast("Sync conflict resolved."); showNextConflict(); }

  async function handleServerEvent({ type, data }) {
    if (data.sourceClientId === window.ThunderShadowSync.clientId) return;
    if (type === "entry.updated" || type === "entry.deleted") {
      if (!state.currentForm || state.currentForm.id !== data.formId || !data.entry) return;
      const entity = { type: "entry", formId: data.formId, entryNumber: data.entry.entryNumber };
      if (await window.ThunderShadowSync.hasPendingEntity(entity)) return;
      replaceEntry(data.entry);
      if (state.currentEntryNumber === data.entry.entryNumber) renderLogger(); else { renderNavigator(); renderProgress(); }
      showToast(`Entry ${data.entry.entryNumber} updated from synchronized data.`);
      return;
    }
    if (type === "form.updated" && data.form) {
      const incoming = normalizeForm(data.form); if (!incoming) return;
      if (state.currentForm?.id === incoming.id && !(await window.ThunderShadowSync.hasPendingForForm(incoming.id))) {
        state.currentForm = incoming; replaceForm(incoming); renderLogger();
      } else replaceForm(incoming);
      renderLibrary();
    } else if (type === "form.deleted") {
      state.forms = state.forms.filter((form) => form.id !== data.formId);
      if (state.currentForm?.id === data.formId) showLibrary(); else renderLibrary();
    } else if (type === "database.restored") {
      state.forms = normalizeForms(await apiRequest("/api/forms")); showLibrary(); showToast("Database restored from synchronized data.");
    }
  }

  async function reconcileCurrentForm() {
    if (!state.currentForm || await window.ThunderShadowSync.hasPendingForForm(state.currentForm.id)) return;
    try { state.currentForm = normalizeForm(await apiRequest(`/api/forms/${encodeURIComponent(state.currentForm.id)}`)); replaceForm(state.currentForm); renderLogger(); } catch {}
  }

  function openPatternGuide() {
    const dialog = $("patternGuideDialog");
    state.patternGuideReturnFocus = document.activeElement;
    dialog.showModal();
    $("patternGuideCloseBtn").focus();
  }

  function closePatternGuide() {
    const dialog = $("patternGuideDialog");
    if (dialog.open) dialog.close();
  }

  function trapPatternGuideFocus(event) {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter((node) => !node.hidden);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function bindEvents() {
    [$("newFormTopBtn"), $("newFormBtn"), $("emptyNewFormBtn")].forEach((b) => b?.addEventListener("click", () => openFormDialog()));
    document.querySelectorAll("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => $(b.dataset.closeDialog)?.close()));
    document.querySelectorAll("[data-length]").forEach((b) => b.addEventListener("click", () => { el.lengthInput.value = b.dataset.length; }));
    el.formCreate.addEventListener("submit", submitForm); el.formSearchInput.addEventListener("input", () => { state.search = el.formSearchInput.value.trim(); renderLibrary(); });
    el.formsGrid.addEventListener("click", (event) => { const card = event.target.closest("[data-form-id]"), button = event.target.closest("[data-action]"); if (!card) return; const form = state.forms.find((f) => f.id === card.dataset.formId); if (!form) return; if (!button) { if (state.uiMode === "touch") openForm(form); return; } if (button.dataset.action === "open") openForm(form); if (button.dataset.action === "export") exportForm(form); if (button.dataset.action === "edit") openFormDialog(form); if (button.dataset.action === "delete") requestConfirm(`Delete ${form.name}?`, "The form and its entries will be permanently removed.", async () => { await mutate(`/api/forms/${encodeURIComponent(form.id)}`, { method: "DELETE", body: { revision: form.revision }, entity: { type: "form", formId: form.id } }); state.forms = state.forms.filter((f) => f.id !== form.id); renderLibrary(); }); });
    el.errorRows.addEventListener("click", (event) => { const b = event.target.closest("[data-error-code]"); if (b) updateEntry((entry) => { entry.errorCode = entry.errorCode === b.dataset.errorCode ? "" : b.dataset.errorCode; }); });
    el.patternRows.addEventListener("click", (event) => { const b = event.target.closest("[data-pattern]"); if (b) updateEntry((entry) => { entry.pattern = entry.pattern === b.dataset.pattern ? "" : b.dataset.pattern; }); else if (event.target.closest("[data-clear-pattern]")) updateEntry((entry) => { entry.pattern = ""; }); });
    el.speedButtons.addEventListener("click", (event) => { const b = event.target.closest("[data-speed-flag]"); if (b) updateEntry((entry) => { const set = new Set(entry.speedFlags); set.has(b.dataset.speedFlag) ? set.delete(b.dataset.speedFlag) : set.add(b.dataset.speedFlag); entry.speedFlags = [...set]; }); else if (event.target.closest("[data-clear-speed]")) updateEntry((entry) => { entry.speedFlags = []; }); });
    $("patternGuideBtn").addEventListener("click", openPatternGuide); $("patternGuideBtn").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPatternGuide(); } }); $("patternGuideTouchBtn").addEventListener("click", openPatternGuide); $("patternGuideCloseBtn").addEventListener("click", closePatternGuide);
    $("entryRailToggleBtn").addEventListener("click", () => setEntryRailExpanded(!state.entryRailExpanded));
    $("touchNewEntryBtn").addEventListener("click", () => { setEntryRailExpanded(false); newEntry(); });
    $("patternCollapseBtn").addEventListener("click", () => toggleTouchSection("pattern"));
    $("noteCollapseBtn").addEventListener("click", () => toggleTouchSection("note"));
    $("speedCollapseBtn").addEventListener("click", () => toggleTouchSection("speed"));
    document.querySelectorAll("[data-touch-section-pref]").forEach((button) => button.addEventListener("click", () => setTouchSectionPreference(button.dataset.touchSectionPref, button.dataset.expanded === "true")));
    $("touchEntryActionsBtn").addEventListener("click", () => { syncTouchSummaries(); $("touchEntryActionsTitle").textContent = `Entry ${state.currentEntryNumber || ""}`; $("touchEntryActionsDialog").showModal(); });
    $("touchEntryActionsCloseBtn").addEventListener("click", () => $("touchEntryActionsDialog").close());
    $("touchEntryActionsDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) $("touchEntryActionsDialog").close(); });
    $("touchDeleteEntryBtn").addEventListener("click", () => { $("touchEntryActionsDialog").close(); deleteOrRestoreEntry(); });
    $("touchPermanentDeleteEntryBtn").addEventListener("click", () => { $("touchEntryActionsDialog").close(); permanentlyDeleteEntry().catch((error) => showToast(error.message)); });
    $("touchExportFormBtn").addEventListener("click", () => { $("touchEntryActionsDialog").close(); exportForm(state.currentForm); });
    $("touchFinishFormBtn").addEventListener("click", () => { $("touchEntryActionsDialog").close(); $("finishFormBtn").click(); });
    $("patternGuideDialog").addEventListener("keydown", trapPatternGuideFocus);
    $("patternGuideDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) closePatternGuide(); });
    $("patternGuideDialog").addEventListener("close", () => { const target = state.patternGuideReturnFocus || $("patternGuideBtn"); state.patternGuideReturnFocus = null; target?.focus(); });
    el.note.addEventListener("input", () => { const entry = currentEntry(); if (!entry) return; entry.reasoningNote = el.note.value; entry.manualRule = el.note.value; entry.updatedAt = new Date().toISOString(); persistCurrentDraft(); autoExpandNote(); saveEntry(); });
    el.rangeTabs.addEventListener("click", (event) => { const b = event.target.closest("[data-entry-filter]"); if (b) { state.filter = b.dataset.entryFilter; renderNavigator(); } });
    el.questionGrid.addEventListener("click", (event) => { const b = event.target.closest("[data-entry-number]"); if (!b) return; const number = Number(b.dataset.entryNumber); if (state.selectionMode) { state.selected.has(number) ? state.selected.delete(number) : state.selected.add(number); state.anchor = number; renderNavigator(); } else if (event.shiftKey || event.metaKey || event.ctrlKey) handleSelection(number, event); else { state.selected.clear(); state.anchor = number; setEntryRailExpanded(false); changeEntry(number); } });
    $("newEntryBtn").addEventListener("click", newEntry); $("copyCodesBtn").addEventListener("click", copyCodes); $("selectAllEntriesBtn").addEventListener("click", () => { state.selected = new Set(loggedEntries().map((e) => e.entryNumber)); renderNavigator(); }); $("clearEntrySelectionBtn").addEventListener("click", clearSelection);
    $("selectEntriesBtn").addEventListener("click", () => setSelectionMode(!state.selectionMode)); $("mobileSelectionDoneBtn").addEventListener("click", () => setSelectionMode(false)); $("mobileCopyCodesBtn").addEventListener("click", copyCodes); $("mobileSelectAllBtn").addEventListener("click", () => { state.selected = new Set(loggedEntries().map((entry) => entry.entryNumber)); renderNavigator(); }); $("mobileClearSelectionBtn").addEventListener("click", clearSelection);
    $("clearQuestionBtn").addEventListener("click", deleteOrRestoreEntry); $("permanentDeleteEntryBtn").addEventListener("click", () => permanentlyDeleteEntry().catch((error) => showToast(error.message))); $("saveNextBtn").addEventListener("click", saveAndNext); $("exportFormBtn").addEventListener("click", () => exportForm(state.currentForm));
    $("finishFormBtn").addEventListener("click", async () => { const finished = !state.currentForm.finished; await saveForm({ finished }); state.currentForm.finished = finished; renderProgress(); showToast(finished ? "Form marked finished. You can reopen and append anytime." : "Form reopened for appending."); });
    const navigate = async (direction) => { const entries = activeEntries(); const index = entries.findIndex((e) => e.entryNumber === state.currentEntryNumber); if (entries[index + direction]) { changeEntry(entries[index + direction].entryNumber); return; } if (direction > 0 && index === entries.length - 1) { await saveEntry(true); await newEntry(); await saveForm(); } };
    $("topPrevBtn").addEventListener("click", () => navigate(-1)); $("bottomPrevBtn").addEventListener("click", () => navigate(-1)); $("topNextBtn").addEventListener("click", () => navigate(1));
    el.homeBtn.addEventListener("click", async () => { await saveEntry(true); await saveForm(); showLibrary(); });
    el.confirmCancel.addEventListener("click", () => { state.pendingConfirm = null; el.confirmDialog.close(); }); el.confirmAction.addEventListener("click", async () => { const action = state.pendingConfirm; state.pendingConfirm = null; el.confirmDialog.close(); if (action) await action(); });
    $("zoomOutBtn").addEventListener("click", () => changeZoom(-1)); $("zoomInBtn").addEventListener("click", () => changeZoom(1)); $("zoomFitBtn").addEventListener("click", fitZoom); addEventListener("resize", scheduleViewportLayout, { passive: true }); addEventListener("orientationchange", scheduleViewportLayout, { passive: true }); window.visualViewport?.addEventListener("resize", syncVisualViewport, { passive: true });
    $("uiModeToggleBtn").addEventListener("click", () => applyUiMode(state.uiMode === "touch" ? "desktop" : "touch")); document.querySelectorAll("[data-ui-mode]").forEach((button) => button.addEventListener("click", () => applyUiMode(button.dataset.uiMode)));
    $("backupBtn").addEventListener("click", () => backupAllForms().catch((e) => showToast(e.message))); $("restoreBackupBtn").addEventListener("click", () => $("restoreInput").click()); $("restoreInput").addEventListener("change", (e) => restoreBackup(e.target.files?.[0]));
    el.theme.addEventListener("change", () => applyTheme(el.theme.value)); document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.themeChoice))); matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if ((localStorage.getItem("thundershadow:theme") || "system") === "system") applyTheme("system"); });
    $("keepServerBtn").addEventListener("click", () => resolveConflict("server").catch((error) => showToast(error.message))); $("keepDeviceBtn").addEventListener("click", () => resolveConflict("device").catch((error) => showToast(error.message))); $("mergeConflictBtn").addEventListener("click", () => resolveConflict("merge").catch((error) => showToast(error.message)));
    addEventListener("thundershadow-sync-status", (event) => { const detail = event.detail || {}, status = detail.state || "synced", cloudState = detail.cloudState || "signedout"; $("syncStatusBtn").dataset.state = status; $("syncStatusText").textContent = status === "pending" ? "Syncing cloud" : status === "offline" ? (cloudState === "signedout" ? "Saved locally" : "Cloud offline") : cloudState === "synced" ? "Cloud synced" : "Saved locally"; $("syncStatusBtn").title = detail.lastSyncedAt ? `Last Drive sync ${new Date(detail.lastSyncedAt).toLocaleTimeString()} · browser storage is always active` : "Saved in this browser"; $("retrySyncBtn").hidden = status === "synced"; });
    addEventListener("thundershadow-conflict", (event) => showConflict(event.detail)); $("retrySyncBtn").addEventListener("click", () => { if (!window.ThunderShadowCloud?.isAuthorized?.()) window.ThunderShadowCloud?.connect?.().catch((error) => showToast(error.message)); else window.ThunderShadowSync.replay(); });
    addEventListener("thundershadow-server-event", (event) => handleServerEvent(event.detail).catch((error) => showToast(error.message))); addEventListener("thundershadow-sync-reconnected", () => reconcileCurrentForm()); addEventListener("thundershadow-cloud-merged", async () => { try { const forms = normalizeForms(await apiRequest("/api/forms")); state.forms = forms; if (state.currentForm) { const merged = forms.find((form) => form.id === state.currentForm.id); if (merged) { state.currentForm = merged; state.currentEntryNumber = merged.entries.some((entry) => entry.entryNumber === state.currentEntryNumber) ? state.currentEntryNumber : (merged.currentEntry || merged.entries.at(-1)?.entryNumber || 1); renderLogger(); } else showLibrary(); } else renderLibrary(); } catch (error) { showToast(error.message); } });
    addEventListener("thundershadow-entry-remapped", (event) => { const detail = event.detail; if (state.currentForm?.id !== detail.formId) return; state.currentForm.entries = state.currentForm.entries.filter((entry) => entry.entryNumber !== detail.provisionalEntryNumber); replaceEntry(detail.entry); if (state.currentEntryNumber === detail.provisionalEntryNumber) state.currentEntryNumber = detail.entry.entryNumber; renderLogger(); });
    document.addEventListener("pointerdown", (event) => { if (state.selected.size && !event.target.closest("#questionRail,#mobileSelectionBar") && !isEditable(event.target)) clearSelection(); });
    addEventListener("keydown", (event) => {
      const editable = isEditable(event.target), guide = $("patternGuideDialog");
      if (guide.open) { if (event.key === "Escape") { event.preventDefault(); closePatternGuide(); } return; }
      if (editable || !state.currentForm || el.formDialog.open || el.confirmDialog.open) return;
      const digitMatch = event.code.match(/^Digit([0-7])$/), digit = digitMatch ? Number(digitMatch[1]) : null;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.code === "Enter") { event.preventDefault(); saveAndNext(); return; }
      if (event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey && digit !== null && digit <= 6) { event.preventDefault(); if (digit === 0) updateEntry((entry) => { entry.speedFlags = []; }); else updateEntry((entry) => { const value = SPEED_FLAGS[digit - 1][0], set = new Set(entry.speedFlags); set.has(value) ? set.delete(value) : set.add(value); entry.speedFlags = [...set]; }); return; }
      if (event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && digit !== null) { event.preventDefault(); updateEntry((entry) => { entry.pattern = digit === 0 ? "" : RULE_PATTERNS[digit - 1][0]; }); return; }
      if (!event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && digit >= 1 && digit <= 7) { event.preventDefault(); const value = String(digit); updateEntry((entry) => { entry.errorCode = entry.errorCode === value ? "" : value; }); return; }
      if (!event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && event.code === "BracketLeft") { event.preventDefault(); navigate(-1); }
      else if (!event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && event.code === "BracketRight") { event.preventDefault(); navigate(1); }
      else if (event.key === "Escape" && state.selected.size) { event.preventDefault(); clearSelection(); }
      else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.code === "KeyC" && state.selected.size) { event.preventDefault(); copyCodes(); }
    });
  }

  async function initialize() { setActiveView("library"); syncVisualViewport(true); applyTheme(localStorage.getItem("thundershadow:theme") || "system"); applyUiMode(state.uiMode); setZoom(100, false); el.dateInput.value = todayISO(); bindEvents(); window.ThunderShadowSync.setFlusher(() => saveEntry(true)); window.ThunderShadowSync.initialize(); try { state.forms = normalizeForms(await apiRequest("/api/forms")); await window.ThunderShadowSync.setCache("forms", state.forms); const settings = await apiRequest("/api/settings"); setZoom(settings.uiScale, false); navigator.storage?.persist?.().catch(() => {}); } catch (error) { state.forms = normalizeForms((await window.ThunderShadowSync.getCache("forms")) || []); showToast(state.forms.length ? "Loaded cached forms; browser storage reported an error." : `Browser storage could not be opened: ${error.message}`); } renderLibrary(); if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {}); }

  window.ThunderShadowApp = { apiRequest, rawApiRequest, downloadFromApi, showLibrary, showToast, refreshAccess: async () => {}, getForms: () => state.forms.map(({ id, name, date }) => ({ id, name, date })), openFormQuestion: async (formId, entryNumber) => { const form = state.forms.find((f) => f.id === formId); if (!form) throw new Error("Source form is no longer available."); await openForm(form); changeEntry(Number(entryNumber)); }, hideCoreViews: () => { el.libraryView.hidden = true; el.loggerView.hidden = true; el.libraryTopActions.hidden = true; el.loggerTopActions.hidden = true; el.homeBtn.hidden = false; setActiveView("other"); syncTouchLayout(); } };
  initialize();
})();
