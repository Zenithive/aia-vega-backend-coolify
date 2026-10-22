// @ts-nocheck
/**
 * Step 1 — Details: only what an admin decides when starting a course, on one compact card.
 * Version numbers are managed by "Create new version", visibility by Publish / Unpublish,
 * and the pass mark next to the quizzes it applies to.
 */
import React, { useState } from 'react';
import {
  Grid,
  TextInput,
  MultiSelect,
  MultiSelectOption,
  SingleSelect,
  SingleSelectOption,
  Combobox,
  ComboboxOption,
  Typography,
  Flex,
  Box,
  Badge,
  Button,
  Dialog,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { getFetchClient } from '@strapi/strapi/admin';
import { Section, FormField, Callout } from '../../components/ui.jsx';
import MediaPicker from '../../components/MediaPicker.jsx';
import { nearLimit } from '../../utils/course';

const CATEGORY_HINTS = {
  Mandatory: 'Required training',
  Orientation: 'For new joiners',
  Other: 'Any other learning',
};

function issueFor(issues, target) {
  return issues.find((i) => i.target === target && i.severity === 'error')?.message;
}

export default function BasicsStep({ form, update, options, readOnly, issues, onLanguagesChange, onOptionsRefresh }) {
  const limits = options?.limits || {};
  const activeOn = (options?.activeValues || [])[0] || 'published';
  const hidden = form.active && form.active !== activeOn;
  const versionMissing = !String(form.course_version || '').trim();

  const [showCreateLabelDialog, setShowCreateLabelDialog] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [createLabelError, setCreateLabelError] = useState('');

  const handleCreateNewLabel = async () => {
    const trimmedName = newLabelName.trim();
    
    if (!trimmedName) {
      setCreateLabelError('Label name is required');
      return;
    }

    // Check if label already exists (handle null/undefined names)
    const exists = (options?.courseGroupLabels || []).some(
      (label) => label.name && label.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      setCreateLabelError('A label with this name already exists');
      return;
    }

    setCreatingLabel(true);
    setCreateLabelError('');

    try {
      const { post } = getFetchClient();
      
      // Step 1: Create the label (as draft)
      const createResponse = await post('/content-manager/collection-types/api::course-group-label.course-group-label', {
        name: trimmedName,
      });

      // Extract documentId from response
      let documentId = createResponse.data?.documentId;
      if (!documentId && createResponse.data?.data) {
        documentId = createResponse.data.data.documentId;
      }
      
      if (!documentId) {
        throw new Error('Failed to get documentId from created label');
      }

      // Step 2: Publish the label using the document service action API
      try {
        await post(`/content-manager/collection-types/api::course-group-label.course-group-label/${documentId}/actions/publish`);
      } catch (publishError) {
        console.warn('Failed to publish label, but it was created:', publishError);
        // Continue anyway - the label exists, even if not published
      }

      const newLabel = {
        documentId: documentId,
        name: trimmedName,
      };

      // Refresh options to get updated list
      if (onOptionsRefresh) {
        await onOptionsRefresh();
      }

      // Auto-select the newly created label
      update({ course_group_label: newLabel });

      // Close dialog and reset
      setShowCreateLabelDialog(false);
      setNewLabelName('');
      setCreateLabelError('');
    } catch (error) {
      console.error('Error creating group label:', error);
      setCreateLabelError('Failed to create label. Please try again.');
    } finally {
      setCreatingLabel(false);
    }
  };

  const handleOpenCreateDialog = () => {
    setShowCreateLabelDialog(true);
    setNewLabelName('');
    setCreateLabelError('');
  };

  const handleCloseCreateDialog = () => {
    if (creatingLabel) return;
    setShowCreateLabelDialog(false);
    setNewLabelName('');
    setCreateLabelError('');
  };

  return (
    <>
      {hidden && (
        <Callout
          variant="warning"
          title="This course is hidden from learners"
          action={
            !readOnly && (
              <Button variant="secondary" onClick={() => update({ active: activeOn })}>
                Show to learners
              </Button>
            )
          }
        >
          It was hidden earlier. Learners will not see it, even when it is published.
        </Callout>
      )}

      <Section title="Course details">
        <Grid.Root gap={5}>
          <Grid.Item col={8} s={12} direction="column" alignItems="stretch">
            <FormField
              name="title"
              label="Course title"
              required
              error={issueFor(issues, 'title')}
              hint={nearLimit(form.title, limits.title)}
            >
              <TextInput
                placeholder="e.g. Workplace Safety Essentials"
                value={form.title || ''}
                maxLength={limits.title || undefined}
                disabled={readOnly}
                onChange={(e) => update({ title: e.target.value })}
              />
            </FormField>
          </Grid.Item>
          <Grid.Item col={4} s={12} direction="column" alignItems="stretch">
            <FormField name="course_category" label="Type of course" required error={issueFor(issues, 'course_category')}>
              <SingleSelect
                placeholder="Choose a type"
                value={form.course_category || ''}
                disabled={readOnly}
                onChange={(v) => update({ course_category: v })}
              >
                {(options?.categories || []).map((c) => (
                  <SingleSelectOption key={c} value={c}>
                    {CATEGORY_HINTS[c] ? `${c} — ${CATEGORY_HINTS[c]}` : c}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </FormField>
          </Grid.Item>

          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            <FormField
              name="course_language"
              label="Languages"
              required
              error={issueFor(issues, 'course_language')}
            >
              <MultiSelect
                withTags
                placeholder="Choose languages"
                disabled={readOnly}
                value={form.course_language || []}
                onChange={(values) => onLanguagesChange(values)}
              >
                {(options?.languages || []).map((l) => (
                  <MultiSelectOption key={l} value={l}>
                    {l}
                  </MultiSelectOption>
                ))}
              </MultiSelect>
            </FormField>
          </Grid.Item>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            <FormField name="company" label="Companies">
              <MultiSelect
                withTags
                placeholder="Choose companies"
                disabled={readOnly}
                value={(form.company || []).map((c) => c.documentId)}
                onChange={(ids) =>
                  update({
                    company: ids.map((id) => (options?.companies || []).find((c) => c.documentId === id)).filter(Boolean),
                  })
                }
              >
                {(options?.companies || []).map((c) => (
                  <MultiSelectOption key={c.documentId} value={c.documentId}>
                    {c.name}
                  </MultiSelectOption>
                ))}
              </MultiSelect>
            </FormField>
          </Grid.Item>

          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            <FormField
              name="course_group_label"
              label="Course Group Label"
              required
              error={issueFor(issues, 'course_group_label')}
              hint="Categorize courses by group"
            >
              <Flex gap={2} alignItems="flex-end">
                <Box style={{ flex: 1 }}>
                  <Combobox
                    placeholder="Search or select a group label"
                    value={form.course_group_label?.documentId || null}
                    disabled={readOnly}
                    onChange={(value) => {
                      const selected = (options?.courseGroupLabels || []).find((label) => label.documentId === value);
                      update({ course_group_label: selected || null });
                    }}
                    onClear={() => update({ course_group_label: null })}
                  >
                    {(options?.courseGroupLabels || [])
                      .filter((label) => label.name) // Filter out null/undefined names
                      .map((label) => (
                        <ComboboxOption key={label.documentId} value={label.documentId}>
                          {label.name}
                        </ComboboxOption>
                      ))}
                  </Combobox>
                </Box>
                {!readOnly && (
                  <Button
                    variant="secondary"
                    startIcon={<Plus />}
                    onClick={handleOpenCreateDialog}
                  >
                    Create New
                  </Button>
                )}
              </Flex>
            </FormField>
          </Grid.Item>

          <Grid.Item col={8} s={12} direction="column" alignItems="stretch">
            <FormField name="thumbnail" label="Course picture">
              <MediaPicker
                value={form.thumbnail}
                allowedTypes={['images']}
                disabled={readOnly}
                emptyLabel="No picture yet"
                onChange={(file) => update({ thumbnail: file })}
              />
            </FormField>
          </Grid.Item>
          <Grid.Item col={4} s={12} direction="column" alignItems="stretch">
            <FormField
              name="course_version"
              label="Version"
              error={issueFor(issues, 'course_version')}
              hint='Change via "Create new version".'
            >
              {versionMissing && !readOnly ? (
                <TextInput
                  placeholder="e.g. 1.0"
                  value={form.course_version || ''}
                  onChange={(e) => update({ course_version: e.target.value })}
                />
              ) : (
                <Flex paddingTop={2}>
                  <Badge>{form.course_version}</Badge>
                </Flex>
              )}
            </FormField>
          </Grid.Item>
        </Grid.Root>
      </Section>

      {/* Create New Group Label Dialog */}
      <Dialog.Root open={showCreateLabelDialog} onOpenChange={(open) => !open && handleCloseCreateDialog()}>
        <Dialog.Content>
          <Dialog.Header>Create New Course Group Label</Dialog.Header>
          <Dialog.Body>
            <Box marginBottom={4}>
              <Typography variant="omega" textColor="neutral600" marginBottom={2}>
                Enter a name for the new group label. This will be used to categorize courses.
              </Typography>
            </Box>
            <FormField
              name="newLabelName"
              label="Label Name"
              required
              error={createLabelError}
            >
              <TextInput
                placeholder="e.g. Safety Training"
                value={newLabelName}
                disabled={creatingLabel}
                onChange={(e) => {
                  setNewLabelName(e.target.value);
                  setCreateLabelError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !creatingLabel) {
                    e.preventDefault();
                    handleCreateNewLabel();
                  }
                }}
              />
            </FormField>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button fullWidth variant="tertiary" onClick={handleCloseCreateDialog} disabled={creatingLabel}>
                Cancel
              </Button>
            </Dialog.Cancel>
            <Button
              fullWidth
              variant="primary"
              loading={creatingLabel}
              onClick={handleCreateNewLabel}
            >
              Create Label
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
