// @ts-nocheck
/**
 * Renders the same CKEditor custom field the Course schema uses (plugin::ckeditor5.CKEditor),
 * so content is authored with the identical editor/preset as in the Content Manager.
 * The CKEditor input reads its value via useField(), so it is hosted in a tiny Strapi <Form>.
 * Falls back to a plain textarea if the custom field cannot be loaded.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Loader, Textarea } from '@strapi/design-system';
import { Form, useStrapiApp } from '@strapi/strapi/admin';
import { FormField } from './ui.jsx';

const CKEDITOR_UID = 'plugin::ckeditor5.CKEditor';
const FIELD = 'content';
let cachedInput = null;

function ValueSync({ value, onChange }) {
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      onChange(value);
    }
  }, [value, onChange]);
  return null;
}

export default function RichTextEditor({ label, value, onChange, hint, error, required, disabled, preset = 'defaultHtml' }) {
  const getCustomField = useStrapiApp('CourseManagementRichText', (state) => state.customFields?.get);
  const [Input, setInput] = useState(() => cachedInput);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (Input) return;
    const customField = typeof getCustomField === 'function' ? getCustomField(CKEDITOR_UID) : null;
    if (!customField?.components?.Input) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    customField.components
      .Input()
      .then((mod) => {
        cachedInput = mod.default || mod;
        if (!cancelled) setInput(() => cachedInput);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [Input, getCustomField]);

  if (failed) {
    return (
      <FormField name={label} label={label} hint={hint} error={error} required={required}>
        <Textarea value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      </FormField>
    );
  }

  if (!Input) {
    return (
      <Box padding={4}>
        <Loader small>Loading editor…</Loader>
      </Box>
    );
  }

  return (
    <Form method="PUT" initialValues={{ [FIELD]: value || '' }} disabled={disabled}>
      {({ values }) => (
        <>
          <ValueSync value={values[FIELD]} onChange={onChange} />
          <Input
            name={FIELD}
            label={label}
            hint={hint}
            error={error}
            required={required}
            disabled={disabled}
            type="customField"
            attribute={{
              type: 'richtext',
              customField: CKEDITOR_UID,
              options: { preset },
            }}
          />
        </>
      )}
    </Form>
  );
}
