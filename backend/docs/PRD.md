# UI-LM Portal - Product Requirements Document (PRD)

## 1. Overview
UI-LM Portal is an internal learning and communication portal for two companies (AIA and Vega). It combines:
- Learning management (courses, modules, quizzes, feedback, assignments, progress)
- Company communications (news, events, townhalls, holidays, policies, forms, gallery, important links)
- Admin workflows (profile edit requests, quiz reattempt approvals)
- Analytics dashboards (learning + overall engagement)
- Activity tracking (portal usage by page/type)

This PRD is derived from the current backend implementation and existing integration docs.

## 2. Problem Statement
Teams need a single portal to publish learning content and company updates, track employee progress, and provide HR/LM admin workflows without relying on multiple disparate tools.

## 3. Goals
- Provide a unified portal for content and learning consumption.
- Enable structured learning assignments and measurable progress.
- Support HR/LM admin workflows for profile updates and quiz reattempts.
- Provide analytics on learning outcomes and portal engagement.
- Support company-specific segmentation (AIA vs Vega).

## 4. Non-Goals
- Replacing SSO/LDAP (future integration only).
- Real-time chat or social features beyond notifications.
- Full LMS certification management outside course completion flags.

## 5. Personas
- Employee: consumes learning and company content; requests profile edits; requests quiz reattempts.
- HR Admin: manages employee profile changes and content.
- LM Admin: manages courses, assignments, quizzes, analytics.
- Admin/Super Admin: platform configuration, permissions, and system health.

## 6. Scope and Features
### 6.1 Learning
- Course authoring with modules, quiz, feedback, prerequisites.
- Course assignment by Department, Company, Work Location, or Individual.
- Automatic user-progress creation on assignment.
- Quiz submission with attempt limits and reattempt request workflow.
- Feedback submission after quiz completion to finalize course.
- Module video progress tracking.

### 6.2 Company Content
- News (with likes), events, townhalls (video/PDF), holidays.
- Company policies, important links, forms/templates, gallery.
- Company and department records to support filtering.

### 6.3 Analytics
- Learning analytics: completion, status, time spent, quiz stats, drop-off.
- Overall analytics: content counts, activity and engagement by company.
- Activity tracking dashboards (time by page/type, logs, KPIs).
- Employee learning summary table with export.

### 6.4 Admin Workflows
- Profile edit requests (employee -> HR approval -> auto-apply changes).
- Quiz reattempt requests (employee -> LM/HR approval -> status updates).
- Audit log for admin changes (currently focused on users).

### 6.5 Notifications
- Notifications recorded in DB and optionally sent via email and socket.io.
- Triggered by course assignment, quiz submissions, reattempt approvals, feedback submissions, news likes.

## 7. Success Metrics
- % of employees with active progress in at least one course per month.
- Course completion rate and average time spent.
- Engagement metrics: activity log visits per user per month.
- Time-to-approval for profile edit and quiz reattempt requests.

## 8. Functional Requirements (Selected)
- Authentication: JWT-based for portal users.
- Role-based access for admin dashboards and plugin pages.
- Company segregation for content visibility and analytics filters.
- Stable, consistent IDs for component structures in course content.
- Activity tracking endpoint that records user + company from JWT.

## 9. Risks and Open Questions
- Activity tracking type definitions differ between docs and schema; align on a single enumeration.
- Analytics endpoints are currently public (auth false); production requires auth.
- Some logic uses numeric IDs and documentIds; ensure consistency across environments.

## 10. References
- Analytics and integration docs: ./README.md, ./FRONTEND-INTEGRATION-GUIDE.md
- Profile edit workflow: ./PROFILE-EDIT-REQUEST-INTEGRATION.md
- Activity tracking flow: ./ACTIVITY-LOG-REAL-DATA-FLOW.md
