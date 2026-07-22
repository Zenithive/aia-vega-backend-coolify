// @ts-nocheck
import React, { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Typography, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import { useForm } from '@strapi/admin/strapi-admin';

/**
 * WorkflowPrerequisitePickerInput
 *
 * Custom field rendered inside each Workflow Module component row.
 * Shows all OTHER workflow modules in the same form as selectable prerequisites.
 *
 * Value stored: JSON array with a single 0-based module index, e.g. [1]
 * Field name in schema: "prerequisite_modules" (customField: "global::workflow-prerequisite-picker")
 */

// Parses the current module's position from the field name prop.
// Strapi v5 may pass dot-notation like "modules.2.prerequisite_modules"
// or bracket-notation like "modules[2].prerequisite_modules".
function parseCurrentIndex(name) {
  if (!name) return -1;
  const dotMatch = name.match(/(?:workflow|modules)\.(\d+)\./);
  if (dotMatch) return parseInt(dotMatch[1], 10);
  const bracketMatch = name.match(/(?:workflow|modules)\[(\d+)\]/);
  if (bracketMatch) return parseInt(bracketMatch[1], 10);
  return -1;
}

function getWorkflowItems(values) {
  if (Array.isArray(values?.modules)) return values.modules;
  if (Array.isArray(values?.workflow)) return values.workflow;
  return [];
}

function parseSelectedIndexes(value) {
  if (!value && value !== 0) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.map(Number).filter((n) => Number.isFinite(n))
      : [];
  } catch {
    return [];
  }
}

function getSingleSelectedIndex(value, workflowItemsLength, currentIndex) {
  const parsed = parseSelectedIndexes(value);
  for (const idx of parsed) {
    if (idx >= 0 && idx < workflowItemsLength && idx !== currentIndex) return idx;
  }
  return null;
}

function getTakenPrerequisiteIndexes(workflowItems, currentIndex) {
  const taken = new Set();

  for (let i = 0; i < workflowItems.length; i++) {
    if (i === currentIndex) continue;
    const module = workflowItems[i] || {};
    const picks = parseSelectedIndexes(module?.prerequisite_modules);
    for (const pick of picks) {
      if (Number.isFinite(pick)) taken.add(pick);
    }
  }

  return taken;
}

function getModuleLabel(item, idx) {
  const type = item?.module_type || 'Unknown';
  return `Module ${idx + 1} — ${type}`;
}

const WorkflowPrerequisitePickerInput = React.forwardRef((props, ref) => {
  const { name, onChange, value, label, intlLabel, description, disabled, error } = props;

  const { formatMessage } = useIntl();

  // Read the full form values to access modules[]/workflow[] array
  const values = useForm('useContentManagerContext', (s) => s?.values, false);

  // Determine which module slot we are inside (e.g. index 2 of modules[])
  const currentIndex = useMemo(() => parseCurrentIndex(name), [name]);

  // All workflow items from the form
  const workflowItems = useMemo(
    () => getWorkflowItems(values),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values?.modules, values?.workflow]
  );

  const selectedIndex = useMemo(
    () => getSingleSelectedIndex(value, workflowItems.length, currentIndex),
    [value, workflowItems.length, currentIndex]
  );

  // Hide modules already selected as prerequisites in other module rows.
  // Keep current selection available so user can see/edit existing value.
  const options = useMemo(() => {
    const takenByOthers = getTakenPrerequisiteIndexes(workflowItems, currentIndex);

    return workflowItems
      .map((item, idx) => ({ item, idx }))
      .filter(({ idx }) => idx !== currentIndex)
      .filter(({ idx }) => !takenByOthers.has(idx) || idx === selectedIndex);
  }, [workflowItems, currentIndex, selectedIndex]);

  const handleChange = (selected) => {
    const n = Number(selected);
    const arr = Number.isFinite(n) ? [n] : [];
    onChange({ target: { name, type: 'json', value: arr } });
  };

  const handleClear = () => {
    onChange({ target: { name, type: 'json', value: [] } });
  };

  const labelText = (() => {
    if (label) {
      if (typeof label === 'string') return label;
      if (label.id) return formatMessage(label);
      if (label.defaultMessage) return label.defaultMessage;
    }
    if (!intlLabel) return 'Prerequisite Modules';
    if (typeof intlLabel === 'string') return intlLabel;
    if (intlLabel.id) return formatMessage(intlLabel);
    return intlLabel.defaultMessage ?? 'Prerequisite Modules';
  })();

  return (
    <Flex ref={ref} direction="column" alignItems="stretch" gap={2}>
      <Typography variant="pi" textColor="neutral800" fontWeight="bold" tag="label" htmlFor={name}>
        {labelText}
      </Typography>

      {options.length === 0 ? (
        <Typography variant="pi" textColor="neutral600">
          {workflowItems.length <= 1
            ? 'Add more workflow modules to set prerequisites.'
            : 'No other modules available as prerequisites.'}
        </Typography>
      ) : (
        <Box position="relative" width="100%">
          <Box paddingRight={selectedIndex != null ? 24 : 0}>
            <SingleSelect
              id={name}
              value={selectedIndex != null ? String(selectedIndex) : undefined}
              onChange={handleChange}
              placeholder="Select prerequisite module..."
              disabled={disabled}
            >
              {options.map(({ item, idx }) => (
                <SingleSelectOption key={idx} value={String(idx)}>
                  {getModuleLabel(item, idx)}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Box>
          {selectedIndex != null && !disabled ? (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear prerequisite module"
              title="Clear prerequisite module"
              style={{
                position: 'absolute',
                top: '50%',
                right: '42px',
                transform: 'translateY(-50%)',
                zIndex: 2,
                width: '18px',
                height: '18px',
                border: 'none',
                background: 'transparent',
                color: '#666687',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
              }}
            >
              x
            </button>
          ) : null}
        </Box>
      )}

      {error && (
        <Typography variant="pi" textColor="danger600">
          {error}
        </Typography>
      )}

      {description && !error && (
        <Typography variant="pi" textColor="neutral600">
          {typeof description === 'string' ? description : (description.defaultMessage ?? '')}
        </Typography>
      )}
    </Flex>
  );
});

WorkflowPrerequisitePickerInput.displayName = 'WorkflowPrerequisitePickerInput';

export default WorkflowPrerequisitePickerInput;
