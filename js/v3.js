(() => {
  "use strict";

  const app = window.ThunderShadowApp;
  const views = {
    library: document.getElementById("ruleLibraryView"),
    analysis: document.getElementById("analysisView"),
    review: document.getElementById("reviewView"),
    settings: document.getElementById("settingsView")
  };
  const state = { rules: [], analytics: null, review: null, reviewIntervals: { again: 1, hard: 3, good: 7, easy: 30 }, reviewedThisSession: 0, activeArea: null, reviewKind: "all", reviewLoad: 0, reviewShortcuts: { again: "1", hard: "2", good: "3", easy: "4", quickGood: "Space" }, settingsCategory: "cards", librarySection: "saved", libraryForms: { saved: "all", suspended: "all" }, restorePreview: null };
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  state.libraryKinds = { saved: "all", suspended: "all" };
  state.selectedRules = new Set();
  state.selectionAnchor = null;
  state.bulkBusy = false;
  state.selectedReview = null;
  state.analysisScope = "all";
  state.timelineMode = "score";
  try {
    const saved = JSON.parse(sessionStorage.getItem("thundershadow:selected-review") || "null");
    if (Array.isArray(saved?.ids) && saved.ids.every((id) => typeof id === "string")) state.selectedReview = { ids: [...new Set(saved.ids)], reviewed: Math.max(0, Number(saved.reviewed) || 0) };
  } catch (_) {}
  const labelResponse = (value) => ({ again: "Again", hard: "Hard", good: "Good", easy: "Easy", still_weak: "Still weak", partly_reliable: "Partly reliable", reliable_today: "Reliable today", mastered: "Mastered", skip: "Skip" })[value] || value;

  function applyReviewTextSize(value, persist = false) {
    const size = Math.min(140, Math.max(80, Math.round((Number(value) || 100) / 5) * 5));
    document.documentElement.style.setProperty("--review-text-scale", String(size / 100));
    document.getElementById("reviewTextSize").value = size;
    document.getElementById("reviewTextSizeValue").textContent = `${size}%`;
    if (persist) { try { localStorage.setItem("thundershadow:review-text-size", String(size)); } catch (_) {} }
  }
  let savedReviewTextSize = 100;
  try { savedReviewTextSize = localStorage.getItem("thundershadow:review-text-size") || 100; } catch (_) {}
  applyReviewTextSize(savedReviewTextSize);
  document.getElementById("reviewTextSize").addEventListener("input", (event) => applyReviewTextSize(event.target.value, true));
  document.getElementById("resetReviewTextSizeBtn").addEventListener("click", () => applyReviewTextSize(100, true));

  const kindLabel = (kind) => kind === "reasoning" ? "Broad Pattern" : "Clinical Pattern";
  const tagMarkup = (rule) => `<span class="note-tag note-tag--static" data-note-kind="${escapeHTML(rule.noteKind)}">${kindLabel(rule.noteKind)}</span>${rule.pattern ? `<span class="badge badge--pattern" data-pattern-tone="${window.ThunderShadowReasoning.PATTERNS.findIndex((item) => item.value === rule.pattern) + 1}">${escapeHTML(rule.patternLabel)}</span>` : ""}`;
  const patternOptions = (selected) => `<option value="">No pattern</option>` + window.ThunderShadowReasoning.PATTERNS.map((pattern) => `<option value="${pattern.value}"${pattern.value === selected ? " selected" : ""}>${pattern.code} — ${pattern.label}</option>`).join("");
  const sourceLabel = (rule) => rule.sourceFormName ? `${rule.sourceFormName} · Entry ${rule.sourceQuestionNumber}` : rule.sourceFormId ? `Source form · Entry ${rule.sourceQuestionNumber || "?"}` : "Source unavailable";

  function hide() {
    Object.values(views).forEach((view) => { view.hidden = true; });
    state.activeArea = null;
  }

  function setActiveNav(area) {
    document.querySelectorAll("[data-area]").forEach((button) => button.classList.toggle("is-active", button.dataset.area === area));
  }

  function selectSettingsCategory(category, focus = false) {
    const tabs = [...document.querySelectorAll("[data-settings-category]")];
    if (!tabs.some((tab) => tab.dataset.settingsCategory === category)) return;
    state.settingsCategory = category;
    tabs.forEach((tab) => {
      const selected = tab.dataset.settingsCategory === category;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
      if (selected && focus) tab.focus({ preventScroll: true });
    });
    views.settings.querySelector(".v3-scroll").scrollTop = 0;
  }

  // Due-card count on the Active Rules tab. A read-only local query; never blocks navigation.
  async function refreshDueBadge() {
    const badge = document.getElementById("reviewNavBadge");
    if (!badge) return;
    try {
      const { due } = await app.apiRequest("/api/rules/review?limit=1");
      badge.textContent = due > 99 ? "99+" : String(due);
      badge.hidden = !due;
      badge.closest("button")?.setAttribute("aria-label", due ? `Active Rules, ${due} due` : "Active Rules");
    } catch { badge.hidden = true; }
  }
  async function show(area) {
    await app.flushPendingEntry();
    refreshDueBadge();
    if (area === "logger") {
      // From another area the Logger tab returns to the form that was open; pressed again it lists the forms.
      const alreadyLogging = document.documentElement.dataset.activeView === "logger";
      hide();
      if (alreadyLogging || !(await app.resumeOpenForm())) app.showLibrary();
      return;
    }
    hide();
    state.activeArea = area;
    app.activateAuxiliaryView(area);
    setActiveNav(area);
    try {
      if (area === "library") { await app.refreshForms(); await loadLibrary(); }
      if (area === "analysis") await loadAnalysis();
      if (area === "review") await loadReview();
      if (area === "settings") { selectSettingsCategory(state.settingsCategory); await Promise.all([loadBackups(), loadReviewIntervals(), loadNoteUpgrade(), app.refreshAccess()]); }
    } catch (error) {
      console.error(error);
      app.showToast(error.message || "This area could not be loaded.");
    }
  }

  function ruleCard(rule) {
    const suspended = rule.status === "archived";
    const sourceFormAvailable = rule.sourceFormId && app.getForms().some((form) => form.id === rule.sourceFormId);
    const source = sourceFormAvailable && rule.sourceQuestionNumber
      ? `<button class="button button--subtle" data-rule-action="source" type="button">${escapeHTML(sourceLabel(rule))}</button>`
      : rule.sourceFormId ? `<span class="muted">${escapeHTML(sourceLabel(rule))} · form unavailable</span>` : "";
    const suggestions = (rule.nearDuplicates || []).map((item) => `
      <div class="duplicate-suggestion">
        <span>${Math.round(item.similarity * 100)}% similar: ${escapeHTML(item.ruleText)}</span>
        <button class="button button--subtle" type="button" data-rule-action="merge" data-source-rule-id="${escapeHTML(item.id)}">Review merge</button>
      </div>
    `).join("");
    const history = rule.reviewHistory.length
      ? rule.reviewHistory.slice(0, 5).map((review) => `<li>${escapeHTML(labelResponse(review.response))} · ${escapeHTML((String(review.reviewedAt || "").slice(0, 10) || "Unknown date"))} → ${escapeHTML(review.nextReviewAt)}</li>`).join("")
      : "<li>No reviews yet.</li>";
    return `
      <article class="rule-browser-row${state.selectedRules.has(rule.id) ? " is-selected" : ""}" data-rule-id="${escapeHTML(rule.id)}">
      <label class="rule-row-select"><input type="checkbox" data-saved-rule-select${state.selectedRules.has(rule.id) ? " checked" : ""} aria-label="Select ${escapeHTML(rule.ruleText.slice(0, 120))}"></label>
      <details class="rule-card${suspended ? " rule-card--suspended" : ""}">
        <summary class="rule-card__summary">
          <span class="rule-card__summary-main"><strong title="${escapeHTML(rule.ruleText)}">${escapeHTML(rule.ruleText)}</strong><span class="rule-row-source">${escapeHTML(sourceLabel(rule))}</span></span>
          <span class="rule-row-tags">${tagMarkup(rule)}</span>
          <span class="rule-card__summary-meta">${suspended ? "Suspended" : `Due ${escapeHTML(rule.nextReviewAt || "today")}`}</span>
        </summary>
        <div class="rule-card__details">
          <div class="rule-card__meta">
          ${tagMarkup(rule)}
          <span>${rule.occurrenceCount} exact occurrence${rule.occurrenceCount === 1 ? "" : "s"}</span>
          <span>${escapeHTML(rule.firstSeen)} → ${escapeHTML(rule.lastSeen)}</span>
            <span>${suspended ? "Removed from review" : `Next review: ${escapeHTML(rule.nextReviewAt || "today")}`}</span>
          </div>
          <p class="rule-source" title="${escapeHTML(rule.sourceNoteId || rule.id)}">${escapeHTML(sourceLabel(rule))}<small>ThunderShadowID: ${escapeHTML(rule.ThunderShadowID || `thundershadow:${rule.id}`)}${rule.sourceNoteId ? ` · Note ID: ${escapeHTML(rule.sourceNoteId)}` : ""}</small></p>
          <label class="rule-edit-label"><span>Rule wording</span><textarea class="rule-card__text" maxlength="12000" aria-label="Canonical rule wording">${escapeHTML(rule.ruleText)}</textarea></label>
          <div class="rule-card__controls">
            <label>Note tag<select class="rule-kind" aria-label="Note tag"><option value="clinical"${rule.noteKind === "clinical" ? " selected" : ""}>Clinical Pattern</option><option value="reasoning"${rule.noteKind === "reasoning" ? " selected" : ""}>Broad Pattern</option></select></label>
            <label class="rule-pattern-label">Pattern<select class="rule-pattern" aria-label="Reasoning pattern">${patternOptions(rule.pattern)}</select></label>
            ${suspended ? "" : `<label>Status <select class="rule-status">${["new", "active", "improving", "mastered"].map((status) => `<option value="${status}"${rule.status === status ? " selected" : ""}>${status}</option>`).join("")}</select></label>`}
            <label class="rule-notes-label">Notes <input class="rule-notes" maxlength="12000" value="${escapeHTML(rule.notes)}" placeholder="Optional notes"></label>
            <button class="button button--primary" data-rule-action="save" type="button">Save</button>
            ${source}
            <button class="button ${suspended ? "button--subtle" : "button--danger-ghost"}" data-rule-action="${suspended ? "resume" : "suspend"}" type="button">${suspended ? "Resume reviews" : "Suspend"}</button>
            <button class="button button--danger" data-rule-action="delete" type="button">Delete permanently</button>
          </div>
          ${suggestions ? `<details class="duplicate-details"><summary>Suggested near-duplicate grouping (${rule.nearDuplicates.length})</summary>${suggestions}</details>` : ""}
          <details class="review-history"><summary>Review history (${rule.reviewHistory.length})</summary><ul>${history}</ul></details>
        </div>
      </details>
      </article>
    `;
  }

  function ruleMatchesForm(rule, formId) {
    return formId === "all" || rule.sourceFormId === formId || (rule.occurrences || []).some((item) => item.formId === formId);
  }

  function ruleMatchesSearch(rule, query) {
    return !query || [rule.ruleText, rule.notes, kindLabel(rule.noteKind), rule.patternLabel, rule.ThunderShadowID, rule.id, rule.sourceNoteId, sourceLabel(rule), ...(rule.occurrences || []).map((item) => `${item.formName} ${item.noteId}`)].join(" ").toLowerCase().includes(query);
  }

  function ruleMatchesKind(rule, section) {
    return state.libraryKinds[section] === "all" || state.libraryKinds[section] === rule.noteKind;
  }

  function sortRules(items, getRule = (item) => item) {
    const sort = document.getElementById("ruleSortSelect").value;
    const key = (rule) => sort === "pattern" ? `${rule.pattern ? window.ThunderShadowReasoning.PATTERNS.findIndex((item) => item.value === rule.pattern) : 9}` : sort === "kind" ? kindLabel(rule.noteKind) : sort === "source" ? sourceLabel(rule) : sort === "wording" ? rule.ruleText : rule.nextReviewAt || "";
    return [...items].sort((a, b) => key(getRule(a)).localeCompare(key(getRule(b)), undefined, { numeric: true }) || getRule(a).ruleText.localeCompare(getRule(b).ruleText) || String(getRule(a).id || "").localeCompare(String(getRule(b).id || "")));
  }

  function visibleSavedRules(section = state.librarySection) {
    const query = document.getElementById("ruleSearchInput").value.trim().toLowerCase();
    return sortRules(state.rules.filter((rule) => (rule.status === "archived") === (section === "suspended") && ruleMatchesKind(rule, section) && ruleMatchesForm(rule, state.libraryForms[section]) && ruleMatchesSearch(rule, query)));
  }

  function renderFormTabs() {
    const forms = new Map(app.getForms().map((form) => [form.id, form.name]));
    const items = state.rules.filter((rule) => (rule.status === "archived") === (state.librarySection === "suspended")).filter((rule) => ruleMatchesKind(rule, state.librarySection));
    for (const rule of items) {
      if (rule.sourceFormId && !forms.has(rule.sourceFormId)) forms.set(rule.sourceFormId, rule.sourceFormName || "Unavailable form");
      for (const item of rule.occurrences || []) if (!forms.has(item.formId)) forms.set(item.formId, item.formName || "Unavailable form");
    }
    if (state.libraryForms[state.librarySection] !== "all" && !forms.has(state.libraryForms[state.librarySection])) state.libraryForms[state.librarySection] = "all";
    const options = [["all", "All forms"], ...[...forms].sort((a, b) => a[1].localeCompare(b[1]))];
    document.getElementById("ruleFormTabs").innerHTML = options.map(([id, name]) => {
      const selected = state.libraryForms[state.librarySection] === id;
      const count = items.filter((rule) => ruleMatchesForm(rule, id)).length;
      return `<button type="button" role="tab" aria-controls="${state.librarySection === "saved" ? "savedRulesPanel" : "suspendedRulesPanel"}" data-rule-form="${escapeHTML(id)}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}" title="${escapeHTML(name)}"><span>${escapeHTML(name)}</span><small>${count}</small></button>`;
    }).join("");
    document.querySelectorAll("[data-library-kind]").forEach((tab) => {
      const selected = tab.dataset.libraryKind === state.libraryKinds[state.librarySection];
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("aria-controls", state.librarySection === "saved" ? "savedRulesPanel" : "suspendedRulesPanel");
      tab.tabIndex = selected ? 0 : -1;
    });
    requestAnimationFrame(updateFormScroll);
  }

  function selectLibrarySection(section, focus = false) {
    if (state.bulkBusy) return;
    if (state.librarySection !== section) { state.selectedRules.clear(); state.selectionAnchor = null; document.getElementById("savedRuleBulkStatus").textContent = ""; }
    state.librarySection = section;
    document.querySelectorAll("[data-rule-section]").forEach((tab) => {
      const selected = tab.dataset.ruleSection === section;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
      if (selected && focus) tab.focus({ preventScroll: true });
    });
    renderFormTabs();
    renderSavedRules();
    views.library.querySelector(".rule-library-panels").scrollTop = 0;
  }

  async function loadLibrary() {
    const payload = await app.apiRequest("/api/rules");
    state.rules = payload.rules;
    state.selectedRules = new Set([...state.selectedRules].filter((id) => state.rules.some((rule) => rule.id === id && (rule.status === "archived") === (state.librarySection === "suspended"))));
    if (state.bulkBusy) { renderFormTabs(); renderSavedRules(); }
    else selectLibrarySection(state.librarySection);
  }

  function renderSavedRules() {
    const query = document.getElementById("ruleSearchInput").value.trim().toLowerCase();
    const active = visibleSavedRules("saved");
    const suspended = visibleSavedRules("suspended");
    document.getElementById("ruleCountBadge").textContent = `${active.length} active`;
    document.getElementById("suspendedCountBadge").textContent = `${suspended.length} suspended`;
    document.getElementById("personalRulesList").innerHTML = active.length ? active.map(ruleCard).join("") : '<div class="frequency-empty">No saved rules match this form and search. Study notes become active rules automatically when saved in the logger.</div>';
    document.getElementById("suspendedRulesList").innerHTML = suspended.length ? suspended.map(ruleCard).join("") : '<div class="frequency-empty">No suspended rules match this form and search.</div>';
    const count = state.librarySection === "suspended" ? suspended.length : active.length;
    document.getElementById("ruleSearchStatus").textContent = query ? `${count} rule${count === 1 ? "" : "s"} match your search` : "";
    updateSavedSelection();
  }

  function updateFormScroll() {
    const strip = document.getElementById("ruleFormTabs");
    document.getElementById("ruleFormsLeftBtn").disabled = strip.scrollLeft <= 1;
    document.getElementById("ruleFormsRightBtn").disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
  }

  function updateSavedSelection() {
    const toolbar = document.getElementById("savedRuleBulkActions");
    toolbar.hidden = false;
    const visible = visibleSavedRules();
    const shown = visible.filter((rule) => state.selectedRules.has(rule.id)).length;
    const total = state.selectedRules.size;
    const hidden = total - shown;
    document.getElementById("savedRuleSelectionCount").textContent = `${total} selected${hidden ? ` · ${hidden} hidden by filters` : ""}`;
    const all = document.getElementById("selectAllSavedRules");
    all.checked = Boolean(visible.length && shown === visible.length);
    all.indeterminate = Boolean(shown && shown < visible.length);
    all.disabled = state.bulkBusy || !visible.length;
    document.getElementById("savedRuleActionControls").hidden = !total;
    document.getElementById("clearSavedRuleSelectionBtn").disabled = state.bulkBusy || !total;
    document.getElementById("reviewSelectedRulesBtn").disabled = state.bulkBusy || !total || state.librarySection === "suspended";
    document.getElementById("applySavedRuleBulkBtn").disabled = state.bulkBusy || !total;
    const action = document.getElementById("savedRuleBulkAction").value;
    document.getElementById("bulkRulePatternLabel").hidden = action !== "pattern";
    document.getElementById("bulkRuleKindLabel").hidden = action !== "kind";
    document.querySelectorAll("[data-saved-rule-select]").forEach((checkbox) => {
      const row = checkbox.closest("[data-rule-id]");
      checkbox.checked = state.selectedRules.has(row.dataset.ruleId);
      checkbox.disabled = state.bulkBusy;
      row.classList.toggle("is-selected", checkbox.checked);
    });
  }

  async function applyBulkRuleAction() {
    if (state.bulkBusy || !state.selectedRules.size) return;
    const action = document.getElementById("savedRuleBulkAction").value;
    // Use the API's date convention so Due today always joins its daily queue.
    const today = new Date().toISOString().slice(0, 10);
    const payload = action === "suspend" ? { status: "archived" } : action === "resume" ? { status: "active" } : action === "due" ? { nextReviewAt: today } : action === "pattern" ? { pattern: document.getElementById("bulkRulePattern").value } : { noteKind: document.getElementById("bulkRuleKind").value };
    const ids = [...state.selectedRules];
    const status = document.getElementById("savedRuleBulkStatus");
    state.bulkBusy = true;
    views.library.setAttribute("aria-busy", "true");
    const locked = [...views.library.querySelectorAll("button, input, select, textarea")].filter((control) => !control.disabled);
    locked.forEach((control) => { control.disabled = true; });
    let changed = 0;
    const failures = [];
    try {
      for (const id of ids) {
        status.textContent = `Saving ${changed + failures.length + 1} of ${ids.length}…`;
        try {
          await app.apiRequest(`/api/rules/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) });
          state.selectedRules.delete(id);
          changed += 1;
        } catch (error) { failures.push(error.message || "Could not save this card."); }
      }
      const outcome = { due: "made due today", suspend: "suspended", resume: "resumed", pattern: "updated with the selected reasoning pattern", kind: "updated with the selected kind" }[action];
      status.textContent = `${changed} card${changed === 1 ? "" : "s"} ${outcome}.${failures.length ? ` ${failures.length} unchanged and still selected. ${failures[0]}` : action === "due" && state.librarySection === "suspended" ? " Suspended cards remain suspended; resume them to review." : ""}`;
      app.showToast(`${changed} card${changed === 1 ? "" : "s"} ${outcome}${failures.length ? `; ${failures.length} unchanged` : ""}.`);
    } finally {
      try { await loadLibrary(); }
      finally {
        state.bulkBusy = false;
        views.library.removeAttribute("aria-busy");
        locked.forEach((control) => { control.disabled = false; });
        updateSavedSelection();
      }
    }
  }

  function persistSelectedReview() {
    try {
      if (state.selectedReview) sessionStorage.setItem("thundershadow:selected-review", JSON.stringify(state.selectedReview));
      else sessionStorage.removeItem("thundershadow:selected-review");
    } catch (_) {}
  }

  async function reviewSelectedRules() {
    if (state.bulkBusy) return;
    const ids = sortRules(state.rules.filter((rule) => state.selectedRules.has(rule.id) && rule.status !== "archived")).map((rule) => rule.id);
    if (!ids.length) return;
    state.selectedReview = { ids, reviewed: 0 };
    state.reviewKind = "all";
    persistSelectedReview();
    await show("review");
  }

  async function deleteRule(card) {
    const id = card.dataset.ruleId;
    const rule = state.rules.find((item) => item.id === id);
    if (!rule) return;
    const confirmed = window.confirm(`Permanently delete this saved rule?\n\n${rule.ruleText}\n\nThis removes the rule from this device and Google Drive after sync. The original Reasoning Note inside an existing form is not changed.`);
    if (!confirmed) return;
    await app.apiRequest(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
    app.showToast("Saved rule permanently deleted.");
    await loadLibrary();
  }

  async function updateRule(card, forceStatus = null) {
    const id = card.dataset.ruleId;
    const existing = state.rules.find((rule) => rule.id === id);
    const ruleText = card.querySelector(".rule-card__text").value.trim();
    if (!ruleText) throw new Error("Rule wording cannot be blank.");
    const payload = {
      noteKind: card.querySelector(".rule-kind").value,
      pattern: card.querySelector(".rule-pattern").value,
      ruleText,
      status: forceStatus || card.querySelector(".rule-status")?.value || existing.status,
      notes: card.querySelector(".rule-notes").value
    };
    if (forceStatus === "active") payload.nextReviewAt = new Date().toISOString().slice(0, 10);
    await app.apiRequest(`/api/rules/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    app.showToast(forceStatus === "archived" ? "Rule suspended and removed from daily review." : forceStatus === "active" ? "Rule returned to daily review." : "Rule updated.");
    await loadLibrary();
  }

  async function mergeRule(card, sourceRuleId) {
    const target = state.rules.find((rule) => rule.id === card.dataset.ruleId);
    const source = state.rules.find((rule) => rule.id === sourceRuleId);
    if (!target || !source) return;
    const confirmed = window.confirm(`Merge this suggested rule into the current rule?\n\nCURRENT: ${target.ruleText}\n\nMERGE: ${source.ruleText}\n\nBoth exact wordings will remain occurrence aliases. This cannot be undone.`);
    if (!confirmed) return;
    const wording = window.prompt("Confirm the canonical wording for the merged rule:", card.querySelector(".rule-card__text").value);
    if (wording === null || !wording.trim()) return;
    await app.apiRequest(`/api/rules/${encodeURIComponent(target.id)}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourceRuleId, ruleText: wording.trim(), pattern: target.pattern })
    });
    app.showToast("Rules merged with both original wordings retained as occurrence matches.");
    await loadLibrary();
  }

  function table(headers, rows) {
    return `<table class="v3-table"><thead><tr>${headers.map((header) => `<th>${escapeHTML(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeHTML(headers[index] || "")}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  // ---------- Analysis ----------
  const analysisEl = (id) => document.getElementById(id);
  const analysisFormsNewestFirst = () => app.getForms().sort((a, b) => b.date.localeCompare(a.date));
  const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const share = (count, total) => total ? `${Math.round(count * 100 / total)}%` : "0%";
  const patternTone = (item) => Number(String(item.code || "").slice(1)) || 1;
  const codeBadge = (id) => `<span class="an-code" data-code="${escapeHTML(id)}">${escapeHTML(id)}</span>`;
  const patternBadge = (item) => `<span class="an-pcode" data-pattern-tone="${patternTone(item)}">${escapeHTML(item.code)}</span>`;
  const TREND_COPY = { rising: ["↑", "Rising", "is-worse"], improving: ["↓", "Improving", "is-better"], stable: ["→", "Stable", "is-flat"] };
  function trendChip(item) {
    const copy = TREND_COPY[item.trend?.direction];
    if (!copy) return "";
    const detail = `${item.trend.earlierPerForm} per form in the earlier ${plural(item.trend.earlierForms, "form")}, ${item.trend.recentPerForm} in the latest ${item.trend.recentForms}`;
    return `<span class="an-trend ${copy[2]}" title="${escapeHTML(detail)}"><i aria-hidden="true">${copy[0]}</i>${copy[1]}</span>`;
  }

  function populateFormFilter() {
    const box = analysisEl("analysisForms");
    if (!box) return;
    const ticked = new Set([...box.querySelectorAll("input:checked")].map((input) => input.value));
    box.innerHTML = analysisFormsNewestFirst().map((form) => `<label class="an-check"><input type="checkbox" value="${escapeHTML(form.id)}"${ticked.has(form.id) ? " checked" : ""}><span>${escapeHTML(form.name)}</span><small>${escapeHTML(form.date)}</small></label>`).join("") || '<p class="muted">No forms yet.</p>';
  }

  // One selection scopes every figure on the page and both exports.
  function analysisFilters() {
    const forms = analysisFormsNewestFirst(), scope = state.analysisScope;
    if (scope === "nbme" || scope === "cms") { const ids = forms.filter((form) => form.examGroup === scope).map((form) => form.id); return { formIds: ids, empty: !ids.length, emptyMessage: `No ${scope.toUpperCase()} forms yet.` }; }
    if (scope === "recent") { const ids = forms.slice(0, 3).map((form) => form.id); return { formIds: ids, empty: !ids.length, emptyMessage: "No forms yet." }; }
    if (scope === "custom") return { startDate: analysisEl("analysisStartDate").value, endDate: analysisEl("analysisEndDate").value, formIds: [...analysisEl("analysisForms").querySelectorAll("input:checked")].map((input) => input.value) };
    return { formIds: [] };
  }

  function analysisQuery() {
    const filters = analysisFilters(), params = new URLSearchParams();
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    if (filters.formIds?.length) params.set("formIds", filters.formIds.join(","));
    return params.toString();
  }

  function renderAnalysisFocus(data) {
    const seen = data.patterns.filter((item) => item.count > 0);
    const urgency = (item) => item.level.level * 10 + (item.trend.direction === "rising" ? 2 : item.trend.direction === "improving" ? 0 : 1);
    const focus = [...seen].sort((a, b) => urgency(b) - urgency(a) || b.count - a.count)[0];
    const topError = [...data.errors].sort((a, b) => b.count - a.count)[0];
    const topSpeed = data.speed.find((item) => item.count > 0);
    const latest = data.recentTrend.at(-1), earlier = data.recentTrend.slice(0, -1);
    const signals = [];
    if (topError?.count) signals.push(`<div class="an-signal"><span class="an-signal__label">Most frequent error code</span><strong>${codeBadge(topError.id)}${escapeHTML(topError.label)}</strong><span class="an-signal__meta">${plural(topError.count, "entry", "entries")} · ${topError.percentage}% of coded</span></div>`);
    const scoredEarlier = earlier.filter((item) => item.score !== null);
    const latestMeta = latest ? `${latest.score !== null ? `${latest.score}% score · ` : ""}${latest.wrong} wrong · ${latest.unstable} unstable` : "";
    const trendNote = (delta, unit, better, worse) => Math.abs(delta) < 0.5 ? `<span class="an-trend is-flat"><i aria-hidden="true">→</i>In line with earlier forms</span>` : `<span class="an-trend ${delta > 0 === (unit === "points") ? "is-better" : "is-worse"}"><i aria-hidden="true">${delta > 0 ? "↑" : "↓"}</i>${Math.abs(delta).toFixed(1)} ${delta > 0 ? better : worse}</span>`;
    if (latest && latest.score !== null && scoredEarlier.length) {
      const average = scoredEarlier.reduce((sum, item) => sum + item.score, 0) / scoredEarlier.length;
      signals.push(`<div class="an-signal"><span class="an-signal__label">Latest form</span><strong>${escapeHTML(latest.formName)}</strong><span class="an-signal__meta">${latestMeta}</span>${trendNote(latest.score - average, "points", "points above the earlier average", "points below the earlier average")}</div>`);
    } else if (latest && earlier.length) {
      const average = earlier.reduce((sum, item) => sum + item.wrong, 0) / earlier.length;
      signals.push(`<div class="an-signal"><span class="an-signal__label">Latest form</span><strong>${escapeHTML(latest.formName)}</strong><span class="an-signal__meta">${latestMeta}</span>${trendNote(latest.wrong - average, "wrong", "more wrong than the earlier average", "fewer wrong than the earlier average")}</div>`);
    } else if (latest) signals.push(`<div class="an-signal"><span class="an-signal__label">Latest form</span><strong>${escapeHTML(latest.formName)}</strong><span class="an-signal__meta">${latestMeta} · add another form to see a trend</span></div>`);
    signals.push(topSpeed
      ? `<div class="an-signal"><span class="an-signal__label">Most frequent speed flag</span><strong>${escapeHTML(topSpeed.label)}</strong><span class="an-signal__meta">${plural(topSpeed.count, "entry", "entries")}</span></div>`
      : `<div class="an-signal"><span class="an-signal__label">Speed flags</span><strong>None logged</strong><span class="an-signal__meta">Mark rushed or overthought entries to see them here.</span></div>`);
    const main = focus
      ? `<div class="an-focus__main" data-pattern-tone="${patternTone(focus)}">
          <p class="an-kicker">Focus next</p>
          <h2>${patternBadge(focus)}<span>${escapeHTML(focus.label)}</span></h2>
          <p class="an-focus__meta"><span class="an-level">${escapeHTML(focus.level.label)}</span>${trendChip(focus)}<span>${plural(focus.count, "entry", "entries")} across ${plural(focus.formCount, "form")}</span></p>
          <p class="an-focus__def">${escapeHTML(focus.definition)}</p>
          <p class="an-focus__fix"><b>Fix</b>${escapeHTML(focus.correctiveAction)}</p>
          <button class="button button--primary" type="button" data-analysis-review="${escapeHTML(focus.id)}">Review these cards</button>
        </div>`
      : `<div class="an-focus__main">
          <p class="an-kicker">Focus next</p>
          <h2><span>No reasoning patterns coded yet</span></h2>
          <p class="an-focus__def">Pick a reasoning pattern while logging and this panel will name the thinking step that fails most, with its fix.</p>
        </div>`;
    analysisEl("analysisFocus").innerHTML = `${main}<div class="an-signals">${signals.join("")}</div>`;
  }

  function renderAnalysisStats(data) {
    const s = data.summary, scored = s.formsWithLength > 0;
    const basis = scored ? (s.formsWithLength === s.forms ? `${s.totalQuestions} questions` : `${plural(s.formsWithLength, "form")} with a question total`) : "";
    const missing = "Add each form's total questions";
    const tiles = [
      ["Score", scored ? `${s.score}%` : "—", scored ? `not wrong · ${basis}` : missing],
      ["Confident correct", s.confidentRate !== null ? `${s.confidentRate}%` : "—", scored ? "neither wrong nor unstable" : missing],
      ["Wrong (codes 1–4)", s.wrongAnswers, scored ? `${s.wrongPer100} per 100 questions` : `${share(s.wrongAnswers, s.errorCodedQuestions)} of coded`],
      ["Unstable correct (5–7)", s.unstableCorrect, scored ? `${s.unstablePer100} per 100 questions` : `${share(s.unstableCorrect, s.errorCodedQuestions)} of coded`],
      ["Logged entries", s.loggedQuestions, `${plural(s.forms, "form")} · ${s.forms ? (s.loggedQuestions / s.forms).toFixed(1) : 0} per form`],
      ["With a reasoning pattern", `${share(s.patternCodedEntries, s.loggedQuestions)}`, `study note on ${share(s.reasoningNotePresence, s.loggedQuestions)}`]
    ];
    analysisEl("analysisCards").innerHTML = tiles.map(([label, value, meta]) => `<div class="an-stat"><span class="an-stat__label">${label}</span><strong>${value}</strong><span class="an-stat__meta">${meta}</span></div>`).join("");
  }

  function timelineSeries(data, mode) {
    if (mode === "score") return [
      { key: "score", label: "Score", values: data.recentTrend.map((item) => item.score), unit: "%" },
      { key: "confident", label: "Confident correct", values: data.recentTrend.map((item) => item.confidentRate), unit: "%" }
    ];
    const series = mode === "codes"
      ? data.errors.map((error) => ({ key: `code-${error.id}`, code: error.id, label: `${error.id} · ${error.label}`, values: error.byForm.map((item) => item.count) }))
      : [
        { key: "wrong", label: "Wrong (codes 1–4)", values: data.recentTrend.map((item) => item.wrong) },
        { key: "unstable", label: "Unstable correct (5–7)", values: data.recentTrend.map((item) => item.unstable) }
      ];
    const uncoded = data.recentTrend.map((item) => Math.max(0, item.logged - item.wrong - item.unstable));
    if (uncoded.some(Boolean)) series.push({ key: "none", label: "No error code", values: uncoded });
    return series;
  }

  function renderAnalysisTimeline(data) {
    const host = analysisEl("analysisTimeline"), forms = data.recentTrend, plotHeight = 168, cap = 20;
    const hasScore = forms.some((item) => item.score !== null);
    const mode = state.timelineMode === "score" && !hasScore ? "split" : state.timelineMode;
    document.querySelectorAll("[data-timeline-mode]").forEach((button) => { button.hidden = button.dataset.timelineMode === "score" && !hasScore; button.setAttribute("aria-pressed", String(button.dataset.timelineMode === mode)); });
    analysisEl("analysisTimelineNote").textContent = mode === "score" ? "Share of each form's questions, oldest to newest." : "Logged entries per form, oldest to newest.";
    const series = timelineSeries(data, mode);
    state.timeline = { forms, series, mode };
    const mark = (item) => item.code ? `data-code="${item.code}"` : `data-series="${item.key}"`;
    const label = (form) => `<span class="an-col__label">${escapeHTML(form.formName)}</span><span class="an-col__date">${escapeHTML(form.date.slice(5))}</span>`;
    let ticks, place, columns, overlay = "";
    if (mode === "score") {
      const values = series.flatMap((item) => item.values).filter((value) => value !== null);
      const low = Math.max(0, Math.floor((Math.min(...values) - 3) / 5) * 5), span = 100 - low, step = span <= 20 ? 5 : span <= 50 ? 10 : 20;
      ticks = []; for (let tick = 100; tick >= low; tick -= step) ticks.unshift(tick);
      const floor = ticks[0];
      place = (value) => (value - floor) * plotHeight / (100 - floor);
      const lastScored = forms.map((form) => form.score !== null).lastIndexOf(true);
      columns = forms.map((form, index) => {
        const points = series.map((item) => ({ item, value: item.values[index] })).filter((point) => point.value !== null);
        const clash = points.length === 2 && Math.abs(place(points[0].value) - place(points[1].value)) < 15;
        const dots = points.map((point, order) => `<i class="an-dot" ${mark(point.item)} style="bottom:${place(point.value).toFixed(1)}px">${index === lastScored && !(clash && order === 1) ? `<b class="${order ? "is-below" : ""}">${point.value}%</b>` : ""}</i>`).join("");
        const spoken = form.score === null ? "total questions not set" : `score ${form.score}%${form.confidentRate !== null ? `, confident correct ${form.confidentRate}%` : ""}`;
        return `<button type="button" class="an-col an-col--score" data-index="${index}" aria-label="${escapeHTML(`${form.formName}, ${form.date}: ${spoken}`)}"><span class="an-col__bar">${dots || '<span class="an-col__missing">no total</span>'}</span>${label(form)}</button>`;
      }).join("");
      // Lines run between column centres; the overlay stretches horizontally only, so strokes stay 2px.
      const segments = (item) => { const runs = []; let run = []; item.values.forEach((value, index) => { if (value === null) { if (run.length > 1) runs.push(run); run = []; } else run.push(`${index + 0.5},${(cap + plotHeight - place(value)).toFixed(1)}`); }); if (run.length > 1) runs.push(run); return runs.map((points) => `<polyline ${mark(item)} points="${points.join(" ")}"/>`).join(""); };
      overlay = `<svg class="an-lines" viewBox="0 0 ${forms.length} ${cap + plotHeight}" preserveAspectRatio="none" aria-hidden="true">${series.map(segments).join("")}</svg>`;
    } else {
      const peak = Math.max(1, ...forms.map((item) => item.logged));
      const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((size) => peak / size <= 4) || 1000, top = Math.ceil(peak / step) * step;
      ticks = []; for (let tick = 0; tick <= top; tick += step) ticks.push(tick);
      place = (value) => value * plotHeight / top;
      columns = forms.map((form, index) => {
        const stackHeight = place(form.logged);
        const segments = series.map((item) => { const value = item.values[index]; if (!value) return ""; return `<i ${mark(item)} style="flex-grow:${value}">${item.code && value * stackHeight / form.logged >= 16 ? item.code : ""}</i>`; }).join("");
        return `<button type="button" class="an-col" data-index="${index}" aria-label="${escapeHTML(`${form.formName}, ${form.date}: ${series.map((item) => `${item.label} ${item.values[index]}`).join(", ")}`)}"><span class="an-col__bar"><span class="an-col__total">${form.logged}</span><span class="an-col__stack" style="height:${stackHeight.toFixed(1)}px">${segments}</span></span>${label(form)}</button>`;
      }).join("");
    }
    host.innerHTML = `<div class="an-legend">${series.map((item) => `<span><i class="an-swatch${mode === "score" ? " an-swatch--line" : ""}" ${mark(item)}></i>${escapeHTML(item.label)}</span>`).join("")}</div>
      <div class="an-chart an-chart--${mode}">
        <div class="an-yaxis" aria-hidden="true">${ticks.map((tick) => `<span style="bottom:${place(tick)}px">${tick}${mode === "score" ? "%" : ""}</span>`).join("")}</div>
        <div class="an-plot-scroll" tabindex="-1"><div class="an-plot"><div class="an-gridlines" aria-hidden="true">${ticks.map((tick) => `<i style="bottom:${place(tick)}px"></i>`).join("")}</div><div class="an-cols" style="max-width:${forms.length * 110}px">${overlay}${columns}</div></div></div>
        <div class="an-tip" role="status" hidden></div>
      </div>${mode === "score" && forms.some((item) => item.score === null) ? '<p class="an-hint">Forms without a question total are skipped. Add it with Edit on the form card.</p>' : ""}`;
    const scroller = host.querySelector(".an-plot-scroll"); scroller.scrollLeft = scroller.scrollWidth;
    const figure = (value) => value === null ? "—" : `${value}%`;
    analysisEl("analysisTrends").innerHTML = table(["Date", "Form", "Questions", "Wrong", "Unstable correct", "Score", "Confident correct", "Logged entries"], forms.map((item) => [escapeHTML(item.date), escapeHTML(item.formName), item.totalQuestions ?? "—", item.wrong, item.unstable, figure(item.score), figure(item.confidentRate), item.logged]));
  }

  // One readout per form listing every series; built with textContent because names are user data.
  function showTimelineTip(column) {
    const chart = column.closest(".an-chart"), tip = chart?.querySelector(".an-tip"), index = Number(column.dataset.index), form = state.timeline?.forms[index];
    if (!tip || !form) return;
    tip.textContent = "";
    const row = (labelText, value, item) => {
      const line = document.createElement("span"); line.className = "an-tip__row";
      const key = document.createElement("i"); if (item?.code) key.dataset.code = item.code; else if (item) key.dataset.series = item.key; else key.className = "is-blank";
      const label = document.createElement("span"); label.textContent = labelText;
      const figure = document.createElement("b"); figure.textContent = value;
      line.append(key, label, figure); tip.append(line);
    };
    const head = document.createElement("strong"); head.textContent = form.formName;
    const date = document.createElement("small");
    date.textContent = state.timeline.mode === "score" ? `${form.date} · ${form.totalQuestions === null ? "total questions not set" : `${form.totalQuestions} questions`}` : `${form.date} · ${plural(form.logged, "logged entry", "logged entries")}`;
    tip.append(head, date);
    if (state.timeline.mode === "score") {
      state.timeline.series.forEach((item) => { if (item.values[index] !== null) row(item.label, `${item.values[index]}%`, item); });
      row("Wrong", String(form.wrong)); row("Unstable correct", String(form.unstable));
    } else state.timeline.series.forEach((item) => { if (item.values[index] || item.key !== "none") row(item.label, String(item.values[index]), item); });
    tip.hidden = false;
    const scroller = chart.querySelector(".an-plot-scroll");
    // Sit beside the column, never on top of it: right when there is room, otherwise left.
    const start = scroller.offsetLeft + column.offsetLeft - scroller.scrollLeft, end = start + column.offsetWidth;
    const left = end + 8 + tip.offsetWidth <= chart.clientWidth ? end + 8 : start - 8 - tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(chart.clientWidth - tip.offsetWidth, left))}px`;
    chart.querySelectorAll(".an-col.is-active").forEach((item) => item.classList.remove("is-active"));
    column.classList.add("is-active");
  }
  function hideTimelineTip() {
    const host = analysisEl("analysisTimeline"), tip = host.querySelector(".an-tip");
    if (tip) tip.hidden = true;
    host.querySelectorAll(".an-col.is-active").forEach((item) => item.classList.remove("is-active"));
  }

  function sparkline(counts, code) {
    if (counts.length < 2) return "";
    const peak = Math.max(1, ...counts), width = 64, height = 20;
    const points = counts.map((count, index) => [2 + index * (width - 4) / (counts.length - 1), height - 3 - count * (height - 6) / peak]);
    const last = points.at(-1);
    return `<svg class="an-spark" data-code="${code}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(`Per form, oldest to newest: ${counts.join(", ")}`)}"><title>${escapeHTML(`Per form, oldest to newest: ${counts.join(", ")}`)}</title><polyline points="${points.map((point) => point.map((value) => value.toFixed(1)).join(",")).join(" ")}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3"/></svg>`;
  }

  function renderAnalysisErrors(data) {
    const total = data.summary.errorCodedQuestions, peak = Math.max(1, ...data.errors.map((item) => item.count));
    const group = (title, ids, count) => `<div class="an-group"><div class="an-group__head"><h3>${title}</h3><span>${count} · ${share(count, total)}</span></div>${data.errors.filter((item) => ids.includes(item.id)).map((item) => `<div class="an-row an-row--code" data-code="${item.id}">${codeBadge(item.id)}<span class="an-row__label">${escapeHTML(item.label)}</span><span class="an-bar"><i style="width:${item.count * 100 / peak}%"></i></span><b>${item.count}</b><span class="an-row__pct">${item.percentage}%</span>${sparkline(item.byForm.map((entry) => entry.count), item.id)}</div>`).join("")}</div>`;
    analysisEl("analysisErrors").innerHTML = group("Wrong answers", ["1", "2", "3", "4"], data.summary.wrongAnswers) + group("Unstable correct", ["5", "6", "7"], data.summary.unstableCorrect);
  }

  function renderAnalysisPatterns(data) {
    const seen = data.patterns.filter((item) => item.count > 0), unseen = data.patterns.filter((item) => !item.count), peak = Math.max(1, ...seen.map((item) => item.count));
    const chips = (items, render) => items.length ? items.slice(0, 3).map(render).join("") : '<span class="muted">—</span>';
    analysisEl("analysisPatterns").innerHTML = (seen.map((item) => `<details class="an-pattern" data-pattern-tone="${patternTone(item)}">
        <summary>${patternBadge(item)}<span class="an-row__label">${escapeHTML(item.label)}</span><span class="an-bar"><i style="width:${item.count * 100 / peak}%"></i></span><b>${item.count}</b><span class="an-row__pct">${item.percentage}%</span>${trendChip(item) || '<span class="an-trend is-none"></span>'}<span class="an-level">${escapeHTML(item.level.label)}</span></summary>
        <div class="an-pattern__body">
          <p>${escapeHTML(item.definition)}</p>
          <p class="an-focus__fix"><b>Fix</b>${escapeHTML(item.correctiveAction)}</p>
          <dl>
            <div><dt>Seen with error codes</dt><dd>${chips(item.associatedErrorCodes, (code) => `<span class="an-chip">${codeBadge(code.id)}${escapeHTML(code.label)} <b>${code.count}</b></span>`)}</dd></div>
            <div><dt>Seen with speed flags</dt><dd>${chips(item.associatedSpeedFlags, (flag) => `<span class="an-chip">${escapeHTML(flag.label)} <b>${flag.count}</b></span>`)}</dd></div>
            <div><dt>Forms</dt><dd>${item.trendOverTime.map((point) => `<span class="an-chip">${escapeHTML(point.formName)} <b>${point.count}</b></span>`).join("")}</dd></div>
          </dl>
          <button class="button button--ghost" type="button" data-analysis-review="${escapeHTML(item.id)}">Review these cards</button>
        </div>
      </details>`).join("") || '<p class="an-none">No reasoning patterns coded in this selection.</p>')
      + (seen.length && unseen.length ? `<p class="an-none">Not observed: ${unseen.map((item) => `${escapeHTML(item.code)} ${escapeHTML(item.label)}`).join(" · ")}</p>` : "");
  }

  function renderAnalysisMatrix(data) {
    const patterns = [...data.patterns].sort((a, b) => patternTone(a) - patternTone(b)), codes = data.errors;
    const peak = Math.max(1, ...patterns.flatMap((item) => Object.values(item.byErrorCode)));
    if (!data.summary.patternCodedEntries) { analysisEl("analysisMatrix").innerHTML = '<p class="an-none">Appears once entries carry both an error code and a reasoning pattern.</p>'; return; }
    // Sequential single hue: five steps of the accent, the count printed in every cell.
    const step = (count) => count ? Math.max(1, Math.ceil(count * 5 / peak)) : 0;
    analysisEl("analysisMatrix").innerHTML = `<table class="an-matrix"><thead><tr><th scope="col"><span class="visually-hidden">Reasoning pattern</span></th>${codes.map((code) => `<th scope="col" title="${escapeHTML(code.label)}">${codeBadge(code.id)}</th>`).join("")}<th scope="col">All</th></tr></thead><tbody>${patterns.map((item) => `<tr><th scope="row" data-pattern-tone="${patternTone(item)}">${patternBadge(item)}<span>${escapeHTML(item.label)}</span></th>${codes.map((code) => { const count = item.byErrorCode[code.id] || 0; return `<td data-step="${step(count)}" title="${escapeHTML(`${item.label} × ${code.id} ${code.label}: ${plural(count, "entry", "entries")}`)}">${count || '<span aria-hidden="true">·</span><span class="visually-hidden">0</span>'}</td>`; }).join("")}<td class="an-matrix__total">${item.count}</td></tr>`).join("")}</tbody></table>
      <p class="an-scale" aria-hidden="true"><span>Fewer</span>${[1, 2, 3, 4, 5].map((level) => `<i data-step="${level}"></i>`).join("")}<span>More</span></p>`;
  }

  function renderAnalysisSpeed(data) {
    const seen = data.speed.filter((item) => item.count > 0), unseen = data.speed.filter((item) => !item.count), peak = Math.max(1, ...seen.map((item) => item.count));
    const top = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    analysisEl("analysisSpeed").innerHTML = (seen.map((item) => {
      const error = top(item.byErrorCode), pattern = top(item.byRulePattern), patternItem = pattern ? data.patterns.find((entry) => entry.id === pattern[0]) : null;
      return `<div class="an-row an-row--speed"><span class="an-row__label">${escapeHTML(item.label)}</span><span class="an-bar an-bar--neutral"><i style="width:${item.count * 100 / peak}%"></i></span><b>${item.count}</b><span class="an-row__with">${error ? `<span class="an-chip">${codeBadge(error[0])}<b>${error[1]}</b></span>` : ""}${patternItem ? `<span class="an-chip">${patternBadge(patternItem)}${escapeHTML(patternItem.label)} <b>${pattern[1]}</b></span>` : ""}</span></div>`;
    }).join("") || '<p class="an-none">No speed flags marked in this selection.</p>')
      + (seen.length ? '<p class="an-hint">Chips show the error code and pattern each flag appears with most.</p>' : "")
      + (seen.length && unseen.length ? `<p class="an-none">Not marked: ${unseen.map((item) => escapeHTML(item.label)).join(" · ")}</p>` : "");
  }

  function renderAnalysisCombinations(data) {
    analysisEl("analysisCombinations").innerHTML = data.combinations.length
      ? data.combinations.map((item) => `<details class="an-combo"><summary>${codeBadge(item.code)}<span class="an-row__label">${escapeHTML(item.label)}</span><b>${item.count}</b></summary><div class="an-combo__list">${item.occurrences.map((entry) => `<button class="an-jump" type="button" data-analysis-jump="${escapeHTML(entry.formId)}" data-entry="${Number(entry.entryNumber)}">${escapeHTML(entry.formName)} · Entry ${Number(entry.entryNumber)}</button>`).join("")}</div></details>`).join("")
      : '<p class="an-none">None of the tracked pairings occurred in this selection.</p>';
  }

  function renderAnalysis(data, filters = {}) {
    const empty = Boolean(filters.empty) || !data || !data.summary.loggedQuestions;
    analysisEl("analysisEmpty").hidden = !empty;
    analysisEl("analysisBody").hidden = empty;
    analysisEl("exportAnalyticsBtn").disabled = Boolean(filters.empty);
    if (empty) {
      analysisEl("analysisEmptyMessage").textContent = filters.emptyMessage || (app.getForms().length ? "No logged entries in this selection. Widen the selection or log entries in these forms." : "Log entries in a form and they will be summarised here.");
      analysisEl("analysisScopeNote").textContent = "";
      return;
    }
    const dates = data.recentTrend.map((item) => item.date);
    analysisEl("analysisScopeNote").textContent = `${plural(data.summary.forms, "form")} · ${dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} to ${dates.at(-1)}`} · ${plural(data.summary.loggedQuestions, "logged entry", "logged entries")}`;
    renderAnalysisFocus(data); renderAnalysisStats(data); renderAnalysisTimeline(data); renderAnalysisErrors(data);
    renderAnalysisPatterns(data); renderAnalysisMatrix(data); renderAnalysisSpeed(data); renderAnalysisCombinations(data);
  }

  async function loadAnalysis() {
    populateFormFilter();
    document.querySelectorAll("[data-analysis-scope]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.analysisScope === state.analysisScope)));
    const custom = state.analysisScope === "custom";
    analysisEl("analysisCustom").hidden = !custom;
    document.querySelector('[data-analysis-scope="custom"]').setAttribute("aria-expanded", String(custom));
    const filters = analysisFilters(), body = analysisEl("analysisBody");
    if (filters.empty) { state.analytics = null; renderAnalysis(null, filters); return; }
    // Hold the previous render while the new slice loads: no skeleton, no layout jump.
    body.classList.add("is-loading");
    try {
      const query = analysisQuery();
      state.analytics = await app.apiRequest(`/api/analytics${query ? `?${query}` : ""}`);
      renderAnalysis(state.analytics, filters);
    } finally { body.classList.remove("is-loading"); }
  }

  // Analysis to targeted practice: review every active card that carries one reasoning pattern.
  async function reviewPattern(patternId) {
    const { rules } = await app.apiRequest("/api/rules");
    const ids = rules.filter((rule) => rule.pattern === patternId && rule.status !== "archived").map((rule) => rule.id);
    if (!ids.length) { app.showToast("No active cards carry this pattern yet. Add a study note to those entries."); return; }
    state.selectedReview = { ids, reviewed: 0 };
    state.reviewKind = "all";
    persistSelectedReview();
    await show("review");
  }

  function reviewCard(rule) {
    const intervals = state.reviewIntervals;
    return `
      <article class="panel review-card" data-rule-id="${escapeHTML(rule.id)}">
        <div class="review-card__content" tabindex="0" role="region" aria-label="Card text and details">
          <div class="review-card__topline"><div class="rule-card__meta">${tagMarkup(rule)}<span class="review-card__desktop-meta"><span>${rule.occurrenceCount} occurrence${rule.occurrenceCount === 1 ? "" : "s"}</span><span>Last seen ${escapeHTML(rule.lastSeen)}</span></span></div><span class="review-card__inline-source" title="${escapeHTML(sourceLabel(rule))}">From ${escapeHTML(sourceLabel(rule))}</span><button class="button button--danger-ghost review-card__desktop-suspend" type="button" data-review-action="suspend">Suspend</button></div>
          <p class="review-source review-card__desktop-source" title="${escapeHTML(rule.sourceNoteId || rule.id)}">From ${escapeHTML(sourceLabel(rule))}</p>
          <div class="review-card__rule"><h2>${escapeHTML(rule.ruleText)}</h2></div>
          ${rule.notes ? `<div class="review-card__notes"><span>Note</span><p>${escapeHTML(rule.notes)}</p></div>` : ""}
          <details class="review-card__details">
            <summary>Source &amp; details</summary>
            <p class="review-source" title="${escapeHTML(rule.sourceNoteId || rule.id)}">${escapeHTML(sourceLabel(rule))}</p>
            <p class="review-card__history">${rule.occurrenceCount} occurrence${rule.occurrenceCount === 1 ? "" : "s"} · Last seen ${escapeHTML(rule.lastSeen)}</p>
          </details>
        </div>
        <div class="review-card__footer">
          <p class="review-card__prompt">How well did you recall and apply this?</p>
          <div class="review-responses">
            ${["again", "hard", "good", "easy"].map((response) => `<button class="review-response review-response--${response}" type="button" data-review-response="${response}" aria-label="${labelResponse(response)}, review in ${intervals[response]} day${intervals[response] === 1 ? "" : "s"}"><strong>${labelResponse(response)}</strong><span>${intervals[response]} day${intervals[response] === 1 ? "" : "s"}</span><kbd>${escapeHTML(state.reviewShortcuts[response])}${response === "good" && state.reviewShortcuts.quickGood !== "none" ? ` / ${escapeHTML(state.reviewShortcuts.quickGood)}` : ""}</kbd></button>`).join("")}
          </div>
        </div>
      </article>
    `;
  }

  function applyReviewIntervals(settings) {
    state.reviewIntervals = settings.reviewIntervals || state.reviewIntervals;
    state.reviewShortcuts = settings.reviewShortcuts || state.reviewShortcuts;
    for (const [name, key] of Object.entries(state.reviewShortcuts)) document.getElementById("reviewShortcutForm").elements[name].value = key;
    for (const [response, days] of Object.entries(state.reviewIntervals)) {
      const input = document.querySelector(`#reviewIntervalForm [name="${response}"]`);
      if (input) input.value = days;
    }
  }

  async function loadReviewIntervals() {
    applyReviewIntervals(await app.apiRequest("/api/settings"));
  }

  async function loadReview() {
    const load = ++state.reviewLoad;
    const list = document.getElementById("reviewRulesList");
    list.setAttribute("aria-busy", "true");
    list.innerHTML = '<p class="muted" role="status">Loading cards…</p>';
    try {
      const selected = state.selectedReview;
      const [review, settings] = await Promise.all([selected
        ? app.apiRequest("/api/rules/review-selection", { method: "POST", body: JSON.stringify({ ruleIds: selected.ids }) })
        : app.apiRequest(`/api/rules/review?limit=30${state.reviewKind === "all" ? "" : `&noteKind=${state.reviewKind}`}`), app.apiRequest("/api/settings")]);
      if (load !== state.reviewLoad) return;
      if (selected) {
        selected.ids = review.rules.map((rule) => rule.id);
        persistSelectedReview();
        review.totalSelected = review.rules.length;
        review.rules = review.rules.filter((rule) => state.reviewKind === "all" || rule.noteKind === state.reviewKind);
        review.due = review.rules.length;
      }
      state.review = review;
      document.querySelectorAll("[data-review-kind]").forEach((button) => { const selected = button.dataset.reviewKind === state.reviewKind; button.classList.toggle("is-active", selected); button.setAttribute("aria-pressed", String(selected)); });
      applyReviewIntervals(settings);
      document.getElementById("reviewHeading").textContent = selected ? "Selected review" : "Daily review";
      views.review.classList.toggle("has-selected-review", Boolean(selected));
      document.getElementById("selectedReviewBar").hidden = !selected;
      document.getElementById("selectedReviewStatus").textContent = selected ? `${selected.reviewed} reviewed · ${review.totalSelected} remaining in your selection. Ratings save your next due dates.` : "";
      document.getElementById("reviewDueBadge").textContent = `${state.review.due} ${selected ? "selected" : "due"}`;
      document.getElementById("reviewSuspendedCount").textContent = String(state.review.suspended || 0);
      document.getElementById("viewSuspendedRulesBtn").setAttribute("aria-label", `Suspended rules (${state.review.suspended || 0})`);
      document.getElementById("reviewProgress").textContent = state.review.rules.length
        ? `${selected ? selected.reviewed : state.reviewedThisSession} reviewed · ${state.review.due} left${selected && state.reviewKind !== "all" ? " in this filter" : ""}`
        : selected ? `${selected.reviewed} reviewed · ${review.totalSelected ? "choose All cards to continue" : "selection complete"}` : state.reviewedThisSession ? `${state.reviewedThisSession} reviewed · queue complete` : "Nothing waiting today";
      document.getElementById("reviewRulesList").innerHTML = state.review.rules.length
        ? reviewCard(state.review.rules[0])
        : `<section class="panel review-complete" tabindex="-1"><span class="review-complete__mark">✓</span><h2>${selected ? review.totalSelected ? "No selected cards in this filter" : "Selection complete" : state.reviewKind === "all" ? "You are done for today" : `No ${state.reviewKind === "reasoning" ? "Broad Patterns" : "Clinical Patterns"} due`}</h2><p class="muted">${selected ? review.totalSelected ? "Choose All cards to continue your selection." : "Return to daily review or choose another selection in the library." : state.reviewKind === "all" ? "Your cards return on the dates set by your review intervals." : "Choose All cards to review your other notes."}</p></section>`;
      if (state.activeArea === "review" && !views.review.hidden) document.querySelector("#reviewRulesList .review-card__content, #reviewRulesList .review-complete")?.focus({ preventScroll: true });
    } catch (error) {
      if (load === state.reviewLoad) list.innerHTML = `<section class="panel review-complete"><h2>Cards could not be loaded</h2><p class="muted">${escapeHTML(error.message || "Open Active Rules to try again.")}</p></section>`;
      throw error;
    } finally {
      if (load === state.reviewLoad) list.removeAttribute("aria-busy");
    }
  }

  async function submitReview(ruleId, response) {
    const list = document.getElementById("reviewRulesList");
    if (list.getAttribute("aria-busy") === "true") return;
    list.setAttribute("aria-busy", "true");
    list.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      const rule = await app.apiRequest(`/api/rules/${encodeURIComponent(ruleId)}/reviews`, { method: "POST", body: JSON.stringify({ response }) });
      state.reviewedThisSession += 1;
      if (state.selectedReview) {
        state.selectedReview.ids = state.selectedReview.ids.filter((id) => id !== ruleId);
        state.selectedReview.reviewed += 1;
        persistSelectedReview();
      }
      app.showToast(`${labelResponse(response)} · next review ${rule.nextReviewAt}.`);
      await loadReview();
      refreshDueBadge();
    } finally {
      list.removeAttribute("aria-busy");
      list.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    }
  }

  async function suspendReview(ruleId) {
    const rule = state.review?.rules?.find((item) => item.id === ruleId);
    if (!rule) return;
    const list = document.getElementById("reviewRulesList");
    if (list.getAttribute("aria-busy") === "true") return;
    list.setAttribute("aria-busy", "true");
    list.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      await app.apiRequest(`/api/rules/${encodeURIComponent(ruleId)}`, { method: "PUT", body: JSON.stringify({ status: "archived" }) });
      if (state.selectedReview) {
        state.selectedReview.ids = state.selectedReview.ids.filter((id) => id !== ruleId);
        persistSelectedReview();
      }
      app.showToast("Rule suspended. You can resume it from the Rule Library.");
      await loadReview();
      refreshDueBadge();
    } finally {
      list.removeAttribute("aria-busy");
      list.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    }
  }

  async function saveReviewIntervals(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const reviewIntervals = Object.fromEntries(["again", "hard", "good", "easy"].map((response) => [response, Number(form.elements[response].value)]));
    const settings = await app.apiRequest("/api/settings", { method: "PUT", body: JSON.stringify({ reviewIntervals }) });
    applyReviewIntervals(settings);
    app.showToast("Review intervals saved.");
  }

  async function saveReviewShortcuts(reviewShortcuts) {
    const settings = await app.apiRequest("/api/settings", { method: "PUT", body: JSON.stringify({ reviewShortcuts }) });
    applyReviewIntervals(settings);
    app.showToast("Review shortcuts saved.");
  }

  async function loadNoteUpgrade() {
    const result = await app.apiRequest("/api/notes/upgrade");
    document.getElementById("noteUpgradePanel").hidden = !result.entries && !result.rules;
    document.getElementById("noteUpgradeStatus").textContent = `${result.entries} older notes · ${result.rules} saved rules`;
  }

  function download(path, fallback) {
    app.downloadFromApi(path, fallback).catch((error) => app.showToast(error.message));
  }

  function renderBackupPreview(previewResult) {
    state.restorePreview = previewResult;
    const preview = previewResult.preview;
    document.getElementById("restorePreviewSummary").innerHTML = `
      <dl class="preview-grid">
        <div><dt>Source</dt><dd>${escapeHTML(previewResult.source.filename || "Encrypted archive")}</dd></div>
        <div><dt>Integrity</dt><dd>${escapeHTML(preview.integrity)}</dd></div>
        <div><dt>Schema</dt><dd>Version ${preview.schemaVersion}</dd></div>
        <div><dt>Forms</dt><dd>${preview.counts.forms}</dd></div>
        <div><dt>Question logs</dt><dd>${preview.counts.questionLogs}</dd></div>
        <div><dt>Rules / reviews</dt><dd>${preview.counts.rules} / ${preview.counts.reviews}</dd></div>
      </dl>`;
    document.getElementById("restoreConfirmationInput").value = "";
    document.getElementById("restoreDatabaseError").hidden = true;
    document.getElementById("restoreDatabaseDialog").showModal();
  }

  async function loadBackups() {
    const payload = await app.apiRequest("/api/backups");
    document.getElementById("backupDirectoryText").textContent = payload.disabled ? `${payload.directory} · snapshots disabled in fallback mode` : `${payload.directory} · keep ${payload.retention} · scheduled every ${payload.intervalHours || "disabled"}${payload.intervalHours ? " hours" : ""}`;
    const createBackupBtn = document.getElementById("createBackupBtn");
    if (createBackupBtn) createBackupBtn.disabled = Boolean(payload.disabled);
    document.getElementById("backupList").innerHTML = payload.disabled ? '<div class="frequency-empty">IndexedDB is unavailable in this browser profile. ThunderShadow is using emergency local storage; use Google Drive sync or JSON export for backup.</div>' : payload.backups.length ? payload.backups.map((backup) => `
      <article class="backup-row" data-backup-filename="${escapeHTML(backup.filename)}">
        <div><strong>${escapeHTML(backup.filename)}</strong><small>${escapeHTML((backup.modifiedAt || "Stored snapshot").slice(0, 19).replace("T", " "))} · ${Number.isFinite(backup.sizeBytes) ? `${(backup.sizeBytes / 1024).toFixed(1)} KB · ` : ""}${backup.valid ? (backup.counts ? `verified · ${backup.counts.forms} forms` : "stored · verify on preview") : escapeHTML(backup.error)}</small></div>
        <div class="v3-heading__actions"><button class="button button--subtle" data-backup-action="download" type="button"${backup.valid ? "" : " disabled"}>Download</button><button class="button button--ghost" data-backup-action="preview" type="button"${backup.valid ? "" : " disabled"}>Preview restore</button></div>
      </article>
    `).join("") : '<div class="frequency-empty">No local backups yet.</div>';
  }

  async function previewLocalBackup(filename) {
    const preview = await app.apiRequest("/api/backups/preview", { method: "POST", body: JSON.stringify({ filename }) });
    renderBackupPreview(preview);
  }

  async function exportEncrypted() {
    const input = document.getElementById("portablePassphrase");
    const passphrase = input.value;
    if (passphrase.length < 8) throw new Error("Enter a passphrase of at least 8 characters.");
    document.getElementById("portableBackupStatus").textContent = "Creating and encrypting a verified snapshot…";
    const response = await app.rawApiRequest("/api/portable/export", { method: "POST", body: JSON.stringify({ passphrase }) });
    input.value = "";
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || "Encrypted export failed.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "ThunderShadow_Encrypted.tsbackup";
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
    document.getElementById("portableBackupStatus").textContent = "Encrypted archive downloaded. Keep its passphrase separately.";
  }

  async function previewEncrypted(file) {
    const input = document.getElementById("portablePassphrase");
    const passphrase = input.value;
    if (!file) return;
    if (passphrase.length < 8) throw new Error("Enter the archive passphrase before selecting the file.");
    document.getElementById("portableBackupStatus").textContent = "Decrypting and verifying the archive…";
    const response = await app.rawApiRequest("/api/portable/import/preview", {
      method: "POST",
      body: await file.arrayBuffer(),
      headers: {
        "Content-Type": "application/octet-stream",
        "X-ThunderShadow-Passphrase": passphrase,
        "X-ThunderShadow-Filename": file.name
      }
    });
    input.value = "";
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || "Encrypted archive could not be opened.");
    }
    const preview = await response.json();
    document.getElementById("portableBackupStatus").textContent = "Archive decrypted and verified. Review the restore preview.";
    renderBackupPreview(preview);
  }

  async function confirmRestore(event) {
    event.preventDefault();
    const errorElement = document.getElementById("restoreDatabaseError");
    if (!state.restorePreview) return;
    try {
      const result = await app.apiRequest("/api/backups/restore", {
        method: "POST",
        body: JSON.stringify({
          previewToken: state.restorePreview.token,
          confirmation: document.getElementById("restoreConfirmationInput").value
        })
      });
      state.restorePreview = null;
      document.getElementById("restoreDatabaseDialog").close();
      app.showToast(`Database restored. Safety backup: ${result.safetyBackup}`);
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    }
  }

  document.getElementById("areaNav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-area]");
    if (button) show(button.dataset.area);
  });
  document.getElementById("settingsTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-settings-category]");
    if (tab) selectSettingsCategory(tab.dataset.settingsCategory);
  });
  document.getElementById("settingsTabs").addEventListener("keydown", (event) => {
    const tabs = [...event.currentTarget.querySelectorAll("[role='tab']")];
    const index = tabs.indexOf(event.target);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectSettingsCategory(tabs[next].dataset.settingsCategory, true);
  });
  async function handleRuleListClick(event) {
    const button = event.target.closest("[data-rule-action]");
    const card = event.target.closest("[data-rule-id]");
    if (!button || !card || state.bulkBusy) return;
    try {
      if (button.dataset.ruleAction === "save") await updateRule(card);
      if (button.dataset.ruleAction === "suspend") await updateRule(card, "archived");
      if (button.dataset.ruleAction === "resume") await updateRule(card, "active");
      if (button.dataset.ruleAction === "delete") await deleteRule(card);
      if (button.dataset.ruleAction === "merge") await mergeRule(card, button.dataset.sourceRuleId);
      if (button.dataset.ruleAction === "source") {
        const rule = state.rules.find((item) => item.id === card.dataset.ruleId);
        await app.openFormQuestion(rule.sourceFormId, rule.sourceQuestionNumber);
      }
    } catch (error) { app.showToast(error.message); }
  }
  document.getElementById("ruleSearchInput").addEventListener("input", () => { renderSavedRules(); });
  document.getElementById("ruleSortSelect").addEventListener("change", () => { state.selectionAnchor = null; renderSavedRules(); });
  document.getElementById("ruleKindTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-library-kind]");
    if (!tab || state.bulkBusy) return;
    state.libraryKinds[state.librarySection] = tab.dataset.libraryKind;
    state.selectionAnchor = null;
    renderFormTabs();
    renderSavedRules();
    views.library.querySelector(".rule-library-panels").scrollTop = 0;
  });
  document.getElementById("bulkRulePattern").innerHTML = patternOptions("");
  document.getElementById("savedRuleBulkAction").addEventListener("change", updateSavedSelection);
  document.getElementById("selectAllSavedRules").addEventListener("change", (event) => {
    if (state.bulkBusy) return;
    document.getElementById("savedRuleBulkStatus").textContent = "";
    for (const rule of visibleSavedRules()) {
      if (event.target.checked) state.selectedRules.add(rule.id);
      else state.selectedRules.delete(rule.id);
    }
    updateSavedSelection();
  });
  document.getElementById("clearSavedRuleSelectionBtn").addEventListener("click", () => { state.selectedRules.clear(); state.selectionAnchor = null; document.getElementById("savedRuleBulkStatus").textContent = ""; updateSavedSelection(); });
  document.getElementById("applySavedRuleBulkBtn").addEventListener("click", () => applyBulkRuleAction().catch((error) => app.showToast(error.message)));
  document.getElementById("reviewSelectedRulesBtn").addEventListener("click", () => reviewSelectedRules().catch((error) => app.showToast(error.message)));
  document.getElementById("exitSelectedReviewBtn").addEventListener("click", () => {
    if (document.getElementById("reviewRulesList").getAttribute("aria-busy") === "true") return;
    state.selectedReview = null;
    persistSelectedReview();
    loadReview().catch((error) => app.showToast(error.message));
  });
  const formStrip = document.getElementById("ruleFormTabs");
  formStrip.addEventListener("scroll", updateFormScroll, { passive: true });
  window.addEventListener("resize", updateFormScroll);
  if (window.ResizeObserver) new ResizeObserver(updateFormScroll).observe(formStrip);
  for (const [id, direction] of [["ruleFormsLeftBtn", -1], ["ruleFormsRightBtn", 1]]) document.getElementById(id).addEventListener("click", () => {
    formStrip.scrollBy({ left: direction * Math.max(180, formStrip.clientWidth * .7), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  document.getElementById("ruleLibraryTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-rule-section]");
    if (tab) selectLibrarySection(tab.dataset.ruleSection);
  });
  document.getElementById("ruleFormTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-rule-form]");
    if (!tab || state.bulkBusy) return;
    state.libraryForms[state.librarySection] = tab.dataset.ruleForm;
    document.querySelectorAll("[data-rule-form]").forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    renderSavedRules();
    views.library.querySelector(".rule-library-panels").scrollTop = 0;
  });
  for (const id of ["ruleLibraryTabs", "ruleKindTabs", "ruleFormTabs"]) document.getElementById(id).addEventListener("keydown", (event) => {
    if (state.bulkBusy) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll("[role='tab']")];
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click();
    const target = id === "ruleFormTabs" ? document.querySelector(`[data-rule-form][aria-selected="true"]`) : tabs[next];
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  document.getElementById("personalRulesList").addEventListener("click", handleRuleListClick);
  document.getElementById("suspendedRulesList").addEventListener("click", handleRuleListClick);
  for (const id of ["personalRulesList", "suspendedRulesList"]) document.getElementById(id).addEventListener("click", (event) => {
    const checkbox = event.target.closest("[data-saved-rule-select]");
    if (!checkbox || state.bulkBusy) return;
    document.getElementById("savedRuleBulkStatus").textContent = "";
    const ruleId = checkbox.closest("[data-rule-id]").dataset.ruleId;
    const ids = visibleSavedRules().map((rule) => rule.id);
    const anchor = ids.indexOf(state.selectionAnchor);
    const index = ids.indexOf(ruleId);
    const range = event.shiftKey && anchor >= 0 ? ids.slice(Math.min(anchor, index), Math.max(anchor, index) + 1) : [ruleId];
    for (const id of range) { if (checkbox.checked) state.selectedRules.add(id); else state.selectedRules.delete(id); }
    state.selectionAnchor = ruleId;
    updateSavedSelection();
  });
  document.getElementById("reviewRulesList").addEventListener("click", (event) => {
    const responseButton = event.target.closest("[data-review-response]");
    const suspendButton = event.target.closest("[data-review-action='suspend']");
    const card = event.target.closest("[data-rule-id]");
    if (responseButton && card) submitReview(card.dataset.ruleId, responseButton.dataset.reviewResponse).catch((error) => app.showToast(error.message));
    if (suspendButton && card) suspendReview(card.dataset.ruleId).catch((error) => app.showToast(error.message));
  });
  document.getElementById("reviewTypeFilter").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-kind]");
    if (!button || document.getElementById("reviewRulesList").getAttribute("aria-busy") === "true") return;
    state.reviewKind = button.dataset.reviewKind;
    loadReview().catch((error) => app.showToast(error.message));
  });
  document.addEventListener("keydown", (event) => {
    if (views.review.hidden || document.documentElement.dataset.activeView !== "review" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || document.querySelector("dialog[open]") || event.target.closest("input,textarea,select,summary,a,button:not(.review-response),[contenteditable]:not([contenteditable='false'])")) return;
    const key = event.key === " " ? "Space" : event.key.toLowerCase();
    const response = key === state.reviewShortcuts.quickGood ? "good" : Object.entries(state.reviewShortcuts).find(([name, value]) => name !== "quickGood" && value === key)?.[0];
    if (!response) return;
    const button = document.querySelector(`#reviewRulesList [data-review-response="${response}"]`);
    if (!button) return;
    event.preventDefault();
    if (!event.repeat && !button.disabled && document.getElementById("reviewRulesList").getAttribute("aria-busy") !== "true") button.click();
  });
  document.getElementById("reviewShortcutForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveReviewShortcuts(Object.fromEntries(new FormData(event.currentTarget))).catch((error) => app.showToast(error.message));
  });
  document.getElementById("resetReviewShortcutsBtn").addEventListener("click", () => saveReviewShortcuts({ again: "1", hard: "2", good: "3", easy: "4", quickGood: "Space" }).catch((error) => app.showToast(error.message)));
  document.getElementById("upgradeNotesBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    document.getElementById("noteUpgradeStatus").textContent = "Saving a safety snapshot and upgrading note metadata…";
    try {
      const result = await app.apiRequest("/api/notes/upgrade", { method: "POST", body: "{}" });
      await app.refreshForms();
      await Promise.all([loadNoteUpgrade(), loadBackups()]);
      app.showToast(`Upgraded ${result.entries} notes and ${result.rules} saved rules.`);
    } catch (error) { document.getElementById("noteUpgradeStatus").textContent = error.message; app.showToast(error.message); }
    finally { button.disabled = false; }
  });
  document.getElementById("reviewIntervalForm").addEventListener("submit", (event) => saveReviewIntervals(event).catch((error) => app.showToast(error.message)));
  document.getElementById("viewSuspendedRulesBtn").addEventListener("click", async () => {
    await show("library");
    state.libraryForms.suspended = "all";
    state.libraryKinds.suspended = "all";
    document.getElementById("ruleSearchInput").value = "";
    selectLibrarySection("suspended");
  });
  const reloadAnalysis = () => loadAnalysis().catch((error) => app.showToast(error.message));
  document.getElementById("analysisScope").addEventListener("click", (event) => {
    const button = event.target.closest("[data-analysis-scope]");
    if (!button) return;
    state.analysisScope = button.dataset.analysisScope;
    reloadAnalysis();
  });
  document.getElementById("analysisTimelineMode").addEventListener("click", (event) => {
    const button = event.target.closest("[data-timeline-mode]");
    if (!button || !state.analytics) return;
    state.timelineMode = button.dataset.timelineMode;
    renderAnalysisTimeline(state.analytics);
  });
  document.getElementById("applyAnalysisFilters").addEventListener("click", reloadAnalysis);
  document.getElementById("clearAnalysisFilters").addEventListener("click", () => {
    document.getElementById("analysisStartDate").value = "";
    document.getElementById("analysisEndDate").value = "";
    document.getElementById("analysisForms").querySelectorAll("input:checked").forEach((input) => { input.checked = false; });
    reloadAnalysis();
  });
  const timelineHost = document.getElementById("analysisTimeline");
  timelineHost.addEventListener("pointerover", (event) => { const column = event.target.closest(".an-col"); if (column) showTimelineTip(column); });
  timelineHost.addEventListener("focusin", (event) => { const column = event.target.closest(".an-col"); if (column) showTimelineTip(column); });
  timelineHost.addEventListener("pointerleave", hideTimelineTip);
  timelineHost.addEventListener("focusout", hideTimelineTip);
  document.getElementById("analysisBody").addEventListener("click", (event) => {
    const review = event.target.closest("[data-analysis-review]"), jump = event.target.closest("[data-analysis-jump]");
    if (review) reviewPattern(review.dataset.analysisReview).catch((error) => app.showToast(error.message));
    if (jump) app.openFormQuestion(jump.dataset.analysisJump, Number(jump.dataset.entry)).then(() => hide()).catch((error) => app.showToast(error.message));
  });

  document.getElementById("exportRulesBtn").addEventListener("click", () => download("/api/export/active-rules.tsv", "ThunderShadow_Active_Rules.tsv"));
  document.getElementById("exportAnalyticsBtn").addEventListener("click", () => download(`/api/export/analytics.json?${analysisQuery()}`, "ThunderShadow_Analytics.json"));
  document.getElementById("exportAllFormsBtn").addEventListener("click", () => download("/api/export/all-forms.tsv", "ThunderShadow_Longitudinal_Log.tsv"));
  document.getElementById("exportAnkiBtn").addEventListener("click", () => download("/api/export/anki.tsv", "ThunderShadow_Anki.tsv"));
  document.getElementById("settingsExportRulesBtn").addEventListener("click", () => download("/api/export/active-rules.tsv", "ThunderShadow_Active_Rules.tsv"));
  document.getElementById("settingsExportAnalyticsBtn").addEventListener("click", () => download("/api/export/analytics.json", "ThunderShadow_Analytics.json"));
  document.getElementById("createBackupBtn").addEventListener("click", async () => {
    try {
      const result = await app.apiRequest("/api/backups", { method: "POST", body: JSON.stringify({}) });
      app.showToast(`Verified backup created: ${result.filename}`);
      await loadBackups();
    } catch (error) { app.showToast(error.message); }
  });
  document.getElementById("refreshBackupsBtn").addEventListener("click", () => loadBackups().catch((error) => app.showToast(error.message)));
  document.getElementById("backupList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-backup-action]");
    const row = event.target.closest("[data-backup-filename]");
    if (!button || !row) return;
    if (button.dataset.backupAction === "download") download(`/api/backups/${encodeURIComponent(row.dataset.backupFilename)}/download`, row.dataset.backupFilename);
    if (button.dataset.backupAction === "preview") previewLocalBackup(row.dataset.backupFilename).catch((error) => app.showToast(error.message));
  });
  document.getElementById("exportEncryptedBtn").addEventListener("click", () => exportEncrypted().catch((error) => {
    document.getElementById("portableBackupStatus").textContent = error.message;
    app.showToast(error.message);
  }));
  document.getElementById("previewEncryptedBtn").addEventListener("click", () => document.getElementById("encryptedImportInput").click());
  document.getElementById("encryptedImportInput").addEventListener("change", async (event) => {
    try { await previewEncrypted(event.target.files?.[0]); }
    catch (error) { document.getElementById("portableBackupStatus").textContent = error.message; app.showToast(error.message); }
    event.target.value = "";
  });
  document.getElementById("restoreDatabaseForm").addEventListener("submit", confirmRestore);
  [document.getElementById("cancelRestoreDatabaseBtn"), document.getElementById("closeRestoreDatabaseBtn")].forEach((button) => button.addEventListener("click", () => {
    document.getElementById("restoreDatabaseDialog").close();
    state.restorePreview = null;
  }));

  // First count once storage has settled after startup.
  setTimeout(refreshDueBadge, 1500);
  window.ThunderShadowV3 = { hide, show };
})();
