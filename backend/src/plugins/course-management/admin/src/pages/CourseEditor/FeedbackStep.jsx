// @ts-nocheck
/**
 * Step 3 — Feedback: whether learners must send feedback, and which feedback form each
 * course language uses (a Hindi course can use a Hindi form).
 *
 * Under the hood there is one `feedback-form.feedback-form` entry per course language, each
 * pointing to a Feedback Template. Templates are created and edited in the Content Manager in
 * this same tab (one editor at a time keeps the data consistent); the course editor's
 * unsaved-changes warning asks first if the course has unsaved edits.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Flex, Grid, Toggle, SingleSelect, SingleSelectOption, Badge } from '@strapi/design-system';
import { Eye, Pencil, Plus } from '@strapi/icons';
import { Section, FormField, Callout } from '../../components/ui.jsx';
import { emptyFeedback } from '../../utils/course';

const TEMPLATE_PATH = '/content-manager/collection-types/api::feedback-template.feedback-template';

function TemplateSelect({ value, onChange, templates, readOnly, label }) {
  return (
    <SingleSelect aria-label={label} placeholder="Choose a feedback form" value={value || ''} disabled={readOnly} onChange={onChange}>
      {templates.map((t) => (
        <SingleSelectOption key={t.documentId} value={t.documentId}>
          {t.name || 'Untitled form'}
        </SingleSelectOption>
      ))}
    </SingleSelect>
  );
}

export default function FeedbackStep({ form, update, options, readOnly }) {
  const languages = form.course_language || [];
  const feedback = form.feedback || [];
  const navigate = useNavigate();
  // Loaded with the course, so a form created in the Content Manager shows up on return.
  const templates = options?.feedbackTemplates || [];
  const enabled = feedback.length > 0;

  const templateRef = (id) => {
    const t = templates.find((x) => x.documentId === id);
    return t ? { documentId: t.documentId, name: t.name } : null;
  };

  const entryFor = (l) => feedback.find((f) => f.language === l) || emptyFeedback(l);
  const setAll = (patch) => update({ feedback: languages.map((l) => ({ ...entryFor(l), ...patch })) });
  const setForLanguage = (lang, patch) =>
    update({ feedback: languages.map((l) => (l === lang ? { ...entryFor(l), ...patch } : entryFor(l))) });

  const createButton = (
    <Button variant="secondary" size="S" startIcon={<Plus />} onClick={() => navigate(`${TEMPLATE_PATH}/create`)}>
      Create new form
    </Button>
  );

  return (
    <Section title="Feedback (optional)" actions={enabled && !readOnly && templates.length > 0 ? createButton : null}>
      <Grid.Root gap={5}>
        <Grid.Item col={3} s={12} direction="column" alignItems="stretch">
          <FormField name="fb-enabled" label="Is feedback compulsory?" hint="Course completes only after feedback is sent.">
            <Toggle
              onLabel="Yes"
              offLabel="No"
              checked={enabled}
              disabled={readOnly}
              onChange={(e) => (e.target.checked ? setAll({ compulsory: true }) : update({ feedback: [] }))}
            />
          </FormField>
        </Grid.Item>

        {enabled && (
          <Grid.Item col={9} s={12} direction="column" alignItems="stretch">
            {templates.length === 0 ? (
              <Callout variant="warning" title="There are no feedback forms yet" action={!readOnly && createButton}>
                Create a form, then come back to this course to choose it.
              </Callout>
            ) : (
              <Flex direction="column" alignItems="stretch" gap={3}>
                {languages.map((l) => {
                  const selectedId = entryFor(l).feedback_template?.documentId;
                  const selected = templates.find((t) => t.documentId === selectedId);
                  return (
                    <FormField key={l} name={`fbt-${l}`} label={languages.length > 1 ? `Feedback form (${l})` : 'Feedback form'}>
                      <Flex gap={3} alignItems="center" wrap="wrap">
                        {languages.length > 1 && <Badge>{l}</Badge>}
                        <Box style={{ flex: '1 1 260px' }}>
                          <TemplateSelect
                            label={`${l} feedback form`}
                            templates={templates}
                            readOnly={readOnly}
                            value={selectedId}
                            onChange={(id) => setForLanguage(l, { feedback_template: templateRef(id) })}
                          />
                        </Box>
                        {selected && (
                          <Button
                            variant="tertiary"
                            size="S"
                            startIcon={readOnly ? <Eye /> : <Pencil />}
                            onClick={() => navigate(`${TEMPLATE_PATH}/${selected.documentId}`)}
                          >
                            {readOnly ? 'View form' : 'View / edit form'}
                          </Button>
                        )}
                      </Flex>
                    </FormField>
                  );
                })}
              </Flex>
            )}
          </Grid.Item>
        )}
      </Grid.Root>
    </Section>
  );
}
