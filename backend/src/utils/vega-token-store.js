//@ts-nocheck
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function getTokenCachePath() {
  // Store inside the backend's data folder, next to the project root
  return process.env.VEGA_AUTH_TOKEN_CACHE_PATH || path.join(process.cwd(), 'data', 'vega-auth-token.json');
}

async function readStoredToken() {
  const tokenPath = getTokenCachePath();
  try {
    const raw = await fs.readFile(tokenPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeStoredToken(tokenResponse) {
  const tokenPath = getTokenCachePath();
  const payload = {
    refreshToken: tokenResponse.refresh_token || null,
    accessToken: tokenResponse.access_token || null,
    scope: tokenResponse.scope || null,
    expiresIn: tokenResponse.expires_in || null,
    tokenType: tokenResponse.token_type || null,
    obtainedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

module.exports = { getTokenCachePath, readStoredToken, writeStoredToken };
