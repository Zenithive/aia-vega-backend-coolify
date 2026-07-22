'use strict';

function pickTokenFromPayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') return payload.trim() || null;

  const candidates = [
    payload.token,
    payload.accessToken,
    payload.access_token,
    payload.jwt,
    // handles { "data": "<token string>" } — the AIA HRMS response shape
    typeof payload?.data === 'string' ? payload.data : undefined,
    payload?.data?.token,
    payload?.data?.accessToken,
    payload?.result?.token,
    payload?.result?.accessToken,
    payload?.value,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function getEmployeeApiToken(strapi) {
  const baseUrl = String(process.env.EMPLOYEE_API_BASE_URL || '').trim();
  const tokenPath = String(process.env.EMPLOYEE_API_TOKEN_PATH || '').trim();
  const username = String(process.env.EMPLOYEE_API_TOKEN_USERNAME || '').trim();
  const password = String(process.env.EMPLOYEE_API_TOKEN_PASSWORD || '').trim();

  if (!baseUrl || !tokenPath || !username || !password) {
    throw new Error(
      'Missing token env config. Required: EMPLOYEE_API_BASE_URL, EMPLOYEE_API_TOKEN_PATH, EMPLOYEE_API_TOKEN_USERNAME, EMPLOYEE_API_TOKEN_PASSWORD'
    );
  }

  const tokenUrl = new URL(tokenPath, baseUrl);
  tokenUrl.searchParams.set('UserName', username);
  tokenUrl.searchParams.set('Password', password);

  const response = await fetch(tokenUrl.toString(), {
    method: 'GET',
    headers: {
      accept: '*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`Token API failed: HTTP ${response.status}`);
  }

  const responseText = await response.text();
  if (!responseText || !responseText.trim()) {
    throw new Error('Token API returned empty response');
  }

  let parsed = responseText.trim();
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Keep plain-text token response as-is.
  }

  const token = pickTokenFromPayload(parsed);
  if (!token) {
    throw new Error('Token API response did not contain a usable token');
  }

  return token;
}

module.exports = {
  getEmployeeApiToken,
};
