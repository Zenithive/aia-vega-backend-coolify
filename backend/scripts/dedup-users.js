/**
 * dedup-users.js
 *
 * Finds and removes duplicate users for AIA (by emp_code) and Vega (by emp_id),
 * then handles same-email duplicates across both companies.
 *
 * Strategy: within each group of duplicates, keep the "best" record:
 *   1. Prefer the one with a real (non-fake) email
 *   2. Among ties, prefer the one with the lowest id (oldest record)
 *
 * The losers are deleted. All related rows in child tables that reference
 * up_users.id via a FK are reassigned to the winner before deletion.
 *
 * Run: node scripts/dedup-users.js [--dry-run]
 *
 * --dry-run  prints what would be deleted without touching the DB.
 */

'use strict';

require('dotenv').config();
const { Client } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');

// ── DB ────────────────────────────────────────────────────────────────────────

function makeClient() {
  return new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

function isFakeEmail(email) {
  if (!email) return false; // null/empty is NOT fake — it means no email from API (legitimate)
  const e = String(email).toLowerCase();
  return e.endsWith('@aia.internal') || e.endsWith('@vega.internal');
}

/**
 * Given an array of user rows, pick the one to keep.
 * Priority:
 *   1. No email (null) — means the API has no email for this person, this is the canonical record
 *   2. Real (non-fake) email
 *   3. Fake email (last resort)
 * Among ties in the same tier, prefer lowest id (oldest record).
 */
function pickWinner(rows) {
  // Tier 1: null/empty email (real record with no API email)
  const noEmail = rows.filter((r) => !r.email || String(r.email).trim() === '');
  if (noEmail.length) return noEmail.reduce((best, r) => (r.id < best.id ? r : best));

  // Tier 2: real email (not fake)
  const withReal = rows.filter((r) => !isFakeEmail(r.email));
  if (withReal.length) return withReal.reduce((best, r) => (r.id < best.id ? r : best));

  // Tier 3: all fake — keep oldest
  return rows.reduce((best, r) => (r.id < best.id ? r : best));
}

// ── child-table reassignment ──────────────────────────────────────────────────

/**
 * Find all FK columns in the DB that reference up_users(id),
 * then for each loser id reassign rows to the winner before deletion.
 */
async function reassignChildRows(client, winnerId, loserIds) {
  if (!loserIds.length) return;

  // Discover FK references to up_users
  const fkRes = await client.query(`
    SELECT
      kcu.table_name,
      kcu.column_name
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = rc.constraint_name
      AND kcu.table_schema = rc.constraint_schema
    JOIN information_schema.key_column_usage rcu
      ON rcu.constraint_name = rc.unique_constraint_name
      AND rcu.table_schema = rc.unique_constraint_schema
    WHERE rcu.table_name = 'up_users'
      AND rcu.column_name = 'id'
      AND kcu.table_schema = 'public'
  `);

  for (const { table_name, column_name } of fkRes.rows) {
    for (const loserId of loserIds) {
      // For link tables with unique constraints (e.g. up_users_role_lnk),
      // reassigning would create a duplicate if the winner already has a row.
      // Instead, delete the loser's row — the winner's row already covers it.
      const isLinkTable = table_name.endsWith('_lnk');
      if (isLinkTable) {
        const sql = `DELETE FROM "${table_name}" WHERE "${column_name}" = $1`;
        if (DRY_RUN) {
          console.log(`  [dry-run] would delete from ${table_name}.${column_name} where ${column_name}=${loserId}`);
        } else {
          const res = await client.query(sql, [loserId]);
          if (res.rowCount > 0) {
            console.log(`  deleted ${res.rowCount} row(s) from ${table_name}.${column_name} (loser id=${loserId})`);
          }
        }
      } else {
        const sql = `UPDATE "${table_name}" SET "${column_name}" = $1 WHERE "${column_name}" = $2`;
        if (DRY_RUN) {
          console.log(`  [dry-run] would reassign ${table_name}.${column_name}: ${loserId} → ${winnerId}`);
        } else {
          const res = await client.query(sql, [winnerId, loserId]);
          if (res.rowCount > 0) {
            console.log(`  reassigned ${res.rowCount} row(s) in ${table_name}.${column_name}: ${loserId} → ${winnerId}`);
          }
        }
      }
    }
  }
}

// ── dedup logic ───────────────────────────────────────────────────────────────

async function dedupByField(client, field, company) {
  // Find all values of `field` that appear more than once for this company
  const dupRes = await client.query(`
    SELECT "${field}", array_agg(id ORDER BY id) AS ids, count(*) AS cnt
    FROM up_users
    WHERE company = $1
      AND "${field}" IS NOT NULL
      AND "${field}" != ''
      AND "${field}" != '-'
    GROUP BY "${field}"
    HAVING count(*) > 1
  `, [company]);

  if (!dupRes.rows.length) {
    console.log(`[dedup][${company}] no duplicates found by ${field}`);
    return 0;
  }

  console.log(`[dedup][${company}] found ${dupRes.rows.length} duplicate group(s) by ${field}`);
  let deletedTotal = 0;

  for (const { [field]: fieldValue, ids } of dupRes.rows) {
    // Fetch full rows for this group
    const rowsRes = await client.query(
      `SELECT id, email, username FROM up_users WHERE id = ANY($1)`,
      [ids]
    );
    const rows = rowsRes.rows;
    const winner = pickWinner(rows);
    const losers = rows.filter((r) => r.id !== winner.id);
    const loserIds = losers.map((r) => r.id);

    console.log(`\n  ${field}=${fieldValue}`);
    console.log(`    KEEP   id=${winner.id} email=${winner.email || 'null'} username=${winner.username}`);
    for (const l of losers) {
      console.log(`    DELETE id=${l.id} email=${l.email || 'null'} username=${l.username}`);
    }

    await reassignChildRows(client, winner.id, loserIds);

    if (!DRY_RUN) {
      await client.query(`DELETE FROM up_users WHERE id = ANY($1)`, [loserIds]);
      deletedTotal += loserIds.length;
    } else {
      deletedTotal += loserIds.length;
    }
  }

  return deletedTotal;
}

async function dedupByEmail(client) {
  // Same non-null, non-fake email across any company
  const dupRes = await client.query(`
    SELECT lower(email) AS norm_email, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
    FROM up_users
    WHERE email IS NOT NULL
      AND email != ''
      AND lower(email) NOT LIKE '%@aia.internal'
      AND lower(email) NOT LIKE '%@vega.internal'
    GROUP BY lower(email)
    HAVING count(*) > 1
  `);

  if (!dupRes.rows.length) {
    console.log(`[dedup][email] no duplicates found by email`);
    return 0;
  }

  console.log(`[dedup][email] found ${dupRes.rows.length} duplicate group(s) by email`);
  let deletedTotal = 0;

  for (const { norm_email, ids } of dupRes.rows) {
    const rowsRes = await client.query(
      `SELECT id, email, username, company FROM up_users WHERE id = ANY($1)`,
      [ids]
    );
    const rows = rowsRes.rows;
    const winner = pickWinner(rows);
    const losers = rows.filter((r) => r.id !== winner.id);
    const loserIds = losers.map((r) => r.id);

    console.log(`\n  email=${norm_email}`);
    console.log(`    KEEP   id=${winner.id} company=${winner.company} username=${winner.username}`);
    for (const l of losers) {
      console.log(`    DELETE id=${l.id} company=${l.company} username=${l.username}`);
    }

    await reassignChildRows(client, winner.id, loserIds);

    if (!DRY_RUN) {
      await client.query(`DELETE FROM up_users WHERE id = ANY($1)`, [loserIds]);
      deletedTotal += loserIds.length;
    } else {
      deletedTotal += loserIds.length;
    }
  }

  return deletedTotal;
}

/**
 * For Vega users that have a fake @vega.internal email but a valid emp_id,
 * clear the fake email (set to null) so they are no longer polluting the list.
 * These are real employees whose email was never provided in the Excel.
 */
async function clearFakeEmailsOnRealVegaUsers(client) {
  const res = await client.query(`
    SELECT id, email, username
    FROM up_users
    WHERE company = 'Vega'
      AND lower(email) LIKE '%@vega.internal'
      AND emp_id IS NOT NULL
      AND trim(emp_id) != ''
      AND trim(emp_id) != '-'
    ORDER BY id
  `);

  if (!res.rows.length) {
    console.log('[dedup][vega-fake-email] no real Vega users with fake emails found');
    return 0;
  }

  console.log(`[dedup][vega-fake-email] found ${res.rows.length} real Vega user(s) with fake emails — clearing email`);
  for (const u of res.rows) {
    console.log(`  CLEAR email id=${u.id} emp_id set, email=${u.email} username=${u.username}`);
  }

  if (!DRY_RUN) {
    const ids = res.rows.map((u) => u.id);
    await client.query(`UPDATE up_users SET email = NULL WHERE id = ANY($1)`, [ids]);
  }

  return res.rows.length;
}



/**
 * Delete users that have a fake email AND no valid emp_code (AIA) or emp_id (Vega).
 * These are orphaned records that were never matched to a real employee.
 *
 * AIA ghost: company='AIA', fake email, emp_code IS NULL or '' or '-'
 * Vega ghost: company='Vega', fake email, emp_id IS NULL or '' or '-'
 */
async function deleteGhostUsers(client) {
  // AIA ghosts
  const aiaRes = await client.query(`
    SELECT id, email, username
    FROM up_users
    WHERE company = 'AIA'
      AND (lower(email) LIKE '%@aia.internal' OR lower(email) LIKE '%@vega.internal')
      AND (emp_code IS NULL OR trim(emp_code) = '' OR trim(emp_code) = '-')
    ORDER BY id
  `);

  // Vega ghosts
  const vegaRes = await client.query(`
    SELECT id, email, username
    FROM up_users
    WHERE company = 'Vega'
      AND (lower(email) LIKE '%@aia.internal' OR lower(email) LIKE '%@vega.internal')
      AND (emp_id IS NULL OR trim(emp_id) = '' OR trim(emp_id) = '-')
    ORDER BY id
  `);

  const aiaGhosts = aiaRes.rows;
  const vegaGhosts = vegaRes.rows;
  const allGhosts = [...aiaGhosts, ...vegaGhosts];

  if (!allGhosts.length) {
    console.log('[dedup][ghosts] no ghost users found');
    return 0;
  }

  console.log(`[dedup][ghosts] found ${aiaGhosts.length} AIA ghost(s) + ${vegaGhosts.length} Vega ghost(s) = ${allGhosts.length} total`);
  for (const u of allGhosts) {
    console.log(`  DELETE ghost id=${u.id} email=${u.email} username=${u.username}`);
  }

  if (!DRY_RUN) {
    const ids = allGhosts.map((u) => u.id);
    // Ghost users have no real data worth reassigning — just delete child rows too
    // Discover FK child tables and delete orphaned child rows first
    const fkRes = await client.query(`
      SELECT kcu.table_name, kcu.column_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = rc.constraint_name
        AND kcu.table_schema = rc.constraint_schema
      JOIN information_schema.key_column_usage rcu
        ON rcu.constraint_name = rc.unique_constraint_name
        AND rcu.table_schema = rc.unique_constraint_schema
      WHERE rcu.table_name = 'up_users'
        AND rcu.column_name = 'id'
        AND kcu.table_schema = 'public'
    `);

    for (const { table_name, column_name } of fkRes.rows) {
      const res = await client.query(
        `DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1)`,
        [ids]
      );
      if (res.rowCount > 0) {
        console.log(`  deleted ${res.rowCount} child row(s) from ${table_name}.${column_name}`);
      }
    }

    await client.query(`DELETE FROM up_users WHERE id = ANY($1)`, [ids]);
  }

  return allGhosts.length;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log('=== DRY RUN — no changes will be made ===\n');

  const client = makeClient();
  await client.connect();

  try {
    let total = 0;

    console.log('\n── Ghost users (fake email + no emp_code/emp_id) ─────────────');
    total += await deleteGhostUsers(client);

    console.log('\n── Clear fake emails on real Vega users (have emp_id) ────────');
    total += await clearFakeEmailsOnRealVegaUsers(client);

    console.log('\n── AIA duplicates (by emp_code) ──────────────────────────────');
    total += await dedupByField(client, 'emp_code', 'AIA');

    console.log('\n── Vega duplicates (by emp_id) ───────────────────────────────');
    total += await dedupByField(client, 'emp_id', 'Vega');

    console.log('\n── Real-email duplicates (all companies) ─────────────────────');
    total += await dedupByEmail(client);

    console.log(`\n=== DONE — ${DRY_RUN ? 'would delete' : 'deleted'} ${total} duplicate user(s) ===`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[dedup-users] fatal:', err.message || err);
  process.exit(1);
});
