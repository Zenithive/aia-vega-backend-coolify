// @ts-nocheck
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Page } from '@strapi/strapi/admin';
import CourseList from './CourseList.jsx';
import CourseEditor from './CourseEditor/index.jsx';
import AssignmentList from './Assignments/AssignmentList.jsx';
import AssignmentEditor from './Assignments/AssignmentEditor.jsx';
import { OfflineProofPage, FeedbackPage } from './Activity/index.jsx';
import ScrollArea from '../components/ScrollArea.jsx';

export default function App() {
  return (
    <ScrollArea>
    <Routes>
      <Route index element={<CourseList />} />
      <Route path="new" element={<CourseEditor />} />
      <Route path="assignments" element={<AssignmentList />} />
      <Route path="assignments/new" element={<AssignmentEditor />} />
      <Route path="assignments/:documentId" element={<AssignmentEditor />} />
      <Route path="offline" element={<OfflineProofPage />} />
      <Route path="feedback" element={<FeedbackPage />} />
      <Route path=":documentId" element={<CourseEditor />} />
      <Route path="*" element={<Page.Error />} />
    </Routes>
    </ScrollArea>
  );
}
