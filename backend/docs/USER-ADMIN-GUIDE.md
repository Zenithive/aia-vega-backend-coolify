# UI-LM Portal - User and Admin Guide

## 1. Quick Start (Backend)
1) npm install
2) npm run build
3) npm run develop
4) Open admin: http://localhost:1337/admin

## 2. Roles and Access
- Employee: portal user (users-permissions)
- HR Admin: reviews profile edit requests, manages employee info
- LM Admin: manages courses, assignments, learning analytics
- Admin/Super Admin: full system configuration

Grant access to Analytics Dashboard in Strapi Admin:
Settings -> Administration Panel -> Roles -> Permissions -> Plugins -> Analytics Dashboard

## 3. Content Management
### 3.1 News, Events, Townhalls, Holidays
- Create items in Content Manager
- Use company relations for segmentation (AIA, Vega)
- News supports likes by users

### 3.2 Policies, Forms, Important Links, Gallery
- Create items in Content Manager
- Use company relations for segmentation

## 4. Learning Management
### 4.1 Create Courses
- Add modules, quiz, and feedback components
- Set course duration and passing score
- Assign course language(s)

### 4.2 Assign Courses
- Use Course Assignments to target Department, Company, Location, or Individual
- Assignment triggers automatic user-progress creation

### 4.3 Monitor Progress
- User Progress records track status, time, and certificates
- Quiz submissions update progress to Failed or In_progress
- Feedback submission finalizes course completion

## 5. Admin Workflows
### 5.1 Profile Edit Requests (HR)
- Employees submit requests via API
- HR reviews in admin plugin page
- Approve applies changes to user profile

### 5.2 Quiz Reattempt Requests (LM/HR)
- Employees submit reattempt requests
- Admin approves/rejects in plugin page
- Approved requests allow next quiz attempt

### 5.3 Audit Logs
- Admin plugin shows audit entries (currently user-focused)
- Filter by date, action, content type, company

## 6. Analytics Dashboards
### 6.1 Learning Analytics
- Global and personal views
- KPIs: assignments, completion rate, quiz stats, drop-off
- Employee table and export

### 6.2 Overall Analytics
- Content engagement and distribution
- Users by company, holidays, news, townhalls

### 6.3 Activity Tracking
- Activity log entries are created by frontend
- Includes time by page/type, KPIs, log table

## 7. Activity Tracking Setup
- Frontend must call POST /api/analytics/activity/track
- Auth required (JWT)
- activity_type must match enum in Activity Log schema

## 8. Seeding and Diagnostics
- npm run seed:portal (development only)
- npm run seed:analytics
- npm run check:employee-data
- npm run check:activity-log

## 9. Production Checklist
- Enable auth on analytics endpoints
- Configure CORS
- Set SMTP and APP_KEYS secrets
- Configure database for production

## 10. Helpful References
- Analytics guide: ./README.md
- Frontend integration: ./FRONTEND-INTEGRATION-GUIDE.md
- Activity tracking: ./ACTIVITY-LOG-REAL-DATA-FLOW.md
- Profile edit requests: ./PROFILE-EDIT-REQUEST-INTEGRATION.md
