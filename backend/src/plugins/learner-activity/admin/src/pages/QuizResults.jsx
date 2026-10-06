// @ts-nocheck
/**
 * Quiz results: one row per learner × module quiz (attempts, best score, latest result).
 * "Attempts" opens every attempt of that learner with all questions and answers.
 * Quizzes differ per module, so the Excel download lists one answer per row.
 */
import React, { useEffect, useMemo, useState } from 'react';
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
  Searchbar,
  Typography,
} from '@strapi/design-system';
import { ChartPie, CaretDown, CaretUp } from '@strapi/icons';
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';
import { api } from '../api';
import CourseFilter, { useCourseFilter } from '../components/CourseFilter.jsx';
import { downloadExcel } from '../components/excel';
import { CountLine, Empty, ErrorBox, Loading } from '../components/states.jsx';

const RESULTS = [
  { value: 'all', label: 'Everyone' },
  { value: 'Passed', label: 'Passed' },
  { value: 'Not passed', label: 'Not passed' },
  { value: 'Pending review', label: 'Waiting for review' },
];
const RESULT_BADGE = {
  Passed: { backgroundColor: 'success100', textColor: 'success700' },
  'Not passed': { backgroundColor: 'danger100', textColor: 'danger700' },
  'Pending review': { backgroundColor: 'warning100', textColor: 'warning700' },
};

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function ResultBadge({ result }) {
  return <Badge {...(RESULT_BADGE[result] || {})}>{result === 'Pending review' ? 'Waiting for review' : result}</Badge>;
}

function AnswerList({ attemptId }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/quiz-results/attempts/${attemptId}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  if (error) return <ErrorBox message={error} />;
  if (!detail) return <Loading>Loading answers…</Loading>;

  return (
    <Flex direction="column" alignItems="stretch" gap={3} paddingTop={3}>
      {detail.answers.map((a, i) => (
        <Box key={a.question_id || i} padding={3} hasRadius borderColor="neutral200" borderStyle="solid" borderWidth="1px" background="neutral0">
          <Flex justifyContent="space-between" alignItems="flex-start" gap={3}>
            <Typography fontWeight="bold" style={{ whiteSpace: 'pre-wrap' }}>{`${i + 1}. ${a.question}`}</Typography>
            {a.correct === true && <Badge backgroundColor="success100" textColor="success700">Correct</Badge>}
            {a.correct === false && <Badge backgroundColor="danger100" textColor="danger700">Incorrect</Badge>}
            {a.correct == null && <Badge backgroundColor="warning100" textColor="warning700">Not marked yet</Badge>}
          </Flex>
          <Typography variant="pi" textColor="neutral600" tag="p" marginTop={2}>Learner answer</Typography>
          <Typography style={{ whiteSpace: 'pre-wrap' }}>{a.learner_answer || '—'}</Typography>
          {a.expected_answer && a.correct !== true && (
            <>
              <Typography variant="pi" textColor="neutral600" tag="p" marginTop={2}>
                {a.question_type === 'Descriptive' ? 'Model answer' : 'Correct answer'}
              </Typography>
              <Typography textColor="neutral700" style={{ whiteSpace: 'pre-wrap' }}>{a.expected_answer}</Typography>
            </>
          )}
        </Box>
      ))}
    </Flex>
  );
}

function AttemptHistory({ row, onClose }) {
  const [attempts, setAttempts] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams({ userId: row.user_id, courseDocumentId: row.course_documentId, moduleId: row.module_id });
    api
      .get(`/quiz-results/attempts?${params.toString()}`)
      .then((list) => {
        setAttempts(list || []);
        if (list?.length) setOpen(list[list.length - 1].id);
      })
      .catch((e) => setError(e.message));
  }, [row]);

  return (
    <Modal.Root open onOpenChange={(o) => !o && onClose()}>
      <Modal.Content style={{ maxWidth: 900, width: '92vw' }}>
        <Modal.Header>
          <Modal.Title>{`${row.emp_name} — ${row.module_title}`}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Typography textColor="neutral600" tag="p" marginBottom={4}>
            {[row.course_title, row.course_version && `Version ${row.course_version}`, row.emp_code || row.emp_id]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          <ErrorBox message={error} />
          {!attempts && !error ? (
            <Loading />
          ) : (
            <Flex direction="column" alignItems="stretch" gap={3}>
              {(attempts || []).map((a, i) => {
                const expanded = open === a.id;
                return (
                  <Box key={a.id} padding={4} hasRadius background="neutral100">
                    <Flex justifyContent="space-between" gap={3} wrap="wrap">
                      <Flex gap={3} wrap="wrap">
                        <Typography fontWeight="bold">{`Attempt ${a.attempt_number ?? i + 1}`}</Typography>
                        <ResultBadge result={a.result} />
                        {a.score != null && <Typography>{`Score ${a.score}%`}</Typography>}
                        <Typography variant="pi" textColor="neutral600">
                          {[formatDateTime(a.submitted_at), a.time_taken_minutes != null && `${a.time_taken_minutes} min`, a.submission_type]
                            .filter(Boolean)
                            .join(' · ')}
                        </Typography>
                      </Flex>
                      <Button
                        size="S"
                        variant="tertiary"
                        endIcon={expanded ? <CaretUp /> : <CaretDown />}
                        onClick={() => setOpen(expanded ? null : a.id)}
                      >
                        {expanded ? 'Hide answers' : 'Show answers'}
                      </Button>
                    </Flex>
                    {a.result === 'Pending review' && (
                      <Typography variant="pi" textColor="warning700" tag="p" marginTop={2}>
                        Written answers are waiting for review in the Answer review tab; the score appears after that.
                      </Typography>
                    )}
                    {expanded && <AnswerList attemptId={a.id} />}
                  </Box>
                );
              })}
            </Flex>
          )}
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

export default function QuizResults() {
  const { toggleNotification } = useNotification();
  const filter = useCourseFilter('/quiz-results/courses');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [openRow, setOpenRow] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (filter.loading || !filter.course) {
      setRows(filter.loading ? null : []);
      return undefined;
    }
    let cancelled = false;
    setRows(null);
    setError('');
    api
      .get(`/quiz-results?${filter.query}`)
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

  useEffect(() => setModuleFilter('all'), [filter.query]);

  // Every quiz module of the chosen course / version (from the course itself, so modules nobody
  // has taken yet are listed too), plus any module title only found in older attempts.
  const modules = useMemo(() => {
    const versions = filter.version ? [filter.version] : filter.course?.versions || [];
    const titles = versions.flatMap((v) => (v.quizModules || []).map((m) => m.title).filter(Boolean));
    (rows || []).forEach((r) => r.module_title && titles.push(r.module_title));
    return [...new Set(titles)];
  }, [filter.course, filter.version, rows]);

  const filtered = useMemo(
    () =>
      (rows || [])
        .filter((r) => moduleFilter === 'all' || r.module_title === moduleFilter)
        .filter((r) => resultFilter === 'all' || r.latest.result === resultFilter)
        .filter((r) => {
          const q = search.trim().toLowerCase();
          return !q || [r.emp_name, r.emp_code, r.emp_id, r.department].some((v) => String(v || '').toLowerCase().includes(q));
        })
        .sort((a, b) => a.emp_name.localeCompare(b.emp_name) || a.module_title.localeCompare(b.module_title)),
    [rows, moduleFilter, resultFilter, search]
  );
  useEffect(() => setPage(1), [filtered]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  /** The table's download: every answer of every attempt (one row per answer). */
  const exportAnswers = async () => {
    try {
      const data = await api.get(`/quiz-results/export?${filter.query}`);
      const list = (data || []).filter((r) => moduleFilter === 'all' || r.Module === moduleFilter);
      if (!list.length) toggleNotification({ type: 'info', message: 'There are no answers to download.' });
      else downloadExcel(list, `quiz-answers-${(filter.course?.title || 'course').replace(/\W+/g, '-').toLowerCase()}`, 'Answers');
    } catch (e) {
      toggleNotification({ type: 'danger', message: e.message });
    }
  };

  const text = (v) => <Typography>{v ?? '—'}</Typography>;

  return (
    <>
      <CourseFilter filter={filter} mergeVersion>
        <Box style={{ flex: '1 1 200px', maxWidth: 280 }}>
          <Field.Root name="module">
            <Field.Label>Module</Field.Label>
            <SingleSelect value={moduleFilter} onChange={(v) => setModuleFilter(String(v))} disabled={!modules.length}>
              <SingleSelectOption value="all">All modules</SingleSelectOption>
              {modules.map((m) => (
                <SingleSelectOption key={m} value={m}>
                  {m}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Box>
        <Box style={{ flex: '1 1 180px', maxWidth: 220 }}>
          <Field.Root name="result">
            <Field.Label>Latest result</Field.Label>
            <SingleSelect value={resultFilter} onChange={(v) => setResultFilter(String(v))}>
              {RESULTS.map((r) => (
                <SingleSelectOption key={r.value} value={r.value}>
                  {r.label}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Box>
        <Box style={{ flex: '2 1 240px' }}>
          <Searchbar
            name="learner-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
            clearLabel="Clear search"
            placeholder="Search learner, code or department"
          >
            Search learners
          </Searchbar>
        </Box>
      </CourseFilter>
      <ErrorBox message={filter.error || error} />

      {rows === null ? (
        <Loading>Loading quiz results…</Loading>
      ) : filtered.length === 0 ? (
        <Empty
          icon={<ChartPie width="64px" height="64px" />}
          content={rows.length ? 'Nobody matches these filters.' : 'No learner has taken a quiz in this course yet.'}
        />
      ) : (
        <>
          <CountLine count={filtered.length} noun="result" />
          <DataTable
            data={pageRows}
            fullData={filtered}
            paginatedData={pageRows}
            onExport={exportAnswers}
            exportLabel="Download all answers (Excel)"
            columns={[
              {
                key: 'emp_name',
                label: 'Learner',
                render: (_, r) => (
                  <Flex direction="column" alignItems="flex-start">
                    <Typography fontWeight="bold">{r.emp_name}</Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {[r.emp_code || r.emp_id, r.department].filter(Boolean).join(' · ') || '—'}
                    </Typography>
                  </Flex>
                ),
              },
              { key: 'module_title', label: 'Module', render: (v) => text(v) },
              { key: 'course_version', label: 'Version', render: (v) => text(v || '—') },
              { key: 'attempts', label: 'Attempts', render: (v, r) => text(r.max_attempts ? `${v} of ${r.max_attempts}` : v) },
              { key: 'best_score', label: 'Best score', render: (v) => text(v != null ? `${v}%` : '—') },
              { key: 'latest', label: 'Latest result', render: (v) => <ResultBadge result={v.result} /> },
              { key: 'last', label: 'Last attempt', render: (_, r) => <Typography variant="pi">{formatDateTime(r.latest.submitted_at)}</Typography> },
              {
                key: 'details',
                label: 'Details',
                render: (_, r) => (
                  <Button size="S" variant="secondary" onClick={() => setOpenRow(r)}>
                    {`View ${r.attempts === 1 ? 'attempt' : 'attempts'}`}
                  </Button>
                ),
              },
            ]}
            pagination={{
              page,
              pageSize,
              total: filtered.length,
              onPageChange: (p) => setPage(Number(p)),
              onPageSizeChange: (size) => {
                setPageSize(Number(size));
                setPage(1);
              },
            }}
          />
        </>
      )}

      {openRow && <AttemptHistory row={openRow} onClose={() => setOpenRow(null)} />}
    </>
  );
}
