//@ts-nocheck
'use strict';

const crypto = require('node:crypto');
const { readStoredToken, writeStoredToken, getTokenCachePath } = require('./vega-token-store');

const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/%s/oauth2/v2.0/token';
const AUTHORIZE_ENDPOINT = 'https://login.microsoftonline.com/%s/oauth2/v2.0/authorize';
const GRAPH_SCOPE_PREFIX = 'https://graph.microsoft.com/';
const OIDC_SCOPES = new Set(['offline_access', 'openid', 'profile', 'email']);

// In-memory map of pending OAuth states (state → expiry timestamp)
const pendingStates = new Map();

function getEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`[vega-auth] Missing required env var: ${name}`);
  return value;
}

function authLog(message) {
  if (global.strapi?.log?.info) global.strapi.log.info(message);
  else console.log(message);
}

function normalizeScopes(raw) {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith('https://') || s.startsWith('api://')) return s;
      if (OIDC_SCOPES.has(s)) return s;
      return `${GRAPH_SCOPE_PREFIX}${s}`;
    })
    .join(' ');
}

function getDelegatedScopes() {
  const raw = process.env.VEGA_GRAPH_DELEGATED_SCOPES || 'offline_access Files.Read.All';
  const normalized = normalizeScopes(raw);
  return normalized.includes('openid') ? normalized : `openid profile ${normalized}`;
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

function createAuthUrl() {
  const tenantId = getEnv('VEGA_AZURE_TENANT_ID');
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, Date.now() + 10 * 60 * 1000); // 10 min expiry

  const params = new URLSearchParams({
    client_id: getEnv('VEGA_AZURE_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: getEnv('VEGA_AZURE_REDIRECT_URI'),
    response_mode: 'query',
    scope: getDelegatedScopes(),
    state,
  });

  const authorizeUrl = AUTHORIZE_ENDPOINT.replace('%s', encodeURIComponent(tenantId));
  return { state, url: `${authorizeUrl}?${params.toString()}` };
}

function consumeState(state) {
  const expiresAt = pendingStates.get(state);
  pendingStates.delete(state);
  if (!expiresAt) throw new Error('OAuth state missing or unknown. Start sign-in again from /vega-auth/start.');
  if (Date.now() > expiresAt) throw new Error('OAuth state expired. Start sign-in again from /vega-auth/start.');
}

async function exchangeAuthorizationCode(code) {
  const tenantId = getEnv('VEGA_AZURE_TENANT_ID');
  const endpoint = TOKEN_ENDPOINT.replace('%s', encodeURIComponent(tenantId));

  const body = new URLSearchParams({
    client_id: getEnv('VEGA_AZURE_CLIENT_ID'),
    client_secret: getEnv('VEGA_AZURE_CLIENT_SECRET'),
    grant_type: 'authorization_code',
    code,
    redirect_uri: getEnv('VEGA_AZURE_REDIRECT_URI'),
    scope: getDelegatedScopes(),
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const raw = await response.text();
  let tokenResponse;
  try { tokenResponse = JSON.parse(raw); } catch { throw new Error(`Token endpoint returned non-JSON: ${raw}`); }

  if (!response.ok) {
    throw new Error(`Auth code exchange failed (${response.status}): ${tokenResponse.error_description || tokenResponse.error}`);
  }
  if (!tokenResponse.refresh_token) {
    throw new Error('Auth code exchange succeeded but no refresh_token returned.');
  }

  return writeStoredToken(tokenResponse);
}

async function getAuthStatus() {
  const stored = await readStoredToken();
  return {
    hasStoredRefreshToken: Boolean(stored?.refreshToken),
    tokenCachePath: getTokenCachePath(),
    obtainedAt: stored?.obtainedAt || null,
    scope: stored?.scope || null,
  };
}

// ── Access token (used by sync) ───────────────────────────────────────────────

async function getAccessToken() {
  const tenantId = getEnv('VEGA_AZURE_TENANT_ID');
  const clientId = getEnv('VEGA_AZURE_CLIENT_ID');
  const clientSecret = getEnv('VEGA_AZURE_CLIENT_SECRET');
  const redirectUri = String(process.env.VEGA_AZURE_REDIRECT_URI || '').trim() || null;
  const refreshScope = 'https://graph.microsoft.com/Files.Read.All offline_access';

  // Prefer token stored on disk (from OAuth flow), fall back to env var
  const stored = await readStoredToken();
  const refreshTokenSource = stored?.refreshToken
    ? 'disk'
    : (String(process.env.VEGA_AZURE_REFRESH_TOKEN || '').trim() ? 'env' : 'none');
  const refreshToken = stored?.refreshToken || String(process.env.VEGA_AZURE_REFRESH_TOKEN || '').trim();
  const tokenCachePath = getTokenCachePath();
  const endpoint = TOKEN_ENDPOINT.replace('%s', encodeURIComponent(tenantId));

  authLog('[vega-auth] ===== ACCESS TOKEN GENERATION START =====');
  authLog(`[vega-auth] tenantId=${tenantId}`);
  authLog(`[vega-auth] client_id=${clientId}`);
  authLog(`[vega-auth] client_secret=${clientSecret}`);
  authLog(`[vega-auth] grant_type=refresh_token`);
  authLog(`[vega-auth] scope=${refreshScope}`);
  authLog(`[vega-auth] token_endpoint=${endpoint}`);
  authLog(`[vega-auth] redirect_uri=${redirectUri} (NOT sent on refresh; used only for OAuth code exchange)`);
  authLog(`[vega-auth] tokenCachePath=${tokenCachePath}`);
  authLog(`[vega-auth] refreshTokenSource=${refreshTokenSource}`);
  authLog(`[vega-auth] stored.obtainedAt=${stored?.obtainedAt || null}`);
  authLog(`[vega-auth] stored.scope=${stored?.scope || null}`);
  authLog(`[vega-auth] stored.hasAccessToken=${Boolean(stored?.accessToken)}`);
  authLog(`[vega-auth] refresh_token=${refreshToken || '(empty)'}`);

  if (!refreshToken) {
    authLog('[vega-auth] ===== ACCESS TOKEN GENERATION FAILED (missing refresh_token) =====');
    throw new Error('[vega-auth] No refresh token available. Visit /api/vega-auth/start to authenticate.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: refreshScope,
  });
  // Do NOT include redirect_uri in refresh_token grants — Azure validates it
  // against registered URIs and will reject if it doesn't match exactly.

  authLog(`[vega-auth] request_body_keys=${[...body.keys()].join(',')}`);
  authLog(`[vega-auth] calling Azure token endpoint...`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const result = await response.json();

  authLog(`[vega-auth] azure_http_status=${response.status}`);
  authLog(`[vega-auth] azure_ok=${response.ok}`);
  authLog(`[vega-auth] azure_error=${result.error || null}`);
  authLog(`[vega-auth] azure_error_description=${result.error_description || null}`);
  authLog(`[vega-auth] azure_token_type=${result.token_type || null}`);
  authLog(`[vega-auth] azure_expires_in=${result.expires_in || null}`);
  authLog(`[vega-auth] azure_ext_expires_in=${result.ext_expires_in || null}`);
  authLog(`[vega-auth] azure_scope=${result.scope || null}`);
  authLog(`[vega-auth] azure_got_access_token=${Boolean(result.access_token)}`);
  authLog(`[vega-auth] azure_got_refresh_token=${Boolean(result.refresh_token)}`);

  if (!response.ok || !result.access_token) {
    authLog(
      `[vega-auth] ===== ACCESS TOKEN GENERATION FAILED failingToken=refresh_token status=${response.status} =====`
    );
    throw new Error(
      `[vega-auth] Token refresh failed (${response.status}): ${result.error_description || result.error || 'unknown'}. ` +
      `Visit /api/vega-auth/start to re-authenticate.`
    );
  }

  authLog(`[vega-auth] access_token=${result.access_token}`);
  if (result.refresh_token) {
    authLog(`[vega-auth] rotated_refresh_token=${result.refresh_token}`);
  }

  // If a new refresh token was returned, persist it so it auto-rotates
  if (result.refresh_token) {
    await writeStoredToken(result).catch((err) => {
      authLog(`[vega-auth] failed to write rotated token file: ${err?.message || err}`);
    });
    authLog(`[vega-auth] rotated refresh token written to ${tokenCachePath}`);
  } else {
    authLog('[vega-auth] no rotated refresh token in response; file not updated');
  }

  authLog('[vega-auth] ===== ACCESS TOKEN GENERATION SUCCESS =====');
  return result.access_token;
}

module.exports = { createAuthUrl, consumeState, exchangeAuthorizationCode, getAuthStatus, getAccessToken };
