// @ts-nocheck
'use strict';

function normalizeRejectionReason(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

module.exports = ({ strapi }) => ({

  async getPendingCount(ctx) {
    try {
      const count = await strapi.plugin('profile-edit-requests').service('profileEditService').getPendingCount();
      ctx.body = { count };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  async getRequests(ctx) {
    try {
      const data = await strapi.plugin('profile-edit-requests').service('profileEditService').getAll();
      ctx.body = { data };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  async getLocationOptions(ctx) {
    try {
      const company = ctx.query?.company || '';
      const locations = await strapi.plugin('profile-edit-requests').service('profileEditService').getLocationOptions(company);
      ctx.body = { data: locations };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  async addPendingComment(ctx) {
    try {
      const { id } = ctx.params;
      const { comment } = ctx.request.body.data || {};
      const updated = await strapi.plugin('profile-edit-requests').service('profileEditService').addPendingComment(
        id,
        comment,
        ctx.state.user
      );
      ctx.body = { data: updated };
    } catch (error) {
      if (error?.message?.includes('not found')) {
        return ctx.throw(404, error.message);
      }
      if (error?.message?.includes('Comments can only be added')) {
        return ctx.throw(400, error.message);
      }
      if (error?.message?.includes('comment is required')) {
        return ctx.throw(400, error.message);
      }
      ctx.throw(500, error.message || 'Failed to add pending comment');
    }
  },

  async updateStatus(ctx) {
    try {
      const { id } = ctx.params;
      const { request_status, reason_for_rejection } = ctx.request.body.data || {};

      if (!request_status || !['Approved', 'Rejected'].includes(request_status)) {
        return ctx.throw(400, 'request_status must be Approved or Rejected');
      }

      const normalizedReason = normalizeRejectionReason(reason_for_rejection);
      if (request_status === 'Rejected' && !normalizedReason) {
        return ctx.throw(400, 'reason_for_rejection is required when rejecting a request');
      }

      const updated = await strapi.plugin('profile-edit-requests').service('profileEditService').updateStatus(
        id,
        request_status,
        ctx.state.user,
        { reason_for_rejection: normalizedReason }
      );
      
      ctx.body = { data: updated };
    } catch (error) {
      if (error?.message?.includes('not found')) {
        return ctx.throw(404, error.message);
      }
      if (error?.message?.includes('Only pending requests')) {
        return ctx.throw(400, error.message);
      }
      if (error?.message?.includes('reason_for_rejection')) {
        return ctx.throw(400, error.message);
      }
      if (error?.message?.includes('No valid changes to apply')) {
        return ctx.throw(400, error.message);
      }
      ctx.throw(500, error.message || 'Failed to update profile edit request status');
    }
  },
});
