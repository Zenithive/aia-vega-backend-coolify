import React from 'react';
import { useIntl } from 'react-intl';
import { Flex, Typography, Switch } from '@strapi/design-system';
import styled from 'styled-components';

/**
 * Wrapper to override Switch colors to Strapi default blue (checked) / gray (unchecked)
 * instead of the design system default green/red.
 */
const SwitchWrapper = styled.div`
  --yesno-off-bg: ${({ theme }) => theme.colors.neutral400};
  --yesno-off-label: ${({ theme }) => theme.colors.neutral700};
  --yesno-on-bg: ${({ theme }) => theme.colors.primary500};
  --yesno-on-label: ${({ theme }) => theme.colors.primary600};
  & button[data-state='unchecked'] {
    background-color: var(--yesno-off-bg) !important;
  }
  & button[data-state='checked'] {
    background-color: var(--yesno-on-bg) !important;
  }
  & [data-state='unchecked']:not(button) {
    color: var(--yesno-off-label) !important;
  }
  & [data-state='checked']:not(button) {
    color: var(--yesno-on-label) !important;
  }
`;

/**
 * Custom field: Yes/No toggle (boolean).
 * Renders as a switch in the Content Manager. Use in any content-type via the Custom tab when adding a field.
 */
const YesNoToggleInput = React.forwardRef((props, ref) => {
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

  const formatLabel = (msg) => {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    if (msg.id != null) return formatMessage(msg);
    return msg.defaultMessage ?? '';
  };

  // Show only the field name when nested (e.g. "Feedback Question.0.Compulsory" → "Compulsory")
  const displayName =
    name && name.includes('.') ? name.split('.').pop() : name;
  const labelText =
    formatLabel(label) ||
    formatLabel(intlLabel) ||
    (displayName
      ? displayName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : 'Yes / No');

  const checked = value === true;

  const handleChange = (checked) => {
    onChange({
      target: { name, type: attribute?.type ?? 'boolean', value: checked },
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
            {' '}*
          </Typography>
        )}
      </Typography>
      <SwitchWrapper>
        <Flex alignItems="center" gap={2}>
          <Switch
            ref={ref}
            id={name}
            name={name}
            checked={checked}
            disabled={disabled}
            onCheckedChange={handleChange}
            visibleLabels
            onLabel="Yes"
            offLabel="No"
            aria-required={required}
            aria-invalid={error ? true : undefined}
          />
        </Flex>
      </SwitchWrapper>
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

YesNoToggleInput.displayName = 'YesNoToggleInput';

export default YesNoToggleInput;
