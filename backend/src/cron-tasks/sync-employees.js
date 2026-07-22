// @ts-nocheck

'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { getEmployeeApiToken } = require('./get-employee-api-token');
const { ensureDepartmentForUser } = require('../utils/ensure-department-for-user');
const { ensureWorkLocationForUser } = require('../utils/ensure-work-location-for-user');

const USER_UID = 'plugin::users-permissions.user';
const ROLE_UID = 'plugin::users-permissions.role';

let isRunning = false;
let isRunningStartedAt = null;
const MAX_RUN_MS = 30 * 60 * 1000;
let isBackfillRunning = false;

function safeString(value, fallback = '-') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function normalizeCompany(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'aia') return 'AIA';
  if (lower === 'vega') return 'Vega';
  return text;
}

function cleanMeaningfulText(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (['-', '--', 'n/a', 'na', 'null', 'undefined'].includes(lower)) return null;
  return text;
}

function normalizeDate(value) {
  if (!value) return null;
  const asString = String(value).trim();
  if (!asString) return null;

  const isoMatch = asString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = asString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const part1 = Number(slashMatch[1]);
    const part2 = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const month = part1 > 12 ? part2 : part1;
    const day = part1 > 12 ? part1 : part2;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}



function resolvePhotoUrl(rawPhotoUrl, baseUrl) {
  if (!rawPhotoUrl) return null;
  const photo = String(rawPhotoUrl).trim();
  if (!photo) return null;
  try {
    return new URL(photo).toString();
  } catch {
    try {
      return new URL(photo, baseUrl).toString();
    } catch {
      return null;
    }
  }
}

function extractEmployeeList(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.data?.data,
    payload?.data?.Data,
    payload?.data,
    payload?.Data?.data,
    payload?.Data,
    payload?.items,
    payload?.Items,
    payload?.result?.data,
    payload?.result,
    payload?.Result,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function extractTotalPages(payload) {
  return (
    payload?.data?.totalPages ??
    payload?.data?.TotalPages ??
    payload?.totalPages ??
    payload?.TotalPages ??
    payload?.data?.total_pages ??
    null
  );
}

function extractTotalCount(payload) {
  return (
    payload?.data?.totalCount ??
    payload?.data?.TotalCount ??
    payload?.data?.totalRecords ??
    payload?.data?.TotalRecords ??
    payload?.totalCount ??
    payload?.TotalCount ??
    payload?.totalRecords ??
    payload?.TotalRecords ??
    null
  );
}

function logPaginationDebug(strapi, payload) {
  // Log the top-level keys to understand response shape
  const topKeys = Object.keys(payload || {});
  strapi.log.info(`[employee-sync][DEBUG] Response top-level keys: ${JSON.stringify(topKeys)}`);
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    const dataKeys = Object.keys(payload.data);
    strapi.log.info(`[employee-sync][DEBUG] Response.data keys: ${JSON.stringify(dataKeys)}`);
    // Log non-array values to see pagination metadata
    const meta = {};
    for (const k of dataKeys) {
      if (!Array.isArray(payload.data[k])) meta[k] = payload.data[k];
    }
    strapi.log.info(`[employee-sync][DEBUG] Pagination metadata in data: ${JSON.stringify(meta)}`);
  }
  // Log top-level non-array values
  const topMeta = {};
  for (const k of topKeys) {
    if (!Array.isArray(payload[k]) && typeof payload[k] !== 'object') topMeta[k] = payload[k];
  }
  if (Object.keys(topMeta).length) {
    strapi.log.info(`[employee-sync][DEBUG] Top-level scalar fields: ${JSON.stringify(topMeta)}`);
  }
}

async function getEmployeeRoleId(strapi) {
  const role =
    (await strapi.db.query(ROLE_UID).findOne({ where: { type: 'employee' }, select: ['id'] })) ||
    (await strapi.db.query(ROLE_UID).findOne({ where: { type: 'authenticated' }, select: ['id'] }));
  if (!role?.id) throw new Error('No suitable role found in users-permissions roles');
  return role.id;
}

function buildUsername(desiredUsername) {
  return safeString(desiredUsername, 'employee').slice(0, 60);
}

async function uploadPhotograph(strapi, photoUrl, username) {
  const response = await fetch(photoUrl, { method: 'GET', headers: { accept: '*/*' } });
  if (!response.ok) throw new Error(`Photograph download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('Photograph download returned empty file');

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const parsedUrl = new URL(photoUrl);
  const extFromPath = path.extname(parsedUrl.pathname || '') || '.bin';
  const fileName = `${safeString(username, 'employee')}_${Date.now()}${extFromPath}`;
  const tmpFilePath = path.join(os.tmpdir(), fileName);
  await fs.writeFile(tmpFilePath, bytes);

  try {
    const uploaded = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: fileName, alternativeText: safeString(username, 'employee') } },
      files: { path: tmpFilePath, name: fileName, type: contentType, size: bytes.length },
    });
    if (!Array.isArray(uploaded) || !uploaded[0]?.id) throw new Error('Upload service returned no metadata');
    return uploaded[0].id;
  } finally {
    await fs.unlink(tmpFilePath).catch(() => {});
  }
}

function buildUserData(record, roleId, usernameOverride, emailOverride) {
  const hasExitDate = Boolean(record.Exit_Date);
  return {
    username: usernameOverride,
    email: emailOverride,
    provider: 'local',
    confirmed: true,
    blocked: hasExitDate,
    role: roleId,
    joining_date: normalizeDate(record.Date_Of_Joining),
    date_of_birth: normalizeDate(record.Date_Of_Birth),
    contact_no: safeString(record.Mobile_No),
    company: 'AIA',
    branch: safeString(record.Branch),
    exit_date: hasExitDate ? normalizeDate(record.Exit_Date, null) : null,
    designation: safeString(record.Designation),
    department: safeString(record.Department),
    emp_code: safeString(record.Emp_Code),
    ext: 0,
    age: 0,
    working_location: '-',
    employment_type: '-',
    active: !hasExitDate,
    emp_id: '-',
    HOD: '-',
    payroll_office: '-',
    region: '-',
    experience_with_vega: '-',
    contract_validity: '-',
    business_vertical: '-',
    description: '',
  };
}

function shouldPreserveManualBlock(existingUser, hasExitDate) {
  if (hasExitDate) return false;
  if (!existingUser?.blocked) return false;
  // If exit_date is already set in DB, the block likely came from HR exit logic.
  return !existingUser?.exit_date;
}

function resolveUserLocation(userData) {
  const company = String(userData?.company || '').trim();
  if (!company) return null;
  if (company.toLowerCase() === 'aia') {
    const branch = String(userData?.branch || '').trim();
    return branch || null;
  }
  const workingLocation = String(userData?.working_location || '').trim();
  return workingLocation || null;
}

async function fetchEmployeePage(baseUrl, apiPath, token, companyId, pageNumber, pageSize) {
  const url = new URL(apiPath, baseUrl);
  url.searchParams.set('cmpId', String(companyId));
  url.searchParams.set('empId', '0');
  url.searchParams.set('pageNumber', String(pageNumber));
  url.searchParams.set('pageSize', String(pageSize));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { accept: '*/*', Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Employee API failed: HTTP ${response.status}`);
  return response.json();
}

async function syncEmployeesFromHrms(strapi) {
  if (isRunning) {
    const elapsed = Date.now() - (isRunningStartedAt || 0);
    if (elapsed < MAX_RUN_MS) {
      strapi.log.warn('[employee-sync] previous run still active, skipping this cycle');
      return;
    }
    strapi.log.warn('[employee-sync] previous run timed out, forcing reset');
  }

  isRunning = true;
  isRunningStartedAt = Date.now();

  const baseUrl = String(process.env.EMPLOYEE_API_BASE_URL || '').trim();
  const apiPath = String(process.env.EMPLOYEE_API_PATH || '').trim();
  const companyId = Number(process.env.EMPLOYEE_API_COMPANY_ID || 1);
  const pageSize = Number(process.env.EMPLOYEE_API_PAGE_SIZE || 100);
  const defaultPassword = String(process.env.EMPLOYEE_DEFAULT_PASSWORD || 'Welcome@123');

  if (!baseUrl || !apiPath) {
    strapi.log.error('[employee-sync] Missing EMPLOYEE_API_BASE_URL or EMPLOYEE_API_PATH');
    isRunning = false;
    return;
  }

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  try {
    strapi.log.info('[sync-summary] company=AIA sync=employee status=started');

    const roleId = await getEmployeeRoleId(strapi);
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    const token = await getEmployeeApiToken(strapi);

    strapi.log.info('[employee-sync] token generated; syncing employees...');

    let pageNumber = 1;
    let totalPages = null;
    let totalCount = null;
    let totalFetched = 0;

    while (true) {
      const payload = await fetchEmployeePage(baseUrl, apiPath, token, companyId, pageNumber, pageSize);

      if (pageNumber === 1) {
        logPaginationDebug(strapi, payload);
        totalPages = extractTotalPages(payload);
        totalCount = extractTotalCount(payload);
        strapi.log.info(
          `[employee-sync] API reports: totalPages=${totalPages ?? 'unknown'}, totalCount=${totalCount ?? 'unknown'}, pageSize=${pageSize}`
        );
        if (totalCount !== null && totalPages !== null) {
          const expectedPages = Math.ceil(totalCount / pageSize);
          if (expectedPages !== totalPages) {
            strapi.log.warn(
              `[employee-sync] WARNING: totalPages(${totalPages}) does not match ceil(totalCount/pageSize)=${expectedPages} — will use page count from API`
            );
          }
        }
      }

      const employees = extractEmployeeList(payload);
      totalFetched += employees.length;
      strapi.log.info(
        `[employee-sync] page ${pageNumber}/${totalPages ?? '?'}: got ${employees.length} employees | running total=${totalFetched}${totalCount !== null ? `/${totalCount}` : ''}`
      );

      if (!employees.length) {
        strapi.log.info('[employee-sync] empty page received, stopping pagination');
        break;
      }

      let pageCreated = 0;
      let pageUpdated = 0;
      let pageErrors = 0;

      for (const record of employees) {
        try {
          const empCode = safeString(record?.Emp_Code, '');
          const email = normalizeEmail(record?.Work_Email);
          const hasEmpCode = Boolean(empCode && empCode !== '-');

          if (!hasEmpCode) {
            strapi.log.warn(`[employee-sync] Skipping ${record?.Emp_Code || record?.Emp_Name || 'unknown'}: missing Emp_Code`);
            continue;
          }

          let existing = null;
          if (hasEmpCode) {
            existing = await strapi.db.query(USER_UID).findOne({
              where: { emp_code: empCode },
              select: ['id', 'username', 'email', 'blocked', 'exit_date'],
            });
          }

          const resolvedEmail = email || normalizeEmail(existing?.email) || null;

          const preferredUsername = safeString(record?.Emp_Name, empCode || 'employee');
          const username = buildUsername(preferredUsername);
          const userData = buildUserData(record, roleId, username, resolvedEmail);
          const keepManualBlock = shouldPreserveManualBlock(existing, Boolean(record?.Exit_Date));
          if (keepManualBlock) {
            userData.blocked = true;
            userData.active = false;
          }

          const photoUrl = resolvePhotoUrl(record?.Photograph, baseUrl);
          if (photoUrl) {
            try {
              userData.photograph = await uploadPhotograph(strapi, photoUrl, username);
            } catch (photoErr) {
              strapi.log.warn(`[employee-sync] Photo upload failed for ${resolvedEmail}: ${photoErr?.message}`);
            }
          }

          if (existing) {
            await strapi.db.query(USER_UID).update({ where: { id: existing.id }, data: userData });
            if (keepManualBlock) {
              strapi.log.info(`[employee-sync] preserved manual block for ${resolvedEmail || empCode}`);
            }
            updatedCount += 1;
            pageUpdated += 1;
          } else {
            await strapi.db.query(USER_UID).create({ data: { ...userData, password: passwordHash } });
            createdCount += 1;
            pageCreated += 1;
          }

          try {
            await ensureDepartmentForUser(strapi, userData.department, userData.company);
          } catch (deptErr) {
            strapi.log.warn(`[employee-sync] ensureDepartmentForUser failed for ${resolvedEmail}: ${deptErr?.message || deptErr}`);
          }

          try {
            const locationName = resolveUserLocation(userData);
            if (locationName) {
              await ensureWorkLocationForUser(strapi, locationName, userData.company);
            }
          } catch (locErr) {
            strapi.log.warn(`[employee-sync] ensureWorkLocationForUser failed for ${resolvedEmail}: ${locErr?.message || locErr}`);
          }
        } catch (employeeErr) {
          errorCount += 1;
          pageErrors += 1;
          const key = record?.Work_Email || record?.Emp_Name || 'unknown';
          strapi.log.error(`[employee-sync] Failed for ${key}: ${employeeErr?.message || employeeErr}`);
        }
      }

      strapi.log.info(
        `[employee-sync] page ${pageNumber} processed: created=${pageCreated}, updated=${pageUpdated}, errors=${pageErrors} | totals so far: created=${createdCount}, updated=${updatedCount}, errors=${errorCount}`
      );

      const shouldStop = totalPages !== null ? pageNumber >= totalPages : employees.length < pageSize;
      if (shouldStop) {
        strapi.log.info(
          `[employee-sync] stopping after page ${pageNumber} — ${totalPages !== null ? `reached totalPages(${totalPages})` : `last page had ${employees.length} < pageSize(${pageSize})`}`
        );
        break;
      }
      pageNumber += 1;
    }

    strapi.log.info(
      `[employee-sync] ===== SYNC COMPLETE ===== fetched=${totalFetched}${totalCount !== null ? `/${totalCount}` : ''} | created=${createdCount}, updated=${updatedCount}, errors=${errorCount}, total processed=${createdCount + updatedCount + errorCount}`
    );
    strapi.log.info(
      `[sync-summary] company=AIA sync=employee status=completed created=${createdCount} updated=${updatedCount} errors=${errorCount} total=${createdCount + updatedCount + errorCount}`
    );
  } catch (err) {
    strapi.log.error(`[employee-sync] run failed: ${err?.message || err}`);
    strapi.log.error(`[sync-summary] company=AIA sync=employee status=failed error="${err?.message || err}"`);
  } finally {
    isRunning = false;
  }
}

async function backfillUserOrgTaxonomy(strapi, options = {}) {
  if (isBackfillRunning) {
    strapi.log.warn('[employee-sync backfill] previous run still active, skipping');
    return;
  }

  isBackfillRunning = true;
  const batchSize = Math.max(100, Number(options.batchSize) || 500);

  try {
    let offset = 0;
    let scannedUsers = 0;
    const uniqueDepartments = new Set();
    const uniqueLocations = new Set();

    while (true) {
      const users = await strapi.db.query(USER_UID).findMany({
        select: ['id', 'company', 'department', 'branch', 'working_location'],
        limit: batchSize,
        offset,
        orderBy: { id: 'asc' },
      });

      if (!Array.isArray(users) || users.length === 0) break;

      scannedUsers += users.length;

      for (const user of users) {
        const company = normalizeCompany(user?.company);
        if (!company) continue;

        const department = cleanMeaningfulText(user?.department);
        if (department) {
          uniqueDepartments.add(`${company}|||${department}`);
        }

        const locationRaw = company === 'AIA' ? user?.branch : user?.working_location;
        const location = cleanMeaningfulText(locationRaw);
        if (location) {
          uniqueLocations.add(`${company}|||${location}`);
        }
      }

      if (users.length < batchSize) break;
      offset += users.length;
    }

    let deptErrors = 0;
    for (const key of uniqueDepartments) {
      const [company, department] = key.split('|||');
      try {
        await ensureDepartmentForUser(strapi, department, company);
      } catch (err) {
        deptErrors += 1;
        strapi.log.warn(`[employee-sync backfill] ensureDepartmentForUser failed for ${company}/${department}: ${err?.message || err}`);
      }
    }

    let locationErrors = 0;
    for (const key of uniqueLocations) {
      const [company, location] = key.split('|||');
      try {
        await ensureWorkLocationForUser(strapi, location, company);
      } catch (err) {
        locationErrors += 1;
        strapi.log.warn(`[employee-sync backfill] ensureWorkLocationForUser failed for ${company}/${location}: ${err?.message || err}`);
      }
    }

    strapi.log.info(
      `[employee-sync backfill] done. scannedUsers=${scannedUsers}, uniqueDepartments=${uniqueDepartments.size}, uniqueLocations=${uniqueLocations.size}, deptErrors=${deptErrors}, locationErrors=${locationErrors}`
    );
  } catch (err) {
    strapi.log.error(`[employee-sync backfill] run failed: ${err?.message || err}`);
  } finally {
    isBackfillRunning = false;
  }
}

module.exports = { syncEmployeesFromHrms, backfillUserOrgTaxonomy };
