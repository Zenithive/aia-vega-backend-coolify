//@ts-nocheck
'use strict';

/**
 * Shared query param extraction for analytics API requests.
 * Used by both Learning and Overall controllers.
 */
function getQueryParams(ctx) {
  return {
    userId: ctx.query.userId || ctx.query.user_id,
    dateFrom: ctx.query.dateFrom || ctx.query.date_from,
    dateTo: ctx.query.dateTo || ctx.query.date_to,
    department: ctx.query.department,
    designation: ctx.query.designation,
    company: ctx.query.company,
    unitLocation: ctx.query.unitLocation || ctx.query.unit_location,
    location: ctx.query.location,
    activityType: ctx.query.activityType || ctx.query.activity_type,
    newsId: ctx.query.newsId || ctx.query.news_id,
    courseCategory: ctx.query.courseCategory || ctx.query.course_category,
    search: ctx.query.search,
    sortBy: ctx.query.sortBy || ctx.query.sort_by,
    sortOrder: ctx.query.sortOrder || ctx.query.sort_order,
    page: ctx.query.page,
    pageSize: ctx.query.pageSize || ctx.query.page_size,
    courseId: ctx.query.courseId || ctx.query.course_id,
    status: ctx.query.status,
    dropOffOnly: ctx.query.dropOffOnly || ctx.query.drop_off_only,
    filterTimeValue: ctx.query.filterTimeValue || ctx.query.filter_time_value,
    filterTimeMin: ctx.query.filterTimeMin || ctx.query.filter_time_min,
    filterTimeMax: ctx.query.filterTimeMax || ctx.query.filter_time_max,
    quizStatus: ctx.query.quizStatus || ctx.query.quiz_status,
    feedbackGiven: ctx.query.feedbackGiven || ctx.query.feedback_given,
    moduleTitle: ctx.query.moduleTitle || ctx.query.module_title,
    moduleIndex: ctx.query.moduleIndex ?? ctx.query.module_index,
    routePath: ctx.query.routePath || ctx.query.route_path,
    pageType: ctx.query.pageType || ctx.query.page_type,
    entityType: ctx.query.entityType || ctx.query.entity_type,
    entityId: ctx.query.entityId || ctx.query.entity_id,
    eventName: ctx.query.eventName || ctx.query.event_name,
    includeInactiveBlocked: ctx.query.includeInactiveBlocked || ctx.query.include_inactive_blocked,
  };
}

module.exports = getQueryParams;
