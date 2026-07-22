'use strict';

/**
 * Send admin notification + email when feedback is submitted via Content Manager.
 * The API submit endpoint already sends notifications; this covers CM create/update.
 */

const FEEDBACK_SUBMISSION_UID = 'api::feedback-submission.feedback-submission';

function getRelationId(rel) {
  if (rel == null) return null;
  if (typeof rel === 'number') return rel;
  if (typeof rel === 'object' && rel !== null) {
    return rel.id ?? rel.documentId ?? rel.document_id ?? null;
  }
  return null;
}

function registerFeedbackSubmissionLifecycles(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [FEEDBACK_SUBMISSION_UID],
    async afterCreate(event) {
      try {
        const { result } = event;
        const userId = getRelationId(result.users_permissions_user) ?? result.users_permissions_user_id;
        const courseId = getRelationId(result.course) ?? result.course_id;
        if (!userId && !courseId) return;

        const notifUtil = strapi.utils?.notification;
        if (!notifUtil) return;

        const meta = { courseId: courseId || null, userId: userId || null };
        const message = userId && courseId
          ? `User ${userId} submitted feedback for course ${courseId}.`
          : `Feedback submission created (user: ${userId || '—'}, course: ${courseId || '—'}).`;

        await notifUtil.sendNotification(
          'feedback_submitted',
          'Course Feedback Submitted',
          message,
          [],
          meta,
          ['admin', 'LMadmin'],
          { sendEmail: true, sendSocket: true }
        );
      } catch (e) {
        strapi.log.error('[feedback-submission] notification afterCreate:', e?.message || e);
      }
    },
  });

  strapi.log.info('Feedback-submission: admin notification on create');
}

module.exports = { registerFeedbackSubmissionLifecycles };
