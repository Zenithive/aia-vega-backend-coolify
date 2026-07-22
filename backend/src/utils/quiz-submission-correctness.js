// @ts-nocheck
'use strict';

const COURSE_UID = 'api::course.course';

function normalizeToken(v) {
  if (v == null) return '';
  return String(v).trim().toLowerCase();
}

function buildEquivalentChoiceTokens(question, rawValue) {
  const token = normalizeToken(rawValue);
  const out = new Set();
  if (!token) return out;
  out.add(token);

  const options = Array.isArray(question?.options) ? question.options : [];
  options.forEach((opt) => {
    const key = normalizeToken(opt?.option_key);
    const label = normalizeToken(opt?.option_label);
    if (!key && !label) return;
    if (token === key || token === label) {
      if (key) out.add(key);
      if (label) out.add(label);
    }
  });

  return out;
}

function canonicalize(question, tokenSet) {
  const out = new Set();
  const options = Array.isArray(question?.options) ? question.options : [];
  tokenSet.forEach((token) => {
    let mapped = token;
    options.forEach((opt) => {
      const key = normalizeToken(opt?.option_key);
      const label = normalizeToken(opt?.option_label);
      if (token === label && key) mapped = key;
    });
    out.add(mapped);
  });
  return out;
}

function areSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function extractSubmittedMultiSelectValues(submitted) {
  if (!Array.isArray(submitted)) return [];
  return submitted
    .map((item) => {
      if (item == null) return null;
      if (typeof item === 'string' || typeof item === 'number') return item;
      if (typeof item === 'object') {
        return item.answer ?? item.option_key ?? item.option_label ?? null;
      }
      return null;
    })
    .filter((v) => v != null);
}

function extractCourseId(rawCourse) {
  if (rawCourse == null) return null;
  if (typeof rawCourse === 'number') return rawCourse;
  if (typeof rawCourse === 'string' && /^\d+$/.test(rawCourse.trim())) return Number(rawCourse.trim());
  if (typeof rawCourse === 'object') {
    if (rawCourse.id != null && Number.isFinite(Number(rawCourse.id))) return Number(rawCourse.id);
    if (Array.isArray(rawCourse.connect) && rawCourse.connect.length > 0) {
      const first = rawCourse.connect[0];
      if (first?.id != null && Number.isFinite(Number(first.id))) return Number(first.id);
    }
    if (Array.isArray(rawCourse.set) && rawCourse.set.length > 0) {
      const first = rawCourse.set[0];
      if (first?.id != null && Number.isFinite(Number(first.id))) return Number(first.id);
    }
  }
  return null;
}

async function populateAnswerCorrectField(strapi, data) {
  const answers = Array.isArray(data?.answers) ? data.answers : null;
  if (!answers || answers.length === 0) return;

  const courseId = extractCourseId(data?.course);
  if (!courseId) return;

  const course = await strapi.db.query(COURSE_UID).findOne({
    where: { id: Number(courseId) },
    populate: {
      quiz: {
        populate: {
          quiz_questions: {
            populate: {
              correct_multiSelect_answers: true,
              options: true,
            },
          },
        },
      },
    },
  });

  const quizQuestions = [];
  (Array.isArray(course?.quiz) ? course.quiz : []).forEach((qz) => {
    if (Array.isArray(qz?.quiz_questions)) quizQuestions.push(...qz.quiz_questions);
  });
  if (quizQuestions.length === 0) return;

  data.answers = answers.map((ans) => {
    const qid = ans?.question_id;
    const question = quizQuestions.find((q) => q?.question_id === qid);
    if (!question) return { ...ans, correct: false };

    let isCorrect = false;
    if (ans?.question_type === 'Multiple_choice') {
      const submitted = buildEquivalentChoiceTokens(question, ans?.selected_answer_for_multiChoice);
      const expected = buildEquivalentChoiceTokens(question, question?.correct_answer);
      isCorrect = [...submitted].some((token) => expected.has(token));
    } else if (ans?.question_type === 'Multiple_select') {
      const userVals = extractSubmittedMultiSelectValues(ans?.selected_answer_for_multiSelect);
      const expectedVals = (Array.isArray(question?.correct_multiSelect_answers) ? question.correct_multiSelect_answers : [])
        .map((x) => x?.answer)
        .filter((x) => x != null);

      const submittedSet = new Set();
      userVals.forEach((v) => buildEquivalentChoiceTokens(question, v).forEach((t) => submittedSet.add(t)));
      const expectedSet = new Set();
      expectedVals.forEach((v) => buildEquivalentChoiceTokens(question, v).forEach((t) => expectedSet.add(t)));

      isCorrect = areSetsEqual(canonicalize(question, submittedSet), canonicalize(question, expectedSet));
    }

    return {
      ...ans,
      correct: Boolean(isCorrect),
    };
  });
}

module.exports = {
  populateAnswerCorrectField,
};

