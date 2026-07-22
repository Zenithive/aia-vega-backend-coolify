"use strict";

const { createCoreController } = require("@strapi/strapi").factories;
const {
  isAdminPanelCreate,
  persistAdminCreated,
  createQuizReattemptRequest,
} = require("../../../utils/quiz-reattempt-admin-created");

const REJECTION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getLatestRejectedForUserCourse(strapi, userId, courseId, allowRerequestAfter24h = false) {
  const list = await strapi.db
    .query("api::quiz-reattempt-request.quiz-reattempt-request")
    .findMany({
      where: {
        users_permissions_user: Number(userId),
        course: Number(courseId),
        request_status: "Rejected",
      },
      orderBy: { updatedAt: "desc" },
      limit: 1,
    });
  const latest = Array.isArray(list) && list.length > 0 ? list[0] : null;
  if (!latest) return null;
  if (!allowRerequestAfter24h) return latest;
  const updatedAt = latest.updatedAt ? new Date(latest.updatedAt).getTime() : 0;
  const now = Date.now();
  if (now - updatedAt < REJECTION_COOLDOWN_MS) return latest;
  return null;
}

module.exports = createCoreController(
  "api::quiz-reattempt-request.quiz-reattempt-request",
  ({ strapi }) => ({

    async create(ctx) {
      const fromAdmin = isAdminPanelCreate(strapi);
      if (!fromAdmin) {
        ctx.state.quizReattemptFromFrontend = true;
      }

      await super.create(ctx);

      const created = ctx.body?.data ?? ctx.body;
      const recordId = created?.id ?? created?.documentId;
      if (recordId != null) {
        const ok = await persistAdminCreated(strapi, recordId, fromAdmin);
        if (!ok) {
          strapi.log.error(
            { recordId, fromAdmin },
            "[quiz-reattempt create] failed to persist adminCreated after REST create"
          );
        }
      }
    },

    async send(ctx) {
      ctx.state.quizReattemptFromFrontend = true;

      // Pino format: strapi.log.info(metaObject, 'message string')
      strapi.log.info({
        hasStateBody: !!ctx.state?.quizReattemptBody,
        stateBodyKeys: ctx.state?.quizReattemptBody ? Object.keys(ctx.state.quizReattemptBody) : [],
        hasRequestBody: !!ctx.request?.body,
        requestBodyKeys: ctx.request?.body ? Object.keys(ctx.request.body) : [],
        contentType: ctx.request?.headers?.['content-type'] || 'none',
        path: ctx?.request?.path || ctx?.path,
      }, '[quiz-reattempt send] RAW body sources');

      const body = ctx.state.quizReattemptBody || ctx.request.body || {};
      const normalizedBody = body?.data ?? body;
      const { userId, courseId } = normalizedBody;

      strapi.log.info({ userId, courseId, path: ctx?.request?.path || ctx?.path }, '[quiz-reattempt send] frontend request received');

      if (!userId || !courseId) {
        strapi.log.warn({ userId, courseId }, '[quiz-reattempt send] missing userId or courseId');
        return ctx.badRequest("userId and courseId required");
      }

      const existing = await strapi.db
        .query("api::quiz-reattempt-request.quiz-reattempt-request")
        .findOne({
          where: {
            users_permissions_user: userId,
            course: courseId,
            request_status: "Pending",
          },
        });

      if (existing) {
        strapi.log.info({ userId, courseId, existingId: existing?.id }, '[quiz-reattempt send] duplicate pending request blocked');
        return ctx.badRequest("You already have a pending reattempt request.");
      }

      const recentRejection = await getLatestRejectedForUserCourse(strapi, userId, courseId, true);
      if (recentRejection) {
        strapi.log.info({ userId, courseId, recentRejectionId: recentRejection?.id }, '[quiz-reattempt send] recent rejection blocked');
        return ctx.badRequest(
          "Your reattempt request was rejected. You can submit a new request after 24 hours."
        );
      }

      const lastSubmission = await strapi.db
        .query("api::quiz-submission.quiz-submission")
        .findOne({
          where: { submitted_by: userId, course: courseId },
          orderBy: { attempt_number: "desc" },
        });

      if (!lastSubmission) {
        strapi.log.warn({ userId, courseId }, '[quiz-reattempt send] no quiz submission found');
        return ctx.badRequest("No quiz attempt found.");
      }

      const nextAttempt = lastSubmission.attempt_number + 1;

      const existingApproved = await strapi.db
        .query("api::quiz-reattempt-request.quiz-reattempt-request")
        .findOne({
          where: {
            users_permissions_user: Number(userId),
            course: Number(courseId),
            request_status: "Approved",
            requested_for_attempt: nextAttempt,
          },
        });

      if (existingApproved) {
        strapi.log.info({ userId, courseId, existingApprovedId: existingApproved.id, nextAttempt }, '[quiz-reattempt send] approved slot already exists, blocking duplicate request');
        return ctx.badRequest("An approved reattempt already exists for your next attempt. You can proceed to take the quiz.");
      }

      strapi.log.info({ userId, courseId, nextAttempt }, '[quiz-reattempt send] creating request');

      let request;
      try {
        request = await createQuizReattemptRequest(
          strapi,
          {
            users_permissions_user: Number(userId),
            course: Number(courseId),
            request_status: "Pending",
            requested_for_attempt: nextAttempt,
          },
          false
        );
      } catch (createErr) {
        strapi.log.error({ err: createErr?.message }, '[quiz-reattempt send] create failed');
        return ctx.internalServerError(createErr?.message || "Failed to create reattempt request");
      }

      strapi.log.info({
        requestId: request?.id,
        userId,
        courseId,
        nextAttempt,
        adminCreated: request?.adminCreated,
      }, '[quiz-reattempt send] request created successfully');

      const notifUtil = /** @type {any} */ (strapi).utils?.notification;
      if (notifUtil) {
        let courseTitle = null;
        let userName = null;
        try {
          const [courseRow, userRow] = await Promise.all([
            strapi.db.query('api::course.course').findOne({ where: { id: Number(courseId) }, select: ['title'] }),
            strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: Number(userId) }, select: ['username', 'email'] }),
          ]);
          courseTitle = courseRow?.title || null;
          userName = userRow?.username || userRow?.email || null;
        } catch { /* keep null */ }

        const meta = { courseId, userId, courseTitle, userName };
        notifUtil.sendNotification(
          "quiz_reattempt_requested",
          "Quiz Reattempt Requested",
          `${userName || `User #${userId}`} has requested a quiz reattempt${courseTitle ? ` for "${courseTitle}"` : ''}. Please review and approve or reject the request in the admin panel.`,
          [],
          meta,
          ["admin", "LMadmin"],
          { sendEmail: true, sendSocket: true }
        ).catch((err) => strapi.log.error({ err: err?.message }, '[quiz-reattempt send] notification error'));
      }

      return ctx.send({
        message: "Reattempt request sent successfully.",
        request,
      });
    },

    async checkPending(ctx) {
      const { userId, courseId } = ctx.query;
      if (!userId || !courseId) {
        return ctx.badRequest("userId and courseId are required");
      }
      const uid = Number(userId);
      const cid = Number(courseId);

      const lastSubmission = await strapi.db
        .query("api::quiz-submission.quiz-submission")
        .findOne({
          where: { submitted_by: uid, course: cid },
          orderBy: { attempt_number: "desc" },
        });
      const nextAttempt = lastSubmission ? lastSubmission.attempt_number + 1 : 1;

      strapi.log.info({ uid, cid, nextAttempt }, '[quiz-reattempt checkPending]');

      const [pending, approved, latestRejected] = await Promise.all([
        strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .findOne({
            where: {
              users_permissions_user: uid,
              course: cid,
              request_status: "Pending",
            },
          }),
        strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .findOne({
            where: {
              users_permissions_user: uid,
              course: cid,
              request_status: "Approved",
              requested_for_attempt: nextAttempt,
            },
          }),
        getLatestRejectedForUserCourse(strapi, uid, cid, false),
      ]);

      let approvedRequest = approved;
      if (!approvedRequest) {
        const fallback = await strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .findMany({
            where: {
              users_permissions_user: uid,
              course: cid,
              request_status: "Approved",
            },
            orderBy: { requested_for_attempt: "asc" },
            limit: 1,
          });
        approvedRequest = Array.isArray(fallback) && fallback.length > 0 ? fallback[0] : null;
      }

      const rejectedAt = latestRejected?.updatedAt ? new Date(latestRejected.updatedAt).getTime() : null;
      const now = Date.now();
      const hasRejectedWithin24h = rejectedAt != null && (now - rejectedAt) < REJECTION_COOLDOWN_MS;
      const canRequestAgainAt = rejectedAt != null ? new Date(rejectedAt + REJECTION_COOLDOWN_MS).toISOString() : null;

      strapi.log.info({
        hasPending: !!pending,
        hasApproved: !!approvedRequest,
        approvedId: approvedRequest?.id ?? null,
        approvedAttempt: approvedRequest?.requested_for_attempt ?? null,
        hasRejected: hasRejectedWithin24h,
      }, '[quiz-reattempt checkPending] result');

      return ctx.send({
        hasPending: !!pending,
        hasApproved: !!approvedRequest,
        approvedForAttempt: approvedRequest?.requested_for_attempt ?? null,
        hasRejected: hasRejectedWithin24h,
        canRequestAgainAt: hasRejectedWithin24h ? canRequestAgainAt : null,
      });
    },

    async approve(ctx) {
      const { requestId } = ctx.request.body;
      if (!requestId) return ctx.badRequest('requestId required');

      const updated = await strapi.service('api::quiz-reattempt-request.quiz-reattempt-request').updateStatus(requestId, 'Approved');

      if (!updated) return ctx.notFound('Request not found');

      return ctx.send({ message: 'Request approved and user notified.', data: updated });
    },

    async reject(ctx) {
      const { requestId } = ctx.request.body;
      if (!requestId) return ctx.badRequest('requestId required');

      const updated = await strapi.service('api::quiz-reattempt-request.quiz-reattempt-request').updateStatus(requestId, 'Rejected');

      if (!updated) return ctx.notFound('Request not found');

      return ctx.send({ message: 'Request rejected and user notified.', data: updated });
    },

  })
);
