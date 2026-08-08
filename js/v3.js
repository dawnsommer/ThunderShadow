(() => {
  "use strict";

  const app = window.ThunderShadowApp;
  const views = {
    library: document.getElementById("ruleLibraryView"),
    analysis: document.getElementById("analysisView"),
    review: document.getElementById("reviewView"),
    settings: document.getElementById("settingsView")
  };
  const state = { rules: [], candidates: [], analytics: null, review: null, activeArea: null, restorePreview: null };
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const labelResponse = (value) => ({ still_weak: "Still weak", partly_reliable: "Partly reliable", reliable_today: "Reliable today", mastered: "Mastered", skip: "Skip" })[value] || value;

  function hide() {
    Object.values(views).forEach((view) => { view.hidden = true; });
    state.activeArea = null;
  }

  function setActiveNav(area) {
    document.querySelectorAll("[data-area]").forEach((button) => button.classList.toggle("is-active", button.dataset.area === area));
  }

  async function show(area) {
    if (area === "logger") {
      app.showLibrary();
      return;
    }
    app.hideCoreViews();
    hide();
    state.activeArea = area;
    views[area].hidden = false;
    setActiveNav(area);
    try {
      if (area === "library") await loadLibrary();
      if (area === "analysis") await loadAnalysis();
      if (area === "review") await loadReview();
      if (area === "settings") { await Promise.all([loadBackups(), app.refreshAccess()]); }
    } catch (error) {
      console.error(error);
      app.showToast(error.message || "This area could not be loaded.");
    }
  }

  function ruleCard(rule) {
    const source = rule.sourceFormId && rule.sourceQuestionNumber
      ? `<button class="button button--subtle" data-rule-action="source" type="button">Open source Entry ${rule.sourceQuestionNumber}</button>`
      : "";
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
      <article class="rule-card" data-rule-id="${escapeHTML(rule.id)}">
        <div class="rule-card__meta">
          <span class="badge">${escapeHTML(rule.patternLabel)}</span>
          <span>${rule.occurrenceCount} exact occurrence${rule.occurrenceCount === 1 ? "" : "s"}</span>
          <span>${escapeHTML(rule.firstSeen)} → ${escapeHTML(rule.lastSeen)}</span>
          <span>Next: ${escapeHTML(rule.nextReviewAt || "unscheduled")}</span>
        </div>
        <textarea class="rule-card__text" maxlength="12000" aria-label="Canonical rule wording">${escapeHTML(rule.ruleText)}</textarea>
        <div class="rule-card__controls">
          <label>Status <select class="rule-status">
            ${["new", "active", "improving", "mastered", "archived"].map((status) => `<option value="${status}"${rule.status === status ? " selected" : ""}>${status}</option>`).join("")}
          </select></label>
          <label class="rule-notes-label">Notes <input class="rule-notes" maxlength="12000" value="${escapeHTML(rule.notes)}" placeholder="Optional notes"></label>
          <button class="button button--primary" data-rule-action="save" type="button">Save</button>
          ${source}
          <button class="button button--danger-ghost" data-rule-action="archive" type="button">Archive</button>
        </div>
        ${suggestions ? `<details class="duplicate-details"><summary>Suggested near-duplicate grouping (${rule.nearDuplicates.length})</summary>${suggestions}</details>` : ""}
        <details class="review-history"><summary>Review history (${rule.reviewHistory.length})</summary><ul>${history}</ul></details>
      </article>
    `;
  }

  async function loadLibrary() {
    const payload = await app.apiRequest("/api/rules");
    state.rules = payload.rules;
    state.candidates = payload.candidates;
    document.getElementById("ruleCountBadge").textContent = `${state.rules.length} rule${state.rules.length === 1 ? "" : "s"}`;
    document.getElementById("personalRulesList").innerHTML = state.rules.length
      ? state.rules.map(ruleCard).join("")
      : '<div class="frequency-empty">No personal rules yet. Add one from a logged Reasoning Note below.</div>';
    document.getElementById("ruleCandidatesList").innerHTML = state.candidates.length
      ? state.candidates.map((candidate, index) => `
          <article class="candidate-card" data-candidate-index="${index}">
            <div><span class="badge">${escapeHTML(candidate.patternLabel)}</span><strong>${escapeHTML(candidate.ruleText)}</strong><small>${escapeHTML(candidate.sourceFormName)} · Entry ${candidate.sourceQuestionNumber} · ${escapeHTML(candidate.sourceDate)}</small></div>
            <button class="button button--primary" data-candidate-action="add" type="button">Add to library</button>
          </article>
        `).join("")
      : '<div class="frequency-empty">Every Reasoning Note is already represented, or no Reasoning Notes have been logged.</div>';
  }

  async function addCandidate(index) {
    const candidate = state.candidates[index];
    if (!candidate) return;
    const result = await app.apiRequest("/api/rules", {
      method: "POST",
      body: JSON.stringify({
        pattern: candidate.pattern,
        ruleText: candidate.ruleText,
        sourceFormId: candidate.sourceFormId,
        sourceQuestionNumber: candidate.sourceQuestionNumber
      })
    });
    app.showToast(result.nearDuplicates.length ? `Rule added; ${result.nearDuplicates.length} possible near-duplicate shown.` : "Rule added to the library.");
    await loadLibrary();
  }

  async function updateRule(card, forceStatus = null) {
    const id = card.dataset.ruleId;
    const existing = state.rules.find((rule) => rule.id === id);
    const ruleText = card.querySelector(".rule-card__text").value.trim();
    if (!ruleText) throw new Error("Rule wording cannot be blank.");
    await app.apiRequest(`/api/rules/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        pattern: existing.pattern,
        ruleText,
        status: forceStatus || card.querySelector(".rule-status").value,
        notes: card.querySelector(".rule-notes").value
      })
    });
    app.showToast(forceStatus === "archived" ? "Rule archived." : "Rule updated.");
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
    return `
      <article class="panel review-card" data-rule-id="${escapeHTML(rule.id)}">
        <div class="rule-card__meta"><span class="badge">${escapeHTML(rule.patternLabel)}</span><span>${rule.occurrenceCount} occurrences</span><span>Status: ${escapeHTML(rule.status)}</span></div>
        <h2>${escapeHTML(rule.ruleText)}</h2>
        ${rule.notes ? `<p>${escapeHTML(rule.notes)}</p>` : ""}
        <p class="muted">Last seen ${escapeHTML(rule.lastSeen)} · next review ${escapeHTML(rule.nextReviewAt || "today")}</p>
        <div class="review-responses">
          ${["still_weak", "partly_reliable", "reliable_today", "mastered", "skip"].map((response) => `<button class="button ${response === "reliable_today" ? "button--primary" : "button--ghost"}" type="button" data-review-response="${response}">${labelResponse(response)}</button>`).join("")}
        </div>
      </article>
    `;
  }

  async function loadReview() {
    state.review = await app.apiRequest("/api/rules/review?limit=10");
    document.getElementById("reviewDueBadge").textContent = `${state.review.due} due`;
    document.getElementById("reviewRulesList").innerHTML = state.review.rules.length
      ? state.review.rules.map(reviewCard).join("")
      : '<section class="panel v3-panel frequency-empty">No rules are due today.</section>';
  }

  async function submitReview(ruleId, response) {
    const rule = await app.apiRequest(`/api/rules/${encodeURIComponent(ruleId)}/reviews`, { method: "POST", body: JSON.stringify({ response }) });
    app.showToast(`${labelResponse(response)} · next review ${rule.nextReviewAt}.`);
    await loadReview();
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
    document.getElementById("backupDirectoryText").textContent = `${payload.directory} · keep ${payload.retention} · scheduled every ${payload.intervalHours || "disabled"}${payload.intervalHours ? " hours" : ""}`;
    document.getElementById("backupList").innerHTML = payload.backups.length ? payload.backups.map((backup) => `
      <article class="backup-row" data-backup-filename="${escapeHTML(backup.filename)}">
        <div><strong>${escapeHTML(backup.filename)}</strong><small>${escapeHTML(backup.modifiedAt.slice(0, 19).replace("T", " "))} · ${(backup.sizeBytes / 1024).toFixed(1)} KB · ${backup.valid ? `verified · ${backup.counts.forms} forms` : escapeHTML(backup.error)}</small></div>
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
  document.getElementById("personalRulesList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-rule-action]");
    const card = event.target.closest("[data-rule-id]");
    if (!button || !card) return;
    try {
      if (button.dataset.ruleAction === "save") await updateRule(card);
      if (button.dataset.ruleAction === "archive") await updateRule(card, "archived");
      if (button.dataset.ruleAction === "merge") await mergeRule(card, button.dataset.sourceRuleId);
      if (button.dataset.ruleAction === "source") {
        const rule = state.rules.find((item) => item.id === card.dataset.ruleId);
        await app.openFormQuestion(rule.sourceFormId, rule.sourceQuestionNumber);
      }
    } catch (error) { app.showToast(error.message); }
  });
  document.getElementById("ruleCandidatesList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-candidate-action='add']");
    const card = event.target.closest("[data-candidate-index]");
    if (button && card) addCandidate(Number(card.dataset.candidateIndex)).catch((error) => app.showToast(error.message));
  });
  document.getElementById("reviewRulesList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-response]");
    const card = event.target.closest("[data-rule-id]");
    if (button && card) submitReview(card.dataset.ruleId, button.dataset.reviewResponse).catch((error) => app.showToast(error.message));
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
