// @ts-nocheck
'use strict';

/**
 * Learning Analytics – detailed, module-level learner state.
 *
 * Everything here is derived with the same rules the learner app uses (utils/course-modules
 * deriveModuleStates), from data loaded in a few batched queries:
 *  - user-progress (published row per learner + course): status, dates, content time, module content record
 *  - quiz-submission (published): every attempt per module, score, pass, review state, time taken
 *  - offline-module-completion: proof per offline module, completed_at, assessor
 *  - feedback-submission (published): feedback given per course
 *  - module-video-progress (published): minutes watched per video module
 *  - activity-log learning events (ingest API): when a module was first opened and the time spent
 *    (module_id is stored from the learner app's event metadata)
 *
 * Time figures come from the ingested events of the current attempt (see summarizeActivity): the time the
 * learner was active in the course — module pages, quiz instructions + attempts and the feedback form — with
 * each second given to a module, so module times add up to the course time. Every view uses this figure.
 * Learners with no time events yet (older data) fall back to the stored values:
 * user-progress.time_spent_minutes / module_activity and quiz-submission.time_taken_minutes.
 */

const {
  modulesForLanguage,
  moduleKeys,
  moduleHasQuiz,
  quizPassMark,
  deriveModuleStates,
  MODULE_TYPES,
} = require('../../../../utils/course-modules');

const COURSE_UID = 'api::course.course';
const PROGRESS_UID = 'api::user-progress.user-progress';
const QUIZ_UID = 'api::quiz-submission.quiz-submission';
const OFFLINE_UID = 'api::offline-module-completion.offline-module-completion';
const FEEDBACK_UID = 'api::feedback-submission.feedback-submission';
const VIDEO_UID = 'api::module-video-progress.module-video-progress';
const ACTIVITY_UID = 'api::activity-log.activity-log';
const ASSIGNMENT_UID = 'api::course-assignment.course-assignment';

const INACTIVE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const MODULE_EVENTS = [
  'learning_module_enter',
  'learning_module_exit',
  'learning_quiz_started',
  'learning_quiz_submitted',
  'learning_feedback_opened',
  'learning_feedback_submitted',
];
/** Events that carry the time spent since their start (duration_seconds). */
const TIMED_EVENTS = new Set(['learning_module_exit', 'learning_quiz_submitted', 'learning_feedback_submitted']);
/** Quiz / feedback: everything between opening and submitting counts. */
const OPENED_BY = { learning_quiz_submitted: 'learning_quiz_started', learning_feedback_submitted: 'learning_feedback_opened' };
const QUIZ_EVENTS = new Set(['learning_quiz_started', 'learning_quiz_submitted']);
/** Short gaps between events (moving between pages, quiz instructions) count as learning time. */
const BRIDGE_MS = 2 * 60 * 1000;
const USER_FIELDS = ['id', 'username', 'email', 'emp_code', 'emp_id', 'company', 'department', 'designation', 'branch', 'working_location', 'blocked'];

/** Module status per learner (shown in the UI as is). */
const STATUS = {
  COMPLETED: 'Completed',
  LOCKED: 'Locked',
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  QUIZ_PENDING: 'Quiz pending',
  QUIZ_FAILED: 'Quiz failed',
  REVIEW_PENDING: 'Review pending',
  PROOF_PENDING: 'Proof pending',
};
const IN_PROGRESS_STATUSES = new Set([STATUS.IN_PROGRESS, STATUS.QUIZ_PENDING, STATUS.QUIZ_FAILED, STATUS.REVIEW_PENDING]);

// ── small helpers ────────────────────────────────────────────────────────────

const time = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};
const iso = (t) => (t == null ? null : new Date(t).toISOString());
const round1 = (n) => Math.round(n * 10) / 10;
const avg = (list) => (list.length ? round1(list.reduce((s, n) => s + n, 0) / list.length) : null);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const minOf = (...list) => {
  const xs = list.filter((x) => x != null);
  return xs.length ? Math.min(...xs) : null;
};
const maxOf = (...list) => {
  const xs = list.filter((x) => x != null);
  return xs.length ? Math.max(...xs) : null;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toBool = (v) => v === true || v === 1 || ['true', 'yes', '1'].includes(String(v ?? '').trim().toLowerCase());
const pairKey = (userId, courseDocumentId) => `${userId}::${courseDocumentId}`;
const uniqNums = (list) => [...new Set((list || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];

function firstLanguage(course) {
  return (Array.isArray(course?.modules) ? course.modules : []).find((m) => m?.language)?.language || null;
}

function userLabel(u) {
  return u?.username || u?.email || (u?.id != null ? `User ${u.id}` : 'Unknown');
}

module.exports = ({ strapi }) => {
  const db = (uid) => strapi.db.query(uid);

  /** Course documentId for a course row id or documentId. */
  async function resolveCourseDocumentId(courseRef) {
    const ref = String(courseRef ?? '').trim();
    if (!ref) return null;
    if (/^\d+$/.test(ref)) {
      const row = await db(COURSE_UID).findOne({ where: { id: Number(ref) }, select: ['documentId'] });
      return row?.documentId || null;
    }
    return ref;
  }

  /**
   * "userId::courseDocumentId" pairs on a published Individual assignment (Department / Location
   * assignments create those per learner). Unassigned learners keep their progress, so this is what
   * decides who is assigned right now. null when there are no assignments at all (nothing to filter by).
   */
  async function loadActivePairs({ userIds = null, courseDocumentIds = null } = {}) {
    const where = { publishedAt: { $notNull: true }, assignment_target_type: 'Individual' };
    if (courseDocumentIds) where.courses = { documentId: { $in: courseDocumentIds } };
    if (userIds) where.individual_user = { id: { $in: userIds } };
    const rows = await db(ASSIGNMENT_UID).findMany({
      where,
      select: ['id'],
      populate: { courses: { select: ['documentId'] }, individual_user: { select: ['id'] } },
      limit: 50000,
    });
    if (!rows?.length) return null;
    const pairs = new Set();
    rows.forEach((a) =>
      (a.individual_user || []).forEach((u) =>
        (a.courses || []).forEach((c) => u?.id && c?.documentId && pairs.add(pairKey(u.id, c.documentId)))
      )
    );
    return pairs;
  }

  /** Courses (by row id) with modules, quiz question ids and feedback forms. */
  async function loadCourses(courseRowIds) {
    if (!courseRowIds.length) return new Map();
    const rows = await db(COURSE_UID).findMany({
      where: { id: { $in: courseRowIds } },
      select: ['id', 'documentId', 'title', 'course_version', 'course_category', 'min_passing_score', 'publishedAt'],
      populate: {
        modules: { populate: { quiz: { populate: { quiz_questions: { select: ['id', 'question_id'] } } } } },
        feedback: true,
      },
    });
    return new Map((rows || []).map((c) => [c.id, c]));
  }

  /** Groups rows by "userId::courseDocumentId". */
  function groupByPair(rows, userOf) {
    const map = new Map();
    (rows || []).forEach((r) => {
      const uid = userOf(r)?.id;
      const doc = r.course?.documentId;
      if (!uid || !doc) return;
      const key = pairKey(uid, doc);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return map;
  }

  /**
   * Loads every enrollment (published progress row) for the given users and/or courses, with all
   * the learner data needed to evaluate it.
   */
  async function loadEnrollmentData({ userIds = null, courseDocumentIds = null, activeOnly = true }) {
    if (Array.isArray(userIds) && userIds.length === 0) return [];
    const where = { publishedAt: { $notNull: true } };
    if (userIds) where.user = { id: { $in: userIds } };
    if (courseDocumentIds) where.course = { documentId: { $in: courseDocumentIds } };

    const progressRows = await db(PROGRESS_UID).findMany({
      where,
      select: [
        'id', 'progress_status', 'progress_percentage', 'completed_modules', 'module_activity', 'started_at',
        'completed_at', 'last_accessed_at', 'time_spent_minutes', 'certificate_issued', 'selected_language',
        'due_date', 'course_version', 'createdAt',
      ],
      populate: { user: { select: USER_FIELDS }, course: { select: ['id', 'documentId'] } },
      limit: 100000,
    });

    // One row per learner + course (newest wins if the data has duplicates).
    const byPair = new Map();
    (progressRows || []).forEach((p) => {
      if (!p.user?.id || !p.course?.documentId) return;
      const key = pairKey(p.user.id, p.course.documentId);
      const prev = byPair.get(key);
      if (!prev || p.id > prev.id) byPair.set(key, p);
    });

    if (activeOnly && byPair.size) {
      const active = await loadActivePairs({
        userIds: userIds || null,
        courseDocumentIds: courseDocumentIds || null,
      });
      if (active) [...byPair.keys()].forEach((key) => !active.has(key) && byPair.delete(key));
    }
    const progresses = [...byPair.values()];
    if (!progresses.length) return [];

    const pUserIds = uniqNums(progresses.map((p) => p.user.id));
    const docIds = [...new Set(progresses.map((p) => p.course.documentId))];
    // Every row of these courses (draft + published): related records may point at either.
    const courseRows = await db(COURSE_UID).findMany({
      where: { documentId: { $in: docIds } },
      select: ['id', 'documentId', 'publishedAt'],
    });
    const rowIds = uniqNums((courseRows || []).map((c) => c.id));
    const courseKeys = [...new Set([...rowIds.map(String), ...docIds])];
    // Module structure: the published course row when there is one.
    const structureRowByDoc = new Map();
    (courseRows || []).forEach((c) => {
      const prev = structureRowByDoc.get(c.documentId);
      if (!prev || (c.publishedAt && !prev.publishedAt)) structureRowByDoc.set(c.documentId, c);
    });

    const [courses, submissions, offlineRecords, feedbacks, videos, events] = await Promise.all([
      loadCourses(uniqNums([...structureRowByDoc.values()].map((c) => c.id))),
      db(QUIZ_UID).findMany({
        where: { publishedAt: { $notNull: true }, submitted_by: { id: { $in: pUserIds } }, course: { id: { $in: rowIds } } },
        select: [
          'id', 'module_id', 'module_title', 'passed', 'score', 'attempt_number', 'submitted_at', 'review_status',
          'reviewed_at', 'time_taken_minutes', 'submission_type',
        ],
        populate: { submitted_by: { select: ['id'] }, course: { select: ['documentId'] } },
        orderBy: [{ attempt_number: 'asc' }, { submitted_at: 'asc' }],
        limit: 200000,
      }),
      db(OFFLINE_UID).findMany({
        where: { user: { id: { $in: pUserIds } }, course: { id: { $in: rowIds } } },
        select: ['id', 'module_id', 'module_title', 'completed_at', 'assessed_by', 'remarks'],
        populate: { proof: { select: ['id'] }, user: { select: ['id'] }, course: { select: ['documentId'] } },
        limit: 200000,
      }),
      db(FEEDBACK_UID).findMany({
        where: { publishedAt: { $notNull: true }, users_permissions_user: { id: { $in: pUserIds } }, course: { id: { $in: rowIds } } },
        select: ['id', 'createdAt'],
        populate: { users_permissions_user: { select: ['id'] }, course: { select: ['documentId'] } },
        limit: 200000,
      }),
      db(VIDEO_UID).findMany({
        where: { publishedAt: { $notNull: true }, user: { id: { $in: pUserIds } }, course: { id: { $in: rowIds } } },
        select: ['module_index', 'module_title', 'video_completion_type', 'time_watched_min', 'video_duration_min', 'last_updated'],
        populate: { user: { select: ['id'] }, course: { select: ['documentId'] } },
        limit: 200000,
      }),
      db(ACTIVITY_UID)
        .findMany({
          where: {
            user: { id: { $in: pUserIds } },
            activity_description: { $in: MODULE_EVENTS },
            entity_id: { $in: courseKeys },
          },
          select: ['activity_description', 'entity_id', 'module_id', 'activity_duration', 'session_id', 'timestamp'],
          populate: { user: { select: ['id'] } },
          limit: 300000,
        })
        .catch((e) => {
          strapi.log.warn(`[analytics] module activity lookup failed: ${e?.message || e}`);
          return [];
        }),
    ]);

    const subsByPair = groupByPair(submissions, (r) => r.submitted_by);
    const offlineByPair = groupByPair(offlineRecords, (r) => r.user);
    const feedbackByPair = groupByPair(feedbacks, (r) => r.users_permissions_user);
    const videosByPair = groupByPair(videos, (r) => r.user);

    // Module telemetry: entity_id is the course row id or documentId.
    const docByCourseKey = new Map();
    (courseRows || []).forEach((c) => {
      docByCourseKey.set(String(c.id), c.documentId);
      docByCourseKey.set(c.documentId, c.documentId);
    });
    const eventsByPair = new Map();
    (events || []).forEach((e) => {
      const uid = e.user?.id;
      const doc = docByCourseKey.get(String(e.entity_id));
      const at = time(e.timestamp);
      if (!uid || !doc || at == null) return;
      const key = pairKey(uid, doc);
      if (!eventsByPair.has(key)) eventsByPair.set(key, []);
      eventsByPair.get(key).push({
        name: e.activity_description,
        moduleId: e.module_id ? String(e.module_id) : null,
        seconds: Math.max(0, num(e.activity_duration) || 0),
        session: e.session_id || null,
        at,
      });
    });

    return progresses
      .map((progress) => {
        const doc = progress.course.documentId;
        const course = courses.get(structureRowByDoc.get(doc)?.id);
        if (!course) return null;
        const key = pairKey(progress.user.id, doc);
        return {
          progress,
          user: progress.user,
          course,
          submissions: subsByPair.get(key) || [],
          offlineRecords: offlineByPair.get(key) || [],
          feedbacks: feedbackByPair.get(key) || [],
          videos: videosByPair.get(key) || [],
          events: eventsByPair.get(key) || [],
        };
      })
      .filter(Boolean);
  }

  // ── evaluation of one enrollment ────────────────────────────────────────────

  /**
   * Learning events of the current attempt → when modules were opened and the time spent.
   * Current attempt: events from the browser session in which the progress record was created onward
   * (a reset learner gets a new record; events of the earlier attempt are left out).
   * Time: the gap between two events of one session counts when the later event covers it (module exit /
   * quiz / feedback duration, hidden-tab time already excluded) or when it is short (BRIDGE_MS). It goes to
   * the module the learner was on; gaps ending in a quiz event are quiz time.
   */
  function summarizeActivity(events, anchor) {
    if (!events?.length) return null;
    const sorted = [...events].sort((a, b) => a.at - b.at);
    let from = anchor;
    if (anchor != null) {
      const session = sorted.find((e) => e.at >= anchor)?.session;
      if (session) from = minOf(anchor, ...sorted.filter((e) => e.session === session).map((e) => e.at));
    }
    const list = from == null ? sorted : sorted.filter((e) => e.at >= from);
    if (!list.length) return null;

    const out = { first: list[0].at, last: list[list.length - 1].at, contentSeconds: 0, quizSeconds: 0, modules: new Map() };
    const moduleOf = (id) => {
      if (!out.modules.has(id)) out.modules.set(id, { firstOpened: null, lastSeen: null, contentSeconds: 0, quizSeconds: 0 });
      return out.modules.get(id);
    };
    let current = null;
    list.forEach((e, i) => {
      if (e.moduleId) {
        const m = moduleOf(e.moduleId);
        if (e.name === 'learning_module_enter') m.firstOpened = minOf(m.firstOpened, e.at);
        m.lastSeen = maxOf(m.lastSeen, e.at);
      }
      const prev = list[i - 1];
      if (prev && prev.session === e.session) {
        const gap = e.at - prev.at;
        let ms;
        if (OPENED_BY[e.name] && prev.name === OPENED_BY[e.name]) ms = gap;
        else if (gap <= BRIDGE_MS) ms = gap;
        else ms = TIMED_EVENTS.has(e.name) ? Math.min(gap, e.seconds * 1000) : 0;
        if (ms > 0) {
          const kind = QUIZ_EVENTS.has(e.name) ? 'quizSeconds' : 'contentSeconds';
          const target = TIMED_EVENTS.has(e.name) || QUIZ_EVENTS.has(e.name) ? e.moduleId || current : current || e.moduleId;
          out[kind] += ms / 1000;
          if (target) moduleOf(target)[kind] += ms / 1000;
        }
      }
      if (e.moduleId) current = e.moduleId;
    });
    return out;
  }

  function quizSummary(state, submissions) {
    const final = submissions.filter((s) => s.review_status !== 'Pending_review');
    const scores = final.map((s) => num(s.score)).filter((n) => n != null);
    return {
      attempts: state.quiz.attempts,
      maxAttempt: state.quiz.max_attempt,
      passMark: state.quiz.pass_mark,
      passed: state.quiz.passed,
      pendingReview: state.quiz.pending_review,
      bestScore: scores.length ? Math.max(...scores) : null,
      latestScore: state.quiz.last_score,
      firstAttemptAt: iso(minOf(...submissions.map((s) => time(s.submitted_at)))),
      timeMinutes: round1(submissions.reduce((s, x) => s + Math.max(0, num(x.time_taken_minutes) || 0), 0)),
      history: submissions.map((s, i) => ({
        attempt: num(s.attempt_number) ?? i + 1,
        score: s.review_status === 'Pending_review' ? null : num(s.score),
        passed: s.review_status === 'Pending_review' ? null : s.passed === true,
        reviewStatus: s.review_status || 'Not_required',
        submittedAt: s.submitted_at || null,
        reviewedAt: s.reviewed_at || null,
        timeTakenMinutes: num(s.time_taken_minutes),
        submissionType: s.submission_type || null,
      })),
    };
  }

  function moduleStatus(state, touched) {
    if (state.completed) return STATUS.COMPLETED;
    if (!state.unlocked) return STATUS.LOCKED;
    if (state.module_type === MODULE_TYPES.OFFLINE) return STATUS.PROOF_PENDING;
    if (state.quiz?.pending_review) return STATUS.REVIEW_PENDING;
    if (state.quiz && state.quiz.attempts > 0 && state.quiz.last_passed === false) return STATUS.QUIZ_FAILED;
    if (state.has_quiz && state.content_completed) return STATUS.QUIZ_PENDING;
    if (state.content_completed || touched) return STATUS.IN_PROGRESS;
    return STATUS.NOT_STARTED;
  }

  /** Full picture of one learner in one course. */
  function evaluate({ progress, user, course, submissions, offlineRecords, feedbacks, videos, events }) {
    const activity = summarizeActivity(events, time(progress.createdAt));
    const tracked = !!activity && activity.contentSeconds + activity.quizSeconds > 0;
    const language = progress.selected_language || firstLanguage(course);
    const summary = deriveModuleStates({
      course,
      progress,
      language,
      submissions,
      offlineRecords,
      includeSubmissions: true,
    });
    const langModules = modulesForLanguage(course.modules, language);
    const moduleActivity = progress.module_activity && typeof progress.module_activity === 'object' ? progress.module_activity : {};
    const now = Date.now();

    const modules = summary.modules.map((state) => {
      const m = langModules[state.index];
      const keys = moduleKeys(m);
      const record = keys.map((k) => moduleActivity[k]).find(Boolean) || null;
      const opened = keys.map((k) => activity?.modules.get(k)).find(Boolean) || null;
      const video =
        (videos || []).find((v) => v.module_title && m?.title && v.module_title.trim().toLowerCase() === m.title.trim().toLowerCase()) ||
        null;
      const quiz = state.quiz ? quizSummary(state, state.quiz.submissions || []) : null;
      const offline =
        state.module_type === MODULE_TYPES.OFFLINE
          ? (() => {
              const r = (offlineRecords || []).find((x) => x.module_id && keys.includes(String(x.module_id)));
              const proofCount = (r?.proof || []).length;
              return {
                proofUploaded: proofCount > 0,
                proofCount,
                completedAt: proofCount > 0 ? r?.completed_at || null : null,
                assessedBy: proofCount > 0 ? r?.assessed_by || null : null,
                remarks: proofCount > 0 ? r?.remarks || null : null,
              };
            })()
          : null;

      // When the module was first opened / finished (only recorded values).
      const startedAt = minOf(opened?.firstOpened, time(quiz?.firstAttemptAt));
      let completedAt = null;
      if (state.completed) {
        if (offline) completedAt = time(offline.completedAt);
        else if (quiz) {
          const pass = (state.quiz.submissions || []).find((s) => s.passed === true && s.review_status !== 'Pending_review');
          completedAt = pass ? time(pass.review_status === 'Reviewed' && pass.reviewed_at ? pass.reviewed_at : pass.submitted_at) : null;
        } else completedAt = time(record?.completed_at);
      }
      // Event time when the learner app recorded time for this attempt, else the stored values.
      const contentMinutes = tracked
        ? (opened ? round1(opened.contentSeconds / 60) : null)
        : record ? num(record.time_spent_minutes) : null;
      const quizMinutes = tracked
        ? (opened?.quizSeconds > 0 ? round1(opened.quizSeconds / 60) : null)
        : quiz ? quiz.timeMinutes : null;
      const touched = !!opened || num(video?.time_watched_min) > 0 || (video && video.video_completion_type !== 'not_started');

      return {
        index: state.index,
        moduleId: state.module_id,
        title: state.title || `Module ${state.index + 1}`,
        type: state.module_type,
        hasQuiz: state.has_quiz,
        status: moduleStatus(state, touched),
        unlocked: state.unlocked,
        contentCompleted: state.content_completed,
        completed: state.completed,
        startedAt: iso(startedAt),
        completedAt: iso(completedAt),
        contentMinutes,
        quizMinutes,
        timeSpentMinutes: contentMinutes == null && !quizMinutes ? null : round1((contentMinutes || 0) + (quizMinutes || 0)),
        video: video
          ? {
              watchedMinutes: num(video.time_watched_min),
              durationMinutes: num(video.video_duration_min),
              completionType: video.video_completion_type || null,
            }
          : null,
        quiz,
        offline,
      };
    });

    const attempts = submissions.length;
    const startedAt = time(progress.started_at);
    const started =
      ['In_progress', 'Failed', 'Completed'].includes(progress.progress_status) ||
      (progress.completed_modules || []).length > 0 ||
      summary.completedCount > 0 ||
      startedAt != null ||
      attempts > 0 ||
      activity?.first != null;
    const current = summary.currentModule;
    let status = 'Not_started';
    if (summary.allCompleted) status = 'Completed';
    else if (current?.quiz && current.quiz.last_passed === false) status = 'Failed';
    else if (started) status = 'In_progress';

    const completedAt = summary.allCompleted ? time(progress.completed_at) ?? maxOf(...modules.map((m) => time(m.completedAt))) : null;
    const lastActivityAt = maxOf(
      time(progress.last_accessed_at),
      activity?.last,
      ...submissions.map((s) => time(s.submitted_at))
    );
    const dueAt = progress.due_date ? time(`${String(progress.due_date).slice(0, 10)}T23:59:59`) : null;

    const feedbackForms = Array.isArray(course.feedback) ? course.feedback : [];
    const feedbackEnabled = feedbackForms.length > 0;
    const feedbackSubmittedAt = minOf(...(feedbacks || []).map((f) => time(f.createdAt)));
    const feedbackSubmitted = (feedbacks || []).length > 0;

    const contentMinutes = tracked
      ? round1(activity.contentSeconds / 60)
      : Math.max(0, num(progress.time_spent_minutes) || 0);
    const quizMinutes = tracked
      ? round1(activity.quizSeconds / 60)
      : round1(submissions.reduce((s, x) => s + Math.max(0, num(x.time_taken_minutes) || 0), 0));
    const quizModules = modules.filter((m) => m.quiz);
    const online = modules.filter((m) => m.type !== MODULE_TYPES.OFFLINE);
    const offline = modules.filter((m) => m.type === MODULE_TYPES.OFFLINE);
    const currentDetail = current ? modules[current.index] : null;

    return {
      userId: user.id,
      user: {
        id: user.id,
        name: userLabel(user),
        email: user.email || null,
        empCode: user.emp_code || null,
        empId: user.emp_id || null,
        company: user.company || null,
        department: user.department || null,
        designation: user.designation || null,
        location: user.working_location || user.branch || null,
      },
      courseId: course.id,
      courseDocumentId: course.documentId,
      courseTitle: course.title || 'Untitled course',
      courseVersion: progress.course_version || course.course_version || null,
      courseCategory: course.course_category || null,
      language,
      status,
      progressPercent: summary.percentage,
      totalModules: summary.total,
      completedModules: summary.completedCount,
      onlineModules: online.length,
      onlineCompleted: online.filter((m) => m.completed).length,
      offlineModules: offline.length,
      offlineCompleted: offline.filter((m) => m.completed).length,
      offlineProofPending: offline.filter((m) => m.status === STATUS.PROOF_PENDING).length,
      currentModule: currentDetail
        ? { index: currentDetail.index, title: currentDetail.title, type: currentDetail.type, status: currentDetail.status }
        : null,
      assignedAt: progress.createdAt || null,
      startedAt: iso(startedAt ?? (started ? minOf(activity?.first, ...submissions.map((s) => time(s.submitted_at))) : null)),
      completedAt: iso(completedAt),
      dueDate: progress.due_date || null,
      overdue: status !== 'Completed' && dueAt != null && dueAt < now,
      lastActivityAt: iso(lastActivityAt),
      inactiveDays: lastActivityAt != null ? Math.max(0, Math.floor((now - lastActivityAt) / DAY_MS)) : null,
      completionDays: startedAt != null && completedAt != null ? round1(Math.max(0, completedAt - startedAt) / DAY_MS) : null,
      time: { contentMinutes, quizMinutes, totalMinutes: round1(contentMinutes + quizMinutes) },
      quiz: {
        quizModules: quizModules.length,
        passedModules: quizModules.filter((m) => m.quiz.passed).length,
        attempts,
        // Average of each quiz's best score (the score that counts); retakes do not pull it down.
        avgScore: avg(quizModules.map((m) => m.quiz.bestScore).filter((n) => n != null)),
      },
      feedback: {
        enabled: feedbackEnabled,
        compulsory: feedbackForms.some((f) => toBool(f?.compulsory)),
        submitted: feedbackSubmitted,
        submittedAt: iso(feedbackSubmittedAt),
        // Feedback is asked for once all modules are done.
        pending: feedbackEnabled && !feedbackSubmitted && summary.allCompleted,
      },
      modules,
    };
  }

  // ── aggregations ───────────────────────────────────────────────────────────

  function isDroppedOff(e) {
    return e.status !== 'Completed' && e.status !== 'Not_started' && e.inactiveDays != null && e.inactiveDays >= INACTIVE_DAYS;
  }

  function learnerRow(e) {
    return {
      name: e.user.name,
      email: e.user.email,
      empCode: e.user.empCode,
      empId: e.user.empId,
      department: e.user.department,
      status: e.status,
      progressPercent: e.progressPercent,
      completedModules: e.completedModules,
      totalModules: e.totalModules,
      currentModule: e.currentModule?.title || null,
      currentModuleIndex: e.currentModule?.index ?? null,
      quizAttempts: e.quiz.attempts,
      avgQuizScore: e.quiz.avgScore,
      feedback: !e.feedback.enabled ? 'Not required' : e.feedback.submitted ? 'Submitted' : e.feedback.pending ? 'Pending' : 'Not yet due',
      startedAt: e.startedAt,
      completedAt: e.completedAt,
      dueDate: e.dueDate,
      overdue: e.overdue,
      lastActivityAt: e.lastActivityAt,
      inactiveDays: e.inactiveDays,
      learningMinutes: e.time.totalMinutes,
      completionDays: e.completionDays,
    };
  }

  /** Course view: one course across the given learners (module rows, learner rows and course figures). */
  function summarizeCourse(course, enrollments) {
    const total = enrollments.length;
    const by = (s) => enrollments.filter((e) => e.status === s).length;
    const started = enrollments.filter((e) => e.status !== 'Not_started');
    const completed = enrollments.filter((e) => e.status === 'Completed');
    const dropped = enrollments.filter(isDroppedOff);
    const quizStates = enrollments.flatMap((e) => e.modules.filter((m) => m.quiz && m.quiz.attempts > 0).map((m) => m.quiz));

    // Reference module list: the course's first language; other languages line up by position.
    const reference = modulesForLanguage(course.modules, firstLanguage(course));
    const moduleCount = Math.max(reference.length, ...enrollments.map((e) => e.modules.length), 0);
    const modules = Array.from({ length: moduleCount }, (_, index) => {
      const ref = reference[index];
      const rows = enrollments.map((e) => e.modules[index]).filter(Boolean);
      const count = (pred) => rows.filter(pred).length;
      const attempted = rows.filter((r) => r.quiz && r.quiz.attempts > 0).map((r) => r.quiz);
      return {
        index,
        title: ref?.title || rows[0]?.title || `Module ${index + 1}`,
        type: ref ? (ref.module_type === MODULE_TYPES.OFFLINE ? MODULE_TYPES.OFFLINE : MODULE_TYPES.ONLINE) : rows[0]?.type,
        hasQuiz: ref ? moduleHasQuiz(ref) : rows.some((r) => r.hasQuiz),
        learners: rows.length,
        completed: count((r) => r.completed),
        completionRate: pct(count((r) => r.completed), rows.length),
        inProgress: count((r) => IN_PROGRESS_STATUSES.has(r.status)),
        notStarted: count((r) => r.status === STATUS.NOT_STARTED),
        locked: count((r) => r.status === STATUS.LOCKED),
        // Learners whose current module is this one (for "Most learners are on").
        stuckHere: enrollments.filter((e) => e.status !== 'Completed' && e.currentModule?.index === index).length,
        avgTimeMinutes: avg(rows.map((r) => r.timeSpentMinutes).filter((n) => n != null)),
        quiz: rows.some((r) => r.quiz)
          ? {
              attempts: attempted.reduce((s, q) => s + q.attempts, 0),
              passRate: pct(attempted.filter((q) => q.passed).length, attempted.length),
              avgScore: avg(attempted.map((q) => q.bestScore).filter((n) => n != null)),
            }
          : null,
      };
    });

    const biggestDrop = [...modules].filter((m) => m.stuckHere > 0).sort((a, b) => b.stuckHere - a.stuckHere)[0] || null;

    return {
      course: {
        title: course.title,
        version: course.course_version || null,
        category: course.course_category || null,
        totalModules: reference.length,
        onlineModules: reference.filter((m) => m.module_type !== MODULE_TYPES.OFFLINE).length,
        offlineModules: reference.filter((m) => m.module_type === MODULE_TYPES.OFFLINE).length,
        quizModules: modules.filter((m) => m.hasQuiz).length,
        passMark: quizPassMark(course),
        feedbackEnabled: Array.isArray(course.feedback) && course.feedback.length > 0,
      },
      summary: {
        assigned: total,
        notStarted: by('Not_started'),
        inProgress: by('In_progress') + by('Failed'),
        completed: completed.length,
        completionRate: pct(completed.length, total),
        avgProgress: total ? Math.round(enrollments.reduce((s, e) => s + e.progressPercent, 0) / total) : 0,
        dropOffRate: pct(dropped.length, started.length),
      },
      timing: {
        // Completed learners when there are any, otherwise everyone who started.
        avgLearningMinutes: avg((completed.length ? completed : started).map((e) => e.time.totalMinutes)),
        avgQuizMinutes: avg(started.map((e) => e.time.quizMinutes)),
      },
      quiz: {
        attempts: quizStates.reduce((s, q) => s + q.attempts, 0),
        avgScore: avg(quizStates.map((q) => q.bestScore).filter((n) => n != null)),
        // Per learner and quiz module: did they pass (eventually).
        passRate: pct(quizStates.filter((q) => q.passed).length, quizStates.length),
      },
      feedback: {
        submitted: enrollments.filter((e) => e.feedback.submitted).length,
        pending: enrollments.filter((e) => e.feedback.pending).length,
      },
      inactiveDaysThreshold: INACTIVE_DAYS,
      biggestDropModule: biggestDrop ? { index: biggestDrop.index, title: biggestDrop.title, learners: biggestDrop.stuckHere } : null,
      modules,
      learners: enrollments.map(learnerRow).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Employee table: one learner across their courses. */
  function summarizeEmployee(enrollments) {
    const by = (s) => enrollments.filter((e) => e.status === s).length;
    const scores = enrollments.flatMap((e) =>
      e.modules.filter((m) => m.quiz && m.quiz.bestScore != null).map((m) => m.quiz.bestScore)
    );
    const lastActivity = maxOf(...enrollments.map((e) => time(e.lastActivityAt)));
    const sum = (f) => enrollments.reduce((s, e) => s + f(e), 0);
    return {
      coursesAssigned: enrollments.length,
      coursesNotStarted: by('Not_started'),
      coursesStarted: enrollments.filter((e) => e.status !== 'Not_started').length,
      coursesInProgress: by('In_progress') + by('Failed'),
      coursesCompleted: by('Completed'),
      coursesOverdue: enrollments.filter((e) => e.overdue).length,
      avgProgress: enrollments.length ? Math.round(sum((e) => e.progressPercent) / enrollments.length) : 0,
      onlineModulesCompleted: sum((e) => e.onlineCompleted),
      onlineModulesTotal: sum((e) => e.onlineModules),
      offlineModulesCompleted: sum((e) => e.offlineCompleted),
      offlineModulesTotal: sum((e) => e.offlineModules),
      offlineProofPending: sum((e) => e.offlineProofPending),
      quizAttempts: sum((e) => e.quiz.attempts),
      quizModulesPassed: sum((e) => e.quiz.passedModules),
      quizModulesTotal: sum((e) => e.quiz.quizModules),
      avgQuizScore: avg(scores),
      feedbackSubmitted: enrollments.filter((e) => e.feedback.submitted).length,
      feedbackPending: enrollments.filter((e) => e.feedback.pending).length,
      contentMinutes: round1(sum((e) => e.time.contentMinutes)),
      quizMinutes: round1(sum((e) => e.time.quizMinutes)),
      learningMinutes: round1(sum((e) => e.time.totalMinutes)),
      lastActivityAt: iso(lastActivity),
      inactiveDays: lastActivity != null ? Math.max(0, Math.floor((Date.now() - lastActivity) / DAY_MS)) : null,
    };
  }

  // ── Course view filters ──────────────────────────────────────────────────────

  const isSet = (v) => v != null && String(v).trim() !== '' && !/^all(\s|$)/i.test(String(v).trim());

  async function nameOf(uid, ref) {
    const key = String(ref).trim();
    const where = /^\d+$/.test(key) ? { id: Number(key) } : { documentId: key };
    const row = await db(uid).findOne({ where, select: ['name'] }).catch(() => null);
    return row?.name || null;
  }

  /** Page filters → values to match learners against (department / location ids become names). */
  async function resolveFilters(params = {}) {
    const f = {};
    if (isSet(params.company)) {
      const c = String(params.company).trim();
      f.company = /^aia$/i.test(c) ? 'AIA' : /^vega$/i.test(c) ? 'Vega' : c;
    }
    if (isSet(params.department)) f.department = (await nameOf('api::department.department', params.department)) || String(params.department);
    if (isSet(params.unitLocation)) {
      f.location =
        (await nameOf('api::work-location.work-location', params.unitLocation)) ||
        (await nameOf('api::unit-location.unit-location', params.unitLocation)) ||
        String(params.unitLocation);
    }
    if (isSet(params.courseCategory)) f.category = String(params.courseCategory);
    if (params.dateFrom) f.from = time(`${String(params.dateFrom).slice(0, 10)}T00:00:00`);
    if (params.dateTo) f.to = time(`${String(params.dateTo).slice(0, 10)}T23:59:59`);
    if (isSet(params.quizStatus)) f.quizStatus = String(params.quizStatus).toLowerCase();
    if (isSet(params.feedbackGiven)) f.feedbackGiven = String(params.feedbackGiven).toLowerCase();
    return f;
  }

  /** Learner ids of one company (narrows the database query before anything is evaluated). */
  async function companyUserIds(company) {
    if (!company) return null;
    const rows = await db('plugin::users-permissions.user').findMany({ where: { company }, select: ['id'], limit: 100000 });
    return uniqNums((rows || []).map((u) => u.id));
  }

  function matchesFilters(e, f) {
    const low = (v) => String(v ?? '').trim().toLowerCase();
    if (f.company && e.user.company !== f.company) return false;
    if (f.department && low(e.user.department) !== low(f.department)) return false;
    if (f.location && !low(e.user.location).includes(low(f.location))) return false;
    if (f.category && e.courseCategory !== f.category) return false;
    // Date range: learners active in the period.
    const last = time(e.lastActivityAt);
    if ((f.from || f.to) && last == null) return false;
    if (f.from && last < f.from) return false;
    if (f.to && last > f.to) return false;
    if (f.quizStatus === 'pass' || f.quizStatus === 'fail') {
      const graded = e.modules.flatMap((m) => (m.quiz ? m.quiz.history.filter((h) => h.passed != null) : []));
      const passed = graded.some((h) => h.passed);
      if (f.quizStatus === 'pass' ? !passed : passed || !graded.length) return false;
    }
    if (f.feedbackGiven === 'yes' && !e.feedback.submitted) return false;
    if (f.feedbackGiven === 'no' && e.feedback.submitted) return false;
    return true;
  }

  async function filteredEnrollments(params, courseDocumentIds = null) {
    const f = await resolveFilters(params);
    const userIds = await companyUserIds(f.company);
    const data = await loadEnrollmentData({ userIds, courseDocumentIds });
    return data
      .map((d) => ({ course: d.course, e: evaluate(d) }))
      .filter(({ e }) => matchesFilters(e, f));
  }

  return {
    LEARNING_MODULE_STATUS: STATUS,

    /** Adds `version` (course_version) to course dropdown options ({ id, documentId, title }). */
    async withCourseVersions(list = []) {
      const docIds = [...new Set(list.map((c) => c?.documentId).filter(Boolean))];
      const ids = uniqNums(list.map((c) => c?.id));
      if (!docIds.length && !ids.length) return list;
      const rows = await db(COURSE_UID).findMany({
        where: { $or: [{ documentId: { $in: docIds } }, { id: { $in: ids } }] },
        select: ['id', 'documentId', 'course_version'],
      });
      const byDoc = new Map();
      const byId = new Map();
      (rows || []).forEach((r) => {
        if (r.course_version) {
          byDoc.set(r.documentId, r.course_version);
          byId.set(r.id, r.course_version);
        }
      });
      return list.map((c) => ({ ...c, version: byDoc.get(c?.documentId) || byId.get(Number(c?.id)) || null }));
    },

    /** Course view table, no course selected: one row per course (with its modules for "View more"). */
    async getCoursesOverview(params = {}) {
      const rows = await filteredEnrollments(params);
      const byCourse = new Map();
      rows.forEach(({ course, e }) => {
        if (!byCourse.has(course.documentId)) byCourse.set(course.documentId, { course, list: [] });
        byCourse.get(course.documentId).list.push(e);
      });

      const courses = [...byCourse.values()]
        .map(({ course, list }) => {
          const d = summarizeCourse(course, list);
          return {
            courseId: course.id,
            documentId: course.documentId,
            title: d.course.title,
            version: d.course.version,
            category: d.course.category,
            totalModules: d.course.totalModules,
            onlineModules: d.course.onlineModules,
            offlineModules: d.course.offlineModules,
            quizModules: d.course.quizModules,
            passMark: d.course.passMark,
            feedbackEnabled: d.course.feedbackEnabled,
            assigned: d.summary.assigned,
            completed: d.summary.completed,
            completionRate: d.summary.completionRate,
            inProgress: d.summary.inProgress,
            notStarted: d.summary.notStarted,
            avgProgress: d.summary.avgProgress,
            dropOffRate: d.summary.dropOffRate,
            quizPassRate: d.quiz.passRate,
            avgQuizScore: d.quiz.avgScore,
            quizAttempts: d.quiz.attempts,
            feedbackSubmitted: d.feedback.submitted,
            feedbackPending: d.feedback.pending,
            avgLearningMinutes: d.timing.avgLearningMinutes,
            avgQuizMinutes: d.timing.avgQuizMinutes,
            biggestDropModule: d.biggestDropModule,
            modules: d.modules,
          };
        })
        .sort((a, b) => b.assigned - a.assigned || String(a.title).localeCompare(String(b.title)));

      return {
        inactiveDaysThreshold: INACTIVE_DAYS,
        learners: new Set(rows.map((r) => r.e.userId)).size,
        courses,
      };
    },

    /** Course view detail for one course; `filters` are the page filters (company, department…). */
    async getCourseLearningDetail(courseRef, { filters = {} } = {}) {
      const documentId = await resolveCourseDocumentId(courseRef);
      if (!documentId) return null;
      const rows = await filteredEnrollments(filters, [documentId]);
      const enrollments = rows.map((r) => r.e);
      const data = rows;
      let course = data[0]?.course || null;
      if (!course) {
        const row = await db(COURSE_UID).findOne({ where: { documentId, publishedAt: { $notNull: true } }, select: ['id'] })
          || await db(COURSE_UID).findOne({ where: { documentId }, select: ['id'] });
        course = row ? (await loadCourses([row.id])).get(row.id) : null;
      }
      return course ? summarizeCourse(course, enrollments) : null;
    },

    /** Personal view: every assigned course of one learner with module detail. */
    async getPersonalLearningDetail(userId, { courseRef = null } = {}) {
      const uid = Number(userId);
      if (!Number.isFinite(uid) || uid <= 0) return [];
      const documentId = courseRef ? await resolveCourseDocumentId(courseRef) : null;
      const data = await loadEnrollmentData({ userIds: [uid], courseDocumentIds: documentId ? [documentId] : null });
      return data
        .map(evaluate)
        .sort((a, b) => (time(b.assignedAt) || 0) - (time(a.assignedAt) || 0));
    },

    /**
     * Learning minutes per "userId::courseDocumentId" — the same figure the course, personal and employee
     * views show, for other screens (Course view KPIs / chart) to use.
     */
    async getLearningMinutesByEnrollment({ userIds = null, courseDocumentIds = null } = {}) {
      const data = await loadEnrollmentData({ userIds, courseDocumentIds, activeOnly: false });
      const out = new Map();
      data.forEach((d) => {
        const e = evaluate(d);
        out.set(pairKey(e.userId, e.courseDocumentId), e.time.totalMinutes);
      });
      return out;
    },

    /** Employee table: per-learner summary across their courses (or one course). Map userId → summary. */
    async getEmployeeLearningSummaries(userIds, { courseRef = null } = {}) {
      const ids = uniqNums(userIds);
      const out = new Map();
      if (!ids.length) return out;
      const documentId = courseRef ? await resolveCourseDocumentId(courseRef) : null;
      const data = await loadEnrollmentData({ userIds: ids, courseDocumentIds: documentId ? [documentId] : null });
      const byUser = new Map();
      data.map(evaluate).forEach((e) => {
        if (!byUser.has(e.userId)) byUser.set(e.userId, []);
        byUser.get(e.userId).push(e);
      });
      ids.forEach((id) => out.set(id, summarizeEmployee(byUser.get(id) || [])));
      return out;
    },

    /** Personal KPI cards from evaluated enrollments. */
    summarizePersonal(enrollments) {
      return summarizeEmployee(enrollments);
    },
  };
};
