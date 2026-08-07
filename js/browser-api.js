(() => {
  "use strict";

  const DB_NAME = "ThunderShadowBrowserDB";
  const DB_VERSION = 1;
  const STORES = { forms: "forms", rules: "rules", settings: "settings", backups: "backups", meta: "meta" };
  const BACKUP_VERSION = 6;
  const SCHEMA_VERSION = 1;
  const BACKUP_RETENTION = 14;
  const BACKUP_INTERVAL_HOURS = 24;
  const MAX_FORM_LENGTH = 1000;
  const MAX_ENTRY_NUMBER = 2147483647;
  const ZOOM_LEVELS = new Set([80, 85, 90, 95, 100, 105, 110, 115, 120]);
  const ERROR_CODES = new Set(["1", "2", "3", "4", "5", "6", "7"]);
  const { PATTERNS, SPEED_FLAGS, PATTERN_VALUES, SPEED_VALUES, canonicalPattern, canonicalSpeedFlags } = window.ThunderShadowReasoning;
  const { calculateAnalytics, findRuleDuplicates, nextReviewSchedule, normalizedRuleText } = window.ThunderShadowAnalytics;
  const PATTERN_LABELS = new Map(PATTERNS.map((item) => [item.value, `${item.code} — ${item.label}`]));
  const SPEED_LABELS = new Map(SPEED_FLAGS.map((item) => [item.value, `${item.code} — ${item.label}`]));
  const restorePreviews = new Map();
  let scheduledBackupChecked = false;

  const nowISO = () => new Date().toISOString();
  const uuid = () => (window.ThunderShadowUUID ? window.ThunderShadowUUID() : crypto.randomUUID());
  const deepClone = (value) => value == null ? value : structuredClone(value);
  const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value, null, 2));
  const byteLength = (value) => jsonBytes(value).byteLength;

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.forms)) db.createObjectStore(STORES.forms, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORES.rules)) db.createObjectStore(STORES.rules, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: "key" });
        if (!db.objectStoreNames.contains(STORES.backups)) db.createObjectStore(STORES.backups, { keyPath: "filename" });
        if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open browser storage."));
    });
  }

  async function withStore(storeName, mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let request;
      try { request = operation(store); }
      catch (error) { db.close(); reject(error); return; }
      if (request && typeof request.onsuccess !== "undefined") {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || tx.error || new Error("Storage operation failed."));
      } else {
        tx.oncomplete = () => resolve(request);
      }
      tx.onerror = () => reject(tx.error || new Error("Storage transaction failed."));
      tx.onabort = () => reject(tx.error || new Error("Storage transaction was aborted."));
      tx.oncomplete = () => { db.close(); if (!request || typeof request.onsuccess === "undefined") resolve(request); };
    }).finally(() => { try { db.close(); } catch {} });
  }

  const get = (store, key) => withStore(store, "readonly", (s) => s.get(key));
  const getAll = (store) => withStore(store, "readonly", (s) => s.getAll());
  const put = (store, value) => withStore(store, "readwrite", (s) => s.put(deepClone(value)));
  const del = (store, key) => withStore(store, "readwrite", (s) => s.delete(key));
  const clear = (store) => withStore(store, "readwrite", (s) => s.clear());

  async function getMeta(key, fallback = null) {
    const record = await get(STORES.meta, key).catch(() => null);
    return record?.value ?? fallback;
  }
  async function setMeta(key, value) { await put(STORES.meta, { key, value }); return value; }
  async function getSetting(key, fallback = null) {
    const record = await get(STORES.settings, key).catch(() => null);
    return record?.value ?? fallback;
  }
  async function setSetting(key, value) { await put(STORES.settings, { key, value, updatedAt: nowISO() }); return value; }

  function blankEntry(number) {
    return { number, entryNumber: number, originalQuestionNumber: null, errorCode: "", pattern: "", speedFlags: [], reasoningNote: "", manualRule: "", deleted: false, createdAt: null, updatedAt: null, revision: 0 };
  }

  function isLogged(entry) {
    return Boolean(entry && !entry.deleted && (entry.errorCode || entry.pattern || entry.reasoningNote?.trim() || entry.manualRule?.trim() || entry.speedFlags?.length));
  }

  function normalizeEntry(input, number = Number(input?.entryNumber || input?.number || 1)) {
    const rawPattern = typeof input?.pattern === "string" ? input.pattern : "";
    const pattern = canonicalPattern(rawPattern);
    const rawSpeed = Array.isArray(input?.speedFlags) ? input.speedFlags : [];
    const speedFlags = canonicalSpeedFlags(rawSpeed, rawPattern).filter((value) => SPEED_VALUES.has(value));
    const errorCode = typeof input?.errorCode === "string" && ERROR_CODES.has(input.errorCode) ? input.errorCode : "";
    const reasoningNote = String(input?.reasoningNote ?? input?.manualRule ?? "").slice(0, 12000);
    return {
      ...blankEntry(number),
      ...deepClone(input || {}),
      number,
      entryNumber: number,
      originalQuestionNumber: input?.originalQuestionNumber ?? null,
      errorCode,
      pattern: PATTERN_VALUES.has(pattern) ? pattern : "",
      speedFlags: [...new Set(speedFlags)],
      reasoningNote,
      manualRule: reasoningNote,
      deleted: Boolean(input?.deleted),
      revision: Number.isSafeInteger(input?.revision) && input.revision >= 0 ? input.revision : 0,
      createdAt: typeof input?.createdAt === "string" ? input.createdAt : null,
      updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : null
    };
  }

  function normalizeForm(input, existing = null) {
    if (!input || typeof input !== "object") throw new Error("Form payload must be an object.");
    const id = String(existing?.id || input.id || "").trim();
    if (!id || id.length > 128) throw new Error("Form id is invalid.");
    const name = String(input.name ?? existing?.name ?? "").trim();
    if (!name || name.length > 80) throw new Error("Form name must contain 1–80 characters.");
    const subject = String(input.subject ?? existing?.subject ?? "").trim().slice(0, 80);
    const examType = String(input.examType ?? existing?.examType ?? "").trim().slice(0, 80);
    const date = String(input.date ?? existing?.date ?? nowISO().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must use YYYY-MM-DD format.");
    let originalFormLength = input.originalFormLength ?? input.questionCount ?? existing?.originalFormLength ?? null;
    if (originalFormLength === "" || originalFormLength == null) originalFormLength = null;
    else {
      originalFormLength = Number(originalFormLength);
      if (!Number.isInteger(originalFormLength) || originalFormLength < 1 || originalFormLength > MAX_FORM_LENGTH) throw new Error("Original form length must be 1–1000.");
    }
    let expectedScreenshotCount = input.expectedScreenshotCount ?? existing?.expectedScreenshotCount ?? null;
    if (expectedScreenshotCount === "" || expectedScreenshotCount == null) expectedScreenshotCount = null;
    else {
      expectedScreenshotCount = Number(expectedScreenshotCount);
      if (!Number.isInteger(expectedScreenshotCount) || expectedScreenshotCount < 0 || expectedScreenshotCount > MAX_FORM_LENGTH) throw new Error("Expected screenshot count must be 0–1000.");
    }
    const sourceEntries = input.entries ?? input.questions ?? existing?.entries ?? [];
    const entries = Array.isArray(sourceEntries) ? sourceEntries.map((entry, index) => normalizeEntry(entry, Number(entry?.entryNumber || entry?.number || index + 1))).sort((a, b) => a.entryNumber - b.entryNumber) : [];
    const maxFromEntries = entries.length ? Math.max(...entries.map((entry) => entry.entryNumber)) : 0;
    const maxEntryNumber = Math.max(Number(existing?.maxEntryNumber || 0), Number(input.maxEntryNumber || 0), maxFromEntries);
    const currentEntry = Math.max(1, Number(input.currentEntry ?? input.currentQuestion ?? existing?.currentEntry ?? entries.at(-1)?.entryNumber ?? 1));
    const createdAt = existing?.createdAt || input.createdAt || nowISO();
    const updatedAt = input.updatedAt || nowISO();
    const revision = Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : Number(existing?.revision || 0);
    return {
      id, name, subject, examType, date, originalFormLength, expectedScreenshotCount,
      questionCount: originalFormLength || 1, currentQuestion: currentEntry, currentEntry,
      finished: Boolean(input.finished ?? input.isFinished ?? existing?.finished), maxEntryNumber,
      createdAt, updatedAt, revision, entries, questions: entries
    };
  }

  function normalizeRule(input, existing = null) {
    if (!input || typeof input !== "object") throw new Error("Rule payload must be an object.");
    const id = String(existing?.id || input.id || uuid());
    const pattern = canonicalPattern(input.pattern ?? existing?.pattern ?? "");
    if (!PATTERN_VALUES.has(pattern)) throw new Error("Canonical rule pattern is not recognized.");
    const ruleText = String(input.ruleText ?? existing?.ruleText ?? "").trim();
    if (!ruleText || ruleText.length > 12000) throw new Error("Rule text must contain 1–12000 characters.");
    const statuses = new Set(["new", "active", "improving", "mastered", "archived"]);
    const status = String(input.status ?? existing?.status ?? "new");
    if (!statuses.has(status)) throw new Error("Rule status is not recognized.");
    const notes = String(input.notes ?? existing?.notes ?? "").slice(0, 12000);
    const createdAt = existing?.createdAt || input.createdAt || nowISO();
    return {
      id, pattern, patternLabel: PATTERN_LABELS.get(pattern), ruleText,
      sourceFormId: input.sourceFormId ?? existing?.sourceFormId ?? null,
      sourceQuestionNumber: input.sourceQuestionNumber ?? existing?.sourceQuestionNumber ?? null,
      status, notes, nextReviewAt: input.nextReviewAt ?? existing?.nextReviewAt ?? nowISO().slice(0, 10),
      successfulReviews: Number(input.successfulReviews ?? existing?.successfulReviews ?? 0) || 0,
      aliases: Array.isArray(input.aliases) ? deepClone(input.aliases) : deepClone(existing?.aliases || []),
      reviewHistory: Array.isArray(input.reviewHistory) ? deepClone(input.reviewHistory) : deepClone(existing?.reviewHistory || []),
      createdAt, updatedAt: input.updatedAt ?? existing?.updatedAt ?? nowISO()
    };
  }

  function formSort(forms) { return forms.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))); }
  async function allForms() { return formSort((await getAll(STORES.forms)).map((form) => normalizeForm(form, form))); }
  async function allStoredRules() { return (await getAll(STORES.rules)).map((rule) => deepClone(rule)); }

  function ruleOccurrences(rule, forms) {
    const identities = [{ pattern: rule.pattern, text: normalizedRuleText(rule.ruleText) }, ...(rule.aliases || []).map((alias) => ({ pattern: canonicalPattern(alias.pattern), text: normalizedRuleText(alias.ruleText) }))];
    const matches = [];
    for (const form of forms) {
      for (const entry of form.entries || []) {
        if (entry.deleted || !String(entry.reasoningNote || "").trim()) continue;
        const normalized = normalizedRuleText(entry.reasoningNote);
        if (identities.some((identity) => identity.pattern === canonicalPattern(entry.pattern) && identity.text === normalized)) {
          matches.push({ formId: form.id, formName: form.name, date: form.date, questionNumber: entry.entryNumber, entryNumber: entry.entryNumber });
        }
      }
    }
    return matches.sort((a, b) => a.date.localeCompare(b.date) || a.entryNumber - b.entryNumber);
  }

  async function hydrateRule(rule, forms = null) {
    const all = forms || await allForms();
    const occurrences = ruleOccurrences(rule, all);
    return {
      ...deepClone(rule), patternLabel: PATTERN_LABELS.get(rule.pattern), occurrenceCount: occurrences.length,
      firstSeen: occurrences[0]?.date || String(rule.createdAt || nowISO()).slice(0, 10),
      lastSeen: occurrences.at(-1)?.date || String(rule.createdAt || nowISO()).slice(0, 10),
      occurrences
    };
  }

  async function allHydratedRules() {
    const forms = await allForms();
    const stored = await allStoredRules();
    const hydrated = [];
    for (const rule of stored) hydrated.push(await hydrateRule(rule, forms));
    return hydrated.sort((a, b) => (a.status === "archived") - (b.status === "archived") || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async function ruleCandidates() {
    const forms = await allForms();
    const rules = await allStoredRules();
    const known = new Set();
    for (const rule of rules) {
      known.add(`${rule.pattern}\n${normalizedRuleText(rule.ruleText)}`);
      for (const alias of rule.aliases || []) known.add(`${canonicalPattern(alias.pattern)}\n${normalizedRuleText(alias.ruleText)}`);
    }
    const candidates = [];
    for (const form of forms) {
      for (const entry of form.entries || []) {
        if (entry.deleted || !entry.pattern || !String(entry.reasoningNote || "").trim()) continue;
        const key = `${canonicalPattern(entry.pattern)}\n${normalizedRuleText(entry.reasoningNote)}`;
        if (known.has(key) || candidates.some((item) => item.key === key)) continue;
        candidates.push({ key, pattern: canonicalPattern(entry.pattern), patternLabel: PATTERN_LABELS.get(canonicalPattern(entry.pattern)), ruleText: entry.reasoningNote, sourceFormId: form.id, sourceFormName: form.name, sourceQuestionNumber: entry.entryNumber, sourceDate: form.date });
      }
    }
    return candidates.sort((a, b) => b.sourceDate.localeCompare(a.sourceDate)).map(({ key, ...rest }) => rest);
  }

  async function duplicateMatches(candidate, rules = null, excludeId = null) {
    const hydrated = rules || await allHydratedRules();
    const comparisons = hydrated.filter((rule) => !excludeId || rule.id !== excludeId).flatMap((rule) => [rule, ...(rule.aliases || []).map((alias) => ({ ...rule, pattern: canonicalPattern(alias.pattern), ruleText: alias.ruleText }))]);
    const matches = findRuleDuplicates(candidate, comparisons);
    const unique = (items) => [...new Map(items.map((item) => [item.id, item])).values()];
    return { exact: unique(matches.exact), near: unique(matches.near) };
  }

  function tsvEscape(value, preserveLines = false) {
    const clean = String(value ?? "").replace(/\t/g, " ");
    return (preserveLines ? clean.replace(/\r\n?|\n/g, "<br>") : clean.replace(/\r?\n/g, " ")).trim();
  }
  function safeFilename(value) {
    const safe = String(value || "ThunderShadow").normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
    return safe || "ThunderShadow";
  }
  function formToTsv(form) {
    const headers = ["Form", "Date", "Entry_Number", "Error_Code", "Rule_Pattern", "Speed_Flags", "Reasoning_Note"];
    const rows = (form.entries || []).filter(isLogged).sort((a, b) => a.entryNumber - b.entryNumber).map((entry) => [
      form.name, form.date, entry.entryNumber, entry.errorCode, PATTERN_LABELS.get(entry.pattern) || "",
      (entry.speedFlags || []).map((flag) => SPEED_LABELS.get(flag) || flag).join(" | "), tsvEscape(entry.reasoningNote, true)
    ].map((value, index) => index === 6 ? value : tsvEscape(value)).join("\t"));
    return [headers.join("\t"), ...rows].join("\n");
  }
  function allFormsToTsv(forms) { return ["Form\tDate\tEntry_Number\tError_Code\tRule_Pattern\tSpeed_Flags\tReasoning_Note", ...forms.flatMap((form) => formToTsv(form).split("\n").slice(1))].join("\n"); }
  function activeRulesTsv(rules) {
    const headers = ["Rule_ID", "Canonical_Pattern", "Rule_Text", "Status", "Occurrence_Count", "First_Seen", "Last_Seen", "Next_Review", "Notes"];
    const rows = rules.filter((rule) => rule.status !== "archived").map((rule) => [rule.id, rule.patternLabel, rule.ruleText, rule.status, rule.occurrenceCount, rule.firstSeen, rule.lastSeen, rule.nextReviewAt || "", rule.notes].map((value) => tsvEscape(value)).join("\t"));
    return [headers.join("\t"), ...rows].join("\n");
  }
  function analysisMarkdown(analytics, rules) {
    const lines = [
      "# ThunderShadow ChatGPT Analysis Package", "", `Generated: ${analytics.generatedAt}`, "", "## Database summary",
      `- Forms: ${analytics.summary.forms}`, `- Logged questions: ${analytics.summary.loggedQuestions}`, `- Error-coded questions: ${analytics.summary.errorCodedQuestions}`,
      `- Wrong answers (codes 1–4): ${analytics.summary.wrongAnswers}`, `- Unstable correct answers (codes 5–7): ${analytics.summary.unstableCorrect}`, "", "## Error frequencies",
      ...analytics.errors.map((item) => `- Code ${item.id} — ${item.label}: ${item.count} (${item.percentage}%)`), "", "## Rule-pattern frequencies",
      ...analytics.patterns.map((item) => { const topError = item.associatedErrorCodes[0], topSpeed = item.associatedSpeedFlags[0], subjects = item.representativeSubjects.map((subject) => subject.label).join(", ") || "none"; return `- ${item.code} — ${item.label}: ${item.level.label}; ${item.count} entries (${item.percentage}% of pattern-coded) across ${item.formCount} forms; top Error Code ${topError ? `${topError.id} (${topError.count})` : "none"}; top Speed Flag ${topSpeed ? `${topSpeed.label} (${topSpeed.count})` : "none"}; subjects/topics ${subjects}; trend ${item.trend.direction}; Fix: ${item.correctiveAction}`; }),
      "", "## Speed frequencies", ...analytics.speed.map((item) => `- ${item.label}: ${item.count}`), "", "## Cross-form trends",
      ...analytics.recentTrend.map((item) => `- ${item.date} — ${item.formName}: logged ${item.logged}, wrong ${item.wrong}, unstable correct ${item.unstable}`), "", "## Active rules",
      ...rules.filter((rule) => rule.status !== "archived").map((rule) => `- [${rule.status}] ${rule.ruleText} (${rule.patternLabel}; ${rule.occurrenceCount} exact occurrences; next review ${rule.nextReviewAt || "unscheduled"})`),
      "", "## Recurring combinations", ...(analytics.combinations.length ? analytics.combinations.map((item) => `- ${item.label}: ${item.count}`) : ["- None in the selected data."]),
      "", "## Ready-to-use analysis prompt", "Analyze this local NBME/CMS reasoning log. Prioritize recurring, recent weaknesses; distinguish wrong answers from unstable correct answers; compare the displayed earlier and recent counts before describing improvement; treat combinations as descriptive associations rather than causes. Recommend a short list of concrete reasoning rules to review without inventing clinical facts or adding new logging fields."
    ];
    return lines.join("\n");
  }

  async function tombstones() {
    const stored = await getMeta("tombstones", { forms: {}, rules: {}, entries: {} });
    return { forms: { ...(stored?.forms || {}) }, rules: { ...(stored?.rules || {}) }, entries: { ...(stored?.entries || {}) } };
  }
  async function markDeleted(kind, id, timestamp = nowISO()) {
    const value = await tombstones();
    const bucket = kind === "form" ? value.forms : kind === "rule" ? value.rules : value.entries;
    if (!bucket[id] || bucket[id] < timestamp) bucket[id] = timestamp;
    await setMeta("tombstones", value);
  }
  async function clearTombstone(kind, id) {
    const value = await tombstones();
    const bucket = kind === "form" ? value.forms : kind === "rule" ? value.rules : value.entries;
    if (bucket[id]) { delete bucket[id]; await setMeta("tombstones", value); }
  }

  async function exportPackage({ includeBrowserSettings = true } = {}) {
    const forms = await allForms();
    const rules = await allHydratedRules();
    const settings = includeBrowserSettings ? { uiScale: Number(await getSetting("ui_scale", 100)) || 100 } : {};
    return { app: "ThunderShadow", version: BACKUP_VERSION, storage: "browser-indexeddb", exportedAt: nowISO(), schemaVersion: SCHEMA_VERSION, forms, rules, settings, tombstones: await tombstones() };
  }

  function previewPackage(payload) {
    const forms = Array.isArray(payload?.forms) ? payload.forms : [];
    const rules = Array.isArray(payload?.rules) ? payload.rules : [];
    const validForms = forms.filter((form) => form && typeof form === "object");
    const validRules = rules.filter((rule) => rule && typeof rule === "object");
    return { integrity: "verified JSON", schemaVersion: payload?.schemaVersion || 1, counts: { forms: validForms.length, questionLogs: validForms.reduce((sum, form) => sum + (Array.isArray(form.entries) ? form.entries.length : (Array.isArray(form.questions) ? form.questions.length : 0)), 0), rules: validRules.length, reviews: validRules.reduce((sum, rule) => sum + (Array.isArray(rule.reviewHistory) ? rule.reviewHistory.length : 0), 0) } };
  }

  function validateBackupPayload(payload) {
    if (!payload || typeof payload !== "object" || payload.app !== "ThunderShadow" || !Array.isArray(payload.forms)) throw new Error("This is not a valid ThunderShadow backup.");
    if (payload.version != null && ![1, 2, 3, 4, 5, 6].includes(Number(payload.version))) throw new Error(`Backup version ${payload.version} is not supported.`);
    return payload;
  }

  async function replacePackage(payload, { preserveBackups = true } = {}) {
    validateBackupPayload(payload);
    const forms = payload.forms
      .filter((form) => form && typeof form === "object" && form.id)
      .map((form) => {
        const rawEntries = Array.isArray(form.entries) ? form.entries : (Array.isArray(form.questions) ? form.questions : []);
        return normalizeForm({ ...form, entries: rawEntries.filter((entry) => entry && typeof entry === "object").map((entry) => normalizeEntry(entry)) });
      });
    const rules = Array.isArray(payload.rules) ? payload.rules
      .filter((rule) => rule && typeof rule === "object")
      .map((rule) => normalizeRule({ ...rule, pattern: canonicalPattern(rule.pattern), aliases: Array.isArray(rule.aliases) ? rule.aliases : [], reviewHistory: Array.isArray(rule.reviewHistory) ? rule.reviewHistory : [] }, null)) : [];
    await clear(STORES.forms); await clear(STORES.rules);
    for (const form of forms) await put(STORES.forms, form);
    for (const rule of rules) await put(STORES.rules, rule);
    if (payload.settings?.uiScale && ZOOM_LEVELS.has(Number(payload.settings.uiScale))) await setSetting("ui_scale", Number(payload.settings.uiScale));
    await setMeta("tombstones", { forms: { ...(payload.tombstones?.forms || {}) }, rules: { ...(payload.tombstones?.rules || {}) }, entries: { ...(payload.tombstones?.entries || {}) } });
    if (!preserveBackups) await clear(STORES.backups);
    return { restored: forms.length, rulesRestored: rules.length };
  }

  function objectTimestamp(value) { return String(value?.updatedAt || value?.createdAt || ""); }
  function newer(a, b) { return objectTimestamp(a) >= objectTimestamp(b) ? a : b; }
  function mergeEntries(aEntries = [], bEntries = []) {
    const map = new Map();
    for (const entry of [...aEntries, ...bEntries]) {
      const n = Number(entry.entryNumber || entry.number);
      const normalized = normalizeEntry(entry, n);
      const prior = map.get(n);
      if (!prior || objectTimestamp(normalized) > objectTimestamp(prior) || (objectTimestamp(normalized) === objectTimestamp(prior) && normalized.revision >= prior.revision)) map.set(n, normalized);
    }
    return [...map.values()].sort((a, b) => a.entryNumber - b.entryNumber);
  }
  function mergeForms(a, b, entryTombstones = {}, formId = a?.id || b?.id) {
    if (!a && !b) return null;

    // Cross-device sync can legitimately merge a form that exists on only one
    // device. Older Safari/iOS snapshots can also contain sparse/null records.
    // Normalize each side defensively and never dereference a missing peer.
    const left = a && typeof a === "object" ? normalizeForm(a, a) : null;
    const right = b && typeof b === "object" ? normalizeForm(b, b) : null;
    if (!left && !right) return null;

    const base = deepClone(left && right ? newer(left, right) : (left || right));
    const resolvedFormId = formId || base?.id || left?.id || right?.id || "";
    const entries = mergeEntries(
      left?.entries || left?.questions || [],
      right?.entries || right?.questions || []
    ).filter((entry) => objectTimestamp(entry) > (entryTombstones?.[`${resolvedFormId}:${entry.entryNumber}`] || ""));

    base.entries = entries;
    base.questions = entries;
    const lastEntryNumber = entries.length ? Number(entries[entries.length - 1]?.entryNumber || 0) : 0;
    base.maxEntryNumber = Math.max(
      Number(left?.maxEntryNumber || 0),
      Number(right?.maxEntryNumber || 0),
      lastEntryNumber
    );
    base.revision = Math.max(Number(left?.revision || 0), Number(right?.revision || 0));

    const leftTs = objectTimestamp(left);
    const rightTs = objectTimestamp(right);
    base.updatedAt = leftTs >= rightTs
      ? (left?.updatedAt || left?.createdAt || base.updatedAt || base.createdAt)
      : (right?.updatedAt || right?.createdAt || base.updatedAt || base.createdAt);

    return normalizeForm(base, base);
  }
  function mergeRuleObjects(a, b) {
    if (!a) return deepClone(b);
    if (!b) return deepClone(a);
    const base = deepClone(newer(a, b));
    const aliasMap = new Map();
    for (const alias of [...(a.aliases || []), ...(b.aliases || [])]) aliasMap.set(`${canonicalPattern(alias.pattern)}\n${normalizedRuleText(alias.ruleText)}`, { pattern: canonicalPattern(alias.pattern), ruleText: alias.ruleText });
    const reviewMap = new Map();
    for (const review of [...(a.reviewHistory || []), ...(b.reviewHistory || [])]) reviewMap.set(review.id || `${review.reviewedAt}:${review.response}`, deepClone(review));
    base.aliases = [...aliasMap.values()]; base.reviewHistory = [...reviewMap.values()].sort((x, y) => String(y.reviewedAt || "").localeCompare(String(x.reviewedAt || "")));
    base.successfulReviews = Math.max(Number(a.successfulReviews || 0), Number(b.successfulReviews || 0));
    return base;
  }

  async function mergePackage(remotePayload) {
    validateBackupPayload(remotePayload);
    const local = await exportPackage();
    const combinedTombstones = { forms: { ...(local.tombstones?.forms || {}) }, rules: { ...(local.tombstones?.rules || {}) }, entries: { ...(local.tombstones?.entries || {}) } };
    for (const [id, ts] of Object.entries(remotePayload.tombstones?.forms || {})) if (!combinedTombstones.forms[id] || combinedTombstones.forms[id] < ts) combinedTombstones.forms[id] = ts;
    for (const [id, ts] of Object.entries(remotePayload.tombstones?.rules || {})) if (!combinedTombstones.rules[id] || combinedTombstones.rules[id] < ts) combinedTombstones.rules[id] = ts;
    for (const [id, ts] of Object.entries(remotePayload.tombstones?.entries || {})) if (!combinedTombstones.entries[id] || combinedTombstones.entries[id] < ts) combinedTombstones.entries[id] = ts;

    const localForms = new Map((local.forms || []).filter((form) => form && typeof form === "object" && form.id).map((form) => [form.id, form]));
    const remoteForms = new Map((remotePayload.forms || [])
      .filter((form) => form && typeof form === "object" && form.id)
      .map((form) => [form.id, normalizeForm(form, form)]));
    const mergedForms = [];
    for (const id of new Set([...localForms.keys(), ...remoteForms.keys(), ...Object.keys(combinedTombstones.forms)])) {
      const merged = mergeForms(localForms.get(id), remoteForms.get(id), combinedTombstones.entries, id);
      const deletedAt = combinedTombstones.forms[id] || "";
      if (merged && objectTimestamp(merged) > deletedAt) mergedForms.push(merged);
    }

    const localRules = new Map((local.rules || []).filter((rule) => rule && typeof rule === "object" && rule.id).map((rule) => [rule.id, rule]));
    const remoteRules = new Map((remotePayload.rules || []).filter((rule) => rule && typeof rule === "object" && rule.id).map((rule) => [rule.id, rule]));
    const mergedRules = [];
    for (const id of new Set([...localRules.keys(), ...remoteRules.keys(), ...Object.keys(combinedTombstones.rules)])) {
      const merged = mergeRuleObjects(localRules.get(id), remoteRules.get(id));
      const deletedAt = combinedTombstones.rules[id] || "";
      if (merged && objectTimestamp(merged) > deletedAt) mergedRules.push(merged);
    }

    const mergedPayload = { app: "ThunderShadow", version: BACKUP_VERSION, storage: "browser-indexeddb", exportedAt: nowISO(), schemaVersion: SCHEMA_VERSION, forms: mergedForms, rules: mergedRules, settings: local.settings, tombstones: combinedTombstones };
    await replacePackage(mergedPayload);
    return exportPackage();
  }

  function backupName(type = "manual") { return `ThunderShadow_Browser_${type}_${nowISO().replace(/[:.]/g, "-")}.json`; }
  async function createSnapshot(type = "manual") {
    const payload = await exportPackage();
    const filename = backupName(type);
    const record = { filename, type, modifiedAt: nowISO(), createdAt: nowISO(), valid: true, sizeBytes: byteLength(payload), counts: previewPackage(payload).counts, payload };
    await put(STORES.backups, record);
    const backups = (await getAll(STORES.backups)).sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
    for (const old of backups.slice(BACKUP_RETENTION)) await del(STORES.backups, old.filename);
    await setMeta("last_backup_at", record.modifiedAt);
    return record;
  }
  async function maybeScheduledBackup() {
    if (scheduledBackupChecked) return;
    scheduledBackupChecked = true;
    const last = await getMeta("last_backup_at", null);
    if (!last || Date.now() - Date.parse(last) >= BACKUP_INTERVAL_HOURS * 3600_000) await createSnapshot("scheduled").catch(() => {});
  }

  function base64FromBytes(bytes) { let binary = ""; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk)); return btoa(binary); }
  function bytesFromBase64(text) { const binary = atob(text); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return bytes; }
  async function derivePortableKey(passphrase, salt, iterations) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encryptPortable(payload, passphrase) {
    if (String(passphrase || "").length < 8) throw new Error("Enter a passphrase of at least 8 characters.");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const iterations = 240000;
    const key = await derivePortableKey(passphrase, salt, iterations);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
    return new TextEncoder().encode(JSON.stringify({ app: "ThunderShadow", format: "tsbackup-browser-v2", version: 2, exportedAt: nowISO(), kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: base64FromBytes(salt) }, cipher: { name: "AES-GCM", iv: base64FromBytes(iv) }, data: base64FromBytes(ciphertext) }));
  }
  async function decryptPortable(buffer, passphrase) {
    let envelope;
    try { envelope = JSON.parse(new TextDecoder().decode(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer))); }
    catch { throw new Error("This encrypted archive is not a browser-edition ThunderShadow archive. Older SQLite/scrypt .tsbackup files must first be restored in the Mac version and exported as JSON."); }
    if (envelope?.app !== "ThunderShadow" || envelope?.format !== "tsbackup-browser-v2") throw new Error("Unsupported encrypted backup format.");
    const salt = bytesFromBase64(envelope.kdf.salt), iv = bytesFromBase64(envelope.cipher.iv), ciphertext = bytesFromBase64(envelope.data);
    try {
      const key = await derivePortableKey(passphrase, salt, Number(envelope.kdf.iterations));
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
      return validateBackupPayload(JSON.parse(new TextDecoder().decode(plaintext)));
    } catch { throw new Error("Passphrase is incorrect or the encrypted archive is damaged."); }
  }

  function jsonResponse(data, status = 200, headers = {}) { return new Response(data == null ? null : JSON.stringify(data), { status, headers: { ...(data == null ? {} : { "Content-Type": "application/json; charset=utf-8" }), ...headers } }); }
  function textResponse(text, contentType, filename = null, status = 200) { const headers = { "Content-Type": contentType }; if (filename) headers["Content-Disposition"] = `attachment; filename="${safeFilename(filename)}"`; return new Response(text, { status, headers }); }
  function bytesResponse(bytes, contentType, filename) { return new Response(bytes, { status: 200, headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${safeFilename(filename)}"` } }); }
  function errorResponse(error, status = 400, code = "BROWSER_API_ERROR") { return jsonResponse({ error: { code, message: error?.message || String(error) } }, status); }
  async function parseBody(options = {}) {
    const body = options.body;
    if (body == null || body === "") return {};
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body instanceof ArrayBuffer ? body : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    if (typeof body === "object") return deepClone(body);
    try { return JSON.parse(body); } catch { return body; }
  }
  function routePath(path) { return new URL(path, location.href); }
  function match(pathname, regex) { const m = pathname.match(regex); return m ? m.slice(1).map(decodeURIComponent) : null; }
  function notifyMutation(kind, detail = {}) {
    window.dispatchEvent(new CustomEvent("thundershadow-local-data-changed", { detail: { kind, ...detail, at: nowISO() } }));
    window.ThunderShadowDrive?.scheduleSync?.();
  }

  async function request(path, options = {}) {
    await maybeScheduledBackup();
    const url = routePath(path);
    const pathname = url.pathname.replace(/\/+/g, "/");
    const method = String(options.method || "GET").toUpperCase();
    try {
      if (pathname.endsWith("/api/forms") && method === "GET") return jsonResponse(await allForms());
      if (pathname.endsWith("/api/forms") && method === "POST") {
        const body = await parseBody(options); if (await get(STORES.forms, body.id)) return errorResponse(new Error("A form with that id already exists."), 409, "CONFLICT");
        const form = normalizeForm({ ...body, revision: 1, createdAt: nowISO(), updatedAt: nowISO() }); await put(STORES.forms, form); await clearTombstone("form", form.id); notifyMutation("form.created", { formId: form.id }); return jsonResponse(form, 201);
      }

      let m = match(pathname, /\/api\/forms\/([^/]+)$/);
      if (m) {
        const [id] = m; const form = await get(STORES.forms, id); if (!form) return errorResponse(new Error("Form not found."), 404, "NOT_FOUND");
        if (method === "GET") return jsonResponse(normalizeForm(form, form));
        if (method === "PUT") { const body = await parseBody(options); const saved = normalizeForm({ ...form, ...body, id, entries: form.entries, questions: form.entries, revision: Number(form.revision || 0) + 1, updatedAt: nowISO() }, form); await put(STORES.forms, saved); notifyMutation("form.updated", { formId: id }); return jsonResponse(saved); }
        if (method === "DELETE") { await del(STORES.forms, id); await markDeleted("form", id); notifyMutation("form.deleted", { formId: id }); return new Response(null, { status: 204 }); }
      }

      m = match(pathname, /\/api\/forms\/([^/]+)\/(?:entries|questions)$/);
      if (m) {
        const [formId] = m; const form = await get(STORES.forms, formId); if (!form) return errorResponse(new Error("Form not found."), 404, "NOT_FOUND");
        if (method === "GET") return jsonResponse((form.entries || []).map((entry) => normalizeEntry(entry)));
        if (method === "POST") {
          const entries = (form.entries || []).map((entry) => normalizeEntry(entry)); const active = entries.filter((entry) => !entry.deleted); const last = active.at(-1); const trailing = last && !isLogged(last) ? last : null;
          form.entries = entries.filter((entry) => entry.deleted || isLogged(entry) || entry === trailing);
          if (trailing) { form.questions = form.entries; await put(STORES.forms, form); return jsonResponse(trailing); }
          const n = Math.max(Number(form.maxEntryNumber || 0), ...entries.map((entry) => entry.entryNumber), 0) + 1; if (n > MAX_ENTRY_NUMBER) throw new Error("Entry number limit reached.");
          const timestamp = nowISO(); const entry = { ...blankEntry(n), createdAt: timestamp, updatedAt: timestamp, revision: 1 };
          form.entries.push(entry); form.entries.sort((a, b) => a.entryNumber - b.entryNumber); form.questions = form.entries; form.maxEntryNumber = n; form.currentEntry = n; form.currentQuestion = n; form.updatedAt = timestamp;
          await put(STORES.forms, form); notifyMutation("entry.created", { formId, entryNumber: n }); return jsonResponse(entry, 201);
        }
      }

      m = match(pathname, /\/api\/forms\/([^/]+)\/(?:entries|questions)\/(\d+)$/);
      if (m) {
        const [formId, nText] = m, n = Number(nText); const form = await get(STORES.forms, formId); if (!form) return errorResponse(new Error("Form not found."), 404, "NOT_FOUND");
        let entries = (form.entries || []).map((entry) => normalizeEntry(entry)); let index = entries.findIndex((entry) => entry.entryNumber === n);
        if (method === "GET") return jsonResponse(index >= 0 ? entries[index] : blankEntry(n));
        if (method === "PUT") {
          if (index < 0) {
            while (Number(form.maxEntryNumber || 0) < n) { const next = Number(form.maxEntryNumber || 0) + 1; entries.push({ ...blankEntry(next), createdAt: nowISO(), updatedAt: nowISO(), revision: 0 }); form.maxEntryNumber = next; }
            index = entries.findIndex((entry) => entry.entryNumber === n);
          }
          const existing = entries[index]; const body = await parseBody(options); const saved = normalizeEntry({ ...existing, ...body, entryNumber: n, number: n, deleted: existing.deleted, revision: Number(existing.revision || 0) + 1, createdAt: existing.createdAt || nowISO(), updatedAt: nowISO() }, n);
          entries[index] = saved; form.entries = entries.sort((a, b) => a.entryNumber - b.entryNumber); form.questions = form.entries; form.currentEntry = n; form.currentQuestion = n; form.updatedAt = nowISO(); await put(STORES.forms, form); notifyMutation("entry.updated", { formId, entryNumber: n }); return jsonResponse(saved);
        }
        if (method === "DELETE") {
          if (index < 0) return errorResponse(new Error("Entry not found."), 404, "NOT_FOUND"); const entry = entries[index]; entry.deleted = true; entry.revision = Number(entry.revision || 0) + 1; entry.updatedAt = nowISO(); entries[index] = entry; form.entries = entries; form.questions = entries; form.updatedAt = nowISO(); await put(STORES.forms, form); notifyMutation("entry.deleted", { formId, entryNumber: n }); return new Response(null, { status: 204 });
        }
      }

      m = match(pathname, /\/api\/forms\/([^/]+)\/entries\/(\d+)\/restore$/);
      if (m && method === "POST") {
        const [formId, nText] = m, n = Number(nText); const form = await get(STORES.forms, formId); if (!form) return errorResponse(new Error("Form not found."), 404, "NOT_FOUND"); const entries = (form.entries || []).map((entry) => normalizeEntry(entry)); const index = entries.findIndex((entry) => entry.entryNumber === n); if (index < 0) return errorResponse(new Error("Entry not found."), 404, "NOT_FOUND"); entries[index].deleted = false; entries[index].revision += 1; entries[index].updatedAt = nowISO(); form.entries = entries; form.questions = entries; form.updatedAt = nowISO(); await put(STORES.forms, form); notifyMutation("entry.restored", { formId, entryNumber: n }); return jsonResponse(entries[index]);
      }
      m = match(pathname, /\/api\/forms\/([^/]+)\/entries\/(\d+)\/permanent$/);
      if (m && method === "DELETE") {
        const [formId, nText] = m, n = Number(nText); const body = await parseBody(options); const form = await get(STORES.forms, formId); if (!form) return errorResponse(new Error("Form not found."), 404, "NOT_FOUND"); const entries = (form.entries || []).map((entry) => normalizeEntry(entry)); const target = entries.find((entry) => entry.entryNumber === n); if (!target?.deleted) return errorResponse(new Error("Only deleted entries can be permanently removed."), 400); if (body.confirmation !== `DELETE ENTRY ${n}`) return errorResponse(new Error(`Type DELETE ENTRY ${n} to confirm.`), 400); form.entries = entries.filter((entry) => entry.entryNumber !== n); form.questions = form.entries; form.updatedAt = nowISO(); await put(STORES.forms, form); await markDeleted("entry", `${formId}:${n}`); notifyMutation("entry.permanent-delete", { formId, entryNumber: n }); return new Response(null, { status: 204 });
      }
      m = match(pathname, /\/api\/forms\/([^/]+)\/export\.tsv$/);
      if (m && method === "GET") { const form = await get(STORES.forms, m[0]); if (!form) return errorResponse(new Error("Form not found."), 404, "NOT_FOUND"); return textResponse(formToTsv(normalizeForm(form, form)), "text/tab-separated-values; charset=utf-8", `${safeFilename(form.name)}_ThunderShadow_Log.tsv`); }

      if (pathname.endsWith("/api/backup") && method === "GET") return jsonResponse(await exportPackage());
      if (pathname.endsWith("/api/restore") && method === "POST") {
        const body = await parseBody(options); const payload = typeof body === "string" ? JSON.parse(body) : body; await createSnapshot("safety-before-json-restore"); const result = await replacePackage(payload); notifyMutation("database.restored"); return jsonResponse(result);
      }
      if (pathname.endsWith("/api/backups") && method === "GET") {
        const backups = (await getAll(STORES.backups)).sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt))).map(({ payload, ...metadata }) => metadata);
        return jsonResponse({ directory: "Browser IndexedDB snapshots", retention: BACKUP_RETENTION, intervalHours: BACKUP_INTERVAL_HOURS, backups });
      }
      if (pathname.endsWith("/api/backups") && method === "POST") { const record = await createSnapshot("manual"); const { payload, ...metadata } = record; return jsonResponse(metadata, 201); }
      m = match(pathname, /\/api\/backups\/([^/]+)\/download$/);
      if (m && method === "GET") { const record = await get(STORES.backups, m[0]); if (!record?.payload) return errorResponse(new Error("Backup not found."), 404, "NOT_FOUND"); return textResponse(JSON.stringify(record.payload, null, 2), "application/json; charset=utf-8", record.filename); }
      if (pathname.endsWith("/api/backups/preview") && method === "POST") { const body = await parseBody(options); const record = await get(STORES.backups, body.filename); if (!record?.payload) return errorResponse(new Error("Backup not found."), 404, "NOT_FOUND"); const token = uuid(); restorePreviews.set(token, { payload: record.payload, source: { type: "browser", filename: record.filename }, expiresAt: Date.now() + 10 * 60_000 }); return jsonResponse({ token, expiresIn: 600, source: { type: "browser", filename: record.filename }, preview: previewPackage(record.payload) }); }
      if (pathname.endsWith("/api/backups/restore") && method === "POST") {
        const body = await parseBody(options); if (body.confirmation !== "RESTORE") return errorResponse(new Error("Type RESTORE to confirm database restoration."), 400); const preview = restorePreviews.get(body.previewToken); restorePreviews.delete(body.previewToken); if (!preview || preview.expiresAt < Date.now()) return errorResponse(new Error("Restore preview is missing or expired."), 400, "RESTORE_PREVIEW_EXPIRED"); const safety = await createSnapshot("safety"); await replacePackage(preview.payload); notifyMutation("database.restored"); return jsonResponse({ restored: true, safetyBackup: safety.filename, preview: previewPackage(preview.payload), reauthenticationRequired: false });
      }
      if (pathname.endsWith("/api/portable/export") && method === "POST") { const body = await parseBody(options); const bytes = await encryptPortable(await exportPackage(), body.passphrase); return bytesResponse(bytes, "application/octet-stream", `ThunderShadow_Encrypted_${nowISO().slice(0, 10)}.tsbackup`); }
      if (pathname.endsWith("/api/portable/import/preview") && method === "POST") { const headers = new Headers(options.headers || {}); const passphrase = headers.get("X-ThunderShadow-Passphrase") || ""; const filename = headers.get("X-ThunderShadow-Filename") || "portable.tsbackup"; const buffer = await parseBody(options); const payload = await decryptPortable(buffer, passphrase); const token = uuid(); const source = { type: "encrypted-browser", filename }; restorePreviews.set(token, { payload, source, expiresAt: Date.now() + 10 * 60_000 }); return jsonResponse({ token, expiresIn: 600, source, preview: previewPackage(payload) }); }

      if (pathname.endsWith("/api/analytics") && method === "GET") { const filters = { startDate: url.searchParams.get("startDate") || undefined, endDate: url.searchParams.get("endDate") || undefined, formIds: (url.searchParams.get("formIds") || "").split(",").filter(Boolean) }; return jsonResponse(calculateAnalytics(await allForms(), filters)); }
      if (pathname.endsWith("/api/rules") && method === "GET") {
        const rules = await allHydratedRules(); const output = [];
        for (const rule of rules) { const duplicates = await duplicateMatches(rule, rules); output.push({ ...rule, nearDuplicates: duplicates.near.map((item) => ({ id: item.id, ruleText: item.ruleText, similarity: item.similarity })) }); }
        return jsonResponse({ rules: output, candidates: await ruleCandidates() });
      }
      if (pathname.endsWith("/api/rules/review") && method === "GET") {
        const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit")) || 10)), today = nowISO().slice(0, 10); const due = (await allHydratedRules()).filter((rule) => rule.status !== "archived" && (!rule.nextReviewAt || rule.nextReviewAt <= today)).sort((a, b) => { const score = { active: 4, new: 3, improving: 2, mastered: 1 }; return (score[b.status] || 0) - (score[a.status] || 0) || b.occurrenceCount - a.occurrenceCount || b.lastSeen.localeCompare(a.lastSeen) || String(a.nextReviewAt || "").localeCompare(String(b.nextReviewAt || "")); }).slice(0, limit); return jsonResponse({ date: today, due: due.length, rules: due });
      }
      if (pathname.endsWith("/api/rules") && method === "POST") {
        const body = await parseBody(options); let source = null; if (body.sourceFormId && body.sourceQuestionNumber) { const form = await get(STORES.forms, body.sourceFormId); source = form?.entries?.find((entry) => entry.entryNumber === Number(body.sourceQuestionNumber)); }
        const candidate = normalizeRule({ ...body, pattern: body.pattern || source?.pattern, ruleText: body.ruleText || source?.reasoningNote }); const duplicates = await duplicateMatches(candidate); if (duplicates.exact.length) return jsonResponse({ error: { code: "EXACT_DUPLICATE", message: "This exact rule is already in the library.", details: { rules: duplicates.exact } } }, 409); await put(STORES.rules, candidate); await clearTombstone("rule", candidate.id); notifyMutation("rule.created", { ruleId: candidate.id }); return jsonResponse({ rule: await hydrateRule(candidate), nearDuplicates: duplicates.near }, 201);
      }
      m = match(pathname, /\/api\/rules\/([^/]+)$/);
      if (m && method === "PUT") {
        const id = m[0], existing = await get(STORES.rules, id); if (!existing) return errorResponse(new Error("Rule not found."), 404, "NOT_FOUND"); const body = await parseBody(options); const priorIdentity = `${existing.pattern}\n${normalizedRuleText(existing.ruleText)}`; const updated = normalizeRule({ ...existing, ...body, id, updatedAt: nowISO() }, existing); const nextIdentity = `${updated.pattern}\n${normalizedRuleText(updated.ruleText)}`; if (priorIdentity !== nextIdentity) updated.aliases = [...(updated.aliases || []), { pattern: existing.pattern, ruleText: existing.ruleText }]; const duplicates = await duplicateMatches(updated, null, id); if (duplicates.exact.length) return jsonResponse({ error: { code: "EXACT_DUPLICATE", message: "This exact rule is already in the library.", details: { rules: duplicates.exact } } }, 409); await put(STORES.rules, updated); notifyMutation("rule.updated", { ruleId: id }); return jsonResponse({ rule: await hydrateRule(updated), nearDuplicates: duplicates.near });
      }
      m = match(pathname, /\/api\/rules\/([^/]+)\/merge$/);
      if (m && method === "POST") {
        const target = await get(STORES.rules, m[0]); const body = await parseBody(options); const source = await get(STORES.rules, body.sourceRuleId); if (!target || !source) return errorResponse(new Error("Merge rule was not found."), 404, "NOT_FOUND"); if (target.id === source.id) return errorResponse(new Error("A rule cannot be merged into itself."), 400); const merged = normalizeRule({ ...target, pattern: body.pattern || target.pattern, ruleText: body.ruleText ?? target.ruleText, updatedAt: nowISO() }, target); merged.aliases = [...(target.aliases || []), { pattern: source.pattern, ruleText: source.ruleText }, ...(source.aliases || [])]; merged.reviewHistory = [...(target.reviewHistory || []), ...(source.reviewHistory || [])]; merged.successfulReviews = Number(target.successfulReviews || 0) + Number(source.successfulReviews || 0); await put(STORES.rules, merged); await del(STORES.rules, source.id); await markDeleted("rule", source.id); notifyMutation("rule.merged", { ruleId: target.id, removedRuleId: source.id }); return jsonResponse(await hydrateRule(merged));
      }
      m = match(pathname, /\/api\/rules\/([^/]+)\/reviews$/);
      if (m && method === "POST") {
        const rule = await get(STORES.rules, m[0]); if (!rule) return errorResponse(new Error("Rule not found."), 404, "NOT_FOUND"); const body = await parseBody(options), reviewedAt = nowISO(); const schedule = nextReviewSchedule(body.response, Number(rule.successfulReviews || 0), new Date(reviewedAt)); const status = schedule.status || (["partly_reliable", "reliable_today"].includes(body.response) ? "improving" : rule.status); const review = { id: uuid(), response: body.response, reviewedAt, intervalDays: schedule.intervalDays, nextReviewAt: schedule.nextReviewAt }; rule.reviewHistory = [review, ...(rule.reviewHistory || [])]; rule.status = status; rule.nextReviewAt = schedule.nextReviewAt; rule.successfulReviews = schedule.successfulReviews; rule.updatedAt = reviewedAt; await put(STORES.rules, rule); notifyMutation("rule.reviewed", { ruleId: rule.id }); return jsonResponse(await hydrateRule(rule));
      }

      if (pathname.endsWith("/api/export/all-forms.tsv") && method === "GET") return textResponse(allFormsToTsv(await allForms()), "text/tab-separated-values; charset=utf-8", "ThunderShadow_Longitudinal_Log.tsv");
      if (pathname.endsWith("/api/export/active-rules.tsv") && method === "GET") return textResponse(activeRulesTsv(await allHydratedRules()), "text/tab-separated-values; charset=utf-8", "ThunderShadow_Active_Rules.tsv");
      if (pathname.endsWith("/api/export/analytics.json") && method === "GET") { const filters = { startDate: url.searchParams.get("startDate") || undefined, endDate: url.searchParams.get("endDate") || undefined, formIds: (url.searchParams.get("formIds") || "").split(",").filter(Boolean) }; return textResponse(JSON.stringify(calculateAnalytics(await allForms(), filters), null, 2), "application/json; charset=utf-8", "ThunderShadow_Analytics.json"); }
      if (pathname.endsWith("/api/export/chatgpt-analysis.md") && method === "GET") { const filters = { startDate: url.searchParams.get("startDate") || undefined, endDate: url.searchParams.get("endDate") || undefined, formIds: (url.searchParams.get("formIds") || "").split(",").filter(Boolean) }; const analytics = calculateAnalytics(await allForms(), filters); return textResponse(analysisMarkdown(analytics, await allHydratedRules()), "text/markdown; charset=utf-8", "ThunderShadow_ChatGPT_Analysis.md"); }

      if (pathname.endsWith("/api/settings") && method === "GET") return jsonResponse({ uiScale: Number(await getSetting("ui_scale", 100)) || 100, backup: { directory: "Browser IndexedDB snapshots", retention: BACKUP_RETENTION, intervalHours: BACKUP_INTERVAL_HOURS }, schemaVersion: SCHEMA_VERSION });
      if (pathname.endsWith("/api/settings") && method === "PUT") { const body = await parseBody(options); const uiScale = Number(body.uiScale); if (!ZOOM_LEVELS.has(uiScale)) return errorResponse(new Error("UI scale must be 80–120 in 5% steps."), 400); await setSetting("ui_scale", uiScale); return jsonResponse({ uiScale }); }

      return errorResponse(new Error("Browser API endpoint not found."), 404, "NOT_FOUND");
    } catch (error) {
      console.error("ThunderShadow browser API error", pathname, method, error);
      return errorResponse(error, 400);
    }
  }

  async function storageSummary() {
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    return { forms: (await getAll(STORES.forms)).length, rules: (await getAll(STORES.rules)).length, backups: (await getAll(STORES.backups)).length, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
  }

  window.ThunderShadowBrowserApi = { request, exportPackage, replacePackage, mergePackage, createSnapshot, storageSummary, allForms, allHydratedRules, getSetting, setSetting, getMeta, setMeta };
})();
