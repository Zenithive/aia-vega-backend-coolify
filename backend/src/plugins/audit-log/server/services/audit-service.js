// @ts-nocheck
'use strict';

module.exports = ({ strapi }) => ({
  async logChange({ action, contentType, entryId, adminUser, changes, data }) {
    try {
      // Get friendly collection name
      const contentTypeObj = strapi.contentTypes[contentType];
      const collectionName = contentTypeObj?.info?.displayName || contentType;
      // Extract company from data (user snapshot)
      const company = data && data.company ? data.company : null;
      await strapi.entityService.create('plugin::audit-log.audit-entry', {
        data: {
          action,
          contentType,
          collectionName,
          entryId,
          adminUser,
          changes: changes || null,
          snapshot: data || null,
          company, // Store as top-level field
        },
      });
    } catch (error) {
      strapi.log.error('Failed to create audit log entry:', error);
    }
  },

  async getAuditLogs({
    page = 1,
    pageSize = 25,
    dateFrom = null,
    dateTo = null,
    contentType = null,
    action = null,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    company = null,
    search = null,
  }) {
    const where = {
      // Historical bad rows may have null createdAt; exclude them from time-ordered log views.
      createdAt: { $notNull: true },
    };

    // Date filtering
    if (dateFrom || dateTo) {
      if (dateFrom) where.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.createdAt.$lte = endDate;
      }
    }

    // Content type filtering
    if (contentType && contentType !== '') {
      where.contentType = contentType;
    }

    // Action filtering (created, updated, deleted)
    if (action && action !== '') {
      where.action = action;
    }

    // Company filtering (now stored as top-level field)
    if (company && company !== '') {
      where.company = company;
    }

    // Search: filter by entryId (user id) when numeric
    const searchVal = search && String(search).trim();
    if (searchVal) {
      const num = parseInt(searchVal, 10);
      if (!Number.isNaN(num) && String(num) === searchVal) {
        where.entryId = num;
      }
    }

    const offset = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Number(pageSize) || 25);
    const limit = Math.max(1, Math.min(10000, Number(pageSize) || 25));
    const orderDir = (sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const orderField = sortBy || 'createdAt';

    const [entries, total] = await strapi.db.query('plugin::audit-log.audit-entry').findWithCount({
      where: Object.keys(where).length > 0 ? where : undefined,
      limit,
      offset,
      orderBy: { [orderField]: orderDir },
      populate: { adminUser: true },
    });

    return {
      data: entries.map(entry => {
        // Extract userId, username, company, emp_code, emp_id from snapshot (if available)
        const snapshot = entry.snapshot || {};
        return {
          id: entry.id,
          action: entry.action,
          contentType: entry.contentType,
          collectionName: entry.collectionName,
          entryId: entry.entryId,
          adminUser: entry.adminUser ? {
            id: entry.adminUser.id,
            firstname: entry.adminUser.firstname,
            lastname: entry.adminUser.lastname,
            email: entry.adminUser.email,
          } : null,
          changes: entry.changes,
          data: snapshot, // Full snapshot for reference
          userId: snapshot.id || snapshot.userId || null,
          company: snapshot.company || null,
          user: snapshot
            ? {
                id: snapshot.id || snapshot.userId || null,
                username: snapshot.username || null,
                firstname: snapshot.firstname || null,
                lastname: snapshot.lastname || null,
                email: snapshot.email || null,
                company: snapshot.company || null,
                emp_code: snapshot.emp_code || null,
                emp_id: snapshot.emp_id || null,
              }
            : null,
          createdAt: entry.createdAt,
        };
      }),
      pagination: {
        page: Number(page) || 1,
        pageSize: limit,
        pageCount: Math.ceil(total / limit) || 1,
        total,
      },
    };
  },

  async getAvailableContentTypes() {
    // Only tracking users-permissions.user
    return [
      {
        uid: 'plugin::users-permissions.user',
        displayName: 'User/Employee',
      }
    ];
  },
});
