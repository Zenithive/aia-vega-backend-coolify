// @ts-nocheck
'use strict';

/**
 * course-assignment controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::course-assignment.course-assignment', ({ strapi }) => ({
  async importUsersFromExcel(ctx) {
    const body = ctx.request.body || {};
    let identifiers = [];

    const normalizeCompanyName = (name) => {
      const value = String(name || '').trim().toLowerCase();
      if (!value) return null;
      if (value.includes('vega')) return 'Vega';
      if (value.includes('aia')) return 'AIA';
      return null;
    };

    const resolveSelectedCompanyName = async () => {
      const rawId = body.companyId;
      const rawDocumentId = body.companyDocumentId;

      if (rawId == null && !rawDocumentId) return null;

      const numericId = rawId != null && /^\d+$/.test(String(rawId)) ? Number(rawId) : null;
      const where = [];
      if (numericId != null) where.push({ id: numericId });
      if (rawDocumentId) where.push({ documentId: String(rawDocumentId) });

      if (where.length === 0) return null;

      const company = await strapi.db.query('api::company.company').findOne({
        where: where.length === 1 ? where[0] : { $or: where },
        select: ['id', 'documentId', 'name'],
      });

      return normalizeCompanyName(company?.name);
    };

    const detectUserCompanyFromFields = (user) => {
      const signals = new Set();

      const email = String(user?.email || '').trim().toLowerCase();
      if (email.endsWith('@vega-industries.com')) signals.add('Vega');
      if (email.endsWith('@aiaengineering.com')) signals.add('AIA');

      const empId = String(user?.emp_id || '').trim().toUpperCase();
      if (/^EMP\d+$/.test(empId)) signals.add('Vega');

      const empCode = String(user?.emp_code || '').trim();
      if (/^\d+$/.test(empCode) && empCode.length > 0) signals.add('AIA');

      if (signals.size === 1) return [...signals][0];
      if (signals.size > 1) return 'Ambiguous';
      return null;
    };

    const resolveUserCompany = (user) => {
      const direct = String(user?.company || '').trim().toLowerCase();
      if (direct === 'aia') return 'AIA';
      if (direct === 'vega') return 'Vega';

      const detected = detectUserCompanyFromFields(user);
      if (detected === 'AIA' || detected === 'Vega') return detected;
      return null;
    };

    const isEligibleForSelectedCompany = (user, selected) => {
      const company = resolveUserCompany(user);
      if (company !== selected) return false;

      if (selected === 'Vega') {
        // Vega eligibility: active users only
        return user?.active !== false;
      }

      if (selected === 'AIA') {
        // AIA eligibility: users with exit_date are considered exited
        const exitDate = user?.exit_date;
        return exitDate == null || String(exitDate).trim() === '';
      }

      return false;
    };

    const getIneligibleReason = (user, selected) => {
      if (selected === 'Vega' && user?.active === false) return 'inactive';
      if (selected === 'AIA') {
        const exitDate = user?.exit_date;
        if (exitDate != null && String(exitDate).trim() !== '') return 'exited';
      }
      return 'ineligible';
    };

    const getMatchedIdentifiersForUser = (user, inputSet) => {
      const fields = ['email', 'username', 'emp_code', 'emp_id'];
      const out = [];
      for (const field of fields) {
        const value = user?.[field];
        if (value == null) continue;
        const str = String(value);
        if (inputSet.has(str)) out.push(str);
      }
      return [...new Set(out)];
    };

    const normalizeHeaderToken = (value) => {
      return String(value || '')
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    };

    const knownHeaderTokens = new Set([
      'email',
      'email_id',
      'email_address',
      'emp_code',
      'employee_code',
      'emp_id',
      'employee_id',
      'username',
      'user_name',
      'user',
      'identifier',
      'name',
      'employee_name',
      'emp_name',
      'full_name',
      'fullname',
      'staff_id',
      'staff_name',
      'staff_code',
      'user_id',
      'userid',
      'login',
      'login_id',
      'no',
      'sr_no',
      'sr',
      'sno',
      'sl_no',
      'serial_no',
      'id',
      'row',
      'index',
    ]);

    const isHeaderLikeIdentifier = (value) => knownHeaderTokens.has(normalizeHeaderToken(value));

    const finalizeIdentifiers = (rawList) => {
      const out = [];
      const seen = new Set();
      for (const item of rawList || []) {
        const value = String(item || '').replace(/^\uFEFF/, '').trim();
        if (!value) continue;
        if (isHeaderLikeIdentifier(value)) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        out.push(value);
      }
      return out;
    };

    if (Array.isArray(body.identifiers)) {
      // CSV pre-parsed on the frontend — receive identifier strings directly
      identifiers = finalizeIdentifiers(body.identifiers);
    } else if (body.fileContent) {
      // XLSX / XLS sent as base64 from the browser — parse server-side
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const XLSX = require('xlsx');
        const base64 = String(body.fileContent).replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames && workbook.SheetNames[0];
        if (!sheetName) return ctx.badRequest('No sheets found in the workbook');
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        // Always skip the first row — it is the header row in virtually all Excel exports
        identifiers = finalizeIdentifiers(
          rows
          .slice(1)
          .map((row) => String((row && row[0]) || '').trim())
        );
      } catch (e) {
        return ctx.badRequest('Failed to parse Excel file: ' + (e?.message || String(e)));
      }
    } else {
      return ctx.badRequest('Provide identifiers array (CSV) or fileContent (Excel base64)');
    }

    if (identifiers.length === 0) return ctx.badRequest('No identifiers found in the file');
    if (identifiers.length > 2000) return ctx.badRequest('Too many rows — maximum 2000 per import');

    const selectedCompany = await resolveSelectedCompanyName();
    if (!selectedCompany) {
      return ctx.badRequest('Select a valid company (AIA or Vega) before importing users');
    }

    // Build OR clauses based on which searchable fields exist on the user model
    const userModel = strapi.getModel('plugin::users-permissions.user');
    const attrs = (userModel && userModel.attributes) || {};

    const orClauses = [];
    if (attrs.email)    orClauses.push({ email:    { $in: identifiers } });
    if (attrs.username) orClauses.push({ username: { $in: identifiers } });
    if (attrs.emp_code) orClauses.push({ emp_code: { $in: identifiers } });
    if (attrs.emp_id)   orClauses.push({ emp_id:   { $in: identifiers } });

    if (orClauses.length === 0) return ctx.badRequest('No matchable user fields found on the user model');
    if (!attrs.company) return ctx.badRequest('User model has no company field; cannot run company-scoped import');

    const identifierWhere = orClauses.length === 1 ? orClauses[0] : { $or: orClauses };
    const scopedWhere = {
      $and: [
        identifierWhere,
        { company: selectedCompany },
      ],
    };

    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: scopedWhere,
      select: ['id', 'documentId', 'email', 'username', 'emp_code', 'emp_id', 'company', 'active', 'exit_date'],
      limit: 2000,
    });

    const identifierSet = new Set(identifiers);

    const usersByIdentifier = new Map();
    for (const identifier of identifiers) usersByIdentifier.set(identifier, []);

    for (const user of users || []) {
      const matchedIdentifiers = getMatchedIdentifiersForUser(user, identifierSet);
      for (const identifier of matchedIdentifiers) {
        usersByIdentifier.get(identifier)?.push(user);
      }
    }

    const selectedUsers = [];
    const selectedUserIds = new Set();
    const matched = new Set();
    const skippedInactiveOrExited = [];
    const crossCompanyOnly = [];

    for (const identifier of identifiers) {
      const candidates = usersByIdentifier.get(identifier) || [];
      if (candidates.length === 0) continue;

      const sameCompany = candidates.filter((u) => resolveUserCompany(u) === selectedCompany);
      const eligible = sameCompany.filter((u) => isEligibleForSelectedCompany(u, selectedCompany));

      if (sameCompany.length > 0) matched.add(identifier);

      if (eligible.length > 0) {
        for (const user of eligible) {
          if (selectedUserIds.has(user.id)) continue;
          selectedUserIds.add(user.id);
          selectedUsers.push(user);
        }
        continue;
      }

      if (sameCompany.length > 0) {
        const sample = sameCompany[0];
        skippedInactiveOrExited.push({
          identifier,
          reason: getIneligibleReason(sample, selectedCompany),
          username: sample.username || null,
          email: sample.email || null,
        });
        continue;
      }

      // Company-scoped DB query prevents other-company records from entering candidates.
    }

    const notFound = identifiers.filter((id) => !matched.has(id));

    return ctx.send({
      found: (selectedUsers || []).map((u) => ({
        id: u.id,
        documentId: u.documentId,
        username: u.username || null,
        email: u.email || null,
      })),
      notFound,
      skippedInactiveOrExited,
    });
  },

  async assign(ctx) {
    const { level, courseId, assignedBy, userId, departmentId, companyId, workLocationId } = ctx.request.body;
    const util = strapi.utils?.notification;
    if (!util) return ctx.internalServerError('Notification util not available');

    let users = [];
    if (level === 'individual' && userId) {
      const u = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: userId }, select: ['id', 'email'] });
      if (u) users = [u];
    } else if (level === 'department' && departmentId) {
      users = await util.getUsersByDepartment(departmentId);
    } else if (level === 'company' && companyId) {
      users = await util.getUsersByCompany(companyId);
    } else if (level === 'work_location' && workLocationId) {
      users = await util.getUsersByWorkLocation(workLocationId);
    }

    // Fetch course title for a meaningful notification message
    let courseTitle = 'A new course';
    if (courseId) {
      try {
        const course = await strapi.db.query('api::course.course').findOne({
          where: { $or: [{ id: courseId }, { documentId: courseId }] },
          select: ['title'],
        });
        if (course?.title) courseTitle = course.title;
      } catch { /* keep default */ }
    }

    // Admin → User: only incomplete users get notification (bell) + email
    const meta = { courseId, assignedBy, level };
    let eligibleUsers = users;
    if (courseId && users.length > 0) {
      const numericCourseId = Number(courseId);
      const resolvedId = !Number.isNaN(numericCourseId) && numericCourseId > 0
        ? numericCourseId
        : (await strapi.db.query('api::course.course').findOne({
          where: { documentId: String(courseId) },
          select: ['id'],
        }))?.id;
      if (resolvedId) {
        const completedRows = await strapi.db.query('api::user-progress.user-progress').findMany({
          where: {
            course: resolvedId,
            user: { $in: users.map((u) => u.id).filter(Boolean) },
            progress_status: 'Completed',
          },
          select: ['id'],
          populate: { user: { select: ['id'] } },
        });
        const completedIds = new Set(
          (completedRows || []).map((row) => row.user?.id ?? row.user).filter(Boolean).map(Number)
        );
        eligibleUsers = users.filter((u) => u?.id && !completedIds.has(Number(u.id)));
      }
    }

    const emailEnabled = typeof util.isEmailEnabled === 'function' ? util.isEmailEnabled() : false;
    await util.sendNotification(
      'course_assigned',
      'Course Assigned',
      `"${courseTitle}" has been assigned to you.`,
      eligibleUsers,
      meta,
      [],
      { sendEmail: emailEnabled, sendSocket: true }
    );
    return ctx.send({ message: 'Course assigned and notifications sent.' });
  },
}));
