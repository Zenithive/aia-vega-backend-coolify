'use strict';

/**
 * quiz-reattempt-request service
 */

const { createCoreService } = require('@strapi/strapi').factories;

const UID = 'api::quiz-reattempt-request.quiz-reattempt-request';

module.exports = createCoreService(UID, ({ strapi }) => ({
  async updateStatus(id, newStatus) {
    const isNumeric = /^\d+$/.test(String(id));
    const where = isNumeric ? { id: Number(id) } : { documentId: String(id) };

    const existing = await strapi.db.query(UID).findOne({ where });
    if (!existing) {
      throw new Error('Request not found');
    }

    await strapi.db.query(UID).update({
      where: { id: existing.id },
      data: { request_status: newStatus },
    });

    return strapi.db.query(UID).findOne({
      where: { id: existing.id },
      populate: ['users_permissions_user', 'course', 'approved_by'],
    });
  },
}));
