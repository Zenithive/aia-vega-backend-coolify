'use strict';

/**
 * ONE-TIME cleanup script for users created with auto-generated fake emails.
 *
 * AIA fake pattern : *@aia.internal
 * Vega fake pattern: *@vega.internal
 *
 * For AIA  — re-fetches all pages from the HRMS API, matches by emp_code,
 *             then sets the real Work_Email (or null if still missing) and
 *             restores the real Emp_Name as username.
 *
 * For Vega — re-reads the OneDrive Excel, matches by emp_id (USER_ID column),
 *             then sets the real email (or null) and restores the real name.
 *
 * Run via Strapi bootstrap or a one-off script. Safe to run multiple times.
 */

const { getEmployeeApiToken } = require('./get-employee-api-token');
const { getAccessToken } = require('../utils/vega-graph-auth');

const USER_UID = 'plugin::users-permissions.user';

// ── shared helpers ────────────────────────────────────────────────────────────

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function safeString(value, fallback = '-') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function isFakeEmail(email) {
  if (!email) return false;
  const e = String(email).toLowerCase();
  return e.endsWith('@aia.internal') || e.endsWith('@vega.internal');
}

// ── AIA helpers ───────────────────────────────────────────────────────────────

function extractEmployeeList(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.data?.data, payload?.data?.Data, payload?.data,
    payload?.Data?.data, payload?.Data, payload?.items, payload?.Items,
    payload?.result?.data, payload?.result, payload?.Result,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function extractTotalPages(payload) {
  return (
    payload?.data?.totalPages ?? payload?.data?.TotalPages ??
    payload?.totalPages ?? payload?.TotalPages ?? null
  );
}

async function fetchAllAiaEmployees(strapi) {
  const baseUrl = String(process.env.EMPLOYEE_API_BASE_URL || '').trim();
  const apiPath = String(process.env.EMPLOYEE_API_PATH || '').trim();
  const companyId = Number(process.env.EMPLOYEE_API_COMPANY_ID || 1);
  const pageSize = Number(process.env.EMPLOYEE_API_PAGE_SIZE || 100);

  if (!baseUrl || !apiPath) throw new Error('Missing EMPLOYEE_API_BASE_URL or EMPLOYEE_API_PATH');

  const token = await getEmployeeApiToken(strapi);
  const all = [];
  let page = 1;

  while (true) {
    const url = new URL(apiPath, baseUrl);
    url.searchParams.set('cmpId', String(companyId));
    url.searchParams.set('empId', '0');
    url.searchParams.set('pageNumber', String(page));
    url.searchParams.set('pageSize', String(pageSize));

    const res = await fetch(url.toString(), {
      headers: { accept: '*/*', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`AIA API failed: HTTP ${res.status}`);
    const payload = await res.json();

    const employees = extractEmployeeList(payload);
    if (!employees.length) break;
    all.push(...employees);

    const totalPages = extractTotalPages(payload);
    if (totalPages !== null ? page >= totalPages : employees.length < pageSize) break;
    page += 1;
  }

  return all;
}

// ── Vega helpers ──────────────────────────────────────────────────────────────

const COL = { SR_NO: 0, STATUS: 1, USER_ID: 2, NAME: 3, EMAIL: 5 };

async function fetchAllVegaRows() {
  const driveId = String(process.env.VEGA_ONEDRIVE_DRIVE_ID || '').trim();
  const itemId = String(process.env.VEGA_ONEDRIVE_FILE_ITEM_ID || '').trim();
  const worksheet = String(process.env.VEGA_EXCEL_WORKSHEET_NAME || 'Task & Vega').trim();

  if (!driveId || !itemId) throw new Error('Missing VEGA_ONEDRIVE_DRIVE_ID or VEGA_ONEDRIVE_FILE_ITEM_ID');

  const accessToken = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodeURIComponent(worksheet)}/usedRange(valuesOnly=true)?$select=values`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph API failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return (data?.values || []).slice(1).filter((row) =>
    row.some((cell) => String(cell || '').trim() !== '')
  );
}

// ── AIA cleanup ───────────────────────────────────────────────────────────────

async function cleanupAiaFakeEmails(strapi) {
  strapi.log.info('[cleanup-fake-emails][AIA] starting...');

  // 1. Find all AIA users with fake emails
  const fakeUsers = await strapi.db.query(USER_UID).findMany({
    where: { company: 'AIA' },
    select: ['id', 'email', 'username', 'emp_code'],
  });

  const dirtyUsers = fakeUsers.filter((u) => isFakeEmail(u.email));
  strapi.log.info(`[cleanup-fake-emails][AIA] found ${dirtyUsers.length} users with fake emails`);

  if (!dirtyUsers.length) {
    strapi.log.info('[cleanup-fake-emails][AIA] nothing to clean up');
    return;
  }

  // 2. Build lookup maps: by emp_code AND by mobile (extracted from fake email)
  const dirtyByEmpCode = new Map();
  const dirtyByMobile = new Map();
  for (const u of dirtyUsers) {
    if (u.emp_code && u.emp_code !== '-') {
      dirtyByEmpCode.set(String(u.emp_code).trim(), u);
    }
    // Extract mobile from fake email like emp.8849276071@aia.internal
    const mobileMatch = String(u.email || '').match(/^emp\.(\d{7,15})@aia\.internal$/);
    if (mobileMatch) {
      dirtyByMobile.set(mobileMatch[1], u);
    }
  }

  // 3. Fetch all employees from AIA API
  strapi.log.info('[cleanup-fake-emails][AIA] fetching all employees from HRMS API...');
  const apiEmployees = await fetchAllAiaEmployees(strapi);
  strapi.log.info(`[cleanup-fake-emails][AIA] fetched ${apiEmployees.length} records from API`);

  let fixed = 0;
  let cleared = 0;
  let notFound = 0;

  for (const record of apiEmployees) {
    const empCode = String(record?.Emp_Code || '').trim();
    if (!empCode) continue;

    // Match by emp_code first, then by mobile number in the fake email
    let dirtyUser = dirtyByEmpCode.get(empCode);
    if (!dirtyUser) {
      const mobile = String(record?.Mobile_No || '').trim().replace(/\D/g, '');
      if (mobile) dirtyUser = dirtyByMobile.get(mobile);
    }
    if (!dirtyUser) continue;

    const realEmail = normalizeEmail(record?.Work_Email);
    const realName = safeString(record?.Emp_Name, dirtyUser.username);

    const updateData = { username: realName };

    if (realEmail) {
      // Check no other user already has this real email
      const conflict = await strapi.db.query(USER_UID).findOne({
        where: { email: realEmail, id: { $ne: dirtyUser.id } },
        select: ['id'],
      });
      if (conflict) {
        strapi.log.warn(`[cleanup-fake-emails][AIA] email conflict for emp_code=${empCode}: ${realEmail} already used by user id=${conflict.id}, skipping email update`);
        await strapi.db.query(USER_UID).update({ where: { id: dirtyUser.id }, data: { username: realName } });
        continue;
      }
      updateData.email = realEmail;
      fixed += 1;
      strapi.log.info(`[cleanup-fake-emails][AIA] FIXED  emp_code=${empCode} | ${dirtyUser.email} → ${realEmail} | name: ${realName}`);
    } else {
      // No real email in API — clear the fake one (set to null)
      updateData.email = null;
      cleared += 1;
      strapi.log.info(`[cleanup-fake-emails][AIA] CLEARED emp_code=${empCode} | removed fake email ${dirtyUser.email} | name: ${realName}`);
    }

    await strapi.db.query(USER_UID).update({ where: { id: dirtyUser.id }, data: updateData });
    // Mark as handled in whichever map it came from
    dirtyByEmpCode.delete(empCode);
    const mobile = String(record?.Mobile_No || '').trim().replace(/\D/g, '');
    if (mobile) dirtyByMobile.delete(mobile);
  }

  // Any remaining dirty users — clear fake emails directly
  // (name-pattern fakes like emp.mr.vikas...@aia.internal can't be matched back to API)
  const remainingByCode = [...dirtyByEmpCode.values()];
  const remainingByMobileSet = new Set([...dirtyByMobile.values()].map((u) => u.id));
  const remainingByCodeSet = new Set(remainingByCode.map((u) => u.id));
  const allRemainingIds = new Set([...remainingByCodeSet, ...remainingByMobileSet]);

  for (const u of dirtyUsers) {
    if (!allRemainingIds.has(u.id)) continue; // already handled
    // Clear the fake email — the regular sync will re-populate when real email arrives
    await strapi.db.query(USER_UID).update({ where: { id: u.id }, data: { email: null } });
    cleared += 1;
    strapi.log.info(`[cleanup-fake-emails][AIA] CLEARED user id=${u.id} | removed unmatched fake email ${u.email}`);
  }

  notFound = 0; // all handled

  strapi.log.info(`[cleanup-fake-emails][AIA] done. fixed=${fixed}, cleared=${cleared}, notFound=${notFound}`);
}

// ── Vega cleanup ──────────────────────────────────────────────────────────────

async function cleanupVegaFakeEmails(strapi) {
  strapi.log.info('[cleanup-fake-emails][Vega] starting...');

  // 1. Find all Vega users with fake emails
  const fakeUsers = await strapi.db.query(USER_UID).findMany({
    where: { company: 'Vega' },
    select: ['id', 'email', 'username', 'emp_id'],
  });

  const dirtyUsers = fakeUsers.filter((u) => isFakeEmail(u.email));
  strapi.log.info(`[cleanup-fake-emails][Vega] found ${dirtyUsers.length} users with fake emails`);

  if (!dirtyUsers.length) {
    strapi.log.info('[cleanup-fake-emails][Vega] nothing to clean up');
    return;
  }

  // 2. Build a map of emp_id -> user record
  const dirtyByEmpId = new Map();
  for (const u of dirtyUsers) {
    if (u.emp_id && u.emp_id !== '-') {
      dirtyByEmpId.set(String(u.emp_id).trim(), u);
    }
  }

  // 3. Fetch all rows from Excel
  strapi.log.info('[cleanup-fake-emails][Vega] fetching Excel data from OneDrive...');
  const rows = await fetchAllVegaRows();
  strapi.log.info(`[cleanup-fake-emails][Vega] fetched ${rows.length} rows from Excel`);

  let fixed = 0;
  let cleared = 0;
  let notFound = 0;

  for (const row of rows) {
    const empId = String(row[COL.USER_ID] || '').trim();
    if (!empId) continue;

    const dirtyUser = dirtyByEmpId.get(empId);
    if (!dirtyUser) continue;

    const realEmail = normalizeEmail(row[COL.EMAIL]);
    const realName = safeString(row[COL.NAME], dirtyUser.username);

    const updateData = { username: realName };

    if (realEmail) {
      const conflict = await strapi.db.query(USER_UID).findOne({
        where: { email: realEmail, id: { $ne: dirtyUser.id } },
        select: ['id'],
      });
      if (conflict) {
        strapi.log.warn(`[cleanup-fake-emails][Vega] email conflict for emp_id=${empId}: ${realEmail} already used by user id=${conflict.id}, skipping email update`);
        await strapi.db.query(USER_UID).update({ where: { id: dirtyUser.id }, data: { username: realName } });
        continue;
      }
      updateData.email = realEmail;
      fixed += 1;
      strapi.log.info(`[cleanup-fake-emails][Vega] FIXED  emp_id=${empId} | ${dirtyUser.email} → ${realEmail} | name: ${realName}`);
    } else {
      updateData.email = null;
      cleared += 1;
      strapi.log.info(`[cleanup-fake-emails][Vega] CLEARED emp_id=${empId} | removed fake email ${dirtyUser.email} | name: ${realName}`);
    }

    await strapi.db.query(USER_UID).update({ where: { id: dirtyUser.id }, data: updateData });
    dirtyByEmpId.delete(empId);
  }

  notFound = dirtyByEmpId.size;
  for (const [empId, u] of dirtyByEmpId) {
    strapi.log.warn(`[cleanup-fake-emails][Vega] NO EXCEL MATCH for emp_id=${empId} (user id=${u.id}, fake email=${u.email}) — clearing fake email`);
    await strapi.db.query(USER_UID).update({ where: { id: u.id }, data: { email: null } });
    cleared += 1;
  }
  notFound = 0;

  strapi.log.info(`[cleanup-fake-emails][Vega] done. fixed=${fixed}, cleared=${cleared}, notFound=${notFound}`);
}

// ── entry point ───────────────────────────────────────────────────────────────

async function cleanupFakeEmails(strapi) {
  strapi.log.info('[cleanup-fake-emails] ===== STARTING CLEANUP =====');
  try {
    await cleanupAiaFakeEmails(strapi);
  } catch (err) {
    strapi.log.error(`[cleanup-fake-emails][AIA] failed: ${err?.message || err}`);
  }
  try {
    await cleanupVegaFakeEmails(strapi);
  } catch (err) {
    strapi.log.error(`[cleanup-fake-emails][Vega] failed: ${err?.message || err}`);
  }
  strapi.log.info('[cleanup-fake-emails] ===== CLEANUP COMPLETE =====');
}

module.exports = { cleanupFakeEmails };
