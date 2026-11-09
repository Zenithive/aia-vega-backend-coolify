//@ts-nocheck
'use strict';

const USER_PROGRESS_UID = 'api::user-progress.user-progress';
const FEEDBACK_SUBMISSION_UID = 'api::feedback-submission.feedback-submission';
const { isFeedbackCompulsory } = require('../utils/course-modules');

function getDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getHalfwayDate(assignmentDate, dueDate, timeZone) {
  const start = getDateInTimeZone(new Date(assignmentDate), timeZone);
  const durationDays = (Date.parse(`${dueDate}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86400000;
  if (!Number.isFinite(durationDays) || durationDays < 1) return null;
  return addDays(start, Math.ceil(durationDays / 2));
}

function formatDueDate(dateValue) {
  const [year, month, day] = dateValue.split('-');
  const monthLabel = new Intl.DateTimeFormat('en', {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${dateValue}T00:00:00.000Z`));
  return `${day} ${monthLabel} ${year}`;
}

async function sendCourseDueDateReminders(strapi, now = new Date(), timeZone = 'UTC') {
  const today = getDateInTimeZone(now, timeZone);
  const dueDate = addDays(today, 2);
  const notifUtil = strapi.utils?.notification;
  if (!notifUtil) {
    throw new Error('Notification utility is unavailable for course due-date reminders');
  }
  if (typeof notifUtil.isEmailEnabled === 'function' && !notifUtil.isEmailEnabled()) {
    strapi.log.info('course due-date reminders: skipped because EMAIL_ENABLED is false');
    return 0;
  }

  const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
    where: {
      due_date: dueDate,
      progress_status: { $ne: 'Completed' },
      publishedAt: { $notNull: true },
    },
    select: ['id'],
    populate: {
      user: { select: ['id', 'email', 'username'] },
      course: { select: ['id', 'title', 'course_version'] },
    },
  });

  const store = strapi.store({ type: 'core', name: 'course-due-date-reminders' });
  const previousRun = await store.get({ key: 'last_run' });
  const sentProgressIds = new Set(
    previousRun?.dueDate === dueDate ? previousRun.progressIds || [] : []
  );
  const processedLearners = new Set();
  let sentCount = 0;
  let skippedCount = 0;

  for (const row of rows || []) {
    const user = row.user;
    const course = row.course;
    if (!row.id || !user?.id || !user.email || !course?.id) {
      skippedCount += 1;
      continue;
    }

    const learnerCourseKey = `${user.id}:${course.id}`;
    if (processedLearners.has(learnerCourseKey)) {
      skippedCount += 1;
      continue;
    }
    processedLearners.add(learnerCourseKey);

    if (sentProgressIds.has(row.id)) {
      skippedCount += 1;
      continue;
    }
    const courseTitle = course.title || `Course #${course.id}`;
    const dueDateLabel = formatDueDate(dueDate);

    const delivery = await notifUtil.sendNotification(
      'due_date_reminder',
      'Course Due Date Reminder',
      `"${courseTitle}" is due in 2 days, on ${dueDateLabel}.`,
      [{ id: user.id, email: user.email }],
      {
        courseId: course.id,
        courseTitle,
        courseVersion: course.course_version || null,
        dueDate: dueDateLabel,
        daysRemaining: 2,
        userId: user.id,
        userName: user.username || user.email,
      },
      [],
      { sendEmail: true, sendSocket: true, awaitEmail: true }
    );
    if (delivery?.emailSentCount !== 1) {
      strapi.log.warn(
        `course due-date reminders: email not confirmed for userId=${user.id}, courseId=${course.id}; will retry`
      );
      skippedCount += 1;
      continue;
    }

    sentProgressIds.add(row.id);
    await store.set({
      key: 'last_run',
      value: { dueDate, progressIds: [...sentProgressIds] },
    });
    sentCount += 1;
  }

  strapi.log.info(`course due-date reminders: matched ${rows?.length || 0} row(s); sent ${sentCount} email(s); skipped ${skippedCount}; due date ${dueDate}`);
  return sentCount;
}

async function sendCourseDueDateExpiredNotifications(strapi, now = new Date(), timeZone = 'UTC') {
  const today = getDateInTimeZone(now, timeZone);
  const notifUtil = strapi.utils?.notification;
  if (!notifUtil) {
    throw new Error('Notification utility is unavailable for expired course due dates');
  }
  if (typeof notifUtil.isEmailEnabled === 'function' && !notifUtil.isEmailEnabled()) {
    strapi.log.info('course due-date expiry notifications: skipped because EMAIL_ENABLED is false');
    return 0;
  }

  const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
    where: {
      due_date: { $lt: today },
      progress_percentage: { $gt: 0, $lt: 100 },
      progress_status: { $ne: 'Completed' },
      publishedAt: { $notNull: true },
    },
    select: ['id', 'due_date', 'progress_percentage'],
    populate: {
      user: { select: ['id', 'email', 'username'] },
      course: { select: ['id', 'title', 'course_version'] },
    },
  });

  const store = strapi.store({ type: 'core', name: 'course-due-date-expiry-notifications' });
  const processedLearners = new Set();
  let sentCount = 0;
  let skippedCount = 0;

  for (const row of rows || []) {
    const user = row.user;
    const course = row.course;
    if (!row.id || !user?.id || !user.email || !course?.id) {
      skippedCount += 1;
      continue;
    }

    const learnerCourseKey = `${user.id}:${course.id}:${row.due_date}`;
    if (processedLearners.has(learnerCourseKey)) {
      skippedCount += 1;
      continue;
    }
    processedLearners.add(learnerCourseKey);

    const storeKey = `sent_${user.id}_${course.id}_${row.due_date}`;
    if (await store.get({ key: storeKey })) {
      skippedCount += 1;
      continue;
    }

    const courseTitle = course.title || `Course #${course.id}`;
    const dueDateLabel = formatDueDate(String(row.due_date).slice(0, 10));
    const delivery = await notifUtil.sendNotification(
      'course_due_date_expired',
      'Course Due Date Expired',
      `The due date for "${courseTitle}" has passed. Status: Not Completed.`,
      [{ id: user.id, email: user.email, username: user.username }],
      {
        courseId: course.id,
        courseTitle,
        courseVersion: course.course_version || null,
        dueDate: dueDateLabel,
        progressPercentage: row.progress_percentage,
        status: 'Not Completed',
        userId: user.id,
        userName: user.username || user.email,
      },
      [],
      { sendEmail: true, sendSocket: true, awaitEmail: true }
    );
    if (delivery?.emailSentCount !== 1) {
      strapi.log.warn(
        `course due-date expiry: email not confirmed for userId=${user.id}, courseId=${course.id}, dueDate=${row.due_date}; will retry`
      );
      skippedCount += 1;
      continue;
    }

    await store.set({ key: storeKey, value: true });
    sentCount += 1;
  }

  strapi.log.info(`course due-date expiry notifications: matched ${rows?.length || 0} row(s); sent ${sentCount} email(s); skipped ${skippedCount}`);
  return sentCount;
}

async function sendCourseNotStartedHalfwayNotifications(strapi, now = new Date(), timeZone = 'UTC') {
  const today = getDateInTimeZone(now, timeZone);
  const notifUtil = strapi.utils?.notification;
  if (!notifUtil) {
    throw new Error('Notification utility is unavailable for halfway course reminders');
  }
  if (typeof notifUtil.isEmailEnabled === 'function' && !notifUtil.isEmailEnabled()) {
    strapi.log.info('course halfway reminders: skipped because EMAIL_ENABLED is false');
    return 0;
  }

  const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
    where: {
      due_date: { $gte: today },
      progress_status: 'Not_started',
      publishedAt: { $notNull: true },
    },
    select: ['id', 'createdAt', 'due_date'],
    populate: {
      user: { select: ['id', 'email', 'username'] },
      course: { select: ['id', 'title', 'course_version'] },
    },
  });

  const store = strapi.store({ type: 'core', name: 'course-not-started-halfway-notifications' });
  const processedLearners = new Set();
  let sentCount = 0;
  let skippedCount = 0;

  for (const row of rows || []) {
    const user = row.user;
    const course = row.course;
    if (!row.id || !row.createdAt || !row.due_date || !user?.id || !user.email || !course?.id) {
      skippedCount += 1;
      continue;
    }

    const dueDate = String(row.due_date).slice(0, 10);
    const halfwayDate = getHalfwayDate(row.createdAt, dueDate, timeZone);
    if (!halfwayDate || today < halfwayDate) {
      skippedCount += 1;
      continue;
    }

    const learnerCourseKey = `${user.id}:${course.id}:${dueDate}`;
    if (processedLearners.has(learnerCourseKey)) {
      skippedCount += 1;
      continue;
    }
    processedLearners.add(learnerCourseKey);

    const storeKey = `sent_${user.id}_${course.id}_${dueDate}`;
    if (await store.get({ key: storeKey })) {
      skippedCount += 1;
      continue;
    }

    const courseTitle = course.title || `Course #${course.id}`;
    const dueDateLabel = formatDueDate(dueDate);
    const halfwayDateLabel = formatDueDate(halfwayDate);
    const assignedDateLabel = formatDueDate(getDateInTimeZone(new Date(row.createdAt), timeZone));
    const delivery = await notifUtil.sendNotification(
      'course_inactive_halfway',
      'Course Inactive Status - Halfway Reminder',
      `You have not started "${courseTitle}" and have reached the halfway point of the completion period. Status: Inactive.`,
      [{ id: user.id, email: user.email, username: user.username }],
      {
        courseId: course.id,
        courseTitle,
        courseVersion: course.course_version || null,
        halfwayDate: halfwayDateLabel,
        assignedDate: assignedDateLabel,
        dueDate: dueDateLabel,
        status: 'Inactive',
        userId: user.id,
        userName: user.username || user.email,
      },
      [],
      { sendEmail: true, sendSocket: true, awaitEmail: true }
    );
    if (delivery?.emailSentCount !== 1) {
      strapi.log.warn(
        `course halfway reminders: email not confirmed for userId=${user.id}, courseId=${course.id}, dueDate=${dueDate}; will retry`
      );
      skippedCount += 1;
      continue;
    }

    await store.set({ key: storeKey, value: true });
    sentCount += 1;
  }

  strapi.log.info(`course halfway reminders: matched ${rows?.length || 0} row(s); sent ${sentCount} email(s); skipped ${skippedCount}`);
  return sentCount;
}

async function sendCourseFeedbackReminders(strapi, now = new Date()) {
  const notifUtil = strapi.utils?.notification;
  if (!notifUtil) {
    throw new Error('Notification utility is unavailable for course feedback reminders');
  }
  if (typeof notifUtil.isEmailEnabled === 'function' && !notifUtil.isEmailEnabled()) {
    strapi.log.info('course feedback reminders: skipped because EMAIL_ENABLED is false');
    return 0;
  }

  const completedBefore = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
    where: {
      progress_status: 'Completed',
      completed_at: { $lte: completedBefore },
      publishedAt: { $notNull: true },
    },
    select: ['id', 'documentId', 'completed_at'],
    populate: {
      user: { select: ['id', 'email', 'username'] },
      course: {
        select: ['id', 'title', 'course_version'],
        populate: { feedback: true },
      },
    },
  });

  const store = strapi.store({ type: 'core', name: 'course-feedback-reminders' });
  const processedLearners = new Set();
  let sentCount = 0;
  let skippedCount = 0;

  for (const row of rows || []) {
    const user = row.user;
    const course = row.course;
    if (!row.id || !row.completed_at || !user?.id || !user.email || !course?.id) {
      skippedCount += 1;
      continue;
    }

    const completedAtDate = new Date(row.completed_at);
    if (Number.isNaN(completedAtDate.getTime()) || completedAtDate > completedBefore) {
      skippedCount += 1;
      continue;
    }

    const learnerCourseKey = `${user.id}:${course.id}`;
    if (processedLearners.has(learnerCourseKey)) {
      skippedCount += 1;
      continue;
    }
    processedLearners.add(learnerCourseKey);

    if (!isFeedbackCompulsory(course)) {
      skippedCount += 1;
      continue;
    }

    const feedbackSubmission = await strapi.db.query(FEEDBACK_SUBMISSION_UID).findOne({
      where: {
        course: Number(course.id),
        users_permissions_user: Number(user.id),
        publishedAt: { $notNull: true },
      },
      select: ['id'],
    });
    if (feedbackSubmission) {
      skippedCount += 1;
      continue;
    }

    const completedAt = completedAtDate.toISOString();
    const storeKey = `sent_${row.documentId || row.id}_${Date.parse(completedAt)}`;
    if (await store.get({ key: storeKey })) {
      skippedCount += 1;
      continue;
    }

    const courseTitle = course.title || `Course #${course.id}`;
    const delivery = await notifUtil.sendNotification(
      'course_feedback_reminder',
      'Course Feedback Reminder',
      `You completed "${courseTitle}" at least 2 days ago. Please submit the required course feedback.`,
      [{ id: user.id, email: user.email, username: user.username }],
      {
        courseId: course.id,
        courseTitle,
        courseVersion: course.course_version || null,
        userId: user.id,
        userName: user.username || user.email,
      },
      [],
      { sendEmail: true, sendSocket: true, awaitEmail: true }
    );
    if (delivery?.emailSentCount !== 1) {
      strapi.log.warn(
        `course feedback reminders: email not confirmed for userId=${user.id}, courseId=${course.id}; will retry`
      );
      skippedCount += 1;
      continue;
    }

    await store.set({ key: storeKey, value: true });
    sentCount += 1;
  }

  strapi.log.info(`course feedback reminders: matched ${rows?.length || 0} row(s); sent ${sentCount} email(s); skipped ${skippedCount}`);
  return sentCount;
}

module.exports = {
  sendCourseDueDateReminders,
  sendCourseDueDateExpiredNotifications,
  sendCourseNotStartedHalfwayNotifications,
  sendCourseFeedbackReminders,
  getHalfwayDate,
};
