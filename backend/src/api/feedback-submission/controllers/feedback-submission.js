'use strict';

/**
 * feedback-submission controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

async function resolveCourseNumericId(strapi, rawCourseId) {
  if (rawCourseId == null || rawCourseId === '') return null;

  const asNumber = Number(rawCourseId);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    // In Strapi v5, draftAndPublish types have two rows per document.
    // Always resolve to the published row so entityService populate works.
    const publishedById = await strapi.db.query('api::course.course').findOne({
      where: { id: asNumber, publishedAt: { $notNull: true } },
      select: ['id'],
    });
    if (publishedById?.id != null) return Number(publishedById.id);

    // The id might be the draft row — find published sibling via documentId
    const anyRow = await strapi.db.query('api::course.course').findOne({
      where: { id: asNumber },
      select: ['id', 'documentId'],
    });
    if (anyRow?.documentId) {
      const publishedByDocId = await strapi.db.query('api::course.course').findOne({
        where: { documentId: anyRow.documentId, publishedAt: { $notNull: true } },
        select: ['id'],
      });
      if (publishedByDocId?.id != null) return Number(publishedByDocId.id);
      return Number(anyRow.id);
    }
  }

  const asDocumentId = String(rawCourseId).trim();
  if (!asDocumentId) return null;

  const publishedByDocId = await strapi.db.query('api::course.course').findOne({
    where: { documentId: asDocumentId, publishedAt: { $notNull: true } },
    select: ['id'],
  });
  if (publishedByDocId?.id != null) return Number(publishedByDocId.id);

  const anyByDocId = await strapi.db.query('api::course.course').findOne({
    where: { documentId: asDocumentId },
    select: ['id'],
  });
  return anyByDocId?.id != null ? Number(anyByDocId.id) : null;
}

module.exports = createCoreController("api::feedback-submission.feedback-submission", ({ strapi }) => ({

  async submit(ctx) {
    if (ctx.method === 'OPTIONS') return ctx.send({ ok: true });

    // Support both nested (Strapi style: body.data) and flat payloads
    const rawBody = ctx.state.feedbackBody || ctx.request.body || {};
    const nested = rawBody.data || {};

    const courseInput =
      nested.course ?? nested.courseId ??
      rawBody.course ?? rawBody.courseId ?? null;
    const courseId = await resolveCourseNumericId(strapi, courseInput);
    const userId = Number(
      nested.users_permissions_user ?? nested.userId ??
      rawBody.users_permissions_user ?? rawBody.userId ?? 0
    );
    const rawAnswers = Array.isArray(nested.answers) ? nested.answers
      : Array.isArray(rawBody.answers) ? rawBody.answers
      : nested.answers ?? rawBody.answers;

    if (!Number.isFinite(Number(courseId)) || Number(courseId) === 0) return ctx.badRequest('courseId is required');
    if (!Number.isFinite(userId) || userId === 0) return ctx.badRequest('userId is required');

    // Transform frontend object { "q-1": 3, "additionalFeedback": "text" } into schema format:
    // [{ question_id, question, answer_type, answer }, ...]
    const answers = Array.isArray(rawAnswers)
      ? rawAnswers
      : Object.entries(rawAnswers || {}).map(([questionId, value]) => ({
          question_id: questionId,
          question: questionId,
          answer_type: typeof value === 'number' ? 'Rating' : 'Text',
          answer: String(value ?? ''),
        }));

    if (!answers.length) return ctx.badRequest("At least one answer required");

    // ADDED: fetch course title so we can store it on feedback-submission
    let courseTitle = null;
    try {
      const courseEntity = await strapi.entityService.findOne(
        "api::course.course",
        Number(courseId),
        { fields: ["title"] }
      );
      courseTitle = courseEntity?.title || null;
    } catch (err) {
      strapi.log.warn('Could not fetch course title for feedback-submission:', err);
    }

    /** @type {any} */
    let entry = null;
    try {
      // Use entityService (not db.query) - db.query cannot build component records
      entry = /** @type {any} */ (await strapi.entityService.create(
        "api::feedback-submission.feedback-submission",
        {
          data: /** @type {any} */ ({
            answers,
            course: Number(courseId),
            users_permissions_user: Number(userId),
            publishedAt: new Date(),
          }),
        }
      ));
    } catch (err) {
      strapi.log.error('Feedback submission error:', err);
      return ctx.internalServerError('Failed to create feedback submission: ' + err.message);
    }

    const entryId = entry && typeof entry.id === 'number' ? entry.id : 0;
    if (!Number.isFinite(entryId) || entryId <= 0) {
      strapi.log.error('Feedback submission created without a valid id');
      return ctx.internalServerError('Failed to create feedback submission');
    }

    // Fetch the entry with course relation populated
    let populatedEntry = null;
    try {
      populatedEntry = await strapi.db.query("api::feedback-submission.feedback-submission").findOne({
        where: { id: entryId },
        populate: {
          course: { select: ['id', 'documentId', 'title', 'publishedAt'], populate: { company: { select: ['name'] } } },
          users_permissions_user: { select: ['id', 'email', 'username'] },
        },
      });

      if (!populatedEntry?.course) {
        await strapi.entityService.update("api::feedback-submission.feedback-submission", entryId, {
          data: { course: Number(courseId) },
        });

        populatedEntry = await strapi.db.query("api::feedback-submission.feedback-submission").findOne({
          where: { id: entryId },
          populate: {
            course: { select: ['id', 'documentId', 'title', 'publishedAt'], populate: { company: { select: ['name'] } } },
            users_permissions_user: { select: ['id', 'email', 'username'] },
          },
        });
      }
    } catch (err) {
      strapi.log.warn('Could not populate course relation for feedback-submission:', err);
      populatedEntry = entry;
    }

    try {
      /** @type {any} */
      const userProgressController = strapi.controller("api::user-progress.user-progress");
      await userProgressController.finalizeCourse(courseId, userId, entryId);
    } catch (err) {
      strapi.log.error('Finalize course error:', err);
    }

    try {
      const feedbackCourse = populatedEntry?.course || null;
      const feedbackCourseDocumentId = feedbackCourse?.documentId || null;
      const feedbackCourseTitle = feedbackCourse?.title || courseTitle || null;
      const feedbackCompanyCandidates = Array.isArray(feedbackCourse?.company) ? feedbackCourse.company : feedbackCourse?.company ? [feedbackCourse.company] : [];
      const feedbackCompany = feedbackCompanyCandidates[0]?.name || null;
      const meta = { courseId, userId, courseDocumentId: feedbackCourseDocumentId, company: feedbackCompany, courseTitle: feedbackCourseTitle };
      // @ts-ignore
      const notifUtil = strapi.utils?.notification;
      if (notifUtil) {
        await notifUtil.sendNotification(
          'feedback_submitted',
          'Course Feedback Submitted',
          'A user submitted course feedback.',
          [],
          meta,
          ['admin', 'LMadmin'],
          { sendEmail: true, sendSocket: true }
        );
      }
    } catch (err) {
      strapi.log.error('Notification error:', err);
    }

    return ctx.send({
      message: "Feedback submitted successfully & course completed",
      submission: populatedEntry || entry,
    });
  },

}));