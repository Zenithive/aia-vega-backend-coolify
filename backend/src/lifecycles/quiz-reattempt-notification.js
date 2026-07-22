'use strict';

/**
 * When a quiz reattempt request is updated to Approved or Rejected,
 * send notification to the user (bell + email). Single place for both
 * plugin UI and Content Manager / API updates.
 */

const QUIZ_REATTEMPT_UID = 'api::quiz-reattempt-request.quiz-reattempt-request';

function getRelationId(rel) {
  if (rel == null) return null;
  if (typeof rel === 'number') return rel;
  if (typeof rel === 'object' && rel !== null) return rel.id ?? rel.documentId ?? rel.document_id ?? null;
  return null;
}

const {
  isAdminPanelCreate,
  persistAdminCreated,
} = require('../utils/quiz-reattempt-admin-created');

function registerQuizReattemptNotificationLifecycles(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [QUIZ_REATTEMPT_UID],

    async afterCreate(event) {
      try {
        const result = event?.result;
        if (!result?.id) return;

        // Strapi v5 may omit boolean false from INSERT/update via query engine.
        // Persist via knex so frontend rows are false, admin rows are true.
        const isAdmin = isAdminPanelCreate(strapi);
        await persistAdminCreated(strapi, result.id, isAdmin);

        strapi.log.info({ id: result.id, adminCreated: isAdmin }, '[quiz-reattempt] afterCreate — adminCreated written');
      } catch (error) {
        strapi.log.warn({ err: error?.message }, '[quiz-reattempt] afterCreate failed');
      }
    },

    async afterUpdate(event) {
      try {
        const { result } = event;
        const status = result?.request_status;
        if (status !== 'Approved' && status !== 'Rejected') return;

        const rawEmailEnabled = String(process.env.EMAIL_ENABLED || 'false').trim().toLowerCase();
        const emailEnabled = rawEmailEnabled === 'true' || rawEmailEnabled === '1' || rawEmailEnabled === 'yes' || rawEmailEnabled === 'on';
        strapi.log.warn(`[quiz-reattempt-notification] EMAIL_ENABLED=${rawEmailEnabled} (computed: ${emailEnabled})`);

        const recordId = result?.id ?? result?.documentId;
        if (recordId == null) return;

        const notifUtil = strapi.utils?.notification;
        if (!notifUtil) return;

        const refetched = await strapi.db.query(QUIZ_REATTEMPT_UID).findOne({
          where: Number.isFinite(Number(recordId)) ? { id: Number(recordId) } : { documentId: recordId },
          populate: { users_permissions_user: true, course: true },
        });
        if (!refetched) return;

        const userId = getRelationId(refetched.users_permissions_user)
          ?? refetched.users_permissions_user_id
          ?? refetched.users_permissions_user;
        const courseId = getRelationId(refetched.course) ?? refetched.course_id;
        if (!userId) return;

        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: Number(userId) },
          select: ['id', 'email'],
        });
        if (!user) return;

        const meta = { courseId: courseId || null, requestId: refetched.id ?? refetched.documentId };
        const isApproved = status === 'Approved';

        // Resolve course title for a descriptive notification
        let courseTitle = null;
        if (courseId) {
          try {
            const course = await strapi.db.query('api::course.course').findOne({
              where: Number.isFinite(Number(courseId)) ? { id: Number(courseId) } : { documentId: String(courseId) },
              select: ['title'],
            });
            courseTitle = course?.title || null;
          } catch { /* keep null */ }
        }

        const enrichedMeta = { ...meta, courseTitle };

        await notifUtil.sendNotification(
          isApproved ? 'quiz_reattempt_approved' : 'quiz_reattempt_rejected',
          isApproved ? 'Quiz Reattempt Approved' : 'Quiz Reattempt Rejected',
          isApproved
            ? `Your reattempt request${courseTitle ? ` for "${courseTitle}"` : ''} has been approved. You can now reattempt the quiz.`
            : `Your reattempt request${courseTitle ? ` for "${courseTitle}"` : ''} has been rejected. Please contact your L&D team for more information.`,
          [{ id: user.id, email: user.email }],
          enrichedMeta,
          [], // admin does not get this; only the user sees it in their bell + email
          { sendEmail: emailEnabled, sendSocket: true }
        );
      } catch (e) {
        strapi.log.error('[quiz-reattempt-notification] afterUpdate:', e?.message || e);
      }
    },
  });

  strapi.log.info('Quiz reattempt: user notification on approve/reject');
}

module.exports = { registerQuizReattemptNotificationLifecycles };
