// @ts-nocheck
/**
 * Course list: search and filter, click a course to open its detail page. Course-level
 * actions (edit, new version, assign, delete) live in the row's action menu; the detail
 * page only edits the course.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Layouts, Page, useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Flex,
  Typography,
  Button,
  IconButton,
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Menu,
  Loader,
  EmptyStateLayout,
  TextButton,
  Tag,
} from '@strapi/design-system';
import { Plus, Pencil, Cross, Book, More, Duplicate, Trash, User } from '@strapi/icons';
import { api } from '../api';
import { BASE_PATH } from '../pluginId';
import { useCoursePermissions, useAssignmentPermissions, useActivityPermissions } from '../utils/usePermissions';
import { thumbnailUrl, formatDate } from '../utils/course';
import { StatusBadge, ConfirmDialog } from '../components/ui.jsx';
import DuplicateModal from '../components/DuplicateModal.jsx';
import SectionNav from '../components/SectionNav.jsx';

const PAGE_SIZE = 10;
const STATUS_FILTERS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];

function Thumbnail({ file }) {
  const url = thumbnailUrl(file);
  const isImage = String(file?.mime || '').startsWith('image/');
  return (
    <Flex
      width="64px"
      height="44px"
      hasRadius
      background="primary100"
      justifyContent="center"
      alignItems="center"
      overflow="hidden"
      shrink={0}
    >
      {url && isImage ? (
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Book fill="primary600" />
      )}
    </Flex>
  );
}

export default function CourseList() {
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const [searchParams, setSearchParams] = useSearchParams();
  const perms = useCoursePermissions();
  const assignmentPerms = useAssignmentPermissions();
  const activityPerms = useActivityPermissions();

  const [options, setOptions] = useState(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [toDelete, setToDelete] = useState(null);
  const [toDuplicate, setToDuplicate] = useState(null);
  const [busy, setBusy] = useState(null);
  const [duplicateError, setDuplicateError] = useState(null);

  const filters = useMemo(
    () => ({
      search: searchParams.get('search') || '',
      status: searchParams.get('status') || '',
      category: searchParams.get('category') || '',
      language: searchParams.get('language') || '',
      active: searchParams.get('active') || '',
      groupId: searchParams.get('groupId') || '',
      page: Number(searchParams.get('page') || 1),
    }),
    [searchParams]
  );

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value === '' || value == null) next.delete(key);
    else next.set(key, String(value));
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.list({ ...filters, pageSize: PAGE_SIZE });
      setRows(res.data || []);
      setMeta(res.meta || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .options()
      .then((res) => setOptions(res.data))
      .catch(() => setOptions({ languages: [], categories: [], activeValues: [] }));
  }, []);

  // Debounced search box → URL
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filters.search) setFilter('search', searchInput.trim());
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const remove = async () => {
    setBusy('delete');
    try {
      await api.remove(toDelete.documentId);
      toggleNotification({ type: 'success', message: 'Course deleted' });
      load();
    } catch (e) {
      toggleNotification({ type: 'danger', message: e.message });
    } finally {
      setToDelete(null);
      setBusy(null);
    }
  };

  const duplicate = async (values) => {
    setBusy('duplicate');
    setDuplicateError(null);
    try {
      const res = await api.duplicate(toDuplicate.documentId, values);
      setToDuplicate(null);
      toggleNotification({ type: 'success', message: `Version ${values.course_version} created as a draft` });
      navigate(`${BASE_PATH}/${res.data.documentId}`);
    } catch (e) {
      setDuplicateError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const groupCourse = filters.groupId ? rows[0] : null;
  const pagination = meta?.pagination;
  const hasFilters = ['search', 'status', 'category', 'language', 'active', 'groupId'].some((k) => filters[k]);

  if (perms.isLoading || assignmentPerms.isLoading || activityPerms.isLoading) return <Page.Loading />;
  if (!perms.canRead) {
    // Roles that only handle assignments, offline proof or feedback land on their part of the plugin.
    const landing = assignmentPerms.canRead
      ? 'assignments'
      : activityPerms.canOffline
        ? 'offline'
        : activityPerms.canFeedback
          ? 'feedback'
          : null;
    return landing ? <Navigate to={`${BASE_PATH}/${landing}`} replace /> : <Page.NoPermissions />;
  }

  return (
    <Page.Main>
      <Page.Title>Course Management</Page.Title>
      <Layouts.Header
        title="Course Management"
        subtitle={
          meta?.totals
            ? `${meta.totals.all} course${meta.totals.all === 1 ? '' : 's'} · ${meta.totals.published} live · ${meta.totals.draft} draft`
            : 'Create, organize and publish courses'
        }
        primaryAction={
          perms.canCreate && (
            <Button startIcon={<Plus />} onClick={() => navigate(`${BASE_PATH}/new`)}>
              Create course
            </Button>
          )
        }
      />
      <Layouts.Content>
        <SectionNav current="courses" />
        <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} marginBottom={4}>
          <Flex gap={3} wrap="wrap" alignItems="flex-end">
            <Box style={{ flex: '2 1 260px' }}>
              <Searchbar
                name="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onClear={() => setSearchInput('')}
                clearLabel="Clear search"
                placeholder="Search by title, version, category or company"
              >
                Search courses
              </Searchbar>
            </Box>
            <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter('status', v)} items={STATUS_FILTERS} />
            <FilterSelect
              label="Category"
              value={filters.category}
              onChange={(v) => setFilter('category', v)}
              items={(options?.categories || []).map((c) => ({ value: c, label: c }))}
            />
            <FilterSelect
              label="Language"
              value={filters.language}
              onChange={(v) => setFilter('language', v)}
              items={(options?.languages || []).map((l) => ({ value: l, label: l }))}
            />
          </Flex>
          {hasFilters && (
            <Flex gap={2} marginTop={3} wrap="wrap">
              {filters.groupId && (
                <Tag icon={<Cross />} onClick={() => setFilter('groupId', '')}>
                  {`All versions of "${groupCourse?.title || 'course'}"`}
                </Tag>
              )}
              <TextButton onClick={clearFilters}>
                Clear all filters
              </TextButton>
            </Flex>
          )}
        </Box>

        {loading && rows.length === 0 ? (
          <Flex justifyContent="center" padding={10}>
            <Loader>Loading courses…</Loader>
          </Flex>
        ) : error ? (
          <Page.Error />
        ) : rows.length === 0 ? (
          <Box background="neutral0" hasRadius shadow="tableShadow">
            <EmptyStateLayout
              icon={<Book width="64px" height="64px" />}
              action={
                hasFilters && (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )
              }
              content={hasFilters ? 'No courses match these filters.' : 'No courses yet. Use "Create course" at the top to make your first one.'}
            />
          </Box>
        ) : (
          <>
            <Table colCount={8} rowCount={rows.length + 1}>
              <Thead>
                <Tr>
                  <Th><Typography variant="sigma">Course</Typography></Th>
                  <Th><Typography variant="sigma">Version</Typography></Th>
                  <Th><Typography variant="sigma">Category</Typography></Th>
                  <Th><Typography variant="sigma">Languages</Typography></Th>
                  <Th><Typography variant="sigma">Status</Typography></Th>
                  <Th><Typography variant="sigma">Updated</Typography></Th>
                  <Th><Typography variant="sigma">Actions</Typography></Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((course) => {
                  const isPublished = course.status !== 'draft';
                  return (
                    <Tr
                      key={course.documentId}
                      onClick={() => navigate(`${BASE_PATH}/${course.documentId}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Td>
                        <Flex gap={3}>
                          <Thumbnail file={course.thumbnail} />
                          <Flex direction="column" alignItems="flex-start" gap={1} style={{ maxWidth: 320 }}>
                            <Typography fontWeight="bold" ellipsis style={{ maxWidth: 320 }}>
                              {course.title || 'Untitled course'}
                            </Typography>
                            <Typography variant="pi" textColor="neutral600" ellipsis style={{ maxWidth: 320 }}>
                              {course.companies.length ? course.companies.join(', ') : 'All companies'}
                              {course.assignmentCount > 0 && ` · ${course.assignmentCount} assignment${course.assignmentCount === 1 ? '' : 's'}`}
                            </Typography>
                          </Flex>
                        </Flex>
                      </Td>
                      <Td>
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Typography>{course.course_version || '—'}</Typography>
                          {course.versionCount > 1 && !filters.groupId && (
                            <TextButton
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilter('groupId', course.group_id);
                              }}
                            >
                              {`${course.versionCount} versions`}
                            </TextButton>
                          )}
                        </Flex>
                      </Td>
                      <Td>
                        <Typography>{course.course_category || '—'}</Typography>
                      </Td>
                      <Td>
                        <Flex gap={1} wrap="wrap" style={{ maxWidth: 180 }}>
                          {course.languages.length ? (
                            course.languages.map((l) => <Badge key={l}>{l}</Badge>)
                          ) : (
                            <Typography textColor="neutral500">—</Typography>
                          )}
                        </Flex>
                      </Td>
                      <Td>
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <StatusBadge status={course.status} />
                          {course.active && course.active !== 'published' && (
                            <Typography variant="pi" textColor="danger600">
                              Hidden from learners
                            </Typography>
                          )}
                        </Flex>
                      </Td>
                      <Td>
                        <Typography variant="pi" textColor="neutral700">
                          {formatDate(course.updatedAt)}
                        </Typography>
                      </Td>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          course={course}
                          isPublished={isPublished}
                          perms={perms}
                          canAssign={assignmentPerms.canAssign}
                          onEdit={() => navigate(`${BASE_PATH}/${course.documentId}`)}
                          onDuplicate={() => {
                            setDuplicateError(null);
                            setToDuplicate(course);
                          }}
                          onAssign={() => navigate(`${BASE_PATH}/assignments/new?course=${course.documentId}`)}
                          onDelete={() => setToDelete(course)}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>

            {pagination && pagination.pageCount > 1 && (
              <Flex justifyContent="space-between" alignItems="center" marginTop={4}>
                <Typography variant="pi" textColor="neutral600">
                  {`Showing ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                    pagination.page * pagination.pageSize,
                    pagination.total
                  )} of ${pagination.total}`}
                </Typography>
                <Flex gap={2}>
                  <Button variant="tertiary" size="S" disabled={pagination.page <= 1} onClick={() => setFilter('page', pagination.page - 1)}>
                    Previous
                  </Button>
                  <Typography variant="pi">{`Page ${pagination.page} of ${pagination.pageCount}`}</Typography>
                  <Button
                    variant="tertiary"
                    size="S"
                    disabled={pagination.page >= pagination.pageCount}
                    onClick={() => setFilter('page', pagination.page + 1)}
                  >
                    Next
                  </Button>
                </Flex>
              </Flex>
            )}
          </>
        )}
      </Layouts.Content>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete course?"
        confirmLabel="Delete course"
        loading={busy === 'delete'}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
      >
        {toDelete &&
          `"${toDelete.title || 'Untitled course'}" (version ${toDelete.course_version || '—'}) and all of its modules, quiz and feedback settings will be permanently deleted. This cannot be undone.`}
      </ConfirmDialog>

      <DuplicateModal
        open={!!toDuplicate}
        course={toDuplicate}
        loading={busy === 'duplicate'}
        error={duplicateError}
        onClose={() => setToDuplicate(null)}
        onSubmit={duplicate}
      />
    </Page.Main>
  );
}

/** Row action menu. New versions and assignments need a published course, so both are disabled for drafts. */
function RowActions({ course, isPublished, perms, canAssign, onEdit, onDuplicate, onAssign, onDelete }) {
  // Published courses are locked; they change through "Create new version".
  const canEdit = perms.canUpdate && !isPublished;
  if (!canEdit && !perms.canCreate && !canAssign && !perms.canDelete) return null;
  return (
    <Menu.Root>
      <Menu.Trigger tag={IconButton} icon={<More />} label={`Actions for ${course.title || 'course'}`} variant="tertiary" />
      <Menu.Content popoverPlacement="bottom-end">
        {canEdit && (
          <Menu.Item startIcon={<Pencil />} onSelect={onEdit}>
            Edit
          </Menu.Item>
        )}
        {perms.canCreate && (
          <Menu.Item startIcon={<Duplicate />} onSelect={onDuplicate} disabled={!isPublished}>
            {isPublished ? 'Create new version' : 'Create new version (publish first)'}
          </Menu.Item>
        )}
        {canAssign && (
          <Menu.Item startIcon={<User />} onSelect={onAssign} disabled={!isPublished}>
            {isPublished ? 'Assign course' : 'Assign course (publish first)'}
          </Menu.Item>
        )}
        {perms.canDelete && (
          <Menu.Item startIcon={<Trash />} variant="danger" onSelect={onDelete}>
            Delete course
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

function FilterSelect({ label, value, onChange, items }) {
  return (
    <Box style={{ flex: '1 1 150px' }}>
      <SingleSelect
        aria-label={label}
        placeholder={label}
        value={value || ''}
        onChange={(v) => onChange(v === '__all' ? '' : v)}
        size="S"
      >
        <SingleSelectOption value="__all">{`All ${label.toLowerCase()}`}</SingleSelectOption>
        {items.map((item) => (
          <SingleSelectOption key={item.value} value={item.value}>
            {item.label}
          </SingleSelectOption>
        ))}
      </SingleSelect>
    </Box>
  );
}