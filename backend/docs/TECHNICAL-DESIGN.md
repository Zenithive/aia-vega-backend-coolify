# UI-LM Portal - Technical Design

## 1. Architecture Overview
- Platform: Strapi v5 backend (Node.js)
- Database: SQLite by default, supports PostgreSQL/MySQL
- Auth: users-permissions plugin (JWT)
- Admin UI: Strapi admin + custom plugins
- Realtime: socket.io via @strapi-community/plugin-io
- Email: Nodemailer provider

## 2. Major Subsystems
### 2.1 Content and Learning APIs (Strapi Content API)
Collection types drive content and learning workflows:
- Courses, Course Assignments, User Progress
- Quiz Submissions, Feedback Submissions
- News, Events, Townhalls, Holidays, Policies, Forms, Gallery
- Companies, Departments, Work Locations

### 2.2 Custom Plugins
- analytics-dashboard: learning + overall analytics endpoints
- audit-log: admin audit trails (currently user-focused)
- profile-edit-requests: admin UI workflow for employee profile changes
- quiz-reattempt-requests: admin UI workflow for quiz reattempt approvals
- modules-sidebar: admin UI sidebar (navigation)

### 2.3 Notification Utility
Centralized notification service (db + email + socket.io). Triggered by:
- Course assigned
- Quiz submitted
- Quiz reattempt requested/approved/rejected
- Feedback submitted
- News liked

## 3. Data Model Highlights
### 3.1 User (plugin::users-permissions.user)
- Company: enum (AIA, Vega)
- Department: string
- AIA-specific fields: branch, photograph, emp_code, ext
- Vega-specific fields: working_location, emp_id, age, employment_type

### 3.2 Course
- Modules (component), Quiz (component), Feedback (component)
- Course category, language, duration, passing score
- Company relation (many-to-many)

### 3.3 Course Assignment
- Target type: Department, Location, Company, Individual
- Auto-expands to per-user assignments for non-Individual targets

### 3.4 User Progress
- Status: Not_started, In_progress, Completed, Failed
- Tracks time, completed modules, certificate issued

### 3.5 Activity Log
- Tracks activity_type (enum), duration (minutes), timestamp
- Company relation used for analytics filtering

## 4. Automated Workflows
### 4.1 Course Assignment -> User Progress
- Lifecycle: course-assignment afterCreate
- Resolves target users by department, company, location, or individual
- Creates user-progress entries with Not_started status
- Creates per-user assignment records for non-Individual targets

### 4.2 Quiz Submission -> Progress Update
- On quiz submission: update user-progress to Failed or In_progress
- Quiz reattempt requests can override attempt limit when approved

### 4.3 Feedback Submission -> Course Complete
- On feedback submission: progress marked Completed + certificate issued

### 4.4 User Create/Update -> Department and Work Location
- Middleware and document hooks ensure Department and Work Location records exist

### 4.5 Component ID Generation
- Course/quiz/feedback components auto-generate stable IDs when missing

## 5. Analytics Pipeline
- Learning analytics aggregate user-progress, quiz submissions, feedback submissions
- Overall analytics aggregate users, holidays, news, townhalls
- Activity tracking uses activity logs with filters for company, department, location

## 6. Security and Access
- Most analytics endpoints are currently public (auth false)
- Activity tracking write endpoint requires JWT
- Admin plugin routes use admin auth
- Production should enable auth for analytics endpoints and configure CORS

## 7. Deployment and Config
- Node.js 20+ required
- Email via SMTP environment variables
- Database client via DATABASE_CLIENT
- Admin URL via ADMIN_URL

## 8. Known Gaps
- Activity type definitions differ between docs and schema (align required)
- Analytics endpoints may require rate limiting in production
- Some logic mixes numeric id and documentId, needs consistent usage strategy

## 9. References
- Analytics setup: ./README.md, ./FRONTEND-INTEGRATION-GUIDE.md
- Activity log flow: ./ACTIVITY-LOG-REAL-DATA-FLOW.md
- Profile edit requests: ./PROFILE-EDIT-REQUEST-INTEGRATION.md
