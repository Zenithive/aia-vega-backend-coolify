// @ts-nocheck
'use strict';

/**
 * Schema-driven helpers so the plugin never hard-codes the Course structure.
 *
 * - buildPopulate(): deep populate for a content type / component, derived from its schema.
 * - toWriteData():   converts the populated (read) shape back into a Document Service payload
 *                    (media → ids, relations → { set: [{ documentId }] }, components recursed).
 *
 * New attributes added to the Course schema or its components flow through automatically.
 */

const SYSTEM_FIELDS = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
]);

const LABEL_CANDIDATES = ['title', 'name', 'username', 'email'];
const MEDIA_FIELDS = ['name', 'url', 'mime', 'ext', 'size', 'formats', 'alternativeText'];

function getModel(strapi, uid) {
  return strapi.getModel(uid) || strapi.getModel(`component::${uid}`);
}

function isManyRelation(attr) {
  const rel = String(attr?.relation || '');
  return rel === 'manyToMany' || rel === 'oneToMany' || rel === 'morphToMany' || rel.endsWith('Many');
}

/** Field used to display a related entry (mainField first, then common label fields). */
function getLabelField(strapi, targetUid) {
  const target = getModel(strapi, targetUid);
  if (!target?.attributes) return null;
  const mainField = target.info?.mainField;
  if (mainField && target.attributes[mainField]) return mainField;
  return LABEL_CANDIDATES.find((f) => target.attributes[f]) || null;
}

/**
 * @param {object} strapi
 * @param {string} uid content-type or component uid
 * @param {object} [overrides] per-attribute populate overrides for the top level only
 */
function buildPopulate(strapi, uid, overrides = {}) {
  const model = getModel(strapi, uid);
  const populate = {};
  if (!model?.attributes) return populate;

  for (const [key, attr] of Object.entries(model.attributes)) {
    if (SYSTEM_FIELDS.has(key) || !attr) continue;
    if (overrides[key] !== undefined) {
      if (overrides[key] !== false) populate[key] = overrides[key];
      continue;
    }
    if (attr.type === 'media') {
      populate[key] = { fields: MEDIA_FIELDS };
    } else if (attr.type === 'relation') {
      if (String(attr.target || '').startsWith('admin::')) continue;
      const label = getLabelField(strapi, attr.target);
      populate[key] = label ? { fields: [label] } : true;
    } else if (attr.type === 'component') {
      const nested = buildPopulate(strapi, attr.component);
      populate[key] = Object.keys(nested).length > 0 ? { populate: nested } : true;
    } else if (attr.type === 'dynamiczone') {
      populate[key] = { populate: '*' };
    }
  }
  return populate;
}

function toMediaId(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (typeof value === 'object' && value.id != null) return Number(value.id);
  return null;
}

function toDocumentRef(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return { documentId: value };
  if (typeof value === 'object' && value.documentId) return { documentId: String(value.documentId) };
  return null;
}

/**
 * @param {object} strapi
 * @param {string} uid
 * @param {object} input read-shape data coming from the admin UI
 * @param {object} [options]
 * @param {boolean} [options.keepComponentIds] keep component row ids (update in place) — false for create/duplicate
 * @param {string[]} [options.omit] top-level attributes to leave untouched
 */
function toWriteData(strapi, uid, input, options = {}) {
  const model = getModel(strapi, uid);
  const out = {};
  if (!model?.attributes || !input || typeof input !== 'object') return out;
  const omit = new Set(options.omit || []);
  const nestedOptions = { keepComponentIds: !!options.keepComponentIds };

  for (const [key, attr] of Object.entries(model.attributes)) {
    if (SYSTEM_FIELDS.has(key) || omit.has(key) || !attr) continue;
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];

    switch (attr.type) {
      case 'media': {
        if (attr.multiple) {
          const list = Array.isArray(value) ? value : value ? [value] : [];
          out[key] = list.map(toMediaId).filter((id) => id != null);
        } else {
          out[key] = toMediaId(Array.isArray(value) ? value[0] : value);
        }
        break;
      }
      case 'relation': {
        if (String(attr.target || '').startsWith('admin::')) break;
        const list = (Array.isArray(value) ? value : value ? [value] : [])
          .map(toDocumentRef)
          .filter(Boolean);
        out[key] = { set: isManyRelation(attr) ? list : list.slice(0, 1) };
        break;
      }
      case 'component': {
        const convert = (item) => {
          if (!item || typeof item !== 'object') return null;
          const data = toWriteData(strapi, attr.component, item, nestedOptions);
          if (nestedOptions.keepComponentIds && item.id != null) data.id = item.id;
          return data;
        };
        if (attr.repeatable) {
          out[key] = (Array.isArray(value) ? value : []).map(convert).filter(Boolean);
        } else {
          out[key] = convert(value);
        }
        break;
      }
      case 'dynamiczone':
        // Not used by the course schema; leave untouched rather than risk data loss.
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

/** Schema attribute (top-level or component) for building UI option lists. */
function getAttribute(strapi, uid, key) {
  return getModel(strapi, uid)?.attributes?.[key] || null;
}

module.exports = {
  buildPopulate,
  toWriteData,
  getAttribute,
  getModel,
};
