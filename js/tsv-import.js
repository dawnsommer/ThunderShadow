// Parser for one form's log TSV: the inverse of formToTsv in js/browser-api.js.
// Pure text-in/data-out so it can run in the page and in Node tests; it never touches storage.
(function (root) {
  "use strict";

  const COLUMN_ALIASES = {
    thunderShadowId: ["thundershadowid"],
    form: ["form", "formname"],
    date: ["date", "formdate"],
    entryNumber: ["entrynumber", "entry", "number"],
    errorCode: ["errorcode", "code"],
    pattern: ["rulepattern", "pattern", "reasoningpattern"],
    speedFlags: ["speedflags", "speedflag", "flags"],
    reasoningNote: ["reasoningnote", "note", "studynote"],
    noteType: ["notetype", "notekind", "kind"],
    formId: ["formid"],
    noteId: ["noteid"],
    ruleText: ["ruletext"],
    examItem: ["examitem", "item"]
  };
  const MAX_ENTRY_NUMBER = 2147483647;
  const MAX_NOTE = 12000;

  const headerKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // RFC-4180-style reader with tab delimiters: quoted fields, doubled quotes, CRLF/CR/LF, BOM.
  function readRows(text) {
    const source = String(text ?? "").replace(/^﻿/, "");
    const rows = [];
    let row = [], field = "", quoted = false, fieldStart = true, i = 0;
    const endField = () => { row.push(field); field = ""; fieldStart = true; };
    const endRow = () => { endField(); rows.push(row); row = []; };
    while (i < source.length) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"') {
          if (source[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i += 1; continue;
        }
        field += ch; i += 1; continue;
      }
      if (ch === '"' && fieldStart) { quoted = true; fieldStart = false; i += 1; continue; }
      if (ch === "\t") { endField(); i += 1; continue; }
      if (ch === "\r" || ch === "\n") { endRow(); i += ch === "\r" && source[i + 1] === "\n" ? 2 : 1; continue; }
      field += ch; fieldStart = false; i += 1;
    }
    if (field !== "" || row.length) endRow();
    return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
  }

  const decodeNote = (value) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/<br\s*\/?>/gi, "\n").trim();

  function createParser(reasoning) {
    const { PATTERNS, SPEED_FLAGS, canonicalPattern, canonicalSpeedFlags, normalizeExamItem } = reasoning;
    const patternValues = new Set(PATTERNS.map((item) => item.value));
    const speedValues = new Set(SPEED_FLAGS.map((item) => item.value));

    function parsePattern(raw) {
      const value = String(raw ?? "").trim();
      if (!value) return { value: "" };
      const coded = value.match(/^P\s*([1-7])\b/i);
      if (coded) return { value: PATTERNS[Number(coded[1]) - 1].value };
      if (patternValues.has(value)) return { value };
      const byLabel = PATTERNS.find((item) => item.label.toLowerCase() === value.toLowerCase());
      if (byLabel) return { value: byLabel.value };
      const legacy = canonicalPattern(value);
      if (legacy) return { value: legacy };
      return { value: "", problem: `Unknown reasoning pattern “${value}” was left blank.` };
    }

    function parseSpeedFlags(raw) {
      const parts = String(raw ?? "").split(/\s*[|;]\s*/).map((part) => part.trim()).filter(Boolean);
      const values = [], unknown = [];
      for (const part of parts) {
        const coded = part.match(/^S\s*([1-6])\b/i);
        const byLabel = SPEED_FLAGS.find((item) => item.label.toLowerCase() === part.toLowerCase());
        const value = coded ? SPEED_FLAGS[Number(coded[1]) - 1].value : speedValues.has(part) ? part : byLabel ? byLabel.value : canonicalSpeedFlags([part])[0];
        if (value) values.push(value); else unknown.push(part);
      }
      return { values: [...new Set(values)], problem: unknown.length ? `Unknown speed flag${unknown.length === 1 ? "" : "s"} ${unknown.map((u) => `“${u}”`).join(", ")} skipped.` : "" };
    }

    function parseErrorCode(raw) {
      const value = String(raw ?? "").trim();
      if (!value) return { value: "" };
      const match = value.match(/^(?:E\s*)?([1-7])(?:\b|$)/i);
      return match ? { value: match[1] } : { value: "", problem: `Error code “${value}” is not 1–7 and was left blank.` };
    }

    function parseNoteKind(raw, pattern) {
      const value = String(raw ?? "").trim();
      if (/broad|reasoning/i.test(value)) return { value: "reasoning" };
      if (/clinical/i.test(value)) return { value: "clinical" };
      const fallback = pattern ? "reasoning" : "clinical";
      return value ? { value: fallback, problem: `Note type “${value}” is not recognized; used ${fallback === "reasoning" ? "Broad Pattern" : "Clinical Pattern"}.` } : { value: fallback };
    }

    // Returns { ok, error?, form, entries, problems, skipped, rowCount, columns }.
    function parse(text, { filename = "" } = {}) {
      const rows = readRows(text);
      if (!rows.length) return { ok: false, error: "This file is empty." };
      const header = rows[0].map(headerKey);
      const columns = {};
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        const index = header.findIndex((key) => aliases.includes(key));
        if (index >= 0) columns[field] = index;
      }
      const dataColumns = ["errorCode", "pattern", "speedFlags", "reasoningNote", "examItem"].filter((field) => field in columns);
      if (!dataColumns.length) return { ok: false, error: "This doesn’t look like a ThunderShadow form log: no Error_Code, Rule_Pattern, Speed_Flags, Reasoning_Note or Exam_Item column was found." };
      const cell = (cells, field) => (field in columns ? String(cells[columns[field]] ?? "") : "");

      const problems = [], skipped = [], drafts = [];
      const groups = new Map();
      rows.slice(1).forEach((cells, index) => {
        const rowNumber = index + 2; // 1-based line in the file, counting the header
        const rowProblems = [];
        const formName = cell(cells, "form").trim();
        const date = cell(cells, "date").trim();
        const groupKey = `${formName}\u0000${date}`;
        groups.set(groupKey, (groups.get(groupKey) || 0) + 1);
        const code = parseErrorCode(cell(cells, "errorCode"));
        const pattern = parsePattern(cell(cells, "pattern"));
        const speed = parseSpeedFlags(cell(cells, "speedFlags"));
        let note = decodeNote(cell(cells, "reasoningNote"));
        if (note.length > MAX_NOTE) { note = note.slice(0, MAX_NOTE); rowProblems.push("Note was longer than 12,000 characters and was shortened."); }
        const kind = parseNoteKind(cell(cells, "noteType"), pattern.value);
        const rawItem = cell(cells, "examItem").trim();
        let examItem = normalizeExamItem(rawItem);
        if (examItem === null) { examItem = ""; rowProblems.push(`Exam item “${rawItem}” is not block.item (e.g. 1.02) and was left blank.`); }
        const rawNumber = cell(cells, "entryNumber").trim();
        let entryNumber = null;
        if (rawNumber) {
          const n = Number(rawNumber);
          if (Number.isInteger(n) && n >= 1 && n <= MAX_ENTRY_NUMBER) entryNumber = n;
          else rowProblems.push(`Entry number “${rawNumber}” is invalid; a new number was assigned.`);
        }
        for (const message of [code.problem, pattern.problem, speed.problem, kind.problem]) if (message) rowProblems.push(message);
        if (!code.value && !pattern.value && !speed.values.length && !note) {
          skipped.push({ row: rowNumber, message: rowProblems[0] || "Row has no error code, pattern, speed flag or note." });
          return;
        }
        drafts.push({ rowNumber, groupKey, formName, date, formId: cell(cells, "formId").trim(), entryNumber, errorCode: code.value, pattern: pattern.value, speedFlags: speed.values, reasoningNote: note, noteKind: kind.value, examItem, rowProblems });
      });

      const named = [...groups.keys()].filter((key) => key !== "\u0000");
      if (named.length > 1) {
        const list = named.map((key) => key.split("\u0000").filter(Boolean).join(" · ")).slice(0, 4).join("; ");
        return { ok: false, error: `This file holds ${named.length} different forms (${list}${named.length > 4 ? "; …" : ""}). Import one form’s log at a time — export it from the form card’s TSV button.` };
      }
      if (!drafts.length) return { ok: false, error: skipped.length ? "No row in this file has an error code, pattern, speed flag or note to import." : "This file has a header but no entries." };

      // Keep numbers from the file; give missing/duplicate numbers the next free number.
      const used = new Set();
      for (const draft of drafts) {
        if (draft.entryNumber != null && used.has(draft.entryNumber)) { draft.rowProblems.push(`Entry number ${draft.entryNumber} appears twice; this row got a new number.`); draft.entryNumber = null; }
        if (draft.entryNumber != null) used.add(draft.entryNumber);
      }
      let next = used.size ? Math.max(...used) : 0;
      for (const draft of drafts) if (draft.entryNumber == null) { do next += 1; while (used.has(next)); draft.entryNumber = next; used.add(next); }

      const first = drafts.find((draft) => draft.formName || draft.date) || drafts[0];
      const fallbackName = String(filename || "").replace(/\.[^.]+$/, "").replace(/_ThunderShadow_Log$/i, "").replace(/_+/g, " ").trim();
      const formIds = [...new Set(drafts.map((draft) => draft.formId).filter(Boolean))];
      const entries = drafts.sort((a, b) => a.entryNumber - b.entryNumber).map((draft) => {
        for (const message of draft.rowProblems) problems.push({ row: draft.rowNumber, entryNumber: draft.entryNumber, message });
        return { entryNumber: draft.entryNumber, errorCode: draft.errorCode, pattern: draft.pattern, speedFlags: draft.speedFlags, reasoningNote: draft.reasoningNote, noteKind: draft.noteKind, examItem: draft.examItem, sourceRow: draft.rowNumber };
      });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(first.date) ? first.date : "";
      if (first.date && !date) problems.unshift({ row: first.rowNumber, message: `Date “${first.date}” is not YYYY-MM-DD; choose the date before importing.` });
      return {
        ok: true,
        form: { name: (first.formName || fallbackName).slice(0, 80), date, formId: formIds.length === 1 ? formIds[0] : "" },
        entries, problems, skipped,
        rowCount: rows.length - 1,
        columns: Object.keys(columns)
      };
    }

    return { parse, parsePattern, parseSpeedFlags, parseErrorCode };
  }

  const api = { readRows, decodeNote, createParser };
  if (root.ThunderShadowReasoning) Object.assign(api, createParser(root.ThunderShadowReasoning));
  root.ThunderShadowTsvImport = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
