// @ts-nocheck
/**
 * Step 1 — Details: only what an admin decides when starting a course, on one compact card.
 * Version numbers are managed by "Create new version", visibility by Publish / Unpublish,
 * and the pass mark next to the quizzes it applies to.
 */
import React from 'react';
import {
  Grid,
  TextInput,
  MultiSelect,
  MultiSelectOption,
  SingleSelect,
  SingleSelectOption,
  Typography,
  Flex,
  Box,
  Badge,
  Button,
} from '@strapi/design-system';
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

export default function BasicsStep({ form, update, options, readOnly, issues, onLanguagesChange }) {
  const limits = options?.limits || {};
  const activeOn = (options?.activeValues || [])[0] || 'published';
  const hidden = form.active && form.active !== activeOn;
  const versionMissing = !String(form.course_version || '').trim();

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
              hint="Change via “Create new version”."
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
    </>
  );
}
