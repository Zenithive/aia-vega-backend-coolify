//@ts-nocheck
'use strict';

// Use server local time (IST) for date boundaries, return UTC ISO string for DB filtering
const normalizeDateBound = (value, endOfDay = false) => {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  // Create a Date object in server local time (IST)
  const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  // Return as ISO string in UTC (so DB filtering works as expected)
  return date.toISOString();
};

/**
 * Overall Analytics – Global and Personal portal engagement.
 */
module.exports = ({ strapi }) => {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function parseMonthSort(s) {
    const [mon, year] = s.split(' ');
    const m = monthNames.indexOf(mon);
    return parseInt(year, 10) * 12 + m;
  }

  return {
    async getOverallGlobal(params = {}) {
      const emptyOverall = () => ({
        kpis: { totalUsers: 0, totalActiveUsers: 0, totalHolidays: 0, totalNews: 0, totalTownhalls: 0 },
        holidayByMonth: [],
        employeesByCompany: [],
        activeUsersByCompany: [],
        newsByCategory: [],
        townhallByContentType: [],
      });
      try {
        const filters = {};
        if (params.dateFrom || params.dateTo) {
          filters.publishedAt = {};
          const dateFrom = normalizeDateBound(params.dateFrom, false);
          const dateTo = normalizeDateBound(params.dateTo, true);
          if (dateFrom) filters.publishedAt.$gte = dateFrom;
          if (dateTo) filters.publishedAt.$lte = dateTo;
        }
        const companyFilter = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
        if (companyFilter) filters.company = { name: params.company };

        const totalUsersWhere = { blocked: { $eq: false } };
        if (companyFilter) totalUsersWhere.company = params.company;
        let totalUsers = 0;
        try {
          totalUsers = await strapi.db.query('plugin::users-permissions.user').count({ where: totalUsersWhere });
        } catch (e) {
          strapi.log.warn('Overall global: totalUsers count failed:', e?.message);
        }

        const activeUsersCountWhere = { blocked: { $eq: false }, active: { $eq: true } };
        if (companyFilter) activeUsersCountWhere.company = params.company;
        let totalActiveUsers = 0;
        try {
          totalActiveUsers = await strapi.db.query('plugin::users-permissions.user').count({ where: activeUsersCountWhere });
        } catch (e) {
          strapi.log.warn('Overall global: totalActiveUsers count failed:', e?.message);
        }

        let activeUsers = [];
        const activeUsersWhere = { blocked: { $eq: false }, active: { $eq: true } };
        if (companyFilter) activeUsersWhere.company = params.company;
        try {
          activeUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
            where: activeUsersWhere,
            select: ['company'],
          }) || [];
        } catch (e) {
          strapi.log.warn('Overall global: activeUsers findMany failed:', e?.message);
        }
        const activeUsersByCompany = {};
        (activeUsers || []).forEach((u) => {
          const company = u.company || 'Unassigned';
          activeUsersByCompany[company] = (activeUsersByCompany[company] || 0) + 1;
        });

        let holidayFilters = { ...filters };
        if (params.unitLocation) holidayFilters['unit_location'] = { id: params.unitLocation };
        let holidays = [];
        try {
          holidays = await strapi.documents('api::holiday.holiday').findMany({
            filters: holidayFilters,
            status: 'published',
            limit: 1000,
            start: 0,
          });
        } catch (e) {
          strapi.log.warn('Overall global: holidays findMany failed:', e?.message);
        }
        holidays = Array.isArray(holidays) ? holidays : [];
        const holidayByMonth = {};
        holidays.forEach((h) => {
          if (h.date) {
            const d = new Date(h.date);
            holidayByMonth[`${monthNames[d.getMonth()]} ${d.getFullYear()}`] = (holidayByMonth[`${monthNames[d.getMonth()]} ${d.getFullYear()}`] || 0) + 1;
          }
        });

        let users = [];
        const employeesWhere = { blocked: { $eq: false } };
        if (companyFilter) employeesWhere.company = params.company;
        try {
          users = await strapi.db.query('plugin::users-permissions.user').findMany({
            where: employeesWhere,
            select: ['company'],
          }) || [];
        } catch (e) {
          strapi.log.warn('Overall global: users findMany failed:', e?.message);
        }
        const employeesByCompany = {};
        (users || []).forEach((u) => {
          const company = u.company || 'Unassigned';
          employeesByCompany[company] = (employeesByCompany[company] || 0) + 1;
        });

        let newsItems = [];
        try {
          newsItems = await strapi.documents('api::news.news').findMany({
            filters,
            status: 'published',
            populate: ['news_category'],
            limit: 1000,
            start: 0,
          });
        } catch (e) {
          strapi.log.warn('Overall global: news findMany failed:', e?.message);
        }
        newsItems = Array.isArray(newsItems) ? newsItems : [];
        const newsByCategory = {};
        newsItems.forEach((n) => {
          const cat = n.news_category?.name || 'Uncategorized';
          newsByCategory[cat] = (newsByCategory[cat] || 0) + 1;
        });

        const townhallFilters = {};
        if (params.dateFrom || params.dateTo) {
          townhallFilters.publishedAt = {};
          const dateFrom = normalizeDateBound(params.dateFrom, false);
          const dateTo = normalizeDateBound(params.dateTo, true);
          if (dateFrom) townhallFilters.publishedAt.$gte = dateFrom;
          if (dateTo) townhallFilters.publishedAt.$lte = dateTo;
        }
        let townhalls = [];
        try {
          townhalls = await strapi.documents('api::townhall.townhall').findMany({
            filters: townhallFilters,
            status: 'published',
            limit: 500,
            start: 0,
          });
        } catch (e) {
          strapi.log.warn('Overall global: townhalls findMany failed:', e?.message);
        }
        townhalls = Array.isArray(townhalls) ? townhalls : [];
        const townhallByContentType = {};
        townhalls.forEach((t) => {
          const type = t.meeting_content_type || 'Other';
          townhallByContentType[type] = (townhallByContentType[type] || 0) + 1;
        });

        return {
          kpis: {
            totalUsers,
            totalActiveUsers,
            totalHolidays: holidays.length,
            totalNews: newsItems.length,
            totalTownhalls: townhalls.length,
          },
          holidayByMonth: Object.entries(holidayByMonth).sort(([a], [b]) => parseMonthSort(a) - parseMonthSort(b)).map(([name, value]) => ({ name, value })),
          employeesByCompany: Object.entries(employeesByCompany).map(([name, value]) => ({ name, value, activeValue: activeUsersByCompany[name] || 0 })),
          activeUsersByCompany: Object.entries(activeUsersByCompany).map(([name, value]) => ({ name, value })),
          newsByCategory: Object.entries(newsByCategory).map(([name, value]) => ({ name, value })),
          townhallByContentType: Object.entries(townhallByContentType).map(([name, value]) => ({ name, value })),
        };
      } catch (err) {
        strapi.log.error('Overall global error:', err?.message || err);
        return {
          kpis: { totalUsers: 0, totalActiveUsers: 0, totalHolidays: 0, totalNews: 0, totalTownhalls: 0 },
          holidayByMonth: [],
          employeesByCompany: [],
          activeUsersByCompany: [],
          newsByCategory: [],
          townhallByContentType: [],
        };
      }
    },

    async getOverallPersonal(userId, params = {}) {
      if (!userId) return null;
      const emptyOverallPersonal = () => ({
        kpis: { totalHolidays: 0 },
        holidayByMonth: [],
        employeesByCompany: [],
      });
      try {
        const filters = {};
        if (params.dateFrom || params.dateTo) {
          filters.publishedAt = {};
          const dateFrom = normalizeDateBound(params.dateFrom, false);
          const dateTo = normalizeDateBound(params.dateTo, true);
          if (dateFrom) filters.publishedAt.$gte = dateFrom;
          if (dateTo) filters.publishedAt.$lte = dateTo;
        }
        if (params.company) filters.company = { name: params.company };

        let holidays = [];
        try {
          holidays = await strapi.documents('api::holiday.holiday').findMany({
            filters,
            status: 'published',
            limit: 500,
            start: 0,
          });
        } catch (e) {
          strapi.log.warn('Overall personal: holidays findMany failed:', e?.message);
        }
        holidays = Array.isArray(holidays) ? holidays : [];
        const holidayByMonth = {};
        holidays.forEach((h) => {
          if (h.date) {
            const d = new Date(h.date);
            const monthKey = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
            holidayByMonth[monthKey] = (holidayByMonth[monthKey] || 0) + 1;
          }
        });

        let targetUser = null;
        try {
          targetUser = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: userId, blocked: { $eq: false } },
            select: ['company'],
          });
        } catch (e) {
          strapi.log.warn('Overall personal: targetUser findOne failed:', e?.message);
        }
        const employeesByCompany = {};
        if (targetUser?.company) {
          employeesByCompany[targetUser.company] = 1;
        } else {
          employeesByCompany['Unassigned'] = 1;
        }

        return {
          kpis: { totalHolidays: holidays.length },
          holidayByMonth: Object.entries(holidayByMonth).sort(([a], [b]) => parseMonthSort(a) - parseMonthSort(b)).map(([name, value]) => ({ name, value })),
          employeesByCompany: Object.entries(employeesByCompany).map(([name, value]) => ({ name, value })),
        };
      } catch (err) {
        strapi.log.error('Overall personal error:', err?.message || err);
        return emptyOverallPersonal();
      }
    },
  };
};
