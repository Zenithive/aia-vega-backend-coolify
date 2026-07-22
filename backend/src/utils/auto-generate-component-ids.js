'use strict';

/**
 * Components that have an "id" field we should auto-generate when missing.
 * Keys are component UID (as in schema: "quiz.quiz", "course.module", etc.).
 * Value: { idKey, prefix } — idKey = attribute name, prefix = short string for generated id.
 * We do NOT include components where the id is a reference (e.g. quiz.answer.question_id).
 */
const COMPONENT_ID_CONFIG = {
  'course.module': { idKey: 'module_id', prefix: 'mod' },
  'quiz.quiz': { idKey: 'quiz_id', prefix: 'quiz' },
  'quiz.question': { idKey: 'question_id', prefix: 'q' },
  'feedback-form.question': { idKey: 'question_id', prefix: 'fb' },
  'routes.bus-route': { idKey: 'route_id', prefix: 'route' },
  'routes.bus-stop': { idKey: 'stop_id', prefix: 'stop' },
};

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getComponentModel(strapi, componentUid) {
  return strapi.getModel(componentUid) || strapi.getModel(`component::${componentUid}`);
}

function ensureComponentIds(strapi, data, componentUid, options = {}) {
  const config = COMPONENT_ID_CONFIG[componentUid];
  if (!config) return;
  const { idKey, prefix } = config;
  const forceRegenerate = !!options.forceRegenerate;
  const val = data[idKey];
  if (forceRegenerate || val === undefined || val === null || String(val).trim() === '') {
    data[idKey] = generateId(prefix);
  }
}

function walkComponentData(strapi, data, componentUid, options = {}) {
  if (!data || typeof data !== 'object') return;
  const model = getComponentModel(strapi, componentUid);
  ensureComponentIds(strapi, data, componentUid, options);

  if (!model?.attributes) return;
  const attrs = model.attributes;
  for (const [key, attr] of Object.entries(attrs)) {
    if (!attr) continue;
    const value = data[key];
    if (value === undefined) continue;
    if (attr.type === 'component') {
      const subUid = attr.component;
      if (!subUid) continue;
      if (attr.repeatable && Array.isArray(value)) {
        value.forEach((item) => walkComponentData(strapi, item, subUid, options));
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        walkComponentData(strapi, value, subUid, options);
      }
    }
  }
}

function walkContentTypeData(strapi, data, contentTypeUid, options = {}) {
  if (!data || typeof data !== 'object') return;
  const model = strapi.getModel(contentTypeUid);
  if (!model?.attributes) return;
  const attrs = model.attributes;
  for (const [key, attr] of Object.entries(attrs)) {
    if (!attr) continue;
    const value = data[key];
    if (value === undefined) continue;
    if (attr.type === 'component') {
      const componentUid = attr.component;
      if (!componentUid) continue;
      if (attr.repeatable && Array.isArray(value)) {
        value.forEach((item) => walkComponentData(strapi, item, componentUid, options));
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        walkComponentData(strapi, value, componentUid, options);
      }
    }
  }
}

/**
 * Mutate params.data in place: for any component that has an id field in COMPONENT_ID_CONFIG,
 * set that id to a generated value when it's missing or empty.
 * @param {object} strapi - Strapi instance
 * @param {string} uid - Content-type UID (e.g. 'api::course.course')
 * @param {object} data - Document payload (params.data)
 * @param {object} [options]
 * @param {boolean} [options.forceRegenerate=false] - regenerate configured component IDs even when existing values are present
 */
function autoGenerateComponentIds(strapi, uid, data, options = {}) {
  if (!data || typeof data !== 'object') return;
  try {
    walkContentTypeData(strapi, data, uid, options);
  } catch (err) {
    strapi.log.warn('autoGenerateComponentIds failed', err);
  }
}

module.exports = {
  autoGenerateComponentIds,
  COMPONENT_ID_CONFIG,
};
