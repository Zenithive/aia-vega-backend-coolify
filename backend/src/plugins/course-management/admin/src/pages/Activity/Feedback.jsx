// @ts-nocheck
/**
 * Feedback: what learners said about a course. Feedback forms differ per course and version,
 * so the table has one row per learner; "View answers" shows all of their answers.
 * The Excel download lists one answer per row.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Flex, Modal, Searchbar, Typography } from '@strapi/design-system';
import { Message } from '@strapi/icons';
import { api } from '../../api';
import CourseFilter, { useCourseFilter } from '../../components/CourseFilter.jsx';
import { downloadExcel } from '../../components/excel';
import { CountLine, Empty, ErrorBox, Loading } from '../../components/states.jsx';
import DataTable from '../../../../../analytics-dashboard/admin/src/components/DataTable';

const cell = { fontSize: '14px' };

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
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
  useEffect(() => setPage(1), [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const text = (v) => (
    <Typography variant="omega" style={cell}>
      {v == null || v === '' ? '—' : v}
    </Typography>
  );

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
      <CourseFilter filter={filter}>
        <Box style={{ flex: '1 1 260px', maxWidth: 380 }}>
          <Searchbar
            name="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
            clearLabel="Clear"
            placeholder="Search name, employee code or department"
          >
            Search learners
          </Searchbar>
        </Box>
      </CourseFilter>
      <ErrorBox message={filter.error || error} />

      {rows === null ? (
        <Loading>Loading feedback…</Loading>
      ) : rows.length === 0 ? (
        <Empty icon={<Message width="64px" height="64px" />} content="No feedback has been submitted for this course yet." />
      ) : filtered.length === 0 ? (
        <Empty icon={<Message width="64px" height="64px" />} content="Nobody matches your search." />
      ) : (
        <>
          <CountLine count={filtered.length} noun="response" />
          <DataTable
            data={pageRows}
            fontSize={cell.fontSize}
            columns={[
              { key: 'emp_name', label: 'Learner', render: (v) => text(v) },
              { key: 'emp_code', label: 'Employee code / ID', render: (v, r) => text(v || r.emp_id) },
              { key: 'department', label: 'Department', render: (v) => text(v) },
              { key: 'course_version', label: 'Version', render: (v) => text(v) },
              { key: 'submitted_at', label: 'Submitted', render: (v) => text(formatDateTime(v)) },
              { key: 'answers', label: 'Answers', render: (v) => text(String(v.length)) },
              {
                key: 'details',
                label: 'Details',
                render: (_, r) => (
                  <Button size="S" variant="secondary" onClick={() => setOpen(r)}>
                    View answers
                  </Button>
                ),
              },
            ]}
            pagination={{
              page: currentPage,
              pageSize,
              total: filtered.length,
              onPageChange: (p) => setPage(Number(p)),
              onPageSizeChange: (size) => {
                setPageSize(Number(size));
                setPage(1);
              },
            }}
            onExport={download}
            exportLabel="Download all answers (Excel)"
          />
        </>
      )}

      {open && <ResponseModal response={open} onClose={() => setOpen(null)} />}
    </>
  );
}
