// @ts-nocheck
/**
 * Offline Assessments: pick a course and one of its offline modules, then upload each
 * learner's practical-test proof. Saving proof completes the module for that learner and
 * unlocks their next module.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFetchClient, useNotification, useStrapiApp } from '@strapi/strapi/admin';
import {
  Box,
  Flex,
  Typography,
  Button,
  SingleSelect,
  SingleSelectOption,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Loader,
  Modal,
  Textarea,
  Field,
  Searchbar,
  EmptyStateLayout,
  IconButton,
} from '@strapi/design-system';
import { Upload, Trash, File as FileIcon, CheckCircle, WarningCircle } from '@strapi/icons';
import { PLUGIN_ID } from '../../pluginId';

const base = `/${PLUGIN_ID}/offline`;

const STATUS = {
  ready: { label: 'Ready for assessment', variant: 'warning' },
  locked: { label: 'Earlier modules pending', variant: 'neutral' },
  completed: { label: 'Completed', variant: 'success' },
  mismatch: { label: 'Not offline in learner language', variant: 'danger' },
};

/** Learner's overall status for the course (user-progress.progress_status). */
const COURSE_STATUS = {
  Not_started: { label: 'Not started', variant: 'neutral' },
  In_progress: { label: 'In progress', variant: 'secondary' },
  Completed: { label: 'Completed', variant: 'success' },
  Failed: { label: 'Failed', variant: 'danger' },
};

function errorMessage(err) {
  return err?.response?.data?.error?.message || err?.message || 'Something went wrong';
}

function fileUrl(file) {
  const url = file?.url || '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${window.strapi?.backendURL || ''}${url}`;
}

function learnerName(user) {
  return user?.username || user?.email || `User #${user?.id}`;
}

function ProofDialog({ learner, open, saving, onClose, onSave }) {
  const [files, setFiles] = useState([]);
  const [remarks, setRemarks] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const components = useStrapiApp('OfflineAssessmentsProof', (state) => state.components);
  const MediaLibraryDialog = components?.['media-library'];

  useEffect(() => {
    if (open) {
      setFiles(learner?.completion?.proof || []);
      setRemarks(learner?.completion?.remarks || '');
    }
  }, [open, learner]);

  return (
    <>
      <Modal.Root open={open && !pickerOpen} onOpenChange={(o) => !o && onClose()}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{`Completion proof — ${learnerName(learner?.user)}`}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={5}>
              <Typography textColor="neutral700">
                {`Attach the result of the practical assessment for "${learner?.module_title || 'this module'}". Saving marks the module completed for this learner and unlocks the next module. Saved proof cannot be changed or removed later.`}
              </Typography>
              <Box>
                <Typography variant="pi" fontWeight="bold">
                  Proof files *
                </Typography>
                <Flex direction="column" alignItems="stretch" gap={2} marginTop={2}>
                  {files.length === 0 && (
                    <Box padding={4} hasRadius background="neutral100">
                      <Typography textColor="neutral600">No file attached yet (PDF, document, image or video).</Typography>
                    </Box>
                  )}
                  {files.map((f) => (
                    <Flex key={f.id} gap={3} padding={2} hasRadius borderColor="neutral200" borderStyle="solid" borderWidth="1px">
                      <FileIcon />
                      <Box flex="1">
                        <a href={fileUrl(f)} target="_blank" rel="noreferrer">
                          <Typography>{f.name || `File #${f.id}`}</Typography>
                        </a>
                      </Box>
                      <IconButton label="Remove file" variant="ghost" onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>
                        <Trash />
                      </IconButton>
                    </Flex>
                  ))}
                </Flex>
                <Box marginTop={2}>
                  <Button variant="secondary" startIcon={<Upload />} onClick={() => setPickerOpen(true)} disabled={!MediaLibraryDialog}>
                    Upload or choose files
                  </Button>
                </Box>
              </Box>
              <Field.Root name="remarks" hint="Optional — e.g. assessor observations or score.">
                <Field.Label>Remarks</Field.Label>
                <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                <Field.Hint />
              </Field.Root>
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">Cancel</Button>
            </Modal.Close>
            <Button loading={saving} disabled={files.length === 0} onClick={() => onSave({ files, remarks })}>
              Save and complete module
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
      {pickerOpen && MediaLibraryDialog && (
        <MediaLibraryDialog
          multiple
          allowedTypes={['files', 'images', 'videos', 'audios']}
          onClose={() => setPickerOpen(false)}
          onSelectAssets={(assets) => {
            const picked = (assets || []).filter(Boolean);
            const ids = new Set(files.map((f) => f.id));
            setFiles([...files, ...picked.filter((a) => !ids.has(a.id))]);
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}

export default function OfflineAssessments({ canSave }) {
  const { toggleNotification } = useNotification();
  const [courses, setCourses] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [moduleIndex, setModuleIndex] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const course = useMemo(() => (courses || []).find((c) => c.documentId === courseId), [courses, courseId]);

  useEffect(() => {
    getFetchClient()
      .get(`${base}/courses`)
      .then((res) => {
        const list = res.data.data || [];
        setCourses(list);
        // Nothing to choose when there is only one course (and one offline module).
        if (list.length === 1) {
          setCourseId(list[0].documentId);
          if (list[0].offlineModules?.length === 1) setModuleIndex(String(list[0].offlineModules[0].index));
        }
      })
      .catch((e) => {
        setCourses([]);
        toggleNotification({ type: 'danger', message: errorMessage(e) });
      });
  }, [toggleNotification]);

  const loadLearners = useCallback(async () => {
    if (!courseId || moduleIndex === '') return;
    setLoading(true);
    try {
      const res = await getFetchClient().get(`${base}/courses/${courseId}/learners?moduleIndex=${moduleIndex}`);
      setData(res.data.data);
    } catch (e) {
      setData(null);
      toggleNotification({ type: 'danger', message: errorMessage(e) });
    } finally {
      setLoading(false);
    }
  }, [courseId, moduleIndex, toggleNotification]);

  useEffect(() => {
    loadLearners();
  }, [loadLearners]);

  const save = async ({ files, remarks }) => {
    setBusy(true);
    try {
      await getFetchClient().post(`${base}/completions`, {
        courseDocumentId: courseId,
        moduleIndex: Number(moduleIndex),
        userId: editing.user.id,
        proof: files.map((f) => f.id),
        remarks,
      });
      toggleNotification({ type: 'success', message: `${learnerName(editing.user)} completed "${editing.module_title}"` });
      setEditing(null);
      await loadLearners();
    } catch (e) {
      toggleNotification({ type: 'danger', message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const learners = (data?.learners || []).filter((l) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [l.user?.username, l.user?.email, l.user?.emp_code, l.user?.emp_id, l.user?.company]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
  const counts = (data?.learners || []).reduce((acc, l) => ({ ...acc, [l.status]: (acc[l.status] || 0) + 1 }), {});

  return (
    <>
      <>
        {!canSave && (
          <Box padding={4} marginBottom={4} hasRadius background="warning100" borderColor="warning200" borderStyle="solid" borderWidth="1px">
            <Typography fontWeight="bold" textColor="warning700" tag="p">
              You can see learners here, but your role cannot upload proof.
            </Typography>
            <Typography textColor="neutral800">
              A Super Admin can allow it in Settings → Roles → your role → Collection types → Offline Module Completion → tick “Update”.
            </Typography>
          </Box>
        )}
        <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} marginBottom={4}>
          <Flex gap={3} wrap="wrap" alignItems="flex-end">
            <Box style={{ flex: '2 1 280px' }}>
              <Field.Root name="course">
                <Field.Label>Course</Field.Label>
                <SingleSelect
                  placeholder={courses === null ? 'Loading…' : courses.length ? 'Choose a course' : 'No published course has offline modules'}
                  value={courseId}
                  onChange={(v) => {
                    setCourseId(v);
                    const c = (courses || []).find((x) => x.documentId === v);
                    setModuleIndex(c?.offlineModules?.length === 1 ? String(c.offlineModules[0].index) : '');
                    setData(null);
                  }}
                >
                  {(courses || []).map((c) => (
                    <SingleSelectOption key={c.documentId} value={c.documentId}>
                      {`${c.title}${c.course_version ? ` (v${c.course_version})` : ''}`}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>
            <Box style={{ flex: '2 1 240px' }}>
              <Field.Root name="module">
                <Field.Label>Offline module</Field.Label>
                <SingleSelect
                  placeholder={course ? 'Choose a module' : 'Choose a course first'}
                  disabled={!course}
                  value={moduleIndex}
                  onChange={(v) => setModuleIndex(String(v))}
                >
                  {(course?.offlineModules || []).map((m) => (
                    <SingleSelectOption key={m.index} value={String(m.index)}>
                      {`Module ${m.position} — ${m.title || 'Untitled'}`}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>
            <Box style={{ flex: '1 1 220px' }}>
              <Searchbar
                name="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
                clearLabel="Clear"
                placeholder="Search learner, code or company"
              >
                Search learners
              </Searchbar>
            </Box>
          </Flex>
          {data && (
            <Flex gap={2} marginTop={3} wrap="wrap">
              <Badge variant="warning">{`${counts.ready || 0} ready for assessment`}</Badge>
              <Badge>{`${counts.locked || 0} still on earlier modules`}</Badge>
              <Badge variant="success">{`${counts.completed || 0} completed`}</Badge>
            </Flex>
          )}
        </Box>

        {!courseId || moduleIndex === '' ? (
          <Box background="neutral0" hasRadius shadow="tableShadow">
            <EmptyStateLayout icon={<CheckCircle width="64px" height="64px" />} content="Choose a course and an offline module to see its learners." />
          </Box>
        ) : loading && !data ? (
          <Flex justifyContent="center" padding={10}>
            <Loader>Loading learners…</Loader>
          </Flex>
        ) : learners.length === 0 ? (
          <Box background="neutral0" hasRadius shadow="tableShadow">
            <EmptyStateLayout
              icon={<WarningCircle width="64px" height="64px" />}
              content={search ? 'No learner matches your search.' : 'No learner is assigned to this course yet.'}
            />
          </Box>
        ) : (
          <Table colCount={6} rowCount={learners.length + 1}>
            <Thead>
              <Tr>
                <Th><Typography variant="sigma">Learner</Typography></Th>
                <Th><Typography variant="sigma">Company</Typography></Th>
                <Th><Typography variant="sigma">Course status</Typography></Th>
                <Th><Typography variant="sigma">Module status</Typography></Th>
                <Th><Typography variant="sigma">Proof</Typography></Th>
                <Th><Typography variant="sigma">Upload proof</Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {learners.map((l) => {
                const meta = STATUS[l.status] || STATUS.locked;
                // An entry is created on assignment without proof; only uploaded files count as proof.
                const hasProof = (l.completion?.proof || []).length > 0;
                return (
                  <Tr key={l.user.id}>
                    <Td>
                      <Flex direction="column" alignItems="flex-start">
                        <Typography fontWeight="bold">{learnerName(l.user)}</Typography>
                        <Typography variant="pi" textColor="neutral600">
                          {[l.user.emp_code, l.user.emp_id, l.user.email].filter(Boolean).join(' · ') || '—'}
                        </Typography>
                      </Flex>
                    </Td>
                    <Td><Typography>{l.user.company || '—'}</Typography></Td>
                    <Td>
                      <Badge variant={(COURSE_STATUS[l.progress_status] || COURSE_STATUS.Not_started).variant}>
                        {(COURSE_STATUS[l.progress_status] || COURSE_STATUS.Not_started).label}
                      </Badge>
                    </Td>
                    <Td>
                      <Flex direction="column" alignItems="flex-start" gap={1}>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {l.status === 'locked' && l.pending_modules_before > 0 && (
                          <Typography variant="pi" textColor="neutral600">
                            {`${l.pending_modules_before} earlier module${l.pending_modules_before === 1 ? '' : 's'} to finish`}
                          </Typography>
                        )}
                      </Flex>
                    </Td>
                    <Td>
                      {hasProof ? (
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          {(l.completion.proof || []).map((f) => (
                            <a key={f.id} href={fileUrl(f)} target="_blank" rel="noreferrer">
                              <Typography variant="pi">{f.name}</Typography>
                            </a>
                          ))}
                          <Typography variant="pi" textColor="neutral600">
                            {[l.completion.assessed_by, l.completion.completed_at && new Date(l.completion.completed_at).toLocaleDateString()]
                              .filter(Boolean)
                              .join(' · ')}
                          </Typography>
                        </Flex>
                      ) : (
                        <Typography textColor="neutral500">No proof yet</Typography>
                      )}
                    </Td>
                    <Td>
                      {l.status === 'mismatch' ? (
                        <Typography variant="pi" textColor="neutral600">
                          {`Not needed: in ${l.selected_language || 'this learner’s'} language this module is online.`}
                        </Typography>
                      ) : hasProof ? (
                        // Submitted proof is final: it cannot be replaced or removed.
                        <Badge variant="success">Submitted</Badge>
                      ) : !canSave ? (
                        <Typography variant="pi" textColor="neutral600">View only</Typography>
                      ) : (
                        <Button size="S" startIcon={<Upload />} onClick={() => setEditing(l)}>
                          Upload proof
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </>

      <ProofDialog learner={editing} open={!!editing} saving={busy} onClose={() => setEditing(null)} onSave={save} />
    </>
  );
}
