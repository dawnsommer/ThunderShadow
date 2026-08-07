(() => {
  "use strict";

const PATTERNS = [
  { code: "P1", value: "task_target", label: "TASK", color: "#3B82F6", definition: "Solved a different question from the one NBME asked.", fix: "Translate the final question into a 2–4 word command before evaluating options." },
  { code: "P2", value: "stability_urgency", label: "STABILITY", color: "#E11D48", definition: "Failed to classify instability, acuity, or an immediate threat before choosing the pathway.", fix: "Ask whether an immediate threat overrides the normal diagnostic or management pathway." },
  { code: "P3", value: "sequence_nbs", label: "SEQUENCE", color: "#F59E0B", definition: "Recognized the clinical problem but selected the wrong stage of diagnosis or management.", fix: "Locate the current node: stabilize → evaluate → confirm → treat → escalate → definitive management." },
  { code: "P4", value: "frame_assumption", label: "FRAME", color: "#8B5CF6", definition: "Built the wrong illness script or added an unsupported assumption before comparing choices.", fix: "Restate the case neutrally using only supplied facts; require a real contradiction before rejecting an option." },
  { code: "P5", value: "hinge_discriminator", label: "HINGE", color: "#14B8A6", definition: "The candidate answers were reasonable, but the decisive discriminator was missed or underweighted.", fix: "Ask which single finding is hardest for the selected answer to explain." },
  { code: "P6", value: "timeline_course", label: "TIMELINE", color: "#6366F1", definition: "The timing, onset, duration, progression, event order, or treatment exposure determined the answer.", fix: "Convert the stem into: trigger → interval → presentation." },
  { code: "P7", value: "modifier_constraint", label: "MODIFIER", color: "#22C55E", definition: "Knew the usual rule but failed to adjust it for a patient-specific constraint or context.", fix: "State: Normally X; because of modifier Y, choose Z." }
];

const SPEED_FLAGS = [
  { code: "S1", value: "rushed", label: "RUSHED" },
  { code: "S2", value: "overthought", label: "OVERTHOUGHT" },
  { code: "S3", value: "reread_loop", label: "RE-READ LOOP" },
  { code: "S4", value: "changed_answer", label: "CHANGED ANSWER" },
  { code: "S5", value: "slow_recall", label: "SLOW RECALL" },
  { code: "S6", value: "fatigue_attention", label: "FATIGUE/ATTENTION" }
];

const LEGACY_PATTERN_MAP = Object.freeze({
  task_recognition: "task_target",
  stability_emergency: "stability_urgency",
  clinical_sequence: "sequence_nbs",
  use_given_facts: "frame_assumption",
  hinge_vs_distractor: "hinge_discriminator",
  differential_discrimination: "hinge_discriminator",
  timeline: "timeline_course",
  modifier: "modifier_constraint",
  diagnose_vs_treat: "task_target",
  exact_task: "task_target",
  stability: "stability_urgency",
  sequence: "sequence_nbs",
  diagnose_treat: "task_target",
  given_facts: "frame_assumption",
  hinge: "hinge_discriminator",
  differential: "hinge_discriminator"
});

const LEGACY_PATTERN_TO_SPEED = Object.freeze({ answer_changing: "changed_answer", answer_change: "changed_answer" });
const LEGACY_BLANK_PATTERNS = new Set(["content_gap", "content_only", "custom", "elimination"]);
const LEGACY_SPEED_MAP = Object.freeze({
  rushed: "rushed",
  overthought: "overthought",
  overanalysis: "overthought",
  reread_loop: "reread_loop",
  reread: "reread_loop",
  changed_answer: "changed_answer",
  changed_wrong: "changed_answer",
  answer_changing: "changed_answer",
  slow_recall: "slow_recall",
  fatigue_attention: "fatigue_attention"
});

const PATTERN_VALUES = new Set(PATTERNS.map((item) => item.value));
const SPEED_VALUES = new Set(SPEED_FLAGS.map((item) => item.value));

function canonicalPattern(value) {
  const raw = String(value || "");
  if (PATTERN_VALUES.has(raw)) return raw;
  return LEGACY_PATTERN_MAP[raw] || "";
}

function canonicalSpeedFlags(values, pattern = "") {
  const input = Array.isArray(values) ? values : [];
  const mapped = input.map((value) => LEGACY_SPEED_MAP[value]).filter(Boolean);
  const fromPattern = LEGACY_PATTERN_TO_SPEED[pattern];
  if (fromPattern) mapped.push(fromPattern);
  return [...new Set(mapped)];
}

window.ThunderShadowReasoning = {
  LEGACY_BLANK_PATTERNS,
  LEGACY_PATTERN_MAP,
  LEGACY_PATTERN_TO_SPEED,
  LEGACY_SPEED_MAP,
  PATTERNS,
  PATTERN_VALUES,
  SPEED_FLAGS,
  SPEED_VALUES,
  canonicalPattern,
  canonicalSpeedFlags
};
})();
