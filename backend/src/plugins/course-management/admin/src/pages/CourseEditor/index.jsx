// @ts-nocheck
/**
 * Guided course editor: Basics → Modules (with module quizzes) → Feedback → Review & publish.
 *
 * Every action has exactly one place, so non-technical admins never have to choose between
 * two buttons that do the same thing: Save draft (or Edit, for a live course) in the header,
 * Publish in Review & publish. New version, assign and delete live in the course list.
 *
 * Saves go to the plugin API, which writes the existing Course document. Published courses
 * are read-only for good: publishing is confirmed first, and later changes go into a new version
 * (unpublishing would cut every learner record off the course).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Layouts, Page, useNotification } from '@strapi/strapi/admin';
import { Box, Flex, Typography, Button, Grid, TextButton, Divider } from '@strapi/design-system';
import { ArrowLeft, ArrowRight, Check, CheckCircle, WarningCircle } from '@strapi/icons';
import { api } from '../../api';
import { BASE_PATH, COURSE_UID } from '../../pluginId';
import { useCoursePermissions } from '../../utils/usePermissions';
import {
  STEPS,
  toForm,
  toPayload,
  newCourseForm,
  validateCourse,
  describeServerError,
  stepForPath,
  emptyModule,
  emptyFeedback,
  newKey,
  isBlank,
  isBlankHtml,
  formatDate,
} from '../../utils/course';
import { StatusBadge, Callout, ConfirmDialog } from '../../components/ui.jsx';
import { scrollToTop } from '../../components/ScrollArea.jsx';
import BasicsStep from './BasicsStep.jsx';
import ModulesStep from './ModulesStep.jsx';
import FeedbackStep from './FeedbackStep.jsx';
import ReviewStep from './ReviewStep.jsx';

const snapshot = (form) => (form ? JSON.stringify(toPayload(form)) : '');

function moduleHasContent(m) {
  return (
    m &&
    (!isBlank(m.title) || (m.video_file || []).length || (m.pdf_file || []).length || !isBlankHtml(m.text_content) || m.quiz)
  );
}

function Stepper({ step, onChange, issues }) {
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" padding={2}>
      <Flex direction="column" alignItems="stretch" gap={1} tag="nav" aria-label="Course editor steps">
        {STEPS.map((s) => {
          const active = s.id === step;
          const stepIssues = issues.filter((i) => i.step === s.id);
          const errors = stepIssues.filter((i) => i.severity === 'error').length;
          const warnings = stepIssues.length - errors;
          const isReview = s.id === 'review';

          return (
            <Box
              key={s.id}
              tag="button"
              type="button"
              onClick={() => onChange(s.id)}
              aria-current={active ? 'step' : undefined}
              padding={3}
              hasRadius
              background={active ? 'primary100' : 'transparent'}
              style={{ textAlign: 'left', cursor: 'pointer', border: 'none', width: '100%' }}
            >
              <Flex gap={3} alignItems="center" justifyContent="space-between">
                <Flex direction="column" alignItems="flex-start" flex="1" style={{ minWidth: 0 }}>
                  <Typography fontWeight="bold" textColor={active ? 'primary700' : 'neutral800'}>
                    {s.label}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" ellipsis>
                    {s.description}
                  </Typography>
                </Flex>

                {!isReview &&
                  (errors > 0 ? (
                    <Flex gap={1} alignItems="center" shrink={0}>
                      <WarningCircle fill="danger600" width="16px" height="16px" />
                      <Typography variant="pi" fontWeight="bold" textColor="danger600">
                        {errors}
                      </Typography>
                    </Flex>
                  ) : warnings > 0 ? (
                    <Flex shrink={0}>
                      <WarningCircle fill="warning600" width="16px" height="16px" />
                    </Flex>
                  ) : (
                    <Flex shrink={0}>
                      <CheckCircle fill="success600" width="16px" height="16px" />
                    </Flex>
                  ))}
              </Flex>
            </Box>
          );
        })}
      </Flex>
    </Box>
  );
}

export default function CourseEditor() {
  const { documentId } = useParams();
  const isNew = !documentId;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toggleNotification } = useNotification();
  const perms = useCoursePermissions();

  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [meta, setMeta] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [serverIssues, setServerIssues] = useState([]);
  const [pendingLanguages, setPendingLanguages] = useState(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const allowNavigationRef = useRef(false);

  const step = STEPS.some((s) => s.id === searchParams.get('step')) ? searchParams.get('step') : 'basics';
  const goTo = useCallback(
    (id) => {
      const next = new URLSearchParams(searchParams);
      next.set('step', id);
      setSearchParams(next, { replace: true });
      scrollToTop();
    },
    [searchParams, setSearchParams]
  );

  /* ------------------------------------------------------------- load */

  const applyResponse = useCallback((res, opts) => {
    const next = toForm(res.data, opts);
    setForm(next);
    setSavedSnapshot(snapshot(next));
    setMeta(res.meta || null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setForm(null);
    (async () => {
      try {
        const [opts, course] = await Promise.all([api.options(), isNew ? null : api.get(documentId)]);
        if (cancelled) return;
        setOptions(opts.data);
        if (course) {
          applyResponse(course, opts.data);
        } else {
          const blank = newCourseForm(opts.data);
          setForm(blank);
          setSavedSnapshot(snapshot(blank));
          setMeta(null);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, isNew, applyResponse]);

  /* ------------------------------------------------------------- derived state */

  const status = meta?.status || 'draft';
  const isPublished = !isNew && status !== 'draft';
  const readOnly = isPublished || (isNew ? !perms.canCreate : !perms.canUpdate);
  const dirty = useMemo(() => !!form && snapshot(form) !== savedSnapshot, [form, savedSnapshot]);
  const clientIssues = useMemo(() => (form ? validateCourse(form, options?.limits) : []), [form, options]);
  const issues = useMemo(() => [...serverIssues, ...clientIssues], [serverIssues, clientIssues]);
  const blockingErrors = clientIssues.filter((i) => i.severity === 'error');

  const update = useCallback((patch) => {
    setForm((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
    setServerIssues([]);
  }, []);

  /* ------------------------------------------------------------- unsaved changes guard */

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        dirtyRef.current && !allowNavigationRef.current && currentLocation.pathname !== nextLocation.pathname,
      []
    )
  );

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const navigateAway = (to, opts) => {
    allowNavigationRef.current = true;
    navigate(to, opts);
    setTimeout(() => {
      allowNavigationRef.current = false;
    }, 0);
  };

  /* ------------------------------------------------------------- languages */

  const orderLanguages = (list) => {
    const all = options?.languages || [];
    return [...list].sort((a, b) => {
      const ia = all.indexOf(a);
      const ib = all.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  };

  const applyLanguages = (nextRaw) => {
    const next = orderLanguages(nextRaw);
    update((prev) => {
      const prevLangs = prev.course_language || [];
      const removed = prevLangs.filter((l) => !next.includes(l));
      const added = next.filter((l) => !prevLangs.includes(l));

      let blocks = (prev.moduleBlocks || []).map((block) => {
        const byLang = { ...block.byLang };
        removed.forEach((l) => delete byLang[l]);
        const template = Object.values(byLang)[0] || {};
        added.forEach((l) => {
          if (!byLang[l]) byLang[l] = emptyModule(l, template);
        });
        return { ...block, byLang };
      });
      blocks = blocks.filter((b) => Object.keys(b.byLang).length > 0);
      if (blocks.length === 0 && next.length > 0) {
        blocks = [{ key: newKey('blk'), byLang: Object.fromEntries(next.map((l) => [l, emptyModule(l)])) }];
      }

      return {
        course_language: next,
        moduleBlocks: blocks,
        feedback: (() => {
          const kept = (prev.feedback || []).filter((f) => !removed.includes(f.language));
          // Feedback is asked once for the whole course: new languages get the same form.
          if (!kept.length) return kept;
          const { feedback_template, compulsory } = kept[0];
          return [...kept, ...added.filter((l) => !kept.some((f) => f.language === l)).map((l) => ({ ...emptyFeedback(l), feedback_template, compulsory }))];
        })(),
      };
    });
  };

  const handleLanguagesChange = (nextRaw) => {
    const removed = (form.course_language || []).filter((l) => !nextRaw.includes(l));
    const losesContent = removed.some(
      (l) =>
        (form.moduleBlocks || []).some((b) => moduleHasContent(b.byLang[l])) ||
        (form.feedback || []).some((f) => f.language === l)
    );
    if (losesContent) setPendingLanguages({ next: nextRaw, removed });
    else applyLanguages(nextRaw);
  };

  /* ------------------------------------------------------------- actions */

  const handleServerError = (e, payload) => {
    const details = e.details?.errors;
    if (Array.isArray(details) && details.length) {
      const mapped = details.map((d) => ({
        step: stepForPath(d.path),
        message: describeServerError(d, payload),
        severity: 'error',
        server: true,
      }));
      setServerIssues(mapped);
      goTo('review');
      toggleNotification({ type: 'danger', message: `${mapped.length} problem${mapped.length === 1 ? '' : 's'} found — see the list below.` });
    } else {
      toggleNotification({ type: 'danger', message: e.message });
    }
  };

  const save = async ({ silent = false } = {}) => {
    if (isBlank(form.title) || isBlank(form.course_version)) {
      goTo('basics');
      toggleNotification({ type: 'warning', message: 'Add a course title and version before saving.' });
      return null;
    }
    setBusy('save');
    setServerIssues([]);
    const payload = toPayload(form);
    try {
      const res = isNew ? await api.create(payload) : await api.update(documentId, payload);
      applyResponse(res, options);
      if (!silent) toggleNotification({ type: 'success', message: isNew ? 'Course created as a draft' : 'Draft saved' });
      if (isNew) navigateAway(`${BASE_PATH}/${res.data.documentId}?step=${step}`, { replace: true });
      return res;
    } catch (e) {
      handleServerError(e, payload);
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** Checks first, then asks for confirmation: a published course can no longer be edited. */
  const requestPublish = () => {
    if (blockingErrors.length) {
      goTo('review');
      toggleNotification({
        type: 'warning',
        message: `Fix ${blockingErrors.length} item${blockingErrors.length === 1 ? '' : 's'} before publishing.`,
      });
      return;
    }
    setConfirmPublish(true);
  };

  const publish = async () => {
    if (dirty) {
      const saved = await save({ silent: true });
      if (!saved) return;
    }
    setBusy('publish');
    try {
      const res = await api.publish(documentId);
      applyResponse(res, options);
      setConfirmPublish(false);
      toggleNotification({ type: 'success', message: 'Course published. Assigned learners can now access it.' });
    } catch (e) {
      handleServerError(e, toPayload(form));
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------------------------------------- render */

  if (perms.isLoading) return <Page.Loading />;
  if (!perms.canRead) return <Page.NoPermissions />;
  if (loadError) {
    return loadError.status === 404 ? (
      <Page.Error content="This course does not exist or was deleted." />
    ) : (
      <Page.Error content={loadError.message} />
    );
  }
  if (!form || !options) return <Page.Loading />;
  if (isNew && !perms.canCreate) return <Page.NoPermissions />;

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const prevStep = STEPS[stepIndex - 1];
  const nextStep = STEPS[stepIndex + 1];
  const stepIssues = issues.filter((i) => i.step === step);
  const stepProps = { form, update, options, readOnly, issues: stepIssues, onGoTo: goTo };

  const headerActions = (
    <Flex gap={2}>
      {!readOnly && (
        <Button startIcon={<Check />} onClick={() => save()} loading={busy === 'save'} disabled={!dirty && !isNew}>
          {isNew || dirty ? 'Save draft' : 'Saved'}
        </Button>
      )}

    </Flex>
  );

  return (
    <Page.Main>
      <Page.Title>{form.title || 'New course'}</Page.Title>
      <Layouts.Header
        navigationAction={
          <TextButton startIcon={<ArrowLeft />} onClick={() => navigate(BASE_PATH)}>
            All courses
          </TextButton>
        }
        title={form.title || 'New course'}
        subtitle={
          <Flex gap={3} wrap="wrap" alignItems="center" paddingTop={1}>
            {isNew ? <Typography textColor="neutral600">Not saved yet</Typography> : <StatusBadge status={status} />}
            {isPublished && (
              <Typography variant="pi" textColor="neutral600">
                · Locked (live)
              </Typography>
            )}
            {form.course_version && <Typography textColor="neutral600">{`Version ${form.course_version}`}</Typography>}
            {meta?.publishedAt && <Typography textColor="neutral600">{`Published ${formatDate(meta.publishedAt)}`}</Typography>}
            {dirty && !readOnly && (
              <Typography textColor="warning600" fontWeight="bold">
                Unsaved changes
              </Typography>
            )}
          </Flex>
        }
        primaryAction={headerActions}
      />
      <Layouts.Content>
        {isPublished && (
          <Callout variant="neutral" title="This course is live and locked">
            Published courses cannot be edited. To make changes, use "Create new version" in the course list, then
            assign the new version.
          </Callout>
        )}
        {!isPublished && readOnly && (
          <Callout variant="warning" title="View only">
            Your role can view courses but not edit them.
          </Callout>
        )}

        <Grid.Root gap={6}>
          <Grid.Item col={3} s={12} direction="column" alignItems="stretch">
            <Box style={{ position: 'sticky', top: 16 }}>
              <Stepper step={step} onChange={goTo} issues={issues} />
            </Box>
          </Grid.Item>
          <Grid.Item col={9} s={12} direction="column" alignItems="stretch">
            {serverIssues.length > 0 && step !== 'review' && stepIssues.some((i) => i.server) && (
              <Callout variant="danger" title="The server rejected some values">
                {stepIssues.filter((i) => i.server).map((i) => i.message).join(' · ')}
              </Callout>
            )}

            {step === 'basics' && <BasicsStep {...stepProps} onLanguagesChange={handleLanguagesChange} />}
            {step === 'modules' && <ModulesStep {...stepProps} />}
            {step === 'feedback' && <FeedbackStep {...stepProps} />}
            {step === 'review' && (
              <ReviewStep
                form={form}
                issues={issues}
                meta={meta}
                isNew={isNew}
                readOnly={readOnly}
                documentId={documentId}
                canPublish={perms.canPublish}
                publishing={busy === 'publish'}
                onPublish={requestPublish}
                onGoTo={goTo}
              />
            )}

            <Divider marginTop={2} marginBottom={4} />
            <Flex justifyContent="space-between">
              {prevStep ? (
                <Button variant="tertiary" startIcon={<ArrowLeft />} onClick={() => goTo(prevStep.id)}>
                  {prevStep.label}
                </Button>
              ) : (
                <span />
              )}
              {nextStep && (
                <Button variant="secondary" endIcon={<ArrowRight />} onClick={() => goTo(nextStep.id)}>
                  {`Next: ${nextStep.label}`}
                </Button>
              )}
            </Flex>
          </Grid.Item>
        </Grid.Root>
      </Layouts.Content>

      <ConfirmDialog
        open={!!pendingLanguages}
        title="Remove language?"
        confirmLabel="Remove content"
        onClose={() => setPendingLanguages(null)}
        onConfirm={() => {
          applyLanguages(pendingLanguages.next);
          setPendingLanguages(null);
        }}
      >
        {pendingLanguages &&
          `The ${pendingLanguages.removed.join(' and ')} version of the modules, quiz and feedback will be removed when you save.`}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmPublish}
        title="Publish this course?"
        confirmLabel="Yes, publish"
        variant="default"
        loading={busy === 'publish' || busy === 'save'}
        onClose={() => setConfirmPublish(false)}
        onConfirm={publish}
      >
        Once published, this course is locked and can no longer be edited or unpublished. Check the content, quizzes
        and feedback now. To change it later, use "Create new version" in the course list.
      </ConfirmDialog>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        confirmLabel="Discard changes"
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      >
        You have unsaved changes. If you leave now, they will be lost.
      </ConfirmDialog>
    </Page.Main>
  );
}
