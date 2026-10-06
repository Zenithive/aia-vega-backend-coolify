// @ts-nocheck
/**
 * Assignments: who has to take which course, and by when. Optionally filtered to one
 * course (?course=<documentId>), e.g. when opened from a course.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layouts, Page, useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Flex,
  IconButton,
  Loader,
  Searchbar,
  Table,
  Tag,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Cross, Eye, Pencil, Plus, Trash, User } from '@strapi/icons';
import { api } from '../../api';
import { BASE_PATH } from '../../pluginId';
import { useAssignmentPermissions } from '../../utils/usePermissions';
import { describeTarget, formatDay, isPastDay } from '../../utils/assignment';
import SectionNav from '../../components/SectionNav.jsx';
import { ConfirmDialog } from '../../components/ui.jsx';

export default function AssignmentList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const perms = useAssignmentPermissions();
  const courseFilter = searchParams.get('course') || '';
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { toggleNotification } = useNotification();

  const remove = async () => {
    setDeleting(true);
    try {
      await api.removeAssignment(toDelete.documentId);
      setRows((list) => (list || []).filter((a) => a.documentId !== toDelete.documentId));
      toggleNotification({ type: 'success', message: 'Assignment deleted' });
    } catch (e) {
      toggleNotification({ type: 'danger', message: e.message });
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  useEffect(() => {
    if (perms.isLoading || !perms.canRead) return;
    setRows(null);
    setError(null);
    api
      .assignments(courseFilter)
      .then((res) => setRows(res.data || []))
      .catch((e) => {
        setRows([]);
        setError(e.message);
      });
  }, [courseFilter, perms.isLoading, perms.canRead]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows || [];
    return (rows || []).filter((a) =>
      [a.company?.name, describeTarget(a), ...a.courses.map((c) => c.title)].filter(Boolean).some((v) => v.toLowerCase().includes(q))
    );
  }, [rows, search]);

  const filterCourse = courseFilter ? (rows || []).flatMap((a) => a.courses).find((c) => c.documentId === courseFilter) : null;
  const newPath = `${BASE_PATH}/assignments/new${courseFilter ? `?course=${courseFilter}` : ''}`;

  if (perms.isLoading) return <Page.Loading />;
  if (!perms.canRead) return <Page.NoPermissions />;

  return (
    <Page.Main>
      <Page.Title>Course assignments</Page.Title>
      <Layouts.Header
        title="Course Management"
        subtitle="Choose who has to take each course and by when. Learners are notified when you assign a course."
        primaryAction={
          perms.canAssign && (
            <Button startIcon={<Plus />} onClick={() => navigate(newPath)}>
              Assign a course
            </Button>
          )
        }
      />
      <Layouts.Content>
        <SectionNav current="assignments" />

        <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} marginBottom={4}>
          <Searchbar
            name="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
            clearLabel="Clear search"
            placeholder="Search by course, company, department or location"
          >
            Search assignments
          </Searchbar>
          {courseFilter && (
            <Flex marginTop={3}>
              <Tag icon={<Cross />} onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                {`Only "${filterCourse?.title || 'this course'}"`}
              </Tag>
            </Flex>
          )}
        </Box>

        {rows === null ? (
          <Flex justifyContent="center" padding={10}>
            <Loader>Loading assignments…</Loader>
          </Flex>
        ) : error ? (
          <Page.Error />
        ) : filtered.length === 0 ? (
          <Box background="neutral0" hasRadius shadow="tableShadow">
            <EmptyStateLayout
              icon={<User width="64px" height="64px" />}
              content={
                search
                  ? 'No assignments match your search.'
                  : courseFilter
                    ? 'This course is not assigned to anyone yet.'
                    : 'No course has been assigned yet. Use "Assign a course" at the top.'
              }
            />
          </Box>
        ) : (
          <Table colCount={6} rowCount={filtered.length + 1}>
            <Thead>
              <Tr>
                <Th><Typography variant="sigma">Course</Typography></Th>
                <Th><Typography variant="sigma">Company</Typography></Th>
                <Th><Typography variant="sigma">Assigned to</Typography></Th>
                <Th><Typography variant="sigma">Due date</Typography></Th>
                <Th><Typography variant="sigma">Status</Typography></Th>
                <Th><Typography variant="sigma">Actions</Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((a) => (
                <Tr key={a.documentId}>
                  <Td>
                    <Flex direction="column" alignItems="flex-start" gap={1} style={{ maxWidth: 320 }}>
                      {a.courses.map((c) => (
                        <Typography key={c.documentId} fontWeight="bold" ellipsis style={{ maxWidth: 320 }}>
                          {`${c.title}${c.course_version ? ` (v${c.course_version})` : ''}`}
                        </Typography>
                      ))}
                      {a.courses.length === 0 && <Typography textColor="neutral500">No course</Typography>}
                    </Flex>
                  </Td>
                  <Td><Typography>{a.company?.name || '—'}</Typography></Td>
                  <Td>
                    <Typography ellipsis style={{ maxWidth: 280, display: 'block' }}>
                      {describeTarget(a)}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography textColor={isPastDay(a.dueDate) ? 'danger600' : 'neutral800'}>{formatDay(a.dueDate)}</Typography>
                  </Td>
                  <Td>
                    {a.isLive ? <Badge variant="success">Assigned</Badge> : <Badge>Not sent yet</Badge>}
                  </Td>
                  <Td>
                    <Flex gap={2}>
                    <Button
                      size="S"
                      variant="secondary"
                      startIcon={perms.canEdit ? <Pencil /> : <Eye />}
                      onClick={() => navigate(`${BASE_PATH}/assignments/${a.documentId}`)}
                    >
                      Open
                    </Button>
                    {perms.canDelete && (
                      <IconButton label="Delete assignment" variant="ghost" onClick={() => setToDelete(a)}>
                        <Trash />
                      </IconButton>
                    )}
                    </Flex>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Layouts.Content>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete assignment?"
        confirmLabel="Delete assignment"
        loading={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
      >
        {toDelete &&
          `${toDelete.courses.map((c) => c.title).join(", ") || "This course"} will no longer be assigned to ${describeTarget(toDelete)}. They lose access unless another assignment gives it to them. Their progress so far is kept.`}
      </ConfirmDialog>
    </Page.Main>
  );
}
