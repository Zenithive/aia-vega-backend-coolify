// @ts-nocheck
/**
 * Feedback: what learners said about a course. Feedback forms differ per course and version,
 * so instead of one wide table there are two views:
 *  - Summary: per question, how many learners gave each answer (rating, yes/no, agree…)
 *  - Responses: one row per learner; "View" shows all of their answers
 * The Excel download lists one answer per row.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Modal,
  Searchbar,
  Table,
  Tabs,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Message, Download } from '@strapi/icons';
import { api } from '../../api';
import CourseFilter, { useCourseFilter } from '../../components/CourseFilter.jsx';
import { downloadExcel } from '../../components/excel';
import { CountLine, Empty, ErrorBox, Loading } from '../../components/states.jsx';
import Pager, { usePaged } from '../../components/Pager.jsx';

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const CHOICE_TYPES = new Set(['Rating', 'AgreeOrDisagree', 'YesOrNo', 'YesNo']);

/** Per question (matched by its text, so versions with the same question add up). */
function summarise(responses) {
  const questions = new Map();
  responses.forEach((r) =>
    r.answers.forEach((a) => {
      const key = `${a.question.trim().toLowerCase()}::${a.answer_type}`;
      if (!questions.has(key)) questions.set(key, { key, question: a.question, type: a.answer_type, values: [] });
      if (String(a.answer).trim() !== '') questions.get(key).values.push({ value: String(a.answer).trim(), by: r.emp_name });
    })
  );
  return [...questions.values()].map((q) => {
    const counts = new Map();
    q.values.forEach(({ value }) => counts.set(value, (counts.get(value) || 0) + 1));
    const numbers = q.values.map((v) => Number(v.value)).filter((n) => Number.isFinite(n));
    return {
      ...q,
      total: q.values.length,
      counts: [...counts.entries()].sort((a, b) =>
        q.type === 'Rating' ? Number(b[0]) - Number(a[0]) : b[1] - a[1]
      ),
      average: q.type === 'Rating' && numbers.length ? (numbers.reduce((s, n) => s + n, 0) / numbers.length).toFixed(1) : null,
    };
  });
}

function QuestionSummary({ item }) {
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" padding={5} marginBottom={4}>
      <Flex justifyContent="space-between" alignItems="flex-start" gap={3} marginBottom={3}>
        <Typography variant="delta" tag="h3">{item.question}</Typography>
        <Flex gap={2}>
          {item.average && <Badge backgroundColor="primary100" textColor="primary700">{`Average ${item.average}`}</Badge>}
          <Badge>{`${item.total} answer${item.total === 1 ? '' : 's'}`}</Badge>
        </Flex>
      </Flex>
      {CHOICE_TYPES.has(item.type) ? (
        <Flex direction="column" alignItems="stretch" gap={2}>
          {item.counts.map(([value, count]) => {
            const pct = item.total ? Math.round((count / item.total) * 100) : 0;
            return (
              <Flex key={value} gap={3}>
                <Box style={{ width: 160 }}>
                  <Typography>{value}</Typography>
                </Box>
                <Box flex="1" background="neutral150" hasRadius style={{ height: 12, overflow: 'hidden' }}>
                  <Box background="primary500" style={{ width: `${pct}%`, height: '100%' }} />
                </Box>
                <Box style={{ width: 90, textAlign: 'right' }}>
                  <Typography variant="pi">{`${count} (${pct}%)`}</Typography>
                </Box>
              </Flex>
            );
          })}
        </Flex>
      ) : (
        <Flex direction="column" alignItems="stretch" gap={2} style={{ maxHeight: 240, overflowY: 'auto' }}>
          {item.values.map((v, i) => (
            <Box key={i} padding={3} hasRadius background="neutral100">
              <Typography style={{ whiteSpace: 'pre-wrap' }}>{v.value}</Typography>
              <Typography variant="pi" textColor="neutral600" tag="p">{`— ${v.by}`}</Typography>
            </Box>
          ))}
        </Flex>
      )}
    </Box>
  );
}

function ResponseModal({ response, onClose }) {
  return (
    <Modal.Root open onOpenChange={(o) => !o && onClose()}>
      <Modal.Content style={{ maxWidth: 760, width: '90vw' }}>
        <Modal.Header>
          <Modal.Title>{`Feedback — ${response.emp_name}`}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Typography textColor="neutral600" tag="p" marginBottom={4}>
            {[response.course_title, response.course_version && `Version ${response.course_version}`, formatDateTime(response.submitted_at)]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          <Flex direction="column" alignItems="stretch" gap={3}>
            {response.answers.map((a, i) => (
              <Box key={a.key} padding={3} hasRadius background="neutral100">
                <Typography fontWeight="bold">{`${i + 1}. ${a.question}`}</Typography>
                <Typography tag="p" marginTop={1} style={{ whiteSpace: 'pre-wrap' }}>{a.answer || '—'}</Typography>
              </Box>
            ))}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Close</Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

export default function Feedback() {
  const filter = useCourseFilter(api.feedbackCourses);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('summary');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (filter.loading || !filter.course) {
      setRows(filter.loading ? null : []);
      return undefined;
    }
    let cancelled = false;
    setRows(null);
    setError('');
    api
      .feedback(filter.query)
      .then((list) => !cancelled && setRows(list || []))
      .catch((e) => {
        if (cancelled) return;
        setRows([]);
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [filter.query, filter.loading, filter.course]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => !q || [r.emp_name, r.emp_code, r.emp_id, r.department].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [rows, search]);
  const summary = useMemo(() => summarise(filtered), [filtered]);
  const paged = usePaged(filtered);

  const download = () =>
    downloadExcel(
      filtered.flatMap((r) =>
        r.answers.map((a, i) => ({
          Employee: r.emp_name,
          'Employee code / ID': r.emp_code || r.emp_id,
          Department: r.department,
          Course: r.course_title,
          Version: r.course_version,
          Submitted: r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '',
          'Question no.': i + 1,
          Question: a.question,
          Answer: a.answer,
        }))
      ),
      `feedback-${(filter.course?.title || 'course').replace(/\W+/g, '-').toLowerCase()}`,
      'Feedback'
    );

  return (
    <>
      <CourseFilter filter={filter} />
      <ErrorBox message={filter.error || error} />

      {rows === null ? (
        <Loading>Loading feedback…</Loading>
      ) : rows.length === 0 ? (
        <Empty icon={<Message width="64px" height="64px" />} content="No feedback has been submitted for this course yet." />
      ) : (
        <>
          <Flex gap={4} wrap="wrap" alignItems="flex-end" justifyContent="space-between" marginBottom={4}>
            <Box style={{ flex: '1 1 280px', maxWidth: 420 }}>
              <Searchbar name="search" value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch('')} clearLabel="Clear" placeholder="Search name, employee code or department">
                Search learners
              </Searchbar>
            </Box>
            <Button variant="secondary" startIcon={<Download />} disabled={!filtered.length} onClick={download}>
              Download all answers (Excel)
            </Button>
          </Flex>

          <Tabs.Root variant="simple" value={view} onValueChange={setView}>
            <Tabs.List aria-label="Feedback view">
              <Tabs.Trigger value="summary">Summary per question</Tabs.Trigger>
              <Tabs.Trigger value="responses">{`Responses (${filtered.length})`}</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
          <Box paddingTop={4}>
            {filtered.length === 0 ? (
              <Empty icon={<Message width="64px" height="64px" />} content="Nobody matches your search." />
            ) : view === 'summary' ? (
              <>
                <CountLine count={filtered.length} noun="response" />
                {summary.map((item) => (
                  <QuestionSummary key={item.key} item={item} />
                ))}
              </>
            ) : (
              <>
                <Table colCount={5} rowCount={paged.rows.length + 1}>
                  <Thead>
                    <Tr>
                      <Th><Typography variant="sigma">Learner</Typography></Th>
                      <Th><Typography variant="sigma">Version</Typography></Th>
                      <Th><Typography variant="sigma">Submitted</Typography></Th>
                      <Th><Typography variant="sigma">Answers</Typography></Th>
                      <Th><Typography variant="sigma">Details</Typography></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {paged.rows.map((r) => (
                      <Tr key={r.id}>
                        <Td>
                          <Flex direction="column" alignItems="flex-start">
                            <Typography fontWeight="bold">{r.emp_name}</Typography>
                            <Typography variant="pi" textColor="neutral600">
                              {[r.emp_code || r.emp_id, r.department].filter(Boolean).join(' · ') || '—'}
                            </Typography>
                          </Flex>
                        </Td>
                        <Td><Typography>{r.course_version || '—'}</Typography></Td>
                        <Td><Typography variant="pi">{formatDateTime(r.submitted_at)}</Typography></Td>
                        <Td><Typography>{r.answers.length}</Typography></Td>
                        <Td>
                          <Button size="S" variant="secondary" onClick={() => setOpen(r)}>
                            View answers
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <Pager paged={paged} />
              </>
            )}
          </Box>
        </>
      )}

      {open && <ResponseModal response={open} onClose={() => setOpen(null)} />}
    </>
  );
}
