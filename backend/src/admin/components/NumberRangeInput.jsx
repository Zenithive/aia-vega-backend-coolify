// @ts-nocheck

import React, { useState, useCallback, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';

/**
 * Number input with optional:
 * - integerOnly: only whole numbers (no decimals)
 * - positiveOnly: only values >= 0 (same as min: 0)
 * - min / max: enforce range (from attribute.pluginOptions.customField)
 *
 * Schema example:
 * "my_field": {
 *   "type": "customField",
 *   "customField": "global::number-range",
 *   "pluginOptions": {
 *     "customField": {
 *       "integerOnly": true,
 *       "positiveOnly": true,
 *       "min": 0,
 *       "max": 100
 *     }
 *   }
 * }
 */
const NumberRangeInput = React.forwardRef((props, ref) => {
  const {
    attribute,
    description,
    disabled,
    label,
    intlLabel,
    name,
    onChange,
    required,
    value,
    error,
  } = props;

  const { formatMessage } = useIntl();
  // Options come from Content-Type Builder (attribute.options) or schema (pluginOptions.customField)
  const builderOpts = attribute?.options || {};
  const pluginOpts = attribute?.pluginOptions?.customField || attribute?.pluginOptions?.numberRange || {};
  const opts = { ...pluginOpts, ...builderOpts };
  const placeholderText = opts.placeholder != null ? String(opts.placeholder) : '';
  const integerOnly = opts.integerOnly === true;
  const positiveOnly = opts.positiveOnly === true;
  // Required: from Content Manager (attribute) or from our option in Builder
  const isRequired = required === true || opts.required === true;
  // Default to positive only when no options set, so negative numbers are never allowed unless min < 0
  const defaultPositive = Object.keys(opts).length === 0;
  const min = opts.min != null && opts.min !== '' ? Number(opts.min) : (positiveOnly || defaultPositive ? 0 : null);
  const max = opts.max != null && opts.max !== '' ? Number(opts.max) : null;

  const formatLabel = (msg) => {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    if (msg.id != null) return formatMessage(msg);
    return msg.defaultMessage ?? '';
  };

  // Use only the field name for label when name is a path (e.g. "Quiz.0.Quiz Questions.0.Point" → "Point")
  const displayName = name && name.includes('.')
    ? name.split('.').pop()
    : name;
  const labelText =
    formatLabel(label) ||
    formatLabel(intlLabel) ||
    (displayName ? displayName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Number');

  const [inputStr, setInputStr] = useState(() =>
    value != null && value !== '' ? String(value) : ''
  );

  useEffect(() => {
    if (value != null && value !== '') {
      setInputStr(String(value));
    } else {
      setInputStr('');
    }
  }, [value]);

  const parseAndClamp = useCallback(
    (raw) => {
      if (raw === '' || raw === undefined) return null;
      let n = Number(raw);
      if (Number.isNaN(n)) return null;
      if (integerOnly) n = Math.round(n);
      if (min != null && n < min) n = min;
      if (max != null && n > max) n = max;
      return n;
    },
    [integerOnly, min, max]
  );

  const handleChange = (e) => {
    const raw = e.target.value;
    setInputStr(raw);
    const next = parseAndClamp(raw === '' ? null : raw);
    onChange({
      target: {
        name,
        type: 'number',
        value: next,
      },
    });
  };

  const handleKeyDown = (e) => {
    if (min != null && min >= 0 && (e.key === '-' || e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
    }
  };

  const handleBlur = () => {
    const next = parseAndClamp(inputStr === '' ? null : inputStr);
    const display = next != null ? String(next) : '';
    setInputStr(display);
    onChange({
      target: {
        name,
        type: 'number',
        value: next,
      },
    });
  };

  const inputMin = min != null ? min : undefined;
  const inputMax = max != null ? max : undefined;
  const step = integerOnly ? 1 : 'any';

  return (
    <Flex direction="column" alignItems="stretch" gap={1}>
      <Typography
        variant="pi"
        textColor="neutral800"
        fontWeight="bold"
        tag="label"
        htmlFor={name}
        ellipsis
      >
        {labelText}
        {isRequired && (
          <Typography tag="span" aria-hidden lineHeight="1em" textColor="danger600">
            *
          </Typography>
        )}
      </Typography>
      <Box>
        <input
          ref={ref}
          id={name}
          type="number"
          name={name}
          value={inputStr}
          placeholder={placeholderText}
          min={inputMin}
          max={inputMax}
          step={step}
          disabled={disabled}
          required={isRequired}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          aria-invalid={error ? true : undefined}
          style={{
            padding: '8px 12px',
            border: `1px solid ${error ? '#d02b20' : '#dcdce4'}`,
            borderRadius: 4,
            fontSize: 14,
            width: '100%',
            maxWidth: 240,
          }}
        />
      </Box>
      {description && (
        <Typography variant="pi" tag="p" textColor="neutral600">
          {formatLabel(description)}
        </Typography>
      )}
      {error && (
        <Typography variant="pi" tag="p" textColor="danger600" data-strapi-field-error>
          {formatLabel(error)}
        </Typography>
      )}
    </Flex>
  );
});

NumberRangeInput.displayName = 'NumberRangeInput';

export default NumberRangeInput;
