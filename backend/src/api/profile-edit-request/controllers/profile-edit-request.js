// @ts-nocheck
'use strict';

/**
 * profile-edit-request controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveUserLocation } = require('../../../utils/profile-edit-request-helpers');

const ALLOWED_PROFILE_FIELDS = [
	'username',
	'email',
	'contact_no',
	'designation',
	'department',
	'working_location',
	'branch',
	'photograph',
	'date_of_birth',
	'joining_date',
	'age',
];

const SNAPSHOT_SCALAR_FIELDS = ALLOWED_PROFILE_FIELDS.filter((field) => field !== 'photograph');

/**
 * @param {Record<string, unknown> | null | undefined} changes
 */
function sanitizeRequestedChanges(changes) {
	if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
		return {};
	}

	/** @type {Record<string, unknown>} */
	const filtered = {};
	for (const [key, value] of Object.entries(changes)) {
		if (ALLOWED_PROFILE_FIELDS.includes(key)) {
			filtered[key] = value;
		}
	}
	return filtered;
}

function normalizeSnapshotValue(value) {
	if (value == null) return value;
	if (Array.isArray(value)) {
		return value.map((item) => normalizeSnapshotValue(item));
	}
	if (typeof value === 'object') {
		if (Object.prototype.hasOwnProperty.call(value, 'id')) {
			return value.id;
		}
		if (Object.prototype.hasOwnProperty.call(value, 'documentId')) {
			return value.documentId;
		}
	}
	return value;
}

function buildPreviousValuesSnapshot(currentUser, filteredChanges) {
	const previous = {};
	for (const key of Object.keys(filteredChanges)) {
		previous[key] = normalizeSnapshotValue(currentUser?.[key]);
	}
	return previous;
}

module.exports = createCoreController('api::profile-edit-request.profile-edit-request', ({ strapi }) => ({
	async find(ctx) {
		// Populate related fields for table display
		ctx.query = ctx.query || {};
		const existingFields = Array.isArray(ctx.query.fields) ? ctx.query.fields : [];
		ctx.query.fields = Array.from(new Set([...existingFields, 'company', 'reason_for_rejection', 'user_location', 'pending_admin_comments']));
		ctx.query.populate = {
			...(ctx.query.populate && typeof ctx.query.populate === 'object' ? ctx.query.populate : {}),
			users_permissions_user: true,
			reviewed_by: true,
		};
		return await super.find(ctx);
	},

	async findOne(ctx) {
		ctx.query = ctx.query || {};
		const existingFields = Array.isArray(ctx.query.fields) ? ctx.query.fields : [];
		ctx.query.fields = Array.from(new Set([...existingFields, 'company', 'reason_for_rejection', 'user_location', 'pending_admin_comments']));
		ctx.query.populate = {
			...(ctx.query.populate && typeof ctx.query.populate === 'object' ? ctx.query.populate : {}),
			users_permissions_user: true,
			reviewed_by: true,
		};
		return await super.findOne(ctx);
	},

	async create(ctx) {
		const user = ctx.state.user;
		if (!user) {
			return ctx.unauthorized('User not authenticated');
		}

		const userData = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
			fields: ['company', 'branch', 'working_location'],
		});

		if (!userData || !userData.company) {
			return ctx.badRequest('User company not found');
		}

		const bodyData = (ctx.request.body && ctx.request.body.data) || {};
		const filteredChanges = sanitizeRequestedChanges(bodyData.requested_changes);

		if (Object.keys(filteredChanges).length === 0) {
			const requestedFields = Object.keys(bodyData.requested_changes || {});
			const allowedFieldsStr = ALLOWED_PROFILE_FIELDS.join(', ');
			const errorMsg = requestedFields.length === 0 
				? `requested_changes is required. Allowed fields: ${allowedFieldsStr}`
				: `Invalid field(s) in requested_changes: ${requestedFields.join(', ')}. Allowed fields: ${allowedFieldsStr}`;
			return ctx.badRequest(errorMsg);
		}

		const currentUserProfile = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
			fields: SNAPSHOT_SCALAR_FIELDS,
			populate: {
				photograph: {
					fields: ['id', 'documentId', 'url'],
				},
			},
		});

		const previousValues = buildPreviousValuesSnapshot(currentUserProfile, filteredChanges);
		const requesterName =
			currentUserProfile?.username ||
			currentUserProfile?.employee_name ||
			currentUserProfile?.name ||
			currentUserProfile?.email ||
			`User ${user.id}`;

		ctx.request.body = ctx.request.body || {};
		ctx.request.body.data = {
			requested_changes: filteredChanges,
			previous_values: previousValues,
			requester_name: requesterName,
			users_permissions_user: user.id,
			company: userData.company,
			user_location: resolveUserLocation(userData, userData.company),
			request_status: 'Pending',
		};

		return await super.create(ctx);
	},

	async update(ctx) {
		// Users should not update request records directly after creation.
		return ctx.forbidden('Profile edit request updates are not allowed from this endpoint');
	},
}));
