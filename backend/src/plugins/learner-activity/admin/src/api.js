// @ts-nocheck
import { getFetchClient } from '@strapi/strapi/admin';
import { PLUGIN_ID, REATTEMPT_UID } from './pluginId';

export function errorMessage(err) {
  return err?.response?.data?.error?.message || err?.message || 'Something went wrong';
}

async function call(method, url, body) {
  const client = getFetchClient();
  try {
    const res = method === 'get' || method === 'del' ? await client[method](url) : await client[method](url, body);
    return res.data;
  } catch (err) {
    throw new Error(errorMessage(err));
  }
}

const base = `/${PLUGIN_ID}`;

/** Plugin endpoints; each resolves with the `data` of the response body. */
export const api = {
  get: (path) => call('get', `${base}${path}`).then((body) => body?.data),
  post: (path, payload) => call('post', `${base}${path}`, payload).then((body) => body?.data),
  put: (path, payload) => call('put', `${base}${path}`, payload).then((body) => body?.data),
  del: (path) => call('del', `${base}${path}`).then((body) => body?.data),

  /** Saved through the Content Manager so the request lifecycle records who approved it. */
  setReattemptStatus: (documentId, status) =>
    call('put', `/content-manager/collection-types/${REATTEMPT_UID}/${encodeURIComponent(documentId)}`, {
      request_status: status,
    }),
};
