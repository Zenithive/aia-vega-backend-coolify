// @ts-nocheck
/**
 * Review & publish: summary, a readiness checklist grouped by step, and read-only
 * information about assignments and other versions of this course.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Flex, Typography, Button, Grid, Badge, TextButton, Table, Thead, Tbody, Tr, Th, Td } from '@strapi/design-system';
import { CheckCircle, WarningCircle, CrossCircle, Earth, Plus, ArrowRight } from '@strapi/icons';
import { Section, Callout, StatusBadge } from '../../components/ui.jsx';
import { STEPS, formatDate } from '../../utils/course';
import { TARGETS } from '../../utils/assignment';
import { BASE_PATH } from '../../pluginId';
import { useAssignmentPermissions } from '../../utils/usePermissions';

const ASSIGNMENT_PATH = `${BASE_PATH}/assignments`;

function SummaryItem({ label, value }) {
  return (
    <Flex direction="column" alignItems="flex-start" gap={1}>
      <Typography variant="sigma" textColor="neutral600">
        {label}
      </Typography>
      <Typography variant="omega" fontWeight="semiBold">
        {value ?? '—'}
      </Typography>
    </Flex>
  );
}

function IssueList({ issues, onGoTo }) {
  const byStep = STEPS.filter((s) => s.id !== 'review')
    .map((s) => ({ step: s, items: issues.filter((i) => i.step === s.id) }))
    .filter((g) => g.items.length);
  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {byStep.map(({ step, items }) => (
        <Box key={step.id}>
          <Flex justifyContent="space-between" marginBottom={2}>
            <Typography fontWeight="bold">{step.label}</Typography>
            <TextButton onClick={() => onGoTo(step.id)}>{`Go to ${step.label}`}</TextButton>
          </Flex>
          <Flex direction="column" alignItems="stretch" gap={1}>
            {items.map((issue, i) => (
              <Flex key={i} gap={2} alignItems="flex-start">
                <Box paddingTop={1}>
                  {issue.severity === 'error' ? (
                    <CrossCircle fill="danger600" width="14px" height="14px" />
                  ) : (
                    <WarningCircle fill="warning600" width="14px" height="14px" />
                  )}
                </Box>
                <Typography variant="omega" textColor={issue.severity === 'error' ? 'danger700' : 'neutral800'}>
                  {issue.message}
                </Typography>
              </Flex>
            ))}
          </Flex>
        </Box>
      ))}
    </Flex>
  );
}

export default function ReviewStep({ form, issues, meta, isNew, readOnly, canPublish, onPublish, publishing, onGoTo, documentId }) {
  const navigate = useNavigate();
  const assignmentPerms = useAssignmentPermissions();
  const languages = form.course_language || [];
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  // Per-learner entries the automation adds for department / location assignments have no course_version.
  const assignments = (form.course_assignments || []).filter((a) => a.course_version);
  const versions = meta?.versions || [];
  const quizModules = (form.moduleBlocks || []).filter((b) => Object.values(b.byLang).some((m) => m?.quiz && m.module_type !== 'Offline')).length;
  const status = meta?.status || 'draft';

  return (
    <>
      <Section title="Summary">
        <Grid.Root gap={5}>
          <Grid.Item col={4} s={6} direction="column" alignItems="stretch">
            <SummaryItem label="Title" value={form.title || '—'} />
          </Grid.Item>
          <Grid.Item col={2} s={6} direction="column" alignItems="stretch">
            <SummaryItem label="Version" value={form.course_version} />
          </Grid.Item>
          <Grid.Item col={3} s={6} direction="column" alignItems="stretch">
            <SummaryItem label="Category" value={form.course_category} />
          </Grid.Item>
          <Grid.Item col={3} s={6} direction="column" alignItems="stretch">
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography variant="sigma" textColor="neutral600">
                Status
              </Typography>
              {isNew ? <Typography>Not saved yet</Typography> : <StatusBadge status={status} />}
            </Flex>
          </Grid.Item>
          <Grid.Item col={4} s={6} direction="column" alignItems="stretch">
            <SummaryItem label="Languages" value={languages.join(', ') || '—'} />
          </Grid.Item>
          <Grid.Item col={2} s={6} direction="column" alignItems="stretch">
            <SummaryItem label="Modules" value={(form.moduleBlocks || []).length} />
          </Grid.Item>
          <Grid.Item col={3} s={6} direction="column" alignItems="stretch">
            <SummaryItem
              label="Module quizzes"
              value={
                quizModules
                  ? `${quizModules} of ${(form.moduleBlocks || []).length} module${quizModules === 1 ? '' : 's'} · pass ${form.min_passing_score ?? '—'}%`
                  : 'None'
              }
            />
          </Grid.Item>
          <Grid.Item col={3} s={6} direction="column" alignItems="stretch">
            <SummaryItem
              label="Feedback"
              value={
                (form.feedback || []).length
                  ? `${(form.feedback || []).map((f) => f.language).join(', ')} · ${
                      (form.feedback || []).some((f) => f.compulsory === true) ? 'Compulsory' : 'Optional'
                    }`
                  : 'None'
              }
            />
          </Grid.Item>
        </Grid.Root>
      </Section>

      <Section
        title="Readiness check"
        subtitle={
          errors.length
            ? `${errors.length} item${errors.length === 1 ? '' : 's'} must be fixed before publishing.`
            : 'Everything required for publishing is in place.'
        }
      >
        {errors.length === 0 && warnings.length === 0 ? (
          <Flex gap={2}>
            <CheckCircle fill="success600" />
            <Typography textColor="success700" fontWeight="bold">
              Ready to publish
            </Typography>
          </Flex>
        ) : (
          <IssueList issues={[...errors, ...warnings]} onGoTo={onGoTo} />
        )}
        {!readOnly && !isNew && canPublish && status === 'draft' && (
          <Box marginTop={6}>
            <Button size="L" startIcon={<Earth />} disabled={errors.length > 0} loading={publishing} onClick={onPublish}>
              Publish course
            </Button>
            {errors.length > 0 && (
              <Box marginTop={2}>
                <Typography variant="pi" textColor="neutral600">
                  Fix the items above to enable publishing.
                </Typography>
              </Box>
            )}
          </Box>
        )}
        {isNew && (
          <Box marginTop={5}>
            <Callout variant="primary">Save the course as a draft first, then publish it from here.</Callout>
          </Box>
        )}
      </Section>

      {!isNew && versions.length > 1 && (
        <Section title={`Versions (${versions.length})`}>
          <Table colCount={4} rowCount={versions.length + 1}>
            <Thead>
              <Tr>
                <Th><Typography variant="sigma">Version</Typography></Th>
                <Th><Typography variant="sigma">Title</Typography></Th>
                <Th><Typography variant="sigma">Status</Typography></Th>
                <Th><Typography variant="sigma">Created</Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {versions.map((v) => {
                const current = v.documentId === documentId;
                return (
                  <Tr
                    key={v.documentId}
                    onClick={() => !current && navigate(`${BASE_PATH}/${v.documentId}`)}
                    style={{ cursor: current ? 'default' : 'pointer' }}
                  >
                    <Td>
                      <Flex gap={2}>
                        <Typography fontWeight="bold">{v.course_version || '—'}</Typography>
                        {current && <Badge variant="primary">This version</Badge>}
                      </Flex>
                    </Td>
                    <Td><Typography>{v.title}</Typography></Td>
                    <Td><StatusBadge status={v.status} /></Td>
                    <Td><Typography variant="pi">{formatDate(v.createdAt)}</Typography></Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Section>
      )}
    </>
  );
}
