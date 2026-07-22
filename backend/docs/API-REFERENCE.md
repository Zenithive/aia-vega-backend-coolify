# UI-LM Portal - API Reference (Backend)

Base URL (dev): http://localhost:1337

## 1. Authentication
### 1.1 Login
POST /api/auth/local

Request:
{
  "identifier": "user@example.com",
  "password": "password"
}

Response:
{
  "jwt": "...",
  "user": { "id": 1, "email": "..." }
}

### 1.2 Current User
GET /api/users/me (Authorization: Bearer <jwt>)

## 2. Standard Content API (Strapi)
Strapi REST endpoints are available for collection types. Common ones:
- /api/courses
- /api/course-assignments
- /api/user-progresses
- /api/quiz-submissions
- /api/feedback-submissions
- /api/news
- /api/news-categories
- /api/events
- /api/townhalls
- /api/holidays
- /api/company-policies
- /api/form-templates
- /api/important-links
- /api/gallery-items
- /api/companies
- /api/departments
- /api/work-locations
- /api/notifications
- /api/activity-logs
- /api/profile-edit-requests
- /api/quiz-reattempt-requests

### 2.1 Common Query Patterns
- Pagination: ?pagination[page]=1&pagination[pageSize]=10
- Filters: ?filters[field][$eq]=value
- Populate relations: ?populate=*
- Fields: ?fields[0]=title&fields[1]=active

## 3. Custom Learning / Progress Endpoints
### 3.1 Assign Course (notify users)
POST /api/course-assignments/assign

Request:
{
  "level": "department" | "company" | "individual" | "work_location",
  "courseId": 1,
  "assignedBy": 1,
  "userId": 10,
  "departmentId": 2,
  "companyId": 1,
  "workLocationId": 3
}

Behavior:
- Sends notifications to matched users. (Does not create assignments; use CMS for that.)

### 3.2 Start Course
POST /api/user-progress/start-course

Request:
{
  "userId": 1,
  "courseId": 10,
  "language": "English"
}

Behavior:
- Creates or updates user-progress; locks language selection.

### 3.3 Mark Module Read
POST /api/user-progress/mark-module

Request:
{
  "userId": 1,
  "courseId": 10,
  "moduleId": "mod-123"
}

Response includes nextStep:
- continue
- quiz_required
- feedback_required
- course_complete_allowed

### 3.4 Module Video Progress
POST /api/module-video-progress/mark-read

Request:
{
  "userId": 1,
  "courseId": 10,
  "moduleIndex": 0,
  "moduleTitle": "Module 1",
  "videoDurationMin": 12,
  "timeWatchedMin": 10
}

## 4. Quiz and Feedback
### 4.1 Quiz Submission (standard create)
POST /api/quiz-submissions

Payload: answers, course, submitted_by, attempt_number, submitted_at

### 4.2 Quiz Reattempt Request
POST /api/quiz-reattempt-request/send

Request:
{
  "userId": 1,
  "courseId": 10
}

### 4.3 Feedback Submission (standard create)
POST /api/feedback-submissions

Payload: answers, course, users_permissions_user, submitted_at

## 5. News Likes
### 5.1 Like News
POST /api/news/:id/like

### 5.2 Unlike News
POST /api/news/:id/unlike

## 6. Analytics Endpoints
### 6.1 Learning Analytics
- GET /api/analytics/learning/global
- GET /api/analytics/learning/personal?userId=1
- GET /api/analytics/learning/employee-table
- GET /api/analytics/learning/employee-table/export
- GET /api/analytics/courses-by-department
- GET /api/analytics/course-modules

### 6.2 Overall Analytics
- GET /api/analytics/overall/global
- GET /api/analytics/overall/personal?userId=1

### 6.3 Activity Tracking
- GET /api/analytics/activity/time-by-type-and-day
- GET /api/analytics/activity/log
- GET /api/analytics/activity/kpis
- GET /api/analytics/activity/pages-stats
- GET /api/analytics/activity/news-list
- POST /api/analytics/activity/track (auth required)

### 6.4 Utility Lists
- GET /api/analytics/employees
- GET /api/analytics/departments
- GET /api/analytics/unit-locations

### 6.5 Common Analytics Params
- dateFrom, dateTo (YYYY-MM-DD)
- company, department, unitLocation
- userId (for personal view)
- search, sortBy, sortOrder, page, pageSize
- courseId, courseCategory, quizStatus, feedbackGiven

## 7. Admin Plugin Routes (Strapi Admin)
These routes are for admin UI plugins and require admin auth:
- GET /profile-edit-requests/requests
- PUT /profile-edit-requests/requests/:id
- GET /quiz-reattempt-requests/requests
- PUT /quiz-reattempt-requests/requests/:id
- GET /audit-log/logs
- GET /audit-log/content-types

## 8. Activity Type Values (as implemented)
Activity log enum values:
News, Event, Course, Quiz, Feedback, Location, Routes, People, Gallery, Home, Company policy, Form & Templates, Calendar

Note: Older docs reference different activity types. Align frontend values with the current enum above.
