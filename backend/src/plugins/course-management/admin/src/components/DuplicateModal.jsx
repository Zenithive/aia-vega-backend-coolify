// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { Modal, Button, Flex, TextInput, Typography } from '@strapi/design-system';
import { FormField } from './ui.jsx';
import { suggestNextVersion, isBlank } from '../utils/course';

/**
 * "Create new version" dialog. The copy keeps the course lineage (group_id) so it shows up
 * as a version of the same course, gets fresh module/quiz ids, and is not assigned to anyone.
 */
export default function DuplicateModal({ course, open, loading, error, onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    // Prefill only when the dialog opens, so typing is not reset by parent re-renders.
    if (open && course) {
      setTitle(course.title || '');
      setVersion(suggestNextVersion(course.course_version));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    if (isBlank(title) || isBlank(version)) return;
    onSubmit({ title: title.trim(), course_version: version.trim() });
  };

  return (
    <Modal.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Create a new version</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Typography variant="omega" textColor="neutral700">
              A draft copy of <strong>{course?.title}</strong> (version {course?.course_version || '—'}) will be created
              with all of its modules, quiz and feedback settings. Course assignments are not copied, so learners keep
              their current version until you assign the new one.
            </Typography>
            <FormField name="dup-title" label="Course title" required error={isBlank(title) ? 'Title is required' : undefined}>
              <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
            </FormField>
            <FormField
              name="dup-version"
              label="New version"
              required
              hint={`Current version: ${course?.course_version || '—'}`}
              error={error || (isBlank(version) ? 'Version is required' : undefined)}
            >
              <TextInput value={version} onChange={(e) => setVersion(e.target.value)} />
            </FormField>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Cancel</Button>
          </Modal.Close>
          <Button onClick={submit} loading={loading} disabled={isBlank(title) || isBlank(version)}>
            Create draft version
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
