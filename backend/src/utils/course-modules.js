// @ts-nocheck
'use strict';

/**
 * Course module rules (single source of truth for sequence + completion).
 *
 * A course has an ordered list of modules per language. Each module is either:
 *  - Online:  content (video / pdf / text) and an optional quiz.
 *             completed = content read, and — when it has a quiz — the quiz passed.
 *             A quiz attempt whose descriptive answers await admin review (review_status
 *             Pending_review) is neither passed nor failed until the review is saved.
 *  - Offline: practical training/test done in the company, no quiz.
 *             completed = an admin attached completion proof to that learner's
 *             api::offline-module-completion record (created on course assignment).
 *
 * A module is unlocked only when every earlier module (same language) is completed.
 *
 * user-progress.completed_modules keeps the ids of modules whose *content* the learner
 * finished (and offline modules with proof) — true completion is derived here, so
 * quiz results and offline proof are never duplicated into progress rows.
 */

const COURSE_UID = 'api::course.course';
const USER_PROGRESS_UID = 'api::user-progress.user-progress';
const QUIZ_SUBMISSION_UID = 'api::quiz-submission.quiz-submission';
const OFFLINE_COMPLETION_UID = 'api::offline-module-completion.offline-module-completion';

const MODULE_TYPES = { ONLINE: 'Online', OFFLINE: 'Offline' };

/** Deep populate of modules + their quiz (questions/options/answers/instructions). */
const MODULE_QUIZ_POPULATE = {
  quiz: {
    populate: {
      quiz_questions: { populate: { options: true, correct_multiSelect_answers: true } },
      quiz_instruction: { populate: { checklist: true } },
    },
  },
};

function normLang(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/** Modules of the learner's language, in course order (falls back to all modules when none match). */
function modulesForLanguage(modules, language) {
  const list = Array.isArray(modules) ? modules : [];
  const lang = normLang(language);
  if (!lang) return list;
  const filtered = list.filter((m) => normLang(m?.language) === lang);
  return filtered.length > 0 ? filtered : list;
}

/** Keys a module may be referenced by in progress data (stable module_id, legacy component row id). */
function moduleKeys(m) {
  const keys = [];
  if (m?.module_id != null && String(m.module_id).trim()) keys.push(String(m.module_id));
  if (m?.id != null) keys.push(String(m.id));
  return keys;
}

function moduleType(m) {
  return m?.module_type === MODULE_TYPES.OFFLINE ? MODULE_TYPES.OFFLINE : MODULE_TYPES.ONLINE;
}

function isOffline(m) {
  return moduleType(m) === MODULE_TYPES.OFFLINE;
}

/** Online module with a quiz that has at least one question. */
function moduleHasQuiz(m) {
  if (isOffline(m)) return false;
  const questions = m?.quiz?.quiz_questions;
  return Array.isArray(questions) ? questions.length > 0 : !!m?.quiz;
}

function findModule(modules, ref) {
  if (ref == null || ref === '') return null;
  const key = String(ref);
  return (Array.isArray(modules) ? modules : []).find((m) => moduleKeys(m).includes(key)) || null;
}

/** All quizzes in a course, each tagged with the module it belongs to. */
function collectModuleQuizzes(course) {
  return (Array.isArray(course?.modules) ? course.modules : [])
    .filter((m) => !isOffline(m) && m?.quiz)
    .map((m) => ({ ...m.quiz, __module: m }));
}

/** Module whose quiz contains most of the submitted question ids (legacy submissions without module_id). */
function findModuleByQuestionIds(course, questionIds) {
  const ids = new Set((questionIds || []).filter(Boolean).map(String));
  let best = null;
  let bestCount = 0;
  collectModuleQuizzes(course).forEach((quiz) => {
    const count = (quiz.quiz_questions || []).filter((q) => ids.has(String(q?.question_id))).length;
    if (count > bestCount) {
      best = quiz.__module;
      bestCount = count;
    }
  });
  return best;
}

/** Pass mark (percentage) for every module quiz: the course's min_passing_score. */
function quizPassMark(course) {
  const mark = Number(course?.min_passing_score);
  return Number.isFinite(mark) ? mark : 0;
}

function quizMaxAttempt(quiz) {
  const n = Number(quiz?.max_attempt);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function resolveCourseRowId(strapi, courseRef) {
  if (courseRef == null || courseRef === '') return null;
  const num = Number(courseRef);
  if (Number.isFinite(num) && num > 0) return num;
  const row = await strapi.db.query(COURSE_UID).findOne({
    where: { documentId: String(courseRef), publishedAt: { $notNull: true } },
    select: ['id'],
  });
  if (row?.id) return Number(row.id);
  const any = await strapi.db.query(COURSE_UID).findOne({ where: { documentId: String(courseRef) }, select: ['id'] });
  return any?.id != null ? Number(any.id) : null;
}

/** Course row with modules (+ quizzes) and feedback, enough to evaluate progress. */
async function loadCourse(strapi, courseId, { withQuestions = false } = {}) {
  if (courseId == null) return null;
  const quizPopulate = withQuestions
    ? MODULE_QUIZ_POPULATE
    : { quiz: { populate: { quiz_questions: { select: ['id', 'question_id'] } } } };
  return strapi.db.query(COURSE_UID).findOne({
    where: { id: Number(courseId) },
    populate: { modules: { populate: quizPopulate }, feedback: true },
  });
}

/** Learner's progress row — the published row when the record has draft + published versions. */
async function loadProgress(strapi, userId, courseId) {
  const where = { user: Number(userId), course: Number(courseId) };
  const published = await strapi.db.query(USER_PROGRESS_UID).findOne({ where: { ...where, publishedAt: { $notNull: true } } });
  return published || strapi.db.query(USER_PROGRESS_UID).findOne({ where });
}

/** Update scalar progress fields on every row of the record (draft + published) so all readers agree. */
async function updateProgressRows(strapi, progress, data) {
  if (progress?.documentId) {
    await strapi.db.query(USER_PROGRESS_UID).updateMany({ where: { documentId: progress.documentId }, data });
  } else if (progress?.id != null) {
    await strapi.db.query(USER_PROGRESS_UID).update({ where: { id: progress.id }, data });
  }
}

/** An offline completion record counts only once proof files are attached. */
function hasProof(record) {
  return Array.isArray(record?.proof) && record.proof.length > 0;
}

/**
 * One offline-module-completion record per learner and offline module, created when the course is
 * assigned so admins only fill in proof, remarks, completed_at and assessed_by.
 * Records follow the learner's course language: a record without proof that points at another
 * language's module is moved to the offline module at the same position.
 * @returns {Promise<number>} records created or changed
 */
async function ensureOfflineCompletionEntries(strapi, { userId, courseId, language }) {
  const uid = Number(userId);
  const cid = Number(courseId);
  if (!uid || !cid) return 0;
  const course = await strapi.db.query(COURSE_UID).findOne({
    where: { id: cid },
    select: ['id', 'course_version'],
    populate: { modules: { select: ['id', 'module_id', 'title', 'language', 'module_type'] } },
  });
  const all = Array.isArray(course?.modules) ? course.modules : [];
  if (!all.some(isOffline)) return 0;

  // Before the learner picks a language, use the course's first language.
  const lang = language || all.find((m) => m?.language)?.language || null;
  const modules = modulesForLanguage(all, lang);
  const records = await strapi.db.query(OFFLINE_COMPLETION_UID).findMany({
    where: { user: uid, course: cid },
    select: ['id', 'documentId', 'module_id', 'module_title'],
    populate: { proof: { select: ['id'] } },
  });
  const inLearnerLanguage = (moduleId) => modules.some((m) => moduleKeys(m).includes(String(moduleId)));
  const positionOf = (moduleId) => {
    const m = all.find((x) => moduleKeys(x).includes(String(moduleId)));
    return m ? modulesForLanguage(all, m.language).indexOf(m) : -1;
  };

  const used = new Set();
  let changed = 0;
  for (const [index, m] of modules.entries()) {
    if (!isOffline(m) || !m.module_id) continue;
    const keys = moduleKeys(m);
    const record =
      records.find((r) => !used.has(r.id) && keys.includes(String(r.module_id))) ||
      records.find(
        (r) => !used.has(r.id) && !hasProof(r) && !inLearnerLanguage(r.module_id) && positionOf(r.module_id) === index
      );
    if (record) {
      used.add(record.id);
      if (record.module_id !== m.module_id || record.module_title !== (m.title || null)) {
        await strapi.documents(OFFLINE_COMPLETION_UID).update({
          documentId: record.documentId,
          data: { module_id: m.module_id, module_title: m.title || null },
        });
        changed++;
      }
      continue;
    }
    await strapi.documents(OFFLINE_COMPLETION_UID).create({
      data: {
        user: { connect: [{ id: uid }] },
        course: { connect: [{ id: cid }] },
        module_id: m.module_id,
        module_title: m.title || null,
        course_version: course.course_version || null,
      },
    });
    changed++;
  }
  return changed;
}

/**
 * Per-module state for one learner.
 * @returns {{ modules: object[], total: number, completedCount: number, allCompleted: boolean,
 *            currentModule: object|null, percentage: number }}
 */
async function computeModuleStates(strapi, { course, userId, progress, language }) {
  const lang = language ?? progress?.selected_language ?? null;
  const modules = modulesForLanguage(course?.modules, lang);
  const contentDone = new Set((Array.isArray(progress?.completed_modules) ? progress.completed_modules : []).map(String));
  const legacyCompleted = progress?.progress_status === 'Completed';

  const [submissions, offlineRecords] = await Promise.all([
    userId && course?.id
      ? strapi.db.query(QUIZ_SUBMISSION_UID).findMany({
          where: { submitted_by: Number(userId), course: Number(course.id) },
          select: ['id', 'module_id', 'passed', 'score', 'attempt_number', 'submitted_at', 'review_status'],
          orderBy: { attempt_number: 'asc' },
        })
      : [],
    userId && course?.id
      ? strapi.db.query(OFFLINE_COMPLETION_UID).findMany({
          where: { user: Number(userId), course: Number(course.id) },
          select: ['id', 'documentId', 'module_id', 'completed_at', 'remarks', 'assessed_by'],
          populate: { proof: { select: ['id', 'name', 'url', 'mime'] } },
        })
      : [],
  ]);

  const quizModules = modules.filter(moduleHasQuiz);
  const lastQuizModule = quizModules[quizModules.length - 1] || null;
  const submissionsFor = (m) =>
    (submissions || []).filter((s) =>
      s.module_id ? moduleKeys(m).includes(String(s.module_id)) : lastQuizModule === m // legacy rows: course-level quiz
    );

  let blocked = false;
  const states = modules.map((m, index) => {
    const keys = moduleKeys(m);
    const type = moduleType(m);
    const read = keys.some((k) => contentDone.has(k));
    const state = {
      index,
      module_id: m.module_id ?? null,
      id: m.id ?? null,
      title: m.title ?? null,
      language: m.language ?? null,
      module_type: type,
      has_quiz: moduleHasQuiz(m),
      content_completed: read,
      completed: false,
      unlocked: !blocked,
      quiz: null,
      offline_completion: null,
    };

    if (type === MODULE_TYPES.OFFLINE) {
      const record = (offlineRecords || []).find((r) => r.module_id && keys.includes(String(r.module_id)));
      // Records are created on assignment; the module is completed once proof is attached.
      state.completed = hasProof(record);
      state.offline_completion = state.completed ? record : null;
    } else if (state.has_quiz) {
      const subs = submissionsFor(m);
      const last = subs[subs.length - 1] || null;
      const passed = subs.some((s) => s.passed === true);
      // Score of an attempt under review is provisional (auto-graded part only): not shown / not a fail.
      const pendingReview = last?.review_status === 'Pending_review';
      state.quiz = {
        attempts: subs.length,
        max_attempt: quizMaxAttempt(m.quiz),
        pass_mark: quizPassMark(course),
        passed,
        pending_review: pendingReview,
        last_score: pendingReview ? null : last?.score ?? null,
        last_passed: last && !pendingReview ? last.passed === true : null,
      };
      state.completed = passed || legacyCompleted;
    } else {
      state.completed = read || legacyCompleted;
    }

    if (!state.completed) blocked = true;
    return state;
  });

  const completedCount = states.filter((s) => s.completed).length;
  const total = states.length;
  return {
    modules: states,
    total,
    completedCount,
    allCompleted: total > 0 && completedCount === total,
    currentModule: states.find((s) => !s.completed) || null,
    percentage: total > 0 ? Math.round((completedCount / total) * 100) : 0,
  };
}

/** What the learner has to do next (kept compatible with the previous nextStep values). */
function nextStepFor(summary, course) {
  if (!summary.allCompleted) {
    const current = summary.currentModule;
    if (!current) return 'continue';
    if (current.module_type === MODULE_TYPES.OFFLINE) return 'offline_assessment_pending';
    if (current.has_quiz && current.quiz?.pending_review) return 'quiz_review_pending';
    if (current.has_quiz && current.content_completed) return 'quiz_required';
    return 'continue';
  }
  const feedbackCompulsory = course?.feedback?.[0]?.compulsory ?? false;
  return feedbackCompulsory ? 'feedback_required' : 'course_complete_allowed';
}

/**
 * Re-derive and persist progress_status / percentage for a learner after any completion event
 * (module read, quiz submitted, offline proof added or removed).
 */
async function recomputeProgress(strapi, { userId, courseId, progress: givenProgress, course: givenCourse }) {
  const numCourseId = Number(courseId);
  const progress = givenProgress || (await loadProgress(strapi, userId, numCourseId));
  if (!progress) return null;
  const course = givenCourse || (await loadCourse(strapi, numCourseId));
  if (!course) return null;

  const summary = await computeModuleStates(strapi, { course, userId, progress });
  const now = new Date();
  const data = { progress_percentage: summary.percentage, last_accessed_at: now };

  if (summary.allCompleted) {
    data.progress_status = 'Completed';
    data.completed_at = progress.completed_at || now;
    data.certificate_issued = true;
  } else {
    const current = summary.currentModule;
    const failedQuiz = current?.quiz && current.quiz.last_passed === false;
    const started =
      ['In_progress', 'Failed', 'Completed'].includes(progress.progress_status) ||
      (progress.completed_modules || []).length > 0 ||
      summary.completedCount > 0;
    if (failedQuiz) data.progress_status = 'Failed';
    else data.progress_status = started ? 'In_progress' : 'Not_started';
    data.completed_at = null;
  }

  await updateProgressRows(strapi, progress, data);
  return { ...summary, progress_status: data.progress_status, nextStep: nextStepFor(summary, course) };
}

/** Add or remove a module id in user-progress.completed_modules. */
async function setModuleContentDone(strapi, progress, moduleId, done = true) {
  if (!progress || !moduleId) return progress;
  const set = new Set((Array.isArray(progress.completed_modules) ? progress.completed_modules : []).map(String));
  if (done) set.add(String(moduleId));
  else set.delete(String(moduleId));
  const completed_modules = [...set];
  await updateProgressRows(strapi, progress, { completed_modules });
  return { ...progress, completed_modules };
}

/**
 * Normalise course.modules on create/update (Document Service middleware):
 * missing type → Online; Offline modules carry no online content or quiz;
 * a module quiz always uses its module's language.
 */
function normalizeCourseModules(data) {
  if (!data || !Array.isArray(data.modules)) return;
  data.modules.forEach((m) => {
    if (!m || typeof m !== 'object') return;
    if (!m.module_type) m.module_type = MODULE_TYPES.ONLINE;
    if (m.module_type === MODULE_TYPES.OFFLINE) {
      m.module_content_type = null;
      m.video_file = [];
      m.pdf_file = [];
      m.text_content = null;
      m.video_description = null;
      m.quiz = null;
    } else if (m.quiz && typeof m.quiz === 'object' && m.language) {
      m.quiz.language = m.language;
    }
  });
}

module.exports = {
  normalizeCourseModules,
  hasProof,
  ensureOfflineCompletionEntries,
  COURSE_UID,
  USER_PROGRESS_UID,
  QUIZ_SUBMISSION_UID,
  OFFLINE_COMPLETION_UID,
  MODULE_TYPES,
  MODULE_QUIZ_POPULATE,
  modulesForLanguage,
  moduleKeys,
  moduleType,
  isOffline,
  moduleHasQuiz,
  findModule,
  collectModuleQuizzes,
  findModuleByQuestionIds,
  quizPassMark,
  quizMaxAttempt,
  resolveCourseRowId,
  loadCourse,
  loadProgress,
  updateProgressRows,
  computeModuleStates,
  nextStepFor,
  recomputeProgress,
  setModuleContentDone,
};
