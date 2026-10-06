// @ts-nocheck
'use strict';

/**
 * Turns saved quiz answers into readable text (option labels instead of keys), shared by
 * answer review, quiz results and the answers export.
 */

const { isDescriptive } = require('../../../../utils/quiz-review');
const { normalizeCompany } = require('../../../../utils/course-catalog');

function employeeName(user = {}) {
  return user.username || user.email || '-';
}

function optionLabel(question, value) {
  const token = String(value ?? '').trim();
  if (!token) return '';
  const options = Array.isArray(question?.options) ? question.options : [];
  const hit = options.find(
    (o) => String(o?.option_key ?? '').trim() === token || String(o?.option_label ?? '').trim() === token
  );
  return hit ? String(hit.option_label || hit.option_key) : token;
}

function multiSelectValues(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (item && typeof item === 'object' ? item.answer ?? item.option_key ?? item.option_label : item))
    .filter((v) => v != null && String(v).trim() !== '');
}

function learnerAnswer(answer, question) {
  if (isDescriptive(answer)) return String(answer.user_answer_for_descriptive_question ?? '');
  if (answer.question_type === 'Multiple_select') {
    return multiSelectValues(answer.selected_answer_for_multiSelect).map((v) => optionLabel(question, v)).join(', ');
  }
  return optionLabel(question, answer.selected_answer_for_multiChoice);
}

function expectedAnswer(answer, question) {
  if (!question) return '';
  if (answer.question_type === 'Multiple_select') {
    return (Array.isArray(question.correct_multiSelect_answers) ? question.correct_multiSelect_answers : [])
      .map((x) => optionLabel(question, x?.answer))
      .filter(Boolean)
      .join(', ');
  }
  if (isDescriptive(answer)) return String(question.correct_answer ?? '');
  return optionLabel(question, question.correct_answer);
}

module.exports = { normalizeCompany, employeeName, optionLabel, learnerAnswer, expectedAnswer };
