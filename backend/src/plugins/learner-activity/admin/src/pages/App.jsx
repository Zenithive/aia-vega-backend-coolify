// @ts-nocheck
/**
 * Quiz Management shell: one header, a tab per area the admin may open, and the routes.
 * Opening the plugin goes to the first tab; tabs with work waiting show a red count.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Layouts, Page } from '@strapi/strapi/admin';
import { Badge, Box, Flex, Tabs } from '@strapi/design-system';
import { api } from '../api';
import { BASE_PATH } from '../pluginId';
import { useActivityPermissions } from '../permissions';
import { SummaryContext } from '../summary';
import { TABS } from '../tabs.jsx';
import AnswerReview from './AnswerReview.jsx';
import ReattemptRequests from './ReattemptRequests.jsx';
import QuizResults from './QuizResults.jsx';

/** Filters that mean the same on every tab and are carried over when switching. */
const SHARED_PARAMS = ['company', 'course', 'version', 'courseId'];

function sharedSearch(search) {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();
  SHARED_PARAMS.forEach((key) => current.get(key) && next.set(key, current.get(key)));
  const qs = next.toString();
  return qs ? `?${qs}` : '';
}

export default function App() {
  const perms = useActivityPermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const [summary, setSummary] = useState({});

  const refresh = useCallback(
    () =>
      api
        .get('/summary')
        .then((s) => setSummary(s || {}))
        .catch(() => {}),
    []
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const summaryValue = useMemo(() => ({ summary, refresh }), [summary, refresh]);

  if (perms.isLoading) return <Page.Loading />;
  const tabs = TABS.filter((t) => perms[t.permission]);
  if (tabs.length === 0) return <Page.NoPermissions />;

  const segment = location.pathname.match(/\/plugins\/learner-activity\/?([^/?]*)/)?.[1] || '';
  const current = tabs.find((t) => t.path === segment) || null;
  const open = (path) => navigate({ pathname: `${BASE_PATH}/${path}`, search: sharedSearch(location.search) });

  return (
    <SummaryContext.Provider value={summaryValue}>
      {/* Own scroll area, one screen high: long pages scroll here and the Strapi menu stays put.
          position: relative keeps the hidden, absolutely positioned parts of inputs inside it,
          otherwise they stretch the document and a second (window) scrollbar appears. */}
      <Box style={{ position: 'relative', height: '100vh', overflowY: 'auto', overflowX: 'hidden' }}>
      <Page.Main>
        <Page.Title>{current ? `${current.label} · Quiz Management` : 'Quiz Management'}</Page.Title>
        <Layouts.Header title="Quiz Management" subtitle={current?.description || ''} />
        <Layouts.Content>
          <Box paddingBottom={10}>
            <Box marginBottom={6}>
              <Tabs.Root variant="simple" value={current?.path || tabs[0].path} onValueChange={open}>
                <Tabs.List aria-label="Quiz Management sections">
                  {tabs.map((t) => {
                    const count = t.countKey ? summary[t.countKey] || 0 : 0;
                    return (
                      <Tabs.Trigger key={t.path} value={t.path}>
                        <Flex gap={2} alignItems="center">
                          {t.label}
                          {count > 0 && (
                            <Badge backgroundColor="danger500" textColor="neutral0">
                              {count > 99 ? '99+' : count}
                            </Badge>
                          )}
                        </Flex>
                      </Tabs.Trigger>
                    );
                  })}
                </Tabs.List>
              </Tabs.Root>
            </Box>

            <Routes>
              <Route index element={<Navigate to={`${BASE_PATH}/${tabs[0].path}${sharedSearch(location.search)}`} replace />} />
              {perms.canReview && <Route path="review" element={<AnswerReview canSave={perms.canReviewUpdate} />} />}
              {perms.canReattempts && <Route path="reattempts" element={<ReattemptRequests />} />}
              {perms.canQuizResults && <Route path="quiz-results" element={<QuizResults />} />}
              <Route path="*" element={<Navigate to={`${BASE_PATH}/${tabs[0].path}`} replace />} />
            </Routes>
          </Box>
        </Layouts.Content>
      </Page.Main>
      </Box>
    </SummaryContext.Provider>
  );
}
