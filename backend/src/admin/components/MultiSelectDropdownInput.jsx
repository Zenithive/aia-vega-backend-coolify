import React, { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Typography, MultiSelect, MultiSelectOption } from '@strapi/design-system';

/**
 * Multi-select dropdown custom field.
 * - Options are configured in Content-Type Builder (one per line, or label:value).
 * - Required can be set in Base settings.
 * - Value is stored as JSON array of selected values (e.g. ["Option A", "Option B"]).
 * - Renders as a dropdown-style multi-select (click to open, select multiple options).
 *
 * Schema example:
 * "my_field": {
 *   "type": "customField",
 *   "customField": "global::multi-select-dropdown",
 *   "required": true,
 *   "pluginOptions": {
 *     "customField": {
 *       "optionsList": "Option A\nOption B\nOption C",
 *       "required": true
 *     }
 *   }
 * }
 */
function parseOptionsList(str) {
  if (!str || typeof str !== 'string') return [];
  return str
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon > 0) {
        return { value: line.slice(0, colon).trim(), label: line.slice(colon + 1).trim() };
      }
      return { value: line, label: line };
    });
}

const MultiSelectDropdownInput = React.forwardRef((props, ref) => {
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

  const builderOpts = attribute?.options || {};
  const pluginOpts = attribute?.pluginOptions?.customField || {};
  const opts = { ...pluginOpts, ...builderOpts };
  const isRequired = required === true || opts.required === true;
  const placeholderText = opts.placeholder != null ? String(opts.placeholder) : 'Select...';
  const optionsListStr = opts.optionsList != null ? String(opts.optionsList) : '';
  const options = useMemo(() => parseOptionsList(optionsListStr), [optionsListStr]);

  const formatLabel = (msg) => {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    if (msg.id != null) return formatMessage(msg);
    return msg.defaultMessage ?? '';
  };

  const displayName = name && name.includes('.') ? name.split('.').pop() : name;
  const labelText =
    formatLabel(label) ||
    formatLabel(intlLabel) ||
    (displayName ? displayName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Multi-select');

  const selectedValues = useMemo(() => {
    if (Array.isArray(value)) return value;
    if (value != null && value !== '') {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }, [value]);

  const handleChange = (next) => {
    const arr = Array.isArray(next) ? next : [];
    onChange({
      target: {
        name,
        type: 'multi-select',
        value: arr,
      },
    });
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={2} ref={ref}>
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
            {' '}*
          </Typography>
        )}
      </Typography>
      {options.length === 0 ? (
        <Typography variant="pi" textColor="neutral600">
          No options defined. Add options in Content-Type Builder (Base settings → Dropdown options).
        </Typography>
      ) : (
        <Box style={{ width: '50%', minWidth: 200 }}>
          <MultiSelect
            id={name}
            name={name}
            value={selectedValues}
            onChange={handleChange}
            placeholder={placeholderText}
            disabled={disabled}
            hasError={!!error}
            required={isRequired}
            withTags
            aria-label={labelText}
          >
            {options.map((opt) => (
              <MultiSelectOption key={opt.value} value={opt.value}>
                {opt.label}
              </MultiSelectOption>
            ))}
          </MultiSelect>
        </Box>
      )}
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

MultiSelectDropdownInput.displayName = 'MultiSelectDropdownInput';

export default MultiSelectDropdownInput;
