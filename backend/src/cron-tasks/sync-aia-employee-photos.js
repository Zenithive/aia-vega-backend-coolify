// @ts-nocheck
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const USER_UID = 'plugin::users-permissions.user';

let isRunning = false;
let isRunningStartedAt = null;
const MAX_RUN_MS = 30 * 60 * 1000;

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

/**
 * Ensures a directory exists, creating it if needed.
 */
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function logDirectoryStatus(dirPath, dirName, strapi) {
  try {
    const entries = await fs.readdir(dirPath);

    const imageCount = entries.filter(file =>
      SUPPORTED_EXTS.has(path.extname(file).toLowerCase())
    ).length;

    if (imageCount === 0) {
      strapi.log.warn(
        `[aia-photo-sync] WARNING: ${dirName} directory is EMPTY (${dirPath})`
      );
    } else {
      strapi.log.info(
        `[aia-photo-sync] ${dirName} directory contains ${imageCount} image files`
      );
    }
  } catch (err) {
    strapi.log.error(
      `[aia-photo-sync] Failed to check ${dirName} directory: ${err.message}`
    );
  }
}
/**
 * Copies new/changed files from sourceDir to cacheDir.
 * A file is copied when:
 *  - it does not exist in cacheDir, OR
 *  - its mtime in sourceDir is newer than in cacheDir.
 * Returns counts: { copied, skipped, failed }
 */
async function syncSourceToCache(sourceDir, cacheDir, strapi) {
  let copied = 0;
  let skipped = 0;
  let failed = 0;

  let entries;
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (err) {
    strapi.log.error(`[aia-photo-sync] Cannot read source dir "${sourceDir}": ${err.message}`);
    return { copied, skipped, failed };
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;

    const srcPath = path.join(sourceDir, entry.name);
    const dstPath = path.join(cacheDir, entry.name);
    const tmpPath = dstPath + '.tmp';

    try {
      const srcStat = await fs.stat(srcPath);

      let needsCopy = true;
      try {
        const dstStat = await fs.stat(dstPath);
        // Skip if cache file is same age or newer
        if (dstStat.mtimeMs >= srcStat.mtimeMs) {
          needsCopy = false;
        }
      } catch {
        // dst does not exist — needs copy
      }

      if (!needsCopy) {
        skipped++;
        continue;
      }

      // Atomic copy: write to .tmp then rename
      await fs.copyFile(srcPath, tmpPath);
      await fs.rename(tmpPath, dstPath);
      copied++;
    } catch (err) {
      failed++;
      strapi.log.warn(`[aia-photo-sync] Copy failed for ${entry.name}: ${err.message}`);
      // Clean up tmp if left behind
      await fs.unlink(tmpPath).catch(() => {});
    }
  }

  return { copied, skipped, failed };
}

/**
 * Reads a directory and builds a map: empCode -> fileName (most recent file wins).
 *
 * Filename format: <photoId>_<date>_<time>_<empCode>.<ext>
 * e.g. 11788_27_09_2021_16_19_09_00008918.png
 * The emp_code is the LAST underscore-separated segment before the extension.
 */
async function buildEmpCodeToFileMap(imagesDir, strapi) {
  const map = new Map(); // empCode -> { fileName, mtime }

  let entries;
  try {
    entries = await fs.readdir(imagesDir, { withFileTypes: true });
  } catch (err) {
    strapi.log.error(`[aia-photo-sync] Cannot read "${imagesDir}": ${err.message}`);
    return map;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;

    // Filename format: <photoId>_<date>_<time>_<empCode>.<ext>
    // e.g. 11788_27_09_2021_16_19_09_00008918.png
    // The emp_code is the LAST underscore-separated segment before the extension.
    const nameWithoutExt = entry.name.slice(0, entry.name.length - ext.length);
    const lastUnderscoreIdx = nameWithoutExt.lastIndexOf('_');
    if (lastUnderscoreIdx === -1) continue;

    const empCode = nameWithoutExt.slice(lastUnderscoreIdx + 1).trim();
    if (!empCode) continue;

    try {
      const stat = await fs.stat(path.join(imagesDir, entry.name));
      const existing = map.get(empCode);
      if (!existing || stat.mtimeMs > existing.mtime) {
        map.set(empCode, { fileName: entry.name, mtime: stat.mtimeMs });
      }
    } catch {
      if (!map.has(empCode)) {
        map.set(empCode, { fileName: entry.name, mtime: 0 });
      }
    }
  }

  return map;
}

/**
 * Syncs AIA employee photos via a two-stage pipeline:
 *  Stage 1 — copy new/changed files from source mount to cache directory.
 *  Stage 2 — update DB emp_photo_file from cache directory filenames.
 *
 * Source: AIA_EMP_IMAGES_DIR (mounted NFS share, read-only)
 * Cache:  AIA_EMP_IMAGES_CACHE_DIR (persistent server volume, managed by this app)
 * Serve:  /empimages/:filename reads from cache dir
 */
async function syncAiaEmployeePhotos(strapi) {
  if (isRunning) {
    const elapsed = Date.now() - (isRunningStartedAt || 0);
    if (elapsed < MAX_RUN_MS) {
      strapi.log.warn('[aia-photo-sync] previous run still active, skipping');
      return;
    }
    strapi.log.warn('[aia-photo-sync] previous run timed out, forcing reset');
  }

  isRunning = true;
  isRunningStartedAt = Date.now();

  const sourceDir = String(process.env.AIA_EMP_IMAGES_DIR || '/mnt/empimages').trim();
  const cacheDir = String(process.env.AIA_EMP_IMAGES_CACHE_DIR || '').trim();
  const useCache = Boolean(cacheDir);

  // The directory we actually read filenames from for DB updates
  const serveDir = useCache ? cacheDir : sourceDir;

  strapi.log.info(`[aia-photo-sync] Starting — source="${sourceDir}" cache="${cacheDir || 'disabled'}"`);
  console.log(`\n[aia-photo-sync] ▶ Starting photo sync...`);
  console.log(`[aia-photo-sync]   source : ${sourceDir}`);
  console.log(`[aia-photo-sync]   cache  : ${cacheDir || '(disabled — serving direct from source)'}`);

  await logDirectoryStatus(sourceDir, 'SOURCE', strapi);

  if (useCache) {
    await logDirectoryStatus(cacheDir, 'CACHE', strapi);
  }

  let updatedCount = 0;
  let skippedUnchanged = 0;
  let skippedNoImage = 0;
  let errorCount = 0;

  try {
    strapi.log.info('[sync-summary] company=AIA sync=photos status=started');

    // ── Stage 1: copy source → cache ────────────────────────────────────────
    if (useCache) {
      await ensureDir(cacheDir);
      const { copied, skipped: copySkipped, failed: copyFailed } = await syncSourceToCache(sourceDir, cacheDir, strapi);
      strapi.log.info(`[aia-photo-sync] Cache sync done — copied=${copied}, unchanged=${copySkipped}, failed=${copyFailed}`);
      console.log(`[aia-photo-sync] ✔ Cache sync — copied=${copied}, unchanged=${copySkipped}, failed=${copyFailed}`);
    }

    // ── Stage 2: build map from serveDir and update DB ──────────────────────
    const empCodeMap = await buildEmpCodeToFileMap(serveDir, strapi);
    strapi.log.info(`[aia-photo-sync] ${empCodeMap.size} unique employee images found in "${serveDir}"`);
    console.log(`[aia-photo-sync] ✔ ${empCodeMap.size} unique employee images found`);

    if (empCodeMap.size === 0) {
      strapi.log.warn('[aia-photo-sync] No images found, aborting');
      console.log('[aia-photo-sync] ⚠ No images found — check AIA_EMP_IMAGES_DIR and that the folder is mounted');
      return;
    }

    const batchSize = 200;
    let offset = 0;
    let totalProcessed = 0;

    while (true) {
      const users = await strapi.db.query(USER_UID).findMany({
        where: { company: 'AIA' },
        select: ['id', 'emp_code', 'emp_photo_file'],
        limit: batchSize,
        offset,
        orderBy: { id: 'asc' },
      });

      if (!Array.isArray(users) || users.length === 0) break;
      totalProcessed += users.length;

      for (const user of users) {
        try {
          const empCode = String(user.emp_code || '').trim();
          if (!empCode || empCode === '-') { skippedNoImage++; continue; }

          // emp_code in DB matches the last segment of the filename directly (e.g. "00008918")
          const imageEntry = empCodeMap.get(empCode);
          if (!imageEntry) { skippedNoImage++; continue; }

          // Only update if the filename has changed (new photo dropped in folder)
          if (user.emp_photo_file === imageEntry.fileName) {
            skippedUnchanged++;
            continue;
          }

          await strapi.db.query(USER_UID).update({
            where: { id: user.id },
            data: { emp_photo_file: imageEntry.fileName },
          });

          updatedCount++;
          strapi.log.info(`[aia-photo-sync] emp_code=${empCode} -> ${imageEntry.fileName}`);
        } catch (err) {
          errorCount++;
          strapi.log.error(`[aia-photo-sync] Failed for emp_code=${user.emp_code}: ${err?.message}`);
        }
      }

      if (users.length < batchSize) break;
      offset += users.length;
    }

    strapi.log.info(
      `[aia-photo-sync] DONE — total=${totalProcessed}, updated=${updatedCount}, unchanged=${skippedUnchanged}, noImage=${skippedNoImage}, errors=${errorCount}`
    );
    console.log(`[aia-photo-sync] ✅ DONE — total=${totalProcessed}, updated=${updatedCount}, unchanged=${skippedUnchanged}, noImage=${skippedNoImage}, errors=${errorCount}\n`);
    strapi.log.info(
      `[sync-summary] company=AIA sync=photos status=completed dbUpdated=${updatedCount} unchanged=${skippedUnchanged} errors=${errorCount} total=${totalProcessed}`
    );
  } catch (err) {
    strapi.log.error(`[aia-photo-sync] run failed: ${err?.message}`);
    strapi.log.error(`[sync-summary] company=AIA sync=photos status=failed error="${err?.message || err}"`);
  } finally {
    isRunning = false;
  }
}

module.exports = { syncAiaEmployeePhotos };
