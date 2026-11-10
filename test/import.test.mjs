// Regression checks for the form-log TSV importer: parser edge cases, formToTsv round trip,
// Step Simulator logs with empty id columns, duplicate detection, merge/replace and undo.
// Runs the real js/*.js page scripts in a Node VM against the localStorage emergency store.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scripts = ["js/uuid.js", "js/reasoning.js", "js/analytics.js", "js/tsv-import.js", "js/browser-api.js"];
const sources = await Promise.all(scripts.map((file) => readFile(path.join(root, file), "utf8")));
const simulatorTsv = await readFile(path.join(root, "test/fixtures/step-simulator-sample.tsv"), "utf8");

function storage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), clear: () => data.clear(), key: (i) => [...data.keys()][i] ?? null, get length() { return data.size; } };
}

function createApp() {
  const listeners = new Map();
  const localStorage = storage();
  localStorage.setItem("thundershadow:emergency-storage:v1", "1");
  const context = {
    console, URL, Headers, Request, Response, TextEncoder, TextDecoder, Blob, structuredClone, setTimeout, clearTimeout, queueMicrotask,
    crypto: webcrypto, localStorage, sessionStorage: storage(), navigator: {}, location: new URL("https://example.test/ThunderShadow/"),
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: () => {},
    dispatchEvent: (event) => { for (const fn of listeners.get(event.type) || []) fn(event); return true; }
  };
  context.window = context; context.self = context; context.globalThis = context;
  vm.createContext(context);
  sources.forEach((source, index) => vm.runInContext(source, context, { filename: scripts[index] }));
  const events = [];
  context.addEventListener("thundershadow-local-data-changed", (event) => events.push(event.detail.kind));
  const api = context.ThunderShadowBrowserApi;
  async function call(pathname, { method = "GET", body } = {}) {
    const response = await api.request(`/api/${pathname}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${pathname} → ${response.status}: ${text}`);
    return response.headers.get("Content-Type")?.includes("json") ? JSON.parse(text) : text;
  }
  return { call, context, events, parser: context.ThunderShadowTsvImport };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const fields = (entry) => ({ entryNumber: entry.entryNumber, errorCode: entry.errorCode, pattern: entry.pattern, speedFlags: [...entry.speedFlags].sort(), reasoningNote: entry.reasoningNote, noteKind: entry.noteKind, examItem: entry.examItem });
const logged = (form) => form.entries.filter((entry) => !entry.deleted && (entry.errorCode || entry.pattern || entry.reasoningNote || entry.speedFlags.length));

async function seedForm(app) {
  const form = await app.call("forms", { method: "POST", body: { id: "orig-form", name: "NBME 14", date: "2026-10-01", examType: "NBME", originalFormLength: 200 } });
  const rows = [
    { errorCode: "5", pattern: "hinge_discriminator", speedFlags: ["reread_loop", "changed_answer"], reasoningNote: "Line one\nLine \"two\" — exports turn tabs into spaces, so none here", noteKind: "reasoning", examItem: "1.02" },
    { errorCode: "1", pattern: "", speedFlags: [], reasoningNote: "", noteKind: "clinical", examItem: "" },
    { errorCode: "", pattern: "timeline_course", speedFlags: ["fatigue_attention"], reasoningNote: "Clinical cue → timing", noteKind: "clinical", examItem: "2.10" },
    { errorCode: "7", pattern: "modifier_constraint", speedFlags: ["rushed"], reasoningNote: "Ünïcödé, commas, and \"quotes\"", noteKind: "clinical", examItem: "3.01" }
  ];
  for (const [index, row] of rows.entries()) await app.call(`forms/${form.id}/entries/${index + 1}`, { method: "PUT", body: row });
  return app.call(`forms/${form.id}`);
}

test("parser handles BOM, CRLF, quotes, doubled quotes, <br>, embedded newlines and tabs", () => {
  const { parser } = createApp();
  const tsv = "﻿Form\tDate\tEntry_Number\tError_Code\tRule_Pattern\tSpeed_Flags\tReasoning_Note\tNote_Type\tExam_Item\r\n"
    + "F1\t2026-01-02\t4\t3\tP5 — HINGE\tS1 — RUSHED | S6 — FATIGUE/ATTENTION\t\"He said \"\"no\"\"<br>next<BR/>last\"\tBroad Pattern\t1.2\r\n"
    + "F1\t2026-01-02\t\t\t\t\t\"multi\r\nline\tcell\"\t\t\r\n";
  const result = parser.parse(tsv);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.form), { name: "F1", date: "2026-01-02", formId: "" });
  assert.deepEqual(plain(result.entries.map(({ sourceRow, ...entry }) => entry)), [
    { entryNumber: 4, errorCode: "3", pattern: "hinge_discriminator", speedFlags: ["rushed", "fatigue_attention"], reasoningNote: "He said \"no\"\nnext\nlast", noteKind: "reasoning", examItem: "1.02" },
    { entryNumber: 5, errorCode: "", pattern: "", speedFlags: [], reasoningNote: "multi\nline\tcell", noteKind: "clinical", examItem: "" }
  ]);
});

test("parser reports problem rows, duplicates, unknown values and multiple forms", () => {
  const { parser } = createApp();
  const head = "Form\tDate\tEntry_Number\tError_Code\tRule_Pattern\tSpeed_Flags\tReasoning_Note\tExam_Item\n";
  const result = parser.parse(head + "F\t2026-01-02\t1\t9\tP9 — NOPE\tS9 — X\tnote\t7.x\nF\t2026-01-02\t1\t2\t\t\t\t\nF\t2026-01-02\t3\t\t\t\t\t\n");
  assert.equal(result.ok, true);
  assert.equal(result.entries.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(plain(result.entries.map((entry) => entry.entryNumber)), [1, 2]);
  const messages = result.problems.map((problem) => problem.message).join("\n");
  for (const fragment of ["Error code “9”", "Unknown reasoning pattern", "Unknown speed flag", "Exam item “7.x”", "appears twice"]) assert.match(messages, new RegExp(fragment));
  assert.equal(parser.parse(head + "A\t2026-01-02\t1\t2\t\t\t\t\nB\t2026-01-03\t1\t2\t\t\t\t\n").ok, false);
  assert.equal(parser.parse("just\tsome\tcolumns\n1\t2\t3\n").ok, false);
  assert.equal(parser.parse("").ok, false);
});

test("formToTsv export re-imports to an identical form", async () => {
  const app = createApp();
  const original = await seedForm(app);
  const tsv = await app.call(`forms/${original.id}/export.tsv`);
  const preview = await app.call("import/form-tsv/preview", { method: "POST", body: { text: tsv, filename: "NBME_14_ThunderShadow_Log.tsv" } });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.problems, []);
  assert.equal(preview.matches.length, 1, "same Form_ID / name+date must be detected");
  assert.equal(preview.matches[0].matchedBy, "id");
  assert.deepEqual(preview.matches[0].plan.merge, { added: 0, updated: 0, unchanged: 4, removed: 0 });

  const fresh = createApp();
  const freshPreview = await fresh.call("import/form-tsv/preview", { method: "POST", body: { text: tsv } });
  assert.deepEqual(freshPreview.matches, []);
  const result = await fresh.call("import/form-tsv/commit", { method: "POST", body: { token: freshPreview.token, mode: "new", name: freshPreview.form.name, date: freshPreview.form.date, examType: "NBME", originalFormLength: 200 } });
  assert.equal(result.form.name, original.name);
  assert.equal(result.form.date, original.date);
  assert.deepEqual(logged(result.form).map(fields), logged(original).map(fields));
  const reexport = await fresh.call(`forms/${result.form.id}/export.tsv`);
  const strip = (text) => text.split("\n").map((line) => line.split("\t").filter((_, i) => ![0, 9, 10].includes(i)).join("\t")).join("\n");
  assert.equal(strip(reexport), strip(tsv), "re-export matches apart from regenerated ids");
  const rules = await fresh.call("rules?status=all");
  assert.equal((rules.rules || rules).length, 3, "every non-empty note became a card");
});

test("Step Simulator TSV with empty id columns imports, generates ids and detects re-import", async () => {
  const app = createApp();
  const preview = await app.call("import/form-tsv/preview", { method: "POST", body: { text: simulatorTsv, filename: "Step1-UWSA1_ThunderShadow_Log.tsv" } });
  assert.equal(preview.form.name, "Step1-UWSA1");
  assert.equal(preview.entries.length, 3);
  assert.deepEqual(preview.problems, []);
  const result = await app.call("import/form-tsv/commit", { method: "POST", body: { token: preview.token, mode: "new", name: "Step1-UWSA1", date: "2026-11-10", examType: "" } });
  assert.ok(result.form.id);
  assert.equal(result.cardsCreated, 3);
  assert.deepEqual(result.form.entries.map((entry) => [entry.entryNumber, entry.errorCode, entry.pattern, entry.speedFlags.join(","), entry.noteKind, entry.examItem, entry.noteId]), [
    [1, "5", "frame_assumption", "reread_loop,changed_answer", "clinical", "1.01", `${result.form.id}:entry-1`],
    [2, "1", "timeline_course", "rushed", "clinical", "1.02", `${result.form.id}:entry-2`],
    [3, "2", "stability_urgency", "slow_recall", "reasoning", "1.03", `${result.form.id}:entry-3`]
  ]);
  const exported = (await app.call(`forms/${result.form.id}/export.tsv`)).split("\n").slice(1).map((line) => line.split("\t"));
  assert.ok(exported.every((cells) => /^thundershadow:log:/.test(cells[0]) && cells[9] === result.form.id && cells[10]), "export now carries generated ThunderShadowID / Form_ID / Note_ID");

  const again = await app.call("import/form-tsv/preview", { method: "POST", body: { text: simulatorTsv } });
  assert.equal(again.matches.length, 1);
  assert.equal(again.matches[0].matchedBy, "name-date");
  assert.deepEqual(again.matches[0].plan.merge, { added: 0, updated: 0, unchanged: 3, removed: 0 });
  const merged = await app.call("import/form-tsv/commit", { method: "POST", body: { token: again.token, mode: "merge", targetFormId: result.form.id } });
  assert.equal((await app.call("forms")).length, 1, "merge never duplicates the form");
  assert.equal(logged(merged.form).length, 3);
  assert.equal(merged.cardsCreated, 0);
});

test("merge matches by exam item, replace soft-deletes, and undo restores forms and cards", async () => {
  const app = createApp();
  const original = await seedForm(app);
  const rulesBefore = await app.call("rules?status=all");
  const head = "Form\tDate\tEntry_Number\tError_Code\tRule_Pattern\tSpeed_Flags\tReasoning_Note\tNote_Type\tExam_Item\n";
  const tsv = head + "NBME 14\t2026-10-01\t1\t2\tP5 — HINGE\t\tChanged note\tBroad Pattern\t1.02\nNBME 14\t2026-10-01\t2\t4\t\t\tBrand new\tClinical Pattern\t4.04\n";

  const preview = await app.call("import/form-tsv/preview", { method: "POST", body: { text: tsv } });
  assert.equal(preview.matches[0].matchedBy, "name-date");
  assert.deepEqual(preview.matches[0].plan.merge, { added: 1, updated: 1, unchanged: 0, removed: 0 });
  assert.deepEqual(preview.matches[0].plan.replace, { added: 0, updated: 2, unchanged: 0, removed: 2 });
  const merged = await app.call("import/form-tsv/commit", { method: "POST", body: { token: preview.token, mode: "merge", targetFormId: original.id } });
  assert.equal(merged.form.entries.find((entry) => entry.examItem === "1.02").reasoningNote, "Changed note");
  assert.equal(merged.form.entries.find((entry) => entry.examItem === "4.04").entryNumber, 5);
  assert.equal(logged(merged.form).length, 5);
  await app.call("import/form-tsv/undo", { method: "POST", body: { undoToken: merged.undoToken } });
  const afterUndo = await app.call(`forms/${original.id}`);
  assert.deepEqual(logged(afterUndo).map(fields), logged(original).map(fields));
  const rulesAfterUndo = await app.call("rules?status=all");
  const ruleText = (list) => (list.rules || list).map((rule) => `${rule.id}|${rule.ruleText}|${rule.pattern}|${rule.noteKind}`).sort();
  assert.deepEqual(ruleText(rulesAfterUndo), ruleText(rulesBefore));

  const second = await app.call("import/form-tsv/preview", { method: "POST", body: { text: tsv } });
  const replaced = await app.call("import/form-tsv/commit", { method: "POST", body: { token: second.token, mode: "replace", targetFormId: original.id } });
  assert.deepEqual(logged(replaced.form).map((entry) => entry.reasoningNote), ["Changed note", "Brand new"]);
  assert.equal(replaced.form.entries.filter((entry) => entry.deleted).length, 2, "replaced entries stay restorable");
  await app.call("import/form-tsv/undo", { method: "POST", body: { undoToken: replaced.undoToken } });
  assert.deepEqual(logged(await app.call(`forms/${original.id}`)).map(fields), logged(original).map(fields));

  const third = await app.call("import/form-tsv/preview", { method: "POST", body: { text: simulatorTsv } });
  const created = await app.call("import/form-tsv/commit", { method: "POST", body: { token: third.token, mode: "new" } });
  assert.equal((await app.call("forms")).length, 2);
  await app.call("import/form-tsv/undo", { method: "POST", body: { undoToken: created.undoToken } });
  assert.deepEqual((await app.call("forms")).map((form) => form.id), [original.id]);
  assert.deepEqual(ruleText(await app.call("rules?status=all")), ruleText(rulesBefore));
  await assert.rejects(app.call("import/form-tsv/undo", { method: "POST", body: { undoToken: created.undoToken } }), /no longer be undone/);
  assert.ok(app.events.includes("form.imported") && app.events.includes("form.deleted"), "imports and undo mark cloud-dirty state");
});
