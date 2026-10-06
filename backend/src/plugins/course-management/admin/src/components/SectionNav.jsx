// @ts-nocheck
/**
 * "Courses | Assignments | Offline module proof | Feedback | Quiz management" switcher under
 * the page header: the course workflow in order — build the course, give it to learners,
 * complete offline modules, read feedback. Quiz follow-up (answer review, reattempts, quiz
 * results) lives in the Quiz Management plugin.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Tabs } from '@strapi/design-system';
import { BASE_PATH, QUIZ_MANAGEMENT_PATH } from '../pluginId';
import { useCoursePermissions, useAssignmentPermissions, useActivityPermissions } from '../utils/usePermissions';

export default function SectionNav({ current }) {
  const navigate = useNavigate();
  const coursePerms = useCoursePermissions();
  const assignmentPerms = useAssignmentPermissions();
  const activityPerms = useActivityPermissions();
  if (coursePerms.isLoading || assignmentPerms.isLoading || activityPerms.isLoading) return null;

  const tabs = [
    coursePerms.canRead && { value: 'courses', label: 'Courses', to: BASE_PATH },
    assignmentPerms.canRead && { value: 'assignments', label: 'Assignments', to: `${BASE_PATH}/assignments` },
    activityPerms.canOffline && { value: 'offline', label: 'Offline module proof', to: `${BASE_PATH}/offline` },
    activityPerms.canFeedback && { value: 'feedback', label: 'Feedback', to: `${BASE_PATH}/feedback` },
    { value: 'quiz', label: 'Quiz management', to: QUIZ_MANAGEMENT_PATH },
  ]
    .filter(Boolean)
    .map((t, i) => ({ ...t, label: `${i + 1}. ${t.label}` }));

  return (
    <Box marginBottom={4}>
      <Tabs.Root variant="simple" value={current} onValueChange={(v) => navigate(tabs.find((t) => t.value === v).to)}>
        <Tabs.List aria-label="Course Management sections">
          {tabs.map((t) => (
            <Tabs.Trigger key={t.value} value={t.value}>
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
    </Box>
  );
}
