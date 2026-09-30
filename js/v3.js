(() => {
  "use strict";

  const app = window.ThunderShadowApp;
  const views = {
    library: document.getElementById("ruleLibraryView"),
    analysis: document.getElementById("analysisView"),
    review: document.getElementById("reviewView"),
    settings: document.getElementById("settingsView")
  };
  const state = { rules: [], candidates: [], analytics: null, review: null, reviewIntervals: { again: 1, hard: 3, good: 7, easy: 30 }, reviewedThisSession: 0, activeArea: null, reviewKind: "all", reviewLoad: 0, reviewShortcuts: { again: "1", hard: "2", good: "3", easy: "4", quickGood: "Space" }, settingsCategory: "cards", restorePreview: null };
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
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

  const kindLabel = (kind) => kind === "reasoning" ? "Reasoning cue" : "Clinical pearl";
  const tagMarkup = (rule) => `<span class="note-tag note-tag--static" data-note-kind="${escapeHTML(rule.noteKind)}">${kindLabel(rule.noteKind)}</span>${rule.noteKind === "reasoning" && rule.pattern ? `<span class="badge">${escapeHTML(rule.patternLabel)}</span>` : ""}`;
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

  async function show(area) {
    await app.flushPendingEntry();
    if (area === "logger") {
      hide();
      app.showLibrary();
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
      ? rule.reviewHistory.slice(0, 5).map((review) => `<li>${escapeHTML(labelResponse(review.response))} · ${escapeHTML(review.reviewedAt.slice(0, 10))} → ${escapeHTML(review.nextReviewAt)}</li>`).join("")
      : "<li>No reviews yet.</li>";
    return `
      <details class="rule-card${suspended ? " rule-card--suspended" : ""}" data-rule-id="${escapeHTML(rule.id)}">
        <summary class="rule-card__summary">
          <span class="rule-card__summary-main"><span class="rule-tags">${tagMarkup(rule)}</span><strong>${escapeHTML(rule.ruleText)}</strong></span>
          <span class="rule-card__summary-meta">${rule.occurrenceCount} occurrence${rule.occurrenceCount === 1 ? "" : "s"} · ${suspended ? "suspended" : `due ${escapeHTML(rule.nextReviewAt || "today")}`}</span>
        </summary>
        <div class="rule-card__details">
          <div class="rule-card__meta">
          ${tagMarkup(rule)}
          <span>${rule.occurrenceCount} exact occurrence${rule.occurrenceCount === 1 ? "" : "s"}</span>
          <span>${escapeHTML(rule.firstSeen)} → ${escapeHTML(rule.lastSeen)}</span>
            <span>${suspended ? "Removed from review" : `Next review: ${escapeHTML(rule.nextReviewAt || "today")}`}</span>
          </div>
          <p class="rule-source" title="${escapeHTML(rule.sourceNoteId || rule.id)}">${escapeHTML(sourceLabel(rule))}<small>Rule ID: ${escapeHTML(rule.id)}${rule.sourceNoteId ? ` · Note ID: ${escapeHTML(rule.sourceNoteId)}` : ""}</small></p>
          <label class="rule-edit-label"><span>Rule wording</span><textarea class="rule-card__text" maxlength="12000" aria-label="Canonical rule wording">${escapeHTML(rule.ruleText)}</textarea></label>
          <div class="rule-card__controls">
            <label>Note tag<select class="rule-kind" aria-label="Note tag"><option value="clinical"${rule.noteKind === "clinical" ? " selected" : ""}>Clinical pearl</option><option value="reasoning"${rule.noteKind === "reasoning" ? " selected" : ""}>Reasoning cue</option></select></label>
            <label class="rule-pattern-label"${rule.noteKind === "clinical" ? " hidden" : ""}>Pattern<select class="rule-pattern" aria-label="Reasoning cue pattern">${patternOptions(rule.pattern)}</select></label>
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
    `;
  }

  async function loadLibrary() {
    const payload = await app.apiRequest("/api/rules");
    state.rules = payload.rules;
    state.candidates = payload.candidates;
    const activeRules = state.rules.filter((rule) => rule.status !== "archived");
    const suspendedRules = state.rules.filter((rule) => rule.status === "archived");
    document.getElementById("ruleCountBadge").textContent = `${activeRules.length} active`;
    document.getElementById("suspendedCountBadge").textContent = `${suspendedRules.length} suspended`;
    document.getElementById("candidateCountBadge").textContent = `${state.candidates.length} found`;
    document.getElementById("candidateBulkActions").hidden = !state.candidates.length;
    document.getElementById("selectAllCandidates").checked = false;
    document.getElementById("selectAllCandidates").indeterminate = false;
    renderSavedRules();
    document.getElementById("ruleCandidatesList").innerHTML = state.candidates.length
      ? state.candidates.map((candidate, index) => `
          <article class="candidate-card" data-candidate-index="${index}">
            <label class="candidate-card__select"><input type="checkbox" data-candidate-select aria-label="Select rule from ${escapeHTML(candidate.sourceFormName)}"></label>
            <div class="candidate-card__content">${tagMarkup(candidate)}<strong>${escapeHTML(candidate.ruleText)}</strong><small>${escapeHTML(candidate.sourceFormName)} · Entry ${candidate.sourceQuestionNumber} · ${escapeHTML(candidate.sourceDate)}</small></div>
            <button class="button button--primary" data-candidate-action="add" type="button">Add to library</button>
          </article>
        `).join("")
      : '<div class="frequency-empty">Every study note is already represented, or no study notes have been logged.</div>';
    updateCandidateSelection();
  }

  function renderSavedRules() {
    const query = document.getElementById("ruleSearchInput").value.trim().toLowerCase();
    const matches = state.rules.filter((rule) => !query || [rule.ruleText, rule.notes, kindLabel(rule.noteKind), rule.noteKind === "reasoning" ? rule.patternLabel : "", rule.id, rule.sourceNoteId, sourceLabel(rule), ...(rule.occurrences || []).map((item) => `${item.formName} ${item.noteId}`)].join(" ").toLowerCase().includes(query));
    const active = matches.filter((rule) => rule.status !== "archived");
    const suspended = matches.filter((rule) => rule.status === "archived");
    document.getElementById("personalRulesList").innerHTML = active.length ? active.map(ruleCard).join("") : `<div class="frequency-empty">${query ? "No active rules match your search." : "No active rules yet. Add a study note from your logs above."}</div>`;
    document.getElementById("suspendedRulesList").innerHTML = suspended.length ? suspended.map(ruleCard).join("") : '<div class="frequency-empty">No suspended rules match.</div>';
    document.getElementById("ruleSearchStatus").textContent = query ? `${matches.length} of ${state.rules.length} saved rules match · ${suspended.length} suspended` : "";
    if (query && suspended.length) document.getElementById("suspendedRulesPanel").open = true;
  }

  function selectedCandidateIndices() {
    return [...document.querySelectorAll("#ruleCandidatesList [data-candidate-select]:checked")].map((checkbox) => Number(checkbox.closest("[data-candidate-index]").dataset.candidateIndex));
  }

  function updateCandidateSelection() {
    const selected = selectedCandidateIndices();
    const total = state.candidates.length;
    document.getElementById("candidateSelectionCount").textContent = `${selected.length} selected`;
    document.getElementById("addSelectedCandidatesBtn").disabled = !selected.length;
    const selectAll = document.getElementById("selectAllCandidates");
    selectAll.checked = Boolean(total && selected.length === total);
    selectAll.indeterminate = Boolean(selected.length && selected.length < total);
  }

  async function addCandidates(indices) {
    const uniqueIndices = [...new Set(indices)].filter((index) => state.candidates[index]);
    if (!uniqueIndices.length) return;
    const bulkActions = document.getElementById("candidateBulkActions");
    const candidateList = document.getElementById("ruleCandidatesList");
    bulkActions.setAttribute("aria-busy", "true");
    candidateList.setAttribute("aria-busy", "true");
    [...bulkActions.querySelectorAll("button, input"), ...candidateList.querySelectorAll("button, input")].forEach((control) => { control.disabled = true; });
    let added = 0;
    let failed = 0;
    try {
      for (const index of uniqueIndices) {
        const candidate = state.candidates[index];
        try {
          await app.apiRequest("/api/rules", { method: "POST", body: JSON.stringify(candidate) });
          added += 1;
        } catch (error) {
          failed += 1;
          console.error("Could not add rule candidate", error);
        }
      }
      app.showToast(failed ? `${added} rule${added === 1 ? "" : "s"} added; ${failed} could not be added.` : `${added} rule${added === 1 ? "" : "s"} added to the library.`);
      await loadLibrary();
    } finally {
      bulkActions.removeAttribute("aria-busy");
      candidateList.removeAttribute("aria-busy");
      [...bulkActions.querySelectorAll("button, input"), ...candidateList.querySelectorAll("button, input")].forEach((control) => { control.disabled = false; });
      updateCandidateSelection();
    }
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

  function populateFormFilter() {
    const select = document.getElementById("analysisForms");
    if (!select) return;
    const selected = new Set([...select.selectedOptions].map((option) => option.value));
    select.innerHTML = app.getForms().sort((a, b) => b.date.localeCompare(a.date)).map((form) => `<option value="${escapeHTML(form.id)}"${selected.has(form.id) ? " selected" : ""}>${escapeHTML(form.date)} · ${escapeHTML(form.name)}</option>`).join("");
  }

  function analysisQuery() {
    const params = new URLSearchParams();
    const start = document.getElementById("analysisStartDate").value;
    const end = document.getElementById("analysisEndDate").value;
    const forms = [...document.getElementById("analysisForms").selectedOptions].map((option) => option.value);
    if (start) params.set("startDate", start);
    if (end) params.set("endDate", end);
    if (forms.length) params.set("formIds", forms.join(","));
    return params.toString();
  }

  function renderAnalysis(data) {
    const cards = [
      ["Forms", data.summary.forms], ["Logged entries", data.summary.loggedQuestions],
      ["Wrong (1–4)", data.summary.wrongAnswers], ["Unstable correct (5–7)", data.summary.unstableCorrect]
    ];
    document.getElementById("analysisCards").innerHTML = cards.map(([label, value]) => `<div class="stat-card"><span class="stat-card__label">${label}</span><strong>${value}</strong></div>`).join("");
    document.getElementById("analysisErrors").innerHTML = table(["Code", "Meaning", "Count", "%"], data.errors.map((item) => [item.id, escapeHTML(item.label), item.count, `${item.percentage}%`]));
    document.getElementById("analysisPatterns").innerHTML = data.patterns.map((item) => {
      const index = Number(item.code?.slice(1)) || 1;
      const topError = item.associatedErrorCodes?.[0];
      const topSpeed = item.associatedSpeedFlags?.[0];
      const subjects = item.representativeSubjects?.map((subject) => `${subject.label} (${subject.count})`).join(", ") || "—";
      return `<article class="analytics-pattern-card pattern-analytics--${index}">
        <header><strong>${escapeHTML(item.code)} — ${escapeHTML(item.label)}</strong><span>${escapeHTML(item.level.label)}</span></header>
        <p class="analytics-pattern-count"><b>${item.count}</b> entr${item.count === 1 ? "y" : "ies"} across <b>${item.formCount}</b> form${item.formCount === 1 ? "" : "s"} · ${item.percentage}% of pattern-coded entries</p>
        <dl><div><dt>Most associated Error Code</dt><dd>${topError ? `Code ${escapeHTML(topError.id)} (${topError.count})` : "—"}</dd></div><div><dt>Most associated Speed Flag</dt><dd>${topSpeed ? `${escapeHTML(topSpeed.label)} (${topSpeed.count})` : "—"}</dd></div><div><dt>Subjects/topics</dt><dd>${escapeHTML(subjects)}</dd></div><div><dt>Trend</dt><dd>${escapeHTML(item.trend.direction)} · ${item.trendOverTime?.length || 0} form-date points</dd></div></dl>
        <p class="analytics-pattern-fix"><b>Fix:</b> ${escapeHTML(item.correctiveAction)}</p>
      </article>`;
    }).join("");
    document.getElementById("analysisSpeed").innerHTML = `<p class="muted speed-burden">Re-read loop: ${data.speedBurden.repeatedReading} · Overthought: ${data.speedBurden.overthought} · Changed answer: ${data.speedBurden.changedAnswer}</p>` + table(["Speed flag", "Count", "Top error", "Top pattern"], data.speed.map((item) => {
      const topError = Object.entries(item.byErrorCode).sort((a, b) => b[1] - a[1])[0];
      const topPattern = Object.entries(item.byRulePattern).sort((a, b) => b[1] - a[1])[0];
      const patternLabel = topPattern ? data.patterns.find((pattern) => pattern.id === topPattern[0])?.label : null;
      return [escapeHTML(item.label), item.count, topError ? `${topError[0]} (${topError[1]})` : "—", topPattern ? `${escapeHTML(patternLabel || topPattern[0])} (${topPattern[1]})` : "—"];
    }));
    document.getElementById("analysisCombinations").innerHTML = data.combinations.length
      ? data.combinations.map((item) => `<article class="finding-card"><strong>${escapeHTML(item.label)}</strong><span>${item.count} descriptive association${item.count === 1 ? "" : "s"}</span></article>`).join("")
      : '<div class="frequency-empty">No predefined combinations occurred in this selection.</div>';
    document.getElementById("analysisTrends").innerHTML = table(["Date", "Form", "Logged", "Wrong", "Unstable correct"], data.recentTrend.map((item) => [escapeHTML(item.date), escapeHTML(item.formName), item.logged, item.wrong, item.unstable]));
  }

  async function loadAnalysis() {
    populateFormFilter();
    const query = analysisQuery();
    state.analytics = await app.apiRequest(`/api/analytics${query ? `?${query}` : ""}`);
    renderAnalysis(state.analytics);
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
            <button class="button button--danger-ghost" type="button" data-review-action="suspend">Suspend card</button>
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
    const [review, settings] = await Promise.all([app.apiRequest(`/api/rules/review?limit=30${state.reviewKind === "all" ? "" : `&noteKind=${state.reviewKind}`}`), app.apiRequest("/api/settings")]);
    if (load !== state.reviewLoad) return;
    state.review = review;
    document.querySelectorAll("[data-review-kind]").forEach((button) => { const selected = button.dataset.reviewKind === state.reviewKind; button.classList.toggle("is-active", selected); button.setAttribute("aria-pressed", String(selected)); });
    applyReviewIntervals(settings);
    document.getElementById("reviewDueBadge").textContent = `${state.review.due} due`;
    document.getElementById("reviewSuspendedCount").textContent = String(state.review.suspended || 0);
    document.getElementById("viewSuspendedRulesBtn").setAttribute("aria-label", `Suspended rules (${state.review.suspended || 0})`);
    document.getElementById("reviewProgress").textContent = state.review.rules.length
      ? `${state.reviewedThisSession} reviewed · ${state.review.due} left`
      : state.reviewedThisSession ? `${state.reviewedThisSession} reviewed · queue complete` : "Nothing waiting today";
    document.getElementById("reviewRulesList").innerHTML = state.review.rules.length
      ? reviewCard(state.review.rules[0])
      : `<section class="panel review-complete" tabindex="-1"><span class="review-complete__mark">✓</span><h2>${state.reviewKind === "all" ? "You are done for today" : `No ${state.reviewKind === "reasoning" ? "Reasoning cues" : "Clinical pearls"} due`}</h2><p class="muted">${state.reviewKind === "all" ? "Your cards return on the dates set by your review intervals." : "Choose All cards to review your other notes."}</p></section>`;
    if (state.activeArea === "review" && !views.review.hidden) document.querySelector("#reviewRulesList .review-card__content, #reviewRulesList .review-complete")?.focus({ preventScroll: true });
  }

  async function submitReview(ruleId, response) {
    const list = document.getElementById("reviewRulesList");
    if (list.getAttribute("aria-busy") === "true") return;
    list.setAttribute("aria-busy", "true");
    list.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      const rule = await app.apiRequest(`/api/rules/${encodeURIComponent(ruleId)}/reviews`, { method: "POST", body: JSON.stringify({ response }) });
      state.reviewedThisSession += 1;
      app.showToast(`${labelResponse(response)} · next review ${rule.nextReviewAt}.`);
      await loadReview();
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
      app.showToast("Rule suspended. You can resume it from the Rule Library.");
      await loadReview();
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
    if (!button || !card) return;
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
  document.getElementById("ruleSearchInput").addEventListener("input", renderSavedRules);
  for (const listId of ["personalRulesList", "suspendedRulesList"]) document.getElementById(listId).addEventListener("change", (event) => {
    if (event.target.matches(".rule-kind")) event.target.closest("[data-rule-id]").querySelector(".rule-pattern-label").hidden = event.target.value === "clinical";
  });
  document.getElementById("personalRulesList").addEventListener("click", handleRuleListClick);
  document.getElementById("suspendedRulesList").addEventListener("click", handleRuleListClick);
  document.getElementById("ruleCandidatesList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-candidate-action='add']");
    const card = event.target.closest("[data-candidate-index]");
    if (button && card) addCandidates([Number(card.dataset.candidateIndex)]).catch((error) => app.showToast(error.message));
  });
  document.getElementById("ruleCandidatesList").addEventListener("change", (event) => {
    if (event.target.matches("[data-candidate-select]")) updateCandidateSelection();
  });
  document.getElementById("selectAllCandidates").addEventListener("change", (event) => {
    document.querySelectorAll("#ruleCandidatesList [data-candidate-select]").forEach((checkbox) => { checkbox.checked = event.target.checked; });
    updateCandidateSelection();
  });
  document.getElementById("addSelectedCandidatesBtn").addEventListener("click", () => addCandidates(selectedCandidateIndices()).catch((error) => app.showToast(error.message)));
  document.getElementById("addAllCandidatesBtn").addEventListener("click", () => addCandidates(state.candidates.map((_, index) => index)).catch((error) => app.showToast(error.message)));
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
    const panel = document.getElementById("suspendedRulesPanel");
    panel.open = true;
    const scroller = panel.closest(".v3-scroll");
    if (scroller) {
      const panelTop = panel.getBoundingClientRect().top;
      const scrollerTop = scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: scroller.scrollTop + panelTop - scrollerTop - 8, behavior: "smooth" });
    }
  });
  document.getElementById("applyAnalysisFilters").addEventListener("click", () => loadAnalysis().catch((error) => app.showToast(error.message)));
  document.getElementById("clearAnalysisFilters").addEventListener("click", () => {
    document.getElementById("analysisStartDate").value = "";
    document.getElementById("analysisEndDate").value = "";
    [...document.getElementById("analysisForms").options].forEach((option) => { option.selected = false; });
    loadAnalysis().catch((error) => app.showToast(error.message));
  });

  document.getElementById("exportRulesBtn").addEventListener("click", () => download("/api/export/active-rules.tsv", "ThunderShadow_Active_Rules.tsv"));
  document.getElementById("exportAnalyticsBtn").addEventListener("click", () => download(`/api/export/analytics.json?${analysisQuery()}`, "ThunderShadow_Analytics.json"));
  document.getElementById("exportChatgptBtn").addEventListener("click", () => download(`/api/export/chatgpt-analysis.md?${analysisQuery()}`, "ThunderShadow_ChatGPT_Analysis.md"));
  document.getElementById("exportAllFormsBtn").addEventListener("click", () => download("/api/export/all-forms.tsv", "ThunderShadow_Longitudinal_Log.tsv"));
  document.getElementById("settingsExportRulesBtn").addEventListener("click", () => download("/api/export/active-rules.tsv", "ThunderShadow_Active_Rules.tsv"));
  document.getElementById("settingsExportAnalyticsBtn").addEventListener("click", () => download("/api/export/analytics.json", "ThunderShadow_Analytics.json"));
  document.getElementById("settingsExportChatgptBtn").addEventListener("click", () => download("/api/export/chatgpt-analysis.md", "ThunderShadow_ChatGPT_Analysis.md"));
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

  window.ThunderShadowV3 = { hide, show };
})();
