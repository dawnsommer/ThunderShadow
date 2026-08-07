(() => {
  "use strict";

const { PATTERNS, SPEED_FLAGS, canonicalPattern, canonicalSpeedFlags } = window.ThunderShadowReasoning;

const ERROR_LABELS = {
  "1": "Careless / misread",
  "2": "Knowledge gap",
  "3": "Misapplied / trapped",
  "4": "Differential confusion",
  "5": "Correct but between two",
  "6": "Lucky correct / no idea",
  "7": "Shaky / trap-prone"
};

const PATTERN_LABELS = Object.fromEntries(PATTERNS.map((item) => [item.value, `${item.code} — ${item.label}`]));
const SPEED_LABELS = Object.fromEntries(SPEED_FLAGS.map((item) => [item.value, `${item.code} — ${item.label}`]));

const COMBINATIONS = [
  { id: "code_3_sequence", label: "Code 3 + SEQUENCE", code: "3", patterns: ["sequence_nbs"] },
  { id: "code_4_hinge", label: "Code 4 + HINGE", code: "4", patterns: ["hinge_discriminator"] },
  { id: "code_5_hinge", label: "Code 5 + HINGE", code: "5", patterns: ["hinge_discriminator"] },
  { id: "code_7_hinge", label: "Code 7 + HINGE", code: "7", patterns: ["hinge_discriminator"] },
  { id: "code_1_task", label: "Code 1 + TASK", code: "1", patterns: ["task_target"] }
];

function isLogged(question) {
  return Boolean(question && !question.deleted && (question.errorCode || question.pattern || question.reasoningNote?.trim() || question.manualRule?.trim() || question.speedFlags?.length));
}

function recurrenceLevel(count, formCount = 0, percentage = 0) {
  if (count <= 0) return { level: 0, label: "Not observed" };
  if (count === 1) return { level: 1, label: "Isolated" };
  if (count === 2) return { level: 2, label: "Watch" };
  if (percentage >= 15) return { level: 5, label: "Dominant pattern" };
  if (count >= 5 && formCount >= 3) return { level: 4, label: "Recurrent priority" };
  if (count >= 3 && formCount >= 2) return { level: 3, label: "Active pattern" };
  return { level: 2, label: "Watch" };
}

function normalizedRuleText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function tokenSet(value) {
  return new Set(normalizedRuleText(value).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2));
}

function ruleSimilarity(first, second) {
  const a = tokenSet(first);
  const b = tokenSet(second);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function findRuleDuplicates(candidate, rules, nearThreshold = 0.55) {
  const exactText = normalizedRuleText(candidate.ruleText);
  const exact = rules.filter((rule) =>
    rule.id !== candidate.id &&
    rule.pattern === candidate.pattern &&
    normalizedRuleText(rule.ruleText) === exactText
  );
  const near = rules
    .filter((rule) => rule.id !== candidate.id && !exact.includes(rule))
    .map((rule) => ({ ...rule, similarity: Number(ruleSimilarity(candidate.ruleText, rule.ruleText).toFixed(2)) }))
    .filter((rule) => rule.similarity >= nearThreshold)
    .sort((a, b) => b.similarity - a.similarity);
  return { exact, near };
}

function nextReviewSchedule(response, successfulReviews = 0, reviewedAt = new Date()) {
  const intervals = {
    still_weak: 1,
    partly_reliable: 3,
    reliable_today: 7,
    mastered: successfulReviews + 1 >= 3 ? 45 : 21,
    skip: 1
  };
  if (!(response in intervals)) throw new Error("Unknown review response.");
  const success = ["reliable_today", "mastered"].includes(response);
  const next = new Date(reviewedAt);
  next.setUTCDate(next.getUTCDate() + intervals[response]);
  return {
    intervalDays: intervals[response],
    nextReviewAt: next.toISOString().slice(0, 10),
    successfulReviews: success ? successfulReviews + 1 : 0,
    status: response === "mastered" ? "mastered" : response === "still_weak" ? "active" : null
  };
}

function calculateAnalytics(allForms, filters = {}) {
  const selectedIds = new Set(Array.isArray(filters.formIds) ? filters.formIds : []);
  const forms = allForms
    .filter((form) => !selectedIds.size || selectedIds.has(form.id))
    .filter((form) => !filters.startDate || form.date >= filters.startDate)
    .filter((form) => !filters.endDate || form.date <= filters.endDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const recentSize = forms.length <= 1 ? forms.length : Math.min(3, Math.ceil(forms.length / 2));
  const recentIds = new Set(forms.slice(-recentSize).map((form) => form.id));
  const earlierIds = new Set(forms.slice(0, -recentSize).map((form) => form.id));
  const errors = Object.fromEntries(Object.entries(ERROR_LABELS).map(([id, label]) => [id, {
    id, label, count: 0, percentage: 0, byForm: [], trend: []
  }]));
  const patterns = Object.fromEntries(PATTERNS.map((definition) => [definition.value, {
    id: definition.value, code: definition.code, label: definition.label, color: definition.color,
    definition: definition.definition, correctiveAction: definition.fix, count: 0, percentage: 0,
    forms: new Set(), byErrorCode: {}, bySpeedFlag: {}, subjects: {}, trendOverTime: [], firstSeen: null, lastSeen: null, recentCount: 0, earlierCount: 0
  }]));
  const speed = Object.fromEntries(Object.entries(SPEED_LABELS).map(([id, label]) => [id, {
    id, label, count: 0, byErrorCode: {}, byRulePattern: {}
  }]));
  const combinations = COMBINATIONS.map((item) => ({ ...item, count: 0, occurrences: [] }));
  let loggedQuestions = 0;
  let errorCodedQuestions = 0;
  let wrongAnswers = 0;
  let unstableCorrect = 0;
  let reasoningNotePresence = 0;
  let contentGapFrequency = 0;
  let patternCodedEntries = 0;

  for (const form of forms) {
    const perFormErrors = Object.fromEntries(Object.keys(ERROR_LABELS).map((id) => [id, 0]));
    for (const question of form.questions || []) {
      if (!isLogged(question)) continue;
      loggedQuestions += 1;
      if ((question.reasoningNote || question.manualRule || "").trim()) reasoningNotePresence += 1;
      const patternId = canonicalPattern(question.pattern);
      const speedFlags = canonicalSpeedFlags(question.speedFlags, question.pattern);
      if (["content_only", "content_gap"].includes(question.pattern)) contentGapFrequency += 1;
      if (["1", "2", "3", "4"].includes(question.errorCode)) wrongAnswers += 1;
      if (["5", "6", "7"].includes(question.errorCode)) unstableCorrect += 1;
      if (errors[question.errorCode]) {
        errorCodedQuestions += 1;
        errors[question.errorCode].count += 1;
        perFormErrors[question.errorCode] += 1;
      }
      if (patterns[patternId]) {
        patternCodedEntries += 1;
        const item = patterns[patternId];
        item.count += 1;
        item.forms.add(form.id);
        if (question.errorCode) item.byErrorCode[question.errorCode] = (item.byErrorCode[question.errorCode] || 0) + 1;
        for (const flag of speedFlags) item.bySpeedFlag[flag] = (item.bySpeedFlag[flag] || 0) + 1;
        const subject = form.subject || form.examType || "Unspecified";
        item.subjects[subject] = (item.subjects[subject] || 0) + 1;
        const trendPoint = item.trendOverTime.find((point) => point.date === form.date && point.formId === form.id);
        if (trendPoint) trendPoint.count += 1;
        else item.trendOverTime.push({ date: form.date, formId: form.id, formName: form.name, count: 1 });
        item.firstSeen = !item.firstSeen || form.date < item.firstSeen ? form.date : item.firstSeen;
        item.lastSeen = !item.lastSeen || form.date > item.lastSeen ? form.date : item.lastSeen;
        if (recentIds.has(form.id)) item.recentCount += 1;
        if (earlierIds.has(form.id)) item.earlierCount += 1;
      }
      for (const flag of speedFlags) {
        if (!speed[flag]) continue;
        speed[flag].count += 1;
        if (question.errorCode) speed[flag].byErrorCode[question.errorCode] = (speed[flag].byErrorCode[question.errorCode] || 0) + 1;
        if (patternId) speed[flag].byRulePattern[patternId] = (speed[flag].byRulePattern[patternId] || 0) + 1;
      }
      for (const combination of combinations) {
        const patternMatch = !combination.patterns || combination.patterns.includes(patternId);
        const speedMatch = !combination.speedFlags || combination.speedFlags.some((flag) => speedFlags.includes(flag));
        if (question.errorCode === combination.code && patternMatch && speedMatch) {
          combination.count += 1;
          combination.occurrences.push({ formId: form.id, formName: form.name, date: form.date, entryNumber: question.entryNumber || question.number });
        }
      }
    }
    for (const id of Object.keys(errors)) {
      errors[id].byForm.push({ formId: form.id, formName: form.name, date: form.date, count: perFormErrors[id] });
      errors[id].trend.push({ date: form.date, formName: form.name, count: perFormErrors[id] });
    }
  }

  for (const item of Object.values(errors)) item.percentage = errorCodedQuestions ? Number((item.count * 100 / errorCodedQuestions).toFixed(1)) : 0;
  const earlierFormCount = earlierIds.size;
  const recentFormCount = recentIds.size;
  for (const item of Object.values(patterns)) {
    const recentRate = recentFormCount ? item.recentCount / recentFormCount : 0;
    const earlierRate = earlierFormCount ? item.earlierCount / earlierFormCount : 0;
    let direction = "insufficient data";
    if (earlierFormCount && recentFormCount) {
      if (recentRate > earlierRate + 0.15) direction = "rising";
      else if (recentRate < earlierRate - 0.15) direction = "improving";
      else direction = "stable";
    }
    item.forms = [...item.forms];
    item.formCount = item.forms.length;
    item.percentage = patternCodedEntries ? Number((item.count * 100 / patternCodedEntries).toFixed(1)) : 0;
    item.level = recurrenceLevel(item.count, item.formCount, item.percentage);
    item.representativeSubjects = Object.entries(item.subjects).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, count]) => ({ label, count }));
    item.associatedErrorCodes = Object.entries(item.byErrorCode).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, label: ERROR_LABELS[id], count }));
    item.associatedSpeedFlags = Object.entries(item.bySpeedFlag).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, label: SPEED_LABELS[id], count }));
    item.trend = {
      direction,
      earlierCount: item.earlierCount,
      earlierForms: earlierFormCount,
      recentCount: item.recentCount,
      recentForms: recentFormCount,
      earlierPerForm: Number(earlierRate.toFixed(2)),
      recentPerForm: Number(recentRate.toFixed(2))
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    filters: { startDate: filters.startDate || null, endDate: filters.endDate || null, formIds: [...selectedIds] },
    summary: { forms: forms.length, loggedQuestions, errorCodedQuestions, patternCodedEntries, wrongAnswers, unstableCorrect, contentGapFrequency, reasoningNotePresence },
    errors: Object.values(errors),
    patterns: Object.values(patterns).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    speed: Object.values(speed).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    speedBurden: {
      changedAnswer: speed.changed_answer.count,
      repeatedReading: speed.reread_loop.count,
      overthought: speed.overthought.count
    },
    combinations: combinations.filter((item) => item.count > 0).sort((a, b) => b.count - a.count),
    recentTrend: forms.map((form) => ({
      formId: form.id,
      formName: form.name,
      date: form.date,
      logged: (form.questions || []).filter(isLogged).length,
      wrong: (form.questions || []).filter((q) => ["1", "2", "3", "4"].includes(q.errorCode)).length,
      unstable: (form.questions || []).filter((q) => ["5", "6", "7"].includes(q.errorCode)).length
    }))
  };
}

window.ThunderShadowAnalytics = {
  ERROR_LABELS,
  PATTERN_LABELS,
  SPEED_LABELS,
  calculateAnalytics,
  findRuleDuplicates,
  nextReviewSchedule,
  normalizedRuleText,
  recurrenceLevel,
  ruleSimilarity
};
})();
