// @ts-nocheck
/**
 * Answer review: quiz attempts with descriptive (written) answers awaiting — or done with —
 * manual review, and a modal to mark each answer correct / incorrect. Saving publishes the
 * learner's final score for that module quiz.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Pencil } from '@strapi/icons';
import { api } from '../api';
import { useSummary } from '../summary';
import CourseFilter, { useCourseFilter } from '../components/CourseFilter.jsx';
import { CountLine, Empty, ErrorBox, Loading } from '../components/states.jsx';

const STATUSES = [
  { value: 'Pending_review', label: 'Waiting for review' },
  { value: 'Reviewed', label: 'Already reviewed' },
  { value: 'all', label: 'All attempts' },
];

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
}

function ResultBadge({ correct }) {
  if (correct === true) return <Badge backgroundColor="success100" textColor="success700">Correct</Badge>;
  if (correct === false) return <Badge backgroundColor="danger100" textColor="danger700">Incorrect</Badge>;
  return <Badge backgroundColor="warning100" textColor="warning700">Not marked</Badge>;
}

function ReviewModal({ submissionId, canSave, onClose, onSaved }) {
  const { toggleNotification } = useNotification();
  const [detail, setDetail] = useState(null);
  const [marks, setMarks] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    api
      .get(`/reviews/${submissionId}`)
      .then((d) => {
        if (cancelled) return;
        setDetail(d || null);
        const initial = {};
        (d?.answers || []).forEach((a) => {
          if (a.needs_review) initial[a.question_id] = { correct: a.correct };
        });
        setMarks(initial);
      })
      .catch((e) => !cancelled && toggleNotification({ type: 'danger', message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [submissionId, toggleNotification]);

  // A published review is final: reviewed attempts open read-only.
  const editable = canSave && detail?.review_status !== 'Reviewed';
  const toReview = (detail?.answers || []).filter((a) => a.needs_review);
  const unmarked = toReview.filter((a) => typeof marks[a.question_id]?.correct !== 'boolean').length;

  // Live preview of the final score with the current marks (1 point per quiz question).
  const preview = useMemo(() => {
    if (!detail) return null;
    const total = detail.total_questions || detail.answers.length || 1;
    const earned = detail.answers.filter((a) => (a.needs_review ? marks[a.question_id]?.correct === true : a.correct === true)).length;
    const score = Math.round((earned / total) * 100);
    return { score, passed: score >= Number(detail.pass_mark || 0) };
  }, [detail, marks]);

  const setMark = (questionId, patch) => setMarks((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/reviews/${submissionId}`, {
        answers: toReview.map((a) => ({ question_id: a.question_id, correct: marks[a.question_id]?.correct })),
      });
      toggleNotification({ type: 'success', message: `Review saved — ${detail.emp_name} can now see the final score.` });
      onSaved();
    } catch (e) {
      toggleNotification({ type: 'danger', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Root open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content style={{ maxWidth: 880, width: '90vw' }}>
        <Modal.Header>
          <Modal.Title>{detail ? `Quiz review — ${detail.emp_name}` : 'Quiz review'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!detail ? (
            <Flex justifyContent="center" padding={6}>
              <Loader>Loading…</Loader>
            </Flex>
          ) : (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Typography variant="omega" textColor="neutral600">
                {[detail.course, detail.module, detail.attempt_number ? `Attempt ${detail.attempt_number}` : null, formatDateTime(detail.submitted_at)]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>

              {detail.answers.map((a, index) => (
                <Box
                  key={a.question_id || index}
                  padding={4}
                  hasRadius
                  borderStyle="solid"
                  borderWidth="1px"
                  borderColor={a.needs_review ? 'primary200' : 'neutral200'}
                  background={a.needs_review ? 'primary100' : 'neutral0'}
                >
                  <Flex justifyContent="space-between" alignItems="flex-start" gap={3} marginBottom={2}>
                    <Typography variant="delta" style={{ whiteSpace: 'pre-wrap' }}>
                      {index + 1}. {a.question}
                    </Typography>
                    <Badge>{String(a.question_type || '').replace('_', ' ')}</Badge>
                  </Flex>

                  <Typography variant="pi" textColor="neutral600">Learner answer</Typography>
                  <Box paddingTop={1} paddingBottom={2}>
                    <Typography style={{ whiteSpace: 'pre-wrap' }}>{a.learner_answer || '—'}</Typography>
                  </Box>

                  {a.expected_answer ? (
                    <>
                      <Typography variant="pi" textColor="neutral600">
                        {a.question_type === 'Descriptive' ? 'Model answer (reference)' : 'Correct answer'}
                      </Typography>
                      <Box paddingTop={1} paddingBottom={2}>
                        <Typography textColor="neutral700" style={{ whiteSpace: 'pre-wrap' }}>
                          {a.expected_answer}
                        </Typography>
                      </Box>
                    </>
                  ) : null}

                  {a.needs_review && editable ? (
                    <Flex gap={2} paddingTop={2}>
                      <Button
                        variant={marks[a.question_id]?.correct === true ? 'success' : 'tertiary'}
                        onClick={() => setMark(a.question_id, { correct: true })}
                      >
                        Correct
                      </Button>
                      <Button
                        variant={marks[a.question_id]?.correct === false ? 'danger' : 'tertiary'}
                        onClick={() => setMark(a.question_id, { correct: false })}
                      >
                        Incorrect
                      </Button>
                    </Flex>
                  ) : (
                    <ResultBadge correct={a.correct} />
                  )}
                </Box>
              ))}
            </Flex>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Close</Button>
          </Modal.Close>
          {detail ? (
            <Flex gap={3} alignItems="center">
              {preview ? (
                <Typography variant="omega" textColor={preview.passed ? 'success600' : 'danger600'}>
                  {unmarked > 0
                    ? `${unmarked} answer${unmarked === 1 ? '' : 's'} left to mark`
                    : `Final score ${preview.score}% — ${preview.passed ? 'Passed' : 'Not passed'} (pass mark ${detail.pass_mark}%)`}
                </Typography>
              ) : null}
              {editable ? (
                <Button onClick={save} loading={saving} disabled={unmarked > 0 || saving}>
                  Publish result
                </Button>
              ) : null}
            </Flex>
          ) : null}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

export default function AnswerReview({ canSave }) {
  const { toggleNotification } = useNotification();
  const { refresh: refreshSummary } = useSummary();
  const filter = useCourseFilter('/reviews/courses', { allowAllCourses: true });
  const { company, query, loading: filterLoading } = filter;
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    if (filterLoading) return;
    setLoading(true);
    try {
      const list = await api.get(`/reviews?${query}&status=${encodeURIComponent(status)}`);
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setRows([]);
      toggleNotification({ type: 'danger', message: e.message });
    } finally {
      setLoading(false);
    }
  }, [query, filterLoading, status, toggleNotification]);

  useEffect(() => {
    load();
  }, [load]);

  const isPending = status === 'Pending_review';
  const idLabel = company === 'Vega' ? 'Employee ID' : 'Employee Code';

  return (
    <>
      <CourseFilter filter={filter}>
        <Box style={{ flex: '1 1 200px', maxWidth: 260 }}>
          <Field.Root name="review-status">
            <Field.Label>Show</Field.Label>
            <SingleSelect value={status} onChange={(v) => setStatus(String(v || 'all'))}>
              {STATUSES.map((s) => (
                <SingleSelectOption key={s.value} value={s.value}>
                  {s.label}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Box>
      </CourseFilter>
      <ErrorBox message={filter.error} />

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty
          icon={<Pencil width="64px" height="64px" />}
          content={isPending ? 'No quiz attempts are waiting for review.' : status === 'all' ? 'No quiz attempts with written answers yet.' : 'No reviewed quiz attempts yet.'}
        />
      ) : (
        <>
          <CountLine count={rows.length} noun="attempt" />
          <Table colCount={8} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                <Th><Typography variant="sigma">Employee</Typography></Th>
                <Th><Typography variant="sigma">{idLabel}</Typography></Th>
                <Th><Typography variant="sigma">Course</Typography></Th>
                <Th><Typography variant="sigma">Module</Typography></Th>
                <Th><Typography variant="sigma">Attempt</Typography></Th>
                <Th><Typography variant="sigma">Submitted</Typography></Th>
                <Th><Typography variant="sigma">{isPending ? 'To review' : status === 'all' ? 'Result' : 'Final score'}</Typography></Th>
                <Th><Typography variant="sigma">Action</Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => {
                // Per row: in "All attempts" both waiting and reviewed attempts are listed.
                const waiting = r.review_status !== 'Reviewed' || r.score == null;
                return (
                <Tr key={r.id}>
                  <Td><Typography>{r.emp_name}</Typography></Td>
                  <Td><Typography>{company === 'Vega' ? r.emp_id : r.emp_code}</Typography></Td>
                  <Td>
                    <Typography>{r.course_version ? `${r.course} (v${r.course_version})` : r.course}</Typography>
                  </Td>
                  <Td><Typography>{r.module}</Typography></Td>
                  <Td><Typography>{r.attempt_number ?? '-'}</Typography></Td>
                  <Td><Typography>{formatDateTime(r.submitted_at)}</Typography></Td>
                  <Td>
                    {waiting ? (
                      <Badge backgroundColor="warning100" textColor="warning700">
                        {r.pending_count > 0
                          ? `To review: ${r.pending_count} written answer${r.pending_count === 1 ? '' : 's'}`
                          : 'Waiting for review'}
                      </Badge>
                    ) : (
                      <Flex direction="column" alignItems="flex-start" gap={1}>
                        <Badge backgroundColor={r.passed ? 'success100' : 'danger100'} textColor={r.passed ? 'success700' : 'danger700'}>
                          {`${r.score}% — ${r.passed ? 'Passed' : 'Not passed'}`}
                        </Badge>
                        {r.reviewed_by ? (
                          <Typography variant="pi" textColor="neutral600">{`by ${r.reviewed_by}`}</Typography>
                        ) : null}
                      </Flex>
                    )}
                  </Td>
                  <Td>
                    <Button variant={waiting ? 'default' : 'tertiary'} onClick={() => setOpenId(r.id)}>
                      {waiting ? 'Review' : 'View'}
                    </Button>
                  </Td>
                </Tr>
                );
              })}
            </Tbody>
          </Table>
        </>
      )}

      {openId != null ? (
        <ReviewModal
          submissionId={openId}
          canSave={canSave}
          onClose={() => setOpenId(null)}
          onSaved={() => {
            setOpenId(null);
            load();
            refreshSummary();
          }}
        />
      ) : null}
    </>
  );
}
