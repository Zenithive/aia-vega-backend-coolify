// @ts-nocheck
/**
 * The IconHub icon picker (custom field `plugin::strapi-plugin-iconhub.iconhub`), loaded from
 * the admin's custom field registry exactly like the Content Manager does, so icons picked here
 * are stored in the same shape. Renders nothing if the IconHub plugin is not installed.
 */
import React, { useEffect, useState } from 'react';
import { useStrapiApp } from '@strapi/strapi/admin';
import { Typography } from '@strapi/design-system';

const ICONHUB_UID = 'plugin::strapi-plugin-iconhub.iconhub';
const ATTRIBUTE = {
  type: 'json',
  customField: ICONHUB_UID,
  options: { storeIconData: true, storeIconName: true },
};

let cachedInput = null;

export default function IconField({ name, label = 'Icon', value, onChange, disabled }) {
  const getCustomField = useStrapiApp('IconField', (state) => state.customFields.get);
  const [Input, setInput] = useState(() => cachedInput);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (Input) return;
    const field = getCustomField?.(ICONHUB_UID);
    if (!field?.components?.Input) {
      setMissing(true);
      return;
    }
    let cancelled = false;
    field.components
      .Input()
      .then((mod) => {
        cachedInput = mod.default;
        if (!cancelled) setInput(() => mod.default);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [Input, getCustomField]);

  if (missing) return null;
  if (!Input) {
    return (
      <Typography variant="pi" textColor="neutral600">
        Loading icon picker…
      </Typography>
    );
  }
  return (
    <Input
      name={name}
      label={label}
      attribute={ATTRIBUTE}
      type={ICONHUB_UID}
      value={value ?? null}
      disabled={disabled}
      required={false}
      onChange={(e) => onChange(e?.target?.value ?? null)}
    />
  );
}
