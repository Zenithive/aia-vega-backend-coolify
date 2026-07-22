// @ts-nocheck
'use strict';

const { errors } = require('@strapi/utils');
const { ValidationError } = errors;

/**
 * Enforce file-type restrictions based on form_type:
 *   PDF   → only application/pdf
 *   Excel → only .xls / .xlsx
 *   Word  → only .doc / .docx
 */

const ALLOWED_MIMES = {
  PDF: [
    'application/pdf',
  ],
  Excel: [
    'application/vnd.ms-excel',                                          // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  ],
  Word: [
    'application/msword',                                                          // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',    // .docx
  ],
};

const FIELD_FOR_TYPE = {
  PDF: 'form_pdf',
  Excel: 'form_excel',
  Word: 'form_word',
};

const LABEL_FOR_TYPE = {
  PDF: 'PDF (.pdf)',
  Excel: 'Excel (.xls, .xlsx)',
  Word: 'Word (.doc, .docx)',
};

/**
 * Extract a numeric file ID from whatever shape Strapi stores the media relation in.
 */
function extractFileId(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (typeof value === 'object') {
    if (value.id != null) return Number(value.id);
    // Strapi v5 relation shapes: { set: [...] } or { connect: [...] }
    const list = value.set ?? value.connect;
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0];
      if (typeof first === 'number') return first;
      if (first?.id != null) return Number(first.id);
    }
  }
  return null;
}

async function validateFileType(fileId, allowedMimes, formType) {
  if (fileId == null) return; // no file uploaded — skip (required-field check is Strapi's job)

  const file = await strapi.db
    .query('plugin::upload.file')
    .findOne({ where: { id: fileId }, select: ['name', 'mime', 'ext'] });

  if (!file) return; // file not found — let Strapi's reference check handle it

  if (!allowedMimes.includes(file.mime)) {
    throw new ValidationError(
      `Wrong file uploaded for a "${formType}" form template. ` +
      `Only ${LABEL_FOR_TYPE[formType]} files are allowed, but you uploaded "${file.name}". ` +
      `Please upload the correct file type.`
    );
  }
}

async function runValidation(data) {
  const formType = data?.form_type;
  if (!formType || !FIELD_FOR_TYPE[formType]) return; // URL type — no file needed

  const fieldName = FIELD_FOR_TYPE[formType];
  const fileId = extractFileId(data[fieldName]);
  await validateFileType(fileId, ALLOWED_MIMES[formType], formType);
}

module.exports = {
  async beforeCreate(event) {
    await runValidation(event.params.data);
  },

  async beforeUpdate(event) {
    const data = event.params.data;
    // Only validate if a new file is being set in this update
    const formType = data?.form_type;
    if (!formType || !FIELD_FOR_TYPE[formType]) return;
    const fieldName = FIELD_FOR_TYPE[formType];
    if (data[fieldName] == null) return; // field not touched in this update
    await runValidation(data);
  },
};
