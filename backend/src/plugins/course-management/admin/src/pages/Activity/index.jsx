// @ts-nocheck
/**
 * Course follow-up tabs of Course Management: offline module proof and feedback.
 * Each gets the plugin header and section tabs, and checks its own permission.
 */
import React from 'react';
import { Layouts, Page } from '@strapi/strapi/admin';
import { useActivityPermissions } from '../../utils/usePermissions';
import SectionNav from '../../components/SectionNav.jsx';
import OfflineAssessments from './OfflineAssessments.jsx';
import Feedback from './Feedback.jsx';

function ActivityPage({ tab, title, subtitle, allowed, isLoading, children }) {
  if (isLoading) return <Page.Loading />;
  if (!allowed) return <Page.NoPermissions />;
  return (
    <Page.Main>
      <Page.Title>{`${title} · Course Management`}</Page.Title>
      <Layouts.Header title="Course Management" subtitle={subtitle} />
      <Layouts.Content>
        <SectionNav current={tab} />
        {children}
      </Layouts.Content>
    </Page.Main>
  );
}

export function OfflineProofPage() {
  const perms = useActivityPermissions();
  return (
    <ActivityPage
      tab="offline"
      title="Offline module proof"
      subtitle="Upload each learner’s proof for an offline module. Saving it completes the module and unlocks the next one."
      allowed={perms.canOffline}
      isLoading={perms.isLoading}
    >
      <OfflineAssessments canSave={perms.canOfflineUpdate} />
    </ActivityPage>
  );
}

export function FeedbackPage() {
  const perms = useActivityPermissions();
  return (
    <ActivityPage
      tab="feedback"
      title="Feedback"
      subtitle="See what learners said about a course: each learner’s answers."
      allowed={perms.canFeedback}
      isLoading={perms.isLoading}
    >
      <Feedback />
    </ActivityPage>
  );
}
