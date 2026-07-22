// @ts-nocheck
'use strict';

const { errors } = require('@strapi/utils');
const USER_UID = 'plugin::users-permissions.user';
const COURSE_UID = 'api::course.course';
const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const { ensureDepartmentForUser } = require('./utils/ensure-department-for-user');
const { syncCourseLanguageComponents } = require('./utils/sync-course-language-components');
const { autoGenerateComponentIds } = require('./utils/auto-generate-component-ids');
const { syncEmployeesFromHrms } = require('./cron-tasks/sync-employees');
const { syncVegaEmployees } = require('./cron-tasks/sync-vega-employees');
const { populateAnswerCorrectField } = require('./utils/quiz-submission-correctness');
const { cleanupFakeEmails } = require('./cron-tasks/cleanup-fake-emails');
const { syncAiaEmployeePhotos } = require('./cron-tasks/sync-aia-employee-photos');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN_TAB_TITLE = 'AIA-VEGA';
const AIA_TITLE_PATCH_MARKER = 'data-aia-title-patch="1"';

function patchGeneratedAdminIndexHtml(strapi) {
  const htmlPath = path.join(__dirname, '..', '.strapi', 'client', 'index.html');

  if (!fs.existsSync(htmlPath)) {
    return false;
  }

  const original = fs.readFileSync(htmlPath, 'utf8');
  let next = original.replace(/<title>[^<]*<\/title>/i, `<title>${ADMIN_TAB_TITLE}</title>`);

  if (!next.includes(AIA_TITLE_PATCH_MARKER)) {
    const inlineScript = `\n    <script ${AIA_TITLE_PATCH_MARKER}>\n      (function () {\n        var ADMIN_TAB_TITLE = '${ADMIN_TAB_TITLE}';\n        function setExactTitle() {\n          var t = document.getElementsByTagName('title')[0];\n          if (t && t.textContent !== ADMIN_TAB_TITLE) {\n            t.textContent = ADMIN_TAB_TITLE;\n          }\n        }\n        var titleEl = document.getElementsByTagName('title')[0];\n        setExactTitle();\n        try {\n          Object.defineProperty(document, 'title', {\n            set: function () {\n              setExactTitle();\n            },\n            get: function () {\n              return ADMIN_TAB_TITLE;\n            },\n            configurable: true,\n          });\n        } catch (e) {}\n        if (titleEl && window.MutationObserver) {\n          new MutationObserver(function () {\n            setExactTitle();\n          }).observe(titleEl, { childList: true, characterData: true, subtree: true });\n        }\n      })();\n    </script>`;

    next = next.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${inlineScript}`);
  }

  if (next === original) {
    return false;
  }

  fs.writeFileSync(htmlPath, next, 'utf8');
  strapi.log.info(`[admin-title] patched generated admin HTML: ${htmlPath}`);
  return true;
}

function installGeneratedAdminTitlePatcher(strapi) {
  // Apply immediately and then retry briefly to handle dev-mode regenerations.
  patchGeneratedAdminIndexHtml(strapi);

  let attempts = 0;
  const maxAttempts = 30;
  const timer = setInterval(() => {
    attempts += 1;
    try {
      patchGeneratedAdminIndexHtml(strapi);
    } catch (err) {
      strapi.log.warn(`[admin-title] patch retry failed: ${err?.message || err}`);
    }

    if (attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, 1000);
}

function isEmailEnabled() {
  const raw = String(process.env.EMAIL_ENABLED || 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function isStartupSyncEnabled() {
  const raw = String(process.env.RUN_STARTUP_SYNCS || 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function suppressEmailServiceIfDisabled(strapi) {
  if (isEmailEnabled()) {
    strapi.log.info('[email] EMAIL_ENABLED=true; outgoing emails are enabled.');
    return;
  }

  const serviceFromPluginAccessor = strapi.plugin?.('email')?.service?.('email');
  const serviceFromLegacyAccessor = strapi.plugins?.email?.services?.email;
  const emailServices = [serviceFromPluginAccessor, serviceFromLegacyAccessor].filter(Boolean);

  if (emailServices.length === 0) {
    strapi.log.warn('[email] Email plugin service not found; EMAIL_ENABLED=false guard not applied.');
    return;
  }

  const suppressedResult = { skipped: true, reason: 'EMAIL_ENABLED=false' };

  for (const emailService of emailServices) {
    if (emailService.__emailSuppressionApplied) continue;

    emailService.send = async () => suppressedResult;

    if (typeof emailService.sendTemplatedEmail === 'function') {
      emailService.sendTemplatedEmail = async () => suppressedResult;
    }

    emailService.__emailSuppressionApplied = true;
  }

  strapi.log.info('[email] EMAIL_ENABLED=false; all outgoing emails are suppressed.');
}

const COURSE_CLONE_ASSIGNMENTS_LOG = '[course-clone-assignments]';

function summarizeCourseAssignmentsPayload(raw) {
  if (raw == null) return 'absent';
  if (Array.isArray(raw)) return `array(len=${raw.length})`;
  if (typeof raw === 'object') {
    const n = (a) => (Array.isArray(a) ? a.length : 0);
    return `connect=${n(raw.connect)} set=${n(raw.set)} disconnect=${n(raw.disconnect)}`;
  }
  return typeof raw;
}

function isContentManagerCourseCloneLikeRequest(strapi) {
  const ctx = strapi.requestContext?.get?.();
  if (!ctx?.request) return false;

  const req = ctx.request;
  const url = String(req.url || req.originalUrl || req.path || '');
  const referer = String(
    (typeof req.header?.referer === 'string' && req.header.referer) ||
      req.headers?.referer ||
      (typeof ctx.get === 'function' ? ctx.get('referer') : '') ||
      ''
  );
  const combined = `${url} ${referer}`;
  if (/\/clone\//i.test(combined)) return true;
  if (/\/actions\/duplicate/i.test(combined)) return true;
  return false;
}

/** Same idea as admin AutoFillComponentIds: duplicated entries default to a “copy” title. */
function titleLooksLikeDuplicatedCourse(rawTitle) {
  const raw = String(rawTitle ?? '').trim();
  if (!raw) return false;
  const s = raw.toLowerCase();
  if (s.startsWith('copy of ')) return true;
  if (s.includes('(copy')) return true;
  if (/\bduplicate\b/.test(s)) return true;
  return false;
}

/**
 * URL/title signals (admin may rename “Copy of…” to e.g. “test course3” before save).
 */
function shouldStripCourseAssignmentsFromUrlOrTitle(strapi, data) {
  if (!data || typeof data !== 'object') return false;
  if (isContentManagerCourseCloneLikeRequest(strapi)) return true;
  if (titleLooksLikeDuplicatedCourse(data.title)) return true;
  return false;
}

/** Set by custom admin fetch when user is saving a duplicated course (clone URL / duplicate modal). */
function vegaDuplicateCourseHeaderPresent(strapi) {
  const ctx = strapi.requestContext?.get?.();
  if (!ctx?.request) return false;
  const h = ctx.request.header || ctx.request.headers || {};
  const v = h['x-vega-duplicate-course'] ?? h['X-Vega-Duplicate-Course'];
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

async function assignmentHasLinksInJoinTable(strapi, assignmentDbId) {
  const id = Number(assignmentDbId);
  if (!Number.isFinite(id)) return null;
  try {
    const knex = strapi.db.connection;
    const table = 'courses_course_assignments_lnk';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return null;
    const row = await knex(table).where({ course_assignment_id: id }).first();
    return row != null;
  } catch (e) {
    strapi.log.debug(
      `${COURSE_CLONE_ASSIGNMENTS_LOG} assignmentHasLinksInJoinTable failed assignmentDbId=${id}`,
      e?.message || e
    );
    return null;
  }
}

function extractCourseAssignmentIdsFromRelationPayload(raw) {
  const out = [];
  const seen = new Set();
  const add = (v) => {
    if (v == null || v === '') return;
    if (typeof v === 'number' && Number.isFinite(v)) {
      const k = `n:${v}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(v);
      }
      return;
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return;
      const k = `s:${t}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(/^\d+$/.test(t) ? Number(t) : t);
    }
  };
  const visit = (item) => {
    if (item == null) return;
    if (typeof item === 'number' || typeof item === 'string') {
      add(item);
      return;
    }
    if (typeof item === 'object') {
      if (item.id != null) add(item.id);
      if (item.documentId != null) add(String(item.documentId));
    }
  };
  if (Array.isArray(raw)) {
    raw.forEach(visit);
    return out;
  }
  if (typeof raw === 'object') {
    const dataEntries = Array.isArray(raw.data) ? raw.data : [];
    [].concat(raw.connect || [], raw.set || [], dataEntries).forEach(visit);
  }
  return out;
}

function assignmentRowMatchesPayloadId(row, id) {
  if (!row) return false;
  if (typeof id === 'number' && Number(row.id) === id) return true;
  if (row.documentId != null && String(row.documentId) === String(id)) return true;
  return false;
}

function assignmentHasLinkedCourse(row) {
  const courses = row?.courses;
  if (Array.isArray(courses)) return courses.length > 0;
  return courses != null && typeof courses === 'object' && courses.id != null;
}

/**
 * Duplicate saves the same relation connects as the source: those assignment rows already link to at least one course.
 * Renamed titles (“test course3”) still match this. Rare side effect: create that only connects brand-new assignments
 * with no course yet is not stripped; create that intentionally joins an existing shared assignment (already has courses)
 * is stripped — use a follow-up update to link if you rely on that edge case.
 */
async function payloadLooksLikeDuplicatedCourseAssignments(strapi, data) {
  const raw = data?.course_assignments;
  if (raw == null) return false;
  const ids = extractCourseAssignmentIdsFromRelationPayload(raw);
  if (ids.length === 0) return false;

  const numericIds = ids.filter((x) => typeof x === 'number');
  const docIds = ids.filter((x) => typeof x === 'string' && !/^\d+$/.test(String(x)));
  const fromStrings = ids.filter((x) => typeof x === 'string' && /^\d+$/.test(String(x))).map((x) => Number(x));
  const allNumeric = [...new Set([...numericIds, ...fromStrings].filter((n) => Number.isFinite(n)))];

  const whereClauses = [];
  if (allNumeric.length > 0) whereClauses.push({ id: { $in: allNumeric } });
  if (docIds.length > 0) whereClauses.push({ documentId: { $in: docIds } });
  if (whereClauses.length === 0) return false;

  const where = whereClauses.length === 1 ? whereClauses[0] : { $or: whereClauses };

  const assignments = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
    where,
    populate: { courses: { select: ['id'] } },
    limit: Math.max(30, ids.length + 10),
  });

  if (assignments.length === 0) return false;

  for (const id of ids) {
    const row = assignments.find((a) => assignmentRowMatchesPayloadId(a, id));
    if (!row) {
      strapi.log.debug(
        `${COURSE_CLONE_ASSIGNMENTS_LOG} payloadLooksLikeDuplicatedCourseAssignments: unresolved assignment id in payload, skip infer`
      );
      return false;
    }
    let linked = assignmentHasLinkedCourse(row);
    if (!linked) {
      const jt = await assignmentHasLinksInJoinTable(strapi, row.id);
      if (jt === true) linked = true;
      else if (jt === false) return false;
      else return false;
    }
  }
  return true;
}

async function stripCourseAssignmentsIfDuplicateLike(strapi, data, sourceLabel, action = 'create') {
  if (!data || typeof data !== 'object' || data.course_assignments == null) {
    return { stripped: false };
  }

  try {
    const summary = summarizeCourseAssignmentsPayload(data.course_assignments);
    const cloneUrlMatch = isContentManagerCourseCloneLikeRequest(strapi);
    const duplicateTitle = titleLooksLikeDuplicatedCourse(data.title);
    let trace = 'no-request-context';
    const ctx = strapi.requestContext?.get?.();
    if (ctx?.request) {
      trace = `${String(ctx.request.url || ctx.request.path || '')} ref=${String(
        (typeof ctx.request.header?.referer === 'string' && ctx.request.header.referer) ||
          ctx.request.headers?.referer ||
          ''
      )}`.slice(0, 400);
    }

    const headerDup = vegaDuplicateCourseHeaderPresent(strapi);
    const urlTitleDup = shouldStripCourseAssignmentsFromUrlOrTitle(strapi, data);
    let duplicateLike = urlTitleDup || headerDup;
    let reason = duplicateLike ? (headerDup ? 'vega-dup-header' : 'url-or-title') : '';

    // Join-table infer only on create — on update it would strip normal assignment edits.
    if (!duplicateLike && action !== 'update') {
      try {
        const inferred = await payloadLooksLikeDuplicatedCourseAssignments(strapi, data);
        if (inferred) {
          duplicateLike = true;
          reason = 'assignments-already-linked';
        }
      } catch (lookupErr) {
        strapi.log.warn(
          `${COURSE_CLONE_ASSIGNMENTS_LOG} ${sourceLabel}: assignment lookup for duplicate infer failed`,
          lookupErr
        );
      }
    }

    if (!duplicateLike) {
      strapi.log.debug(
        `${COURSE_CLONE_ASSIGNMENTS_LOG} ${sourceLabel}: keep course_assignments (summary=${summary} cloneUrlMatch=${cloneUrlMatch} dupHeader=${headerDup} duplicateTitle=${duplicateTitle} trace=${trace}`
      );
      return { stripped: false };
    }

    strapi.log.info(
      `${COURSE_CLONE_ASSIGNMENTS_LOG} ${sourceLabel}: stripping course_assignments (${summary}) reason=${reason} action=${action} cloneUrlMatch=${cloneUrlMatch} dupHeader=${headerDup} duplicateTitle=${duplicateTitle} trace=${trace}`
    );

    if (action === 'update') {
      // For duplicate flow, relation links might already exist on the draft row before publish.
      // Force-clear M2M on update/publish so copied assignment ids are removed.
      data.course_assignments = { set: [] };
    } else {
      delete data.course_assignments;
    }
    return { stripped: true };
  } catch (err) {
    strapi.log.error(
      `${COURSE_CLONE_ASSIGNMENTS_LOG} ${sourceLabel}: error while stripping course_assignments`,
      err
    );
    throw err;
  }
}

module.exports = {
  register({ strapi }) {
    strapi.customFields.register({
      name: 'date-future-only',
      type: 'date',
    });
    strapi.customFields.register({
      name: 'number-range',
      type: 'integer',
    });
    strapi.customFields.register({
      name: 'multi-select-dropdown',
      type: 'json',
    });
    strapi.customFields.register({
      name: 'yes-no-toggle',
      type: 'boolean',
    });
    strapi.customFields.register({
      name: 'workflow-prerequisite-picker',
      type: 'json',
    });

    // Course create/update: strip course_assignments only for duplicate-like saves (URL/title, join-table infer, or X-Vega-Duplicate-Course from admin).
    strapi.documents.use(async (context, next) => {
      if (context.uid === COURSE_UID && (context.action === 'create' || context.action === 'update')) {
        await stripCourseAssignmentsIfDuplicateLike(
          strapi,
          context.params?.data,
          `documents.use.${context.action}`,
          context.action
        );
      }
      return await next();
    });

    // When a course is created or updated, sync modules/quiz/feedback_question to match course_language (one entry per language)
    strapi.documents.use(async (context, next) => {
      if (context.uid === COURSE_UID && ['create', 'update'].includes(context.action)) {
        const data = context.params?.data;
        if (data && typeof data === 'object') {
          try {
            syncCourseLanguageComponents(data);
          } catch (err) {
            strapi.log.warn('syncCourseLanguageComponents failed', err);
          }
        }
      }
      return await next();
    });

    // Auto-generate id fields for all components (module_id, quiz_id, question_id, unit_id, route_id, etc.) when missing
    strapi.documents.use(async (context, next) => {
      if (['create', 'update'].includes(context.action)) {
        const data = context.params?.data;
        if (data && typeof data === 'object' && context.uid) {
          try {
            const forceRegenerate = context.uid === COURSE_UID && context.action === 'create';
            autoGenerateComponentIds(strapi, context.uid, data, { forceRegenerate });
          } catch (err) {
            strapi.log.warn('autoGenerateComponentIds failed', err);
          }
        }
      }
      return await next();
    });

    // Course: published entries are read-only from Content Manager update flow.
    // If a course has a published version, block updates from both Draft/Published tabs.
    strapi.documents.use(async (context, next) => {
      if (context.uid !== COURSE_UID || context.action !== 'update') {
        return await next();
      }

      const where = context.params?.where || {};
      let documentId =
        context.params?.documentId
        || where?.documentId
        || where?.$and?.find?.((x) => x?.documentId)?.documentId
        || null;

      // Fallback: resolve documentId from id/where when only row id is available.
      if (!documentId) {
        const row = await strapi.db.query(COURSE_UID).findOne({
          where: where?.id ? { id: where.id } : where,
          select: ['id', 'documentId'],
        });
        documentId = row?.documentId || null;
      }

      if (!documentId) {
        return await next();
      }

      const publishedVersion = await strapi.db.query(COURSE_UID).findOne({
        where: {
          documentId,
          publishedAt: { $notNull: true },
        },
        select: ['id', 'documentId', 'publishedAt'],
      });

      if (publishedVersion) {
        throw new errors.ValidationError(
          'Published course entries are locked. Create a duplicate or unpublish first, then edit.'
        );
      }

      return await next();
    });

    // When a user is created or updated, ensure a Department entry exists for their department + company
    strapi.documents.use(async (context, next) => {
      const result = await next();
      if (context.uid !== USER_UID || !['create', 'update'].includes(context.action)) {
        return result;
      }
      // Prefer params.data (payload sent) so we don't depend on result shape
      const fromParams = context.params?.data;
      const fromResult = result?.document ?? result;
      const department = fromParams?.department ?? fromResult?.department;
      const company = fromParams?.company ?? fromResult?.company;
      if (!department || !company) return result;
      try {
        await ensureDepartmentForUser(strapi, department, company);
      } catch (err) {
        strapi.log.warn('ensureDepartmentForUser failed', err);
      }
      return result;
    });

    // Prevent direct user updates to sensitive fields - force profile-edit-request flow
    strapi.documents.use(async (context, next) => {
      const { uid, action } = context;
      const data = context.params?.data;

      if (uid !== USER_UID || action !== 'update' || !data) {
        return await next();
      }

      const user = context.state?.user || context.user;
      const targetDocId = context.params?.documentId;
      const targetId = context.params?.id;
      const isUpdatingSelf = user && (
        String(user.documentId) === String(targetDocId) ||
        String(user.id) === String(targetId)
      );

      if (!isUpdatingSelf) {
        return await next();
      }

      const sensitiveFields = [
        'photograph',
        'email',
        'contact_no',
        'designation',
        'department',
        'working_location',
        'branch',
        'date_of_birth',
      ];

      const attemptedSensitiveUpdates = Object.keys(data).filter((key) =>
        sensitiveFields.includes(key)
      );

      if (attemptedSensitiveUpdates.length > 0) {
        throw new Error(
          `Cannot directly update profile. Sensitive fields (${attemptedSensitiveUpdates.join(', ')}) ` +
          'require approval via profile-edit-request. Please use the profile edit request system.'
        );
      }

      return await next();
    });

    // Course-assignment automation runs from docManager.create (Content Manager) and from db lifecycle (API/fallback).
    // We do not run it here in documents.use to avoid double-running when CM creates.
  },

  bootstrap({ strapi }) {
    installGeneratedAdminTitlePatcher(strapi);

    suppressEmailServiceIfDisabled(strapi);

    const uploadsDir = path.join(strapi.dirs.static.public, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const httpServer = strapi.server?.httpServer;
    if (httpServer) {
      httpServer.requestTimeout = 0;
      httpServer.headersTimeout = 0;
      httpServer.keepAliveTimeout = 5 * 60 * 1000;
      strapi.log.info(
        `[upload] HTTP timeouts — requestTimeout=${httpServer.requestTimeout}, headersTimeout=${httpServer.headersTimeout}, keepAliveTimeout=${httpServer.keepAliveTimeout}`
      );
    }

    // ── Serve AIA employee photos from cache dir (if configured) else direct mount ──
    // Route: GET /empimages/:filename  (e.g. /empimages/11000_06_06_2018_....JPG)
    // Serves from AIA_EMP_IMAGES_CACHE_DIR (persistent volume) when set,
    // falling back to AIA_EMP_IMAGES_DIR (mounted share) otherwise.
    {
      const fsSync = require('node:fs');
      const nodePath = require('node:path');
      const cacheDir = String(process.env.AIA_EMP_IMAGES_CACHE_DIR || '').trim();
      const sourceDir = String(process.env.AIA_EMP_IMAGES_DIR || '/mnt/empimages').trim();
      const imagesDir = cacheDir || sourceDir;
      const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
      const MIME = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.webp': 'image/webp',
        '.gif': 'image/gif', '.bmp': 'image/bmp',
      };

      strapi.server.app.use(async (ctx, next) => {
        if (!ctx.path.startsWith('/empimages/')) return next();

        // Strip the prefix and sanitize — no path traversal
        const rawName = ctx.path.slice('/empimages/'.length);
        const fileName = nodePath.basename(rawName); // strips any ../ attempts
        const ext = nodePath.extname(fileName).toLowerCase();

        if (!fileName || !ALLOWED_EXT.has(ext)) {
          ctx.status = 400;
          return;
        }

        const filePath = nodePath.join(imagesDir, fileName);

        // Security: ensure resolved path is still inside imagesDir
        if (!filePath.startsWith(imagesDir + nodePath.sep) && filePath !== imagesDir) {
          ctx.status = 403;
          return;
        }

        if (!fsSync.existsSync(filePath)) {
          ctx.status = 404;
          return;
        }

        ctx.set('Content-Type', MIME[ext] || 'application/octet-stream');
        ctx.set('Cache-Control', 'public, max-age=86400'); // cache 1 day in browser
        ctx.body = fsSync.createReadStream(filePath);
      });

      strapi.log.info(`[aia-photo-sync] Serving employee photos from "${imagesDir}" at /empimages/:filename${cacheDir ? ' (cache)' : ' (direct mount)'}`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Optional startup syncs (env-controlled) ──────────────────────────────
    if (isStartupSyncEnabled()) {
      console.log('\n[startup-sync] 🚀 RUN_STARTUP_SYNCS=true: triggering startup syncs...');

      console.log('[employee-sync] 🚀 Bootstrap: triggering AIA employee sync on startup...');
      syncEmployeesFromHrms(strapi).catch((err) => {
        console.error(`[employee-sync] ❌ Startup sync failed: ${err?.message || err}`);
        strapi.log.error(`[employee-sync] Startup sync failed: ${err?.message || err}`);
      });

      console.log('[aia-photo-sync] 🚀 Bootstrap: triggering AIA photo sync on startup...');
      syncAiaEmployeePhotos(strapi).catch((err) => {
        console.error(`[aia-photo-sync] ❌ Startup photo sync failed: ${err?.message || err}`);
        strapi.log.error(`[aia-photo-sync] Startup photo sync failed: ${err?.message || err}`);
      });

      console.log('[vega-sync] 🚀 Bootstrap: triggering Vega employee sync on startup...');
      syncVegaEmployees(strapi).catch((err) => {
        console.error(`[vega-sync] ❌ Startup sync failed: ${err?.message || err}`);
        strapi.log.error(`[vega-sync] Startup sync failed: ${err?.message || err}`);
      });
    } else {
      strapi.log.info('[startup-sync] RUN_STARTUP_SYNCS=false; skipping startup sync jobs.');
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Register scheduled cron tasks (Strapi v5 requires explicit strapi.cron.add) ──
    {
      const CRON_TZ = process.env.CRON_TZ || process.env.TZ || 'UTC';

      const cronTasks = {
        employeeSyncDaily: {
          task: async ({ strapi: s }) => {
            await syncEmployeesFromHrms(s);
            await syncAiaEmployeePhotos(s);
          },
          options: { rule: '0 0 22 * * *', tz: CRON_TZ },
        },
        vegaEmployeeSyncDaily: {
          task: async ({ strapi: s }) => {
            await syncVegaEmployees(s);
          },
          options: { rule: '0 0 22 * * *', tz: CRON_TZ },
        },
      };

      strapi.cron.add(cronTasks);
      strapi.log.info(`[cron-register] registered cron tasks: ${Object.keys(cronTasks).join(', ')} | tz=${CRON_TZ}`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── One-time cleanup: remove fake auto-generated emails ──────────────────
    if (String(process.env.RUN_FAKE_EMAIL_CLEANUP || '').trim() === 'true') {
      console.log('\n[cleanup-fake-emails] 🚀 Bootstrap: RUN_FAKE_EMAIL_CLEANUP=true, starting cleanup in 15s...');
      // Delay to let hot-reload settle (token file write triggers restart in develop mode)
      setTimeout(() => {
        cleanupFakeEmails(strapi).catch((err) => {
          console.error(`[cleanup-fake-emails] ❌ Cleanup failed: ${err?.message || err}`);
          strapi.log.error(`[cleanup-fake-emails] Cleanup failed: ${err?.message || err}`);
        });
      }, 15000);
    }
    // ─────────────────────────────────────────────────────────────────────────
    //Force reset when admin changes password
    strapi.db.lifecycles.subscribe({
      models: ['plugin::users-permissions.user'],

      async beforeUpdate(event) {
        const { data, where } = event.params;
        const ctx = strapi.requestContext.get();
        const requestUrl = ctx?.request?.url || '';
        const isFrontendChangePassword = requestUrl.includes('/change-password');
        const isAdminContentManagerUpdate = requestUrl.includes('/content-manager/');
        const hasPasswordInPayload = Object.prototype.hasOwnProperty.call(data || {}, 'password');
        const nextPassword = typeof data?.password === 'string' ? data.password.trim() : '';

        strapi.log.info(
          `[user-password-lifecycle] beforeUpdate url=${requestUrl || 'n/a'} hasPasswordInPayload=${hasPasswordInPayload} passwordProvided=${Boolean(nextPassword)} isFrontendChangePassword=${isFrontendChangePassword} isAdminContentManagerUpdate=${isAdminContentManagerUpdate}`
        );

        if (!hasPasswordInPayload || !nextPassword || isFrontendChangePassword || !isAdminContentManagerUpdate) {
          strapi.log.info('[user-password-lifecycle] skipped: update is not an admin Content Manager password change');
          return;
        }

        const existingUser = await strapi.db.query(USER_UID).findOne({
          where,
          select: ['id', 'password'],
        });

        strapi.log.info(
          `[user-password-lifecycle] candidate userId=${existingUser?.id ?? 'unknown'} existingPasswordFound=${Boolean(existingUser?.password)}`
        );

        if (!existingUser?.password) {
          data.is_first_login = true;
          strapi.log.info('[user-password-lifecycle] existing password not found, setting is_first_login=true');
          return;
        }

        const userService =
          strapi.plugins?.['users-permissions']?.services?.user ||
          strapi.plugin?.('users-permissions')?.service?.('user');

        if (!userService?.validatePassword) {
          data.is_first_login = true;
          strapi.log.warn('[user-password-lifecycle] validatePassword unavailable, setting is_first_login=true as fallback');
          return;
        }

        const isSamePassword = await userService.validatePassword(nextPassword, existingUser.password);

        strapi.log.info(`[user-password-lifecycle] password comparison result isSamePassword=${isSamePassword}`);

        if (!isSamePassword) {
          data.is_first_login = true;
          strapi.log.info('[user-password-lifecycle] admin password changed, setting is_first_login=true');
          return;
        }

        strapi.log.info('[user-password-lifecycle] password unchanged, leaving is_first_login as-is');
      },
    });

    strapi.utils = strapi.utils || {};
    strapi.utils.notification = require('./utils/notification')(strapi);

    // ── Socket.io: JWT-based auto-room join ──────────────────────────────────
    try {
      if (strapi.$io) {
        // Verify JWT on every connection and store userId on the socket object
        strapi.$io.server.use(async (socket, next) => {
          try {
            const token = socket.handshake.auth?.token;
            if (!token) return next();
            const jwtService =
              strapi.plugins?.['users-permissions']?.services?.jwt ||
              strapi.plugin?.('users-permissions')?.service?.('jwt');
            if (!jwtService) return next();
            const decoded = await jwtService.verify(token);
            const userId = decoded?.id ?? decoded?._id;
            if (userId) socket.userId = String(userId);
            next();
          } catch {
            next(); // invalid/expired token — allow connection without a room
          }
        });

        strapi.$io.server.on('connection', (socket) => {
          // Auto-join the user's personal room from the JWT-decoded userId
          if (socket.userId) {
            socket.join(`user_${socket.userId}`);
          }

          // Fallback: client can also emit 'join-room' after connect
          socket.on('join-room', (room) => {
            if (
              typeof room === 'string' &&
              (room.startsWith('user_') || room.startsWith('admin_'))
            ) {
              socket.join(room);
            }
          });
        });
      } else {
        strapi.log.warn('[socket] strapi.$io not available — ensure @strapi-community/plugin-io is enabled.');
      }
    } catch (e) {
      strapi.log.error('[socket] Bootstrap failed:', e?.message || e);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // User-progress automation: course-assignment → Not_started; start-course → In_progress; quiz-submission → Completed/Failed
    try {
      const { registerUserProgressLifecycles } = require('./lifecycles/user-progress-automation');
      registerUserProgressLifecycles(strapi);
    } catch (e) {
      strapi.log.error('User-progress automation bootstrap failed:', e?.message || e);
    }

    // Feedback-submission: admin notification when created via Content Manager
    try {
      const { registerFeedbackSubmissionLifecycles } = require('./lifecycles/feedback-submission-notification');
      registerFeedbackSubmissionLifecycles(strapi);
    } catch (e) {
      strapi.log.error('Feedback-submission notification bootstrap failed:', e?.message || e);
    }

    // Quiz reattempt: user notification (bell + email) when admin approves or rejects
    try {
      const { registerQuizReattemptNotificationLifecycles } = require('./lifecycles/quiz-reattempt-notification');
      registerQuizReattemptNotificationLifecycles(strapi);
    } catch (e) {
      strapi.log.error('Quiz reattempt notification bootstrap failed:', e?.message || e);
    }

    // Profile edit request: notify admin on create, notify user on approve/reject
    try {
      const { registerProfileEditRequestNotificationLifecycles } = require('./lifecycles/profile-edit-request-notification');
      registerProfileEditRequestNotificationLifecycles(strapi);
    } catch (e) {
      strapi.log.error('Profile edit request notification bootstrap failed:', String(e));
    }

    // Course-workflow: when module_type is Offline, create one offline_module row per selected user.
    try {
      const { registerCourseWorkflowOfflineModuleSync } = require('./lifecycles/course-workflow-offline-module-sync');
      registerCourseWorkflowOfflineModuleSync(strapi);
    } catch (e) {
      strapi.log.error('Course-workflow offline-module sync bootstrap failed:', e?.message || e);
    }

    // Global safety net: always populate quiz_submission.answers[].correct regardless of route/controller path.
    try {
      strapi.db.lifecycles.subscribe({
        models: ['api::quiz-submission.quiz-submission'],
        async beforeCreate(event) {
          const data = event?.params?.data || {};
          await populateAnswerCorrectField(strapi, data);
          const t = Array.isArray(data.answers) ? data.answers.filter((a) => a?.correct === true).length : 0;
          const f = Array.isArray(data.answers) ? data.answers.filter((a) => a?.correct === false).length : 0;
          strapi.log.info('[quiz-submission db lifecycle] beforeCreate total=%s true=%s false=%s', data?.answers?.length || 0, t, f);
        },
        async beforeUpdate(event) {
          const data = event?.params?.data || {};
          await populateAnswerCorrectField(strapi, data);
          const t = Array.isArray(data.answers) ? data.answers.filter((a) => a?.correct === true).length : 0;
          const f = Array.isArray(data.answers) ? data.answers.filter((a) => a?.correct === false).length : 0;
          strapi.log.info('[quiz-submission db lifecycle] beforeUpdate total=%s true=%s false=%s', data?.answers?.length || 0, t, f);
        },
      });
    } catch (e) {
      strapi.log.error('Quiz-submission correctness lifecycle bootstrap failed:', e?.message || e);
    }

    // Fallback: ensure department when user is created/updated via Content Manager
    const plugin = strapi.plugin('content-manager');
    if (!plugin) return;
    const docManager = plugin.service('document-manager');
    if (!docManager || typeof docManager.create !== 'function') return;

    const originalCreate = docManager.create.bind(docManager);
    docManager.create = async (uid, opts = {}) => {
      if (uid === COURSE_UID && opts?.data && typeof opts.data === 'object') {
        try {
          await stripCourseAssignmentsIfDuplicateLike(strapi, opts.data, 'docManager.create', 'create');
        } catch (err) {
          strapi.log.error(`${COURSE_CLONE_ASSIGNMENTS_LOG} docManager.create: strip failed`, err);
          throw err;
        }
      }
      if (uid === COURSE_UID && opts?.data && typeof opts.data === 'object') {
        try {
          syncCourseLanguageComponents(opts.data);
        } catch (err) {
          strapi.log.warn('syncCourseLanguageComponents (create) failed', err);
        }
      }
      const result = await originalCreate(uid, opts);
      if (uid === USER_UID) {
        const department = opts?.data?.department ?? result?.department;
        const company = opts?.data?.company ?? result?.company;
        if (department && company) {
          try {
            await ensureDepartmentForUser(strapi, department, company);
          } catch (err) {
            strapi.log.warn('ensureDepartmentForUser (create) failed', err);
          }
        }
      }
      // Course-assignment automation runs only from db lifecycle (afterCreate) to avoid duplicate
      // user-progress entries. Do not run here.
      return result;
    };

    const originalUpdate = docManager.update.bind(docManager);
    docManager.update = async (id, uid, opts = {}) => {
      if (uid === COURSE_UID && opts?.data && typeof opts.data === 'object') {
        try {
          syncCourseLanguageComponents(opts.data);
        } catch (err) {
          strapi.log.warn('syncCourseLanguageComponents (update) failed', err);
        }
      }
      const result = await originalUpdate(id, uid, opts);
      if (uid === USER_UID) {
        const department = opts?.data?.department ?? result?.department;
        const company = opts?.data?.company ?? result?.company;
        if (department && company) {
          try {
            await ensureDepartmentForUser(strapi, department, company);
          } catch (err) {
            strapi.log.warn('ensureDepartmentForUser (update) failed', err);
          }
        }
      }
      return result;
    };
  },
};
