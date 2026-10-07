// @ts-nocheck
/**
 * Small presentational building blocks shared by the list and editor pages.
 */
import React from 'react';
import { Box, Flex, Typography, Field, Status, Button, Dialog } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { STATUS_META } from '../utils/course';

export function FormField({ name, label, hint, error, required, children, labelAction }) {
  return (
    <Field.Root name={name} id={name} hint={hint} error={error} required={required}>
      <Field.Label action={labelAction}>{label}</Field.Label>
      {children}
      <Field.Hint />
      <Field.Error />
    </Field.Root>
  );
}

/** White card with a heading, used to break each step into digestible sections. */
export function Section({ title, subtitle, actions, children, padding = 6, ...boxProps }) {
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" padding={padding} marginBottom={5} {...boxProps}>
      {(title || actions) && (
        <Flex justifyContent="space-between" alignItems="flex-start" gap={4} marginBottom={5}>
          <Flex direction="column" alignItems="flex-start" gap={1}>
            {title && (
              <Typography variant="delta" tag="h2">
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="pi" textColor="neutral600">
                {subtitle}
              </Typography>
            )}
          </Flex>
          {actions && <Flex gap={2}>{actions}</Flex>}
        </Flex>
      )}
      {children}
    </Box>
  );
}

export function StatusBadge({ status, size = 'S' }) {
  const meta = STATUS_META[status] || STATUS_META.draft;
  return (
    <Status variant={meta.variant} size={size}>
      <Typography fontWeight="bold" variant="omega" textColor={`${meta.variant}700`}>
        {meta.label}
      </Typography>
    </Status>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', variant = 'danger-light', loading, onConfirm, onClose }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose?.()}>
      <Dialog.Content>
        <Dialog.Header>{title}</Dialog.Header>
        <Dialog.Body icon={<WarningCircle fill="danger600" />}>
          <Box textAlign="center">
            <Typography tag="div" variant="epsilon" textColor="neutral800">
              {children}
            </Typography>
          </Box>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Cancel>
            <Button fullWidth variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
          </Dialog.Cancel>
          <Button fullWidth variant={variant} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Large selectable cards — friendlier than a dropdown for small enumerations.
 * `compact` renders one-line pills instead, with the selected item's description underneath.
 * @param {{ value: string, label: string, description?: string, icon?: React.ReactNode }[]} items
 */
export function ChoiceCards({ items, value, onChange, disabled, multiple = false, minWidth = 160, compact = false }) {
  const isSelected = (v) => (multiple ? (value || []).includes(v) : value === v);
  const toggle = (v) => {
    if (disabled) return;
    if (!multiple) return onChange(v);
    const current = value || [];
    onChange(current.includes(v) ? current.filter((x) => x !== v) : [...current, v]);
  };
  if (compact) {
    const selectedItem = !multiple && items.find((i) => i.value === value);
    return (
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <Flex gap={2} wrap="wrap" role={multiple ? 'group' : 'radiogroup'}>
          {items.map((item) => {
            const selected = isSelected(item.value);
            return (
              <Box
                key={item.value}
                tag="button"
                type="button"
                role={multiple ? 'checkbox' : 'radio'}
                aria-checked={selected}
                title={item.description}
                onClick={() => toggle(item.value)}
                disabled={disabled}
                paddingTop={2}
                paddingBottom={2}
                paddingLeft={3}
                paddingRight={4}
                hasRadius
                background={selected ? 'primary100' : 'neutral0'}
                borderColor={selected ? 'primary600' : 'neutral200'}
                borderStyle="solid"
                borderWidth="1px"
                style={{
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled && !selected ? 0.6 : 1,
                }}
              >
                <Flex gap={2} alignItems="center">
                  {item.icon && (
                    <Flex color={selected ? 'primary600' : 'neutral600'} style={{ width: 16, height: 16 }}>
                      {item.icon}
                    </Flex>
                  )}
                  <Typography fontWeight="bold" textColor={selected ? 'primary700' : 'neutral800'}>
                    {item.label}
                  </Typography>
                </Flex>
              </Box>
            );
          })}
        </Flex>
        {selectedItem?.description && (
          <Typography variant="pi" textColor="neutral600">
            {selectedItem.description}
          </Typography>
        )}
      </Flex>
    );
  }
  return (
    <Flex gap={3} wrap="wrap" role={multiple ? 'group' : 'radiogroup'}>
      {items.map((item) => {
        const selected = isSelected(item.value);
        return (
          <Box
            key={item.value}
            tag="button"
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={selected}
            onClick={() => toggle(item.value)}
            disabled={disabled}
            padding={4}
            hasRadius
            background={selected ? 'primary100' : 'neutral0'}
            borderColor={selected ? 'primary600' : 'neutral200'}
            borderStyle="solid"
            borderWidth="1px"
            style={{
              flex: `1 1 ${minWidth}px`,
              maxWidth: 320,
              textAlign: 'left',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled && !selected ? 0.6 : 1,
            }}
          >
            <Flex gap={3} alignItems="flex-start">
              {item.icon && <Box color={selected ? 'primary600' : 'neutral600'}>{item.icon}</Box>}
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography fontWeight="bold" textColor={selected ? 'primary700' : 'neutral800'}>
                  {item.label}
                </Typography>
                {item.description && (
                  <Typography variant="pi" textColor="neutral600">
                    {item.description}
                  </Typography>
                )}
              </Flex>
            </Flex>
          </Box>
        );
      })}
    </Flex>
  );
}

/** Light inline callout (info / warning / danger) that does not get dismissed like an Alert. */
export function Callout({ variant = 'primary', title, children, action }) {
  return (
    <Box
      background={`${variant}100`}
      borderColor={`${variant}200`}
      borderStyle="solid"
      borderWidth="1px"
      hasRadius
      padding={4}
      marginBottom={5}
    >
      <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
        <Flex direction="column" alignItems="flex-start" gap={1}>
          {title && (
            <Typography fontWeight="bold" textColor={`${variant}700`}>
              {title}
            </Typography>
          )}
          {children && (
            <Typography variant="omega" textColor="neutral800">
              {children}
            </Typography>
          )}
        </Flex>
        {action && <Flex gap={2}>{action}</Flex>}
      </Flex>
    </Box>
  );
}
