'use strict';

/**
 * important-link controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const getUserCompany = require('../../../utils/getUserCompany');

module.exports = createCoreController('api::important-link.important-link', ({ strapi }) => ({
	async find(ctx) {
		const userCompany = await getUserCompany(strapi, ctx);
		const where = { publishedAt: { $notNull: true }, active: 'published' };
		if (userCompany) {
			where.company = { name: userCompany };
		}
		const items = await strapi.db.query('api::important-link.important-link').findMany({
			where,
			orderBy: { createdAt: 'desc' },
			populate: ['link_icon', 'company'],
		});
		ctx.body = {
			data: items,
			meta: { pagination: { page: 1, pageSize: items.length, pageCount: 1, total: items.length } },
		};
	},

	async findOne(ctx) {
		const userCompany = await getUserCompany(strapi, ctx);
		const docId = ctx.params.documentId ?? ctx.params.id;
		const where = { publishedAt: { $notNull: true }, active: 'published' };
		if (docId) where.documentId = docId;
		if (userCompany) where.company = { name: userCompany };
		const item = await strapi.db.query('api::important-link.important-link').findOne({
			where,
			populate: ['link_icon', 'company'],
		});
		if (!item) {
			return ctx.notFound();
		}
		ctx.body = { data: item };
	},
}));
