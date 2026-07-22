import React from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';

/**
 * Date picker that only allows selecting today or future dates.
 * Used for News "Publish date" to prevent past dates.
 * Label uses Strapi Design System Typography (same as Field.Label: variant pi, neutral800, bold).
 */
const DateFutureOnlyInput = React.forwardRef((props, ref) => {
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

  // formatMessage requires { id, defaultMessage }; Content Manager may pass plain strings
  const formatLabel = (msg) => {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    if (msg.id != null) return formatMessage(msg);
    return msg.defaultMessage ?? '';
  };

  // Fallback when Content Manager doesn't pass a label (e.g. custom field in edit view)
  const labelText =
    formatLabel(label) ||
    formatLabel(intlLabel) ||
    (name ? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Date');

  // Min date: today in local date string (YYYY-MM-DD)
  const today = new Date();
  const minDate = today.toISOString().slice(0, 10);

  // Value: content-manager may pass ISO string or null
  const displayValue = value && typeof value === 'string' ? value.slice(0, 10) : value ?? '';

  const handleChange = (e) => {
    const next = e.target.value || undefined;
    onChange({
      target: { name, type: attribute?.type ?? 'date', value: next || null },
    });
  };

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
        {required && (
          <Typography tag="span" aria-hidden lineHeight="1em" textColor="danger600">
            *
          </Typography>
        )}
      </Typography>
      <Box>
        <input
          ref={ref}
          id={name}
          type="date"
          name={name}
          value={displayValue}
          min={minDate}
          disabled={disabled}
          required={required}
          onChange={handleChange}
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

DateFutureOnlyInput.displayName = 'DateFutureOnlyInput';

export default DateFutureOnlyInput;
