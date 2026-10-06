// @ts-nocheck
/**
 * Publish confirmation, in up to three steps:
 *  1. "Publish this course?" — a published course is locked for good.
 *  2. Only for a new version whose earlier version has learners (and a role that may assign):
 *     "25 learners are currently assigned to … (v1.0)" → Yes, Auto-Assign / No, Skip Assignment.
 *  3. After Yes: one due date for every auto-assigned learner.
 * onPublish(autoAssign | null) does the publishing; autoAssign = { sourceDocumentId, dueDate }.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Button, Flex, Typography, Field, DatePicker, SingleSelect, SingleSelectOption, Loader } from '@strapi/design-system';
import { api } from '../../api';
import { toISODate, toPickerDate, formatDay } from '../../utils/assignment';

const versionLabel = (v) => {
  const raw = String(v?.course_version || '').trim();
  if (!raw) return v?.title || 'the earlier version';
  return `${v.title} (${/^v/i.test(raw) ? raw : `v${raw}`})`;
};

export default function PublishDialog({ open, documentId, canAutoAssign, publishing, onPublish, onClose }) {
  const [step, setStep] = useState('confirm'); // confirm | assign | due
  const [sources, setSources] = useState(null);
  const [sourceId, setSourceId] = useState('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setStep('confirm');
    setDueDate('');
    if (!canAutoAssign || !documentId) {
      setSources([]);
      return undefined;
    }
    let cancelled = false;
    setSources(null);
    api
      .autoAssignSources(documentId)
      .then((res) => {
        if (cancelled) return;
        const list = res.data || [];
        setSources(list);
        setSourceId(list[0]?.documentId || '');
      })
      .catch(() => !cancelled && setSources([]));
    return () => {
      cancelled = true;
    };
  }, [open, documentId, canAutoAssign]);

  const source = (sources || []).find((s) => s.documentId === sourceId) || null;
  const hasLearners = (sources || []).length > 0;

  let title = 'Publish this course?';
  let body;
  let footer;

  if (step === 'confirm') {
    body = (
      <Typography>
        Once published, this course is locked and can no longer be edited or unpublished. Check the content, quizzes
        and feedback now. To change it later, use "Create new version" in the course list.
      </Typography>
    );
    footer = (
      <>
        <Button variant="tertiary" onClick={onClose} disabled={publishing}>
          Cancel
        </Button>
        {sources === null ? (
          <Button disabled startIcon={<Loader small />}>
            Checking learners…
          </Button>
        ) : hasLearners ? (
          <Button onClick={() => setStep('assign')}>Continue</Button>
        ) : (
          <Button loading={publishing} onClick={() => onPublish(null)}>
            Yes, publish
          </Button>
        )}
      </>
    );
  } else if (step === 'assign') {
    title = 'Assign this version to current learners?';
    body = (
      <Flex direction="column" alignItems="stretch" gap={4}>
        {sources.length > 1 && (
          <Field.Root name="auto-assign-source">
            <Field.Label>Take the learners from</Field.Label>
            <SingleSelect value={sourceId} onChange={(v) => setSourceId(String(v))}>
              {sources.map((s) => (
                <SingleSelectOption key={s.documentId} value={s.documentId}>
                  {`${versionLabel(s)} — ${s.learnerCount} learner${s.learnerCount === 1 ? '' : 's'}`}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        )}
        <Typography>
          <strong>{`${source?.learnerCount || 0} learner${source?.learnerCount === 1 ? ' is' : 's are'}`}</strong>
          {` currently assigned to ${versionLabel(source)}.`}
        </Typography>
        <Typography textColor="neutral600">
          Auto-assign gives them this new version as well. Their assignment and progress on the earlier version stay as
          they are.
        </Typography>
      </Flex>
    );
    footer = (
      <>
        <Button variant="tertiary" loading={publishing} onClick={() => onPublish(null)}>
          No, Skip Assignment
        </Button>
        <Button onClick={() => setStep('due')} disabled={publishing}>
          Yes, Auto-Assign
        </Button>
      </>
    );
  } else {
    title = 'Due date for the new version';
    body = (
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Field.Root name="auto-assign-due">
          <Field.Label>Complete by</Field.Label>
          <DatePicker
            value={toPickerDate(dueDate)}
            onChange={(d) => setDueDate(toISODate(d))}
            onClear={() => setDueDate('')}
            minDate={toPickerDate(toISODate(new Date()))}
            clearLabel="Clear date"
          />
        </Field.Root>
        <Typography textColor="neutral600">
          {`All ${source?.learnerCount || 0} learners get this due date for the new version and a "Course Assigned" notification. Their due date on ${versionLabel(source)} does not change.`}
        </Typography>
      </Flex>
    );
    footer = (
      <>
        <Button variant="tertiary" onClick={() => setStep('assign')} disabled={publishing}>
          Back
        </Button>
        <Button
          loading={publishing}
          disabled={!dueDate}
          onClick={() => onPublish({ sourceDocumentId: sourceId, dueDate })}
        >
          {dueDate ? `Publish & assign (due ${formatDay(dueDate)})` : 'Publish & assign'}
        </Button>
      </>
    );
  }

  return (
    <Modal.Root open={open} onOpenChange={(o) => !o && !publishing && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body}</Modal.Body>
        <Modal.Footer>{footer}</Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
