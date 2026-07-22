# Frontend Integration Guide – UI-LM Portal

This document provides detailed information for building the frontend and integrating it with the Strapi backend.

---

## 1. Backend Changes Required After Implementing Frontend

### 1.1 Authentication & Authorization

**Current state:** All analytics endpoints use `auth: false` (no authentication).

**Required for production:**
- Enable authentication on analytics routes in `src/plugins/analytics-dashboard/strapi-server.js`
- Change `auth: false` to `auth: { scope: ['authenticated'] }` or use JWT validation
- Ensure only logged-in portal users can access analytics
- Consider role-based access (e.g., managers vs employees)

**Files to modify:**
```
src/plugins/analytics-dashboard/strapi-server.js
```

### 1.2 CORS Configuration

**Current state:** Default Strapi CORS allows all origins in development.

**Required for production:**
- Update `config/middlewares.js` or create `config/cors.js` to whitelist your frontend domain(s)
- Example: Allow `https://your-portal-domain.com` and `http://localhost:3000` (dev)

```javascript
// config/middlewares.js - cors section
'strapi::cors': {
  enabled: true,
  config: {
    origin: ['https://your-frontend.com', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization'],
  },
},
```

### 1.3 API Permissions (Strapi Content API)

**For Strapi Content API (news, events, courses, etc.):**
- Go to **Settings → Users & Permissions → Roles**
- Configure **Public** and **Authenticated** roles
- Grant `find`, `findOne` for content types the frontend needs
- Restrict `create`, `update`, `delete` as needed

### 1.4 Activity Log Creation from Frontend

**Current state:** Activity logs are created only via seed script.

**Required:** Frontend must create activity logs when users perform actions:
- News reading (when user views/reads a news article)
- Event info (when user views event details)
- Townhall video/PDF (when user watches/views)
- Holiday view (when user checks holiday calendar)

**Implementation options:**
1. **Direct API call from frontend** – Frontend calls `POST /api/activity-logs` when user performs an action
2. **Backend webhook/event** – Strapi lifecycle hooks create activity logs when content is accessed (requires custom logic)
3. **Middleware/proxy** – A middleware layer tracks requests and creates logs

**Implemented:** `POST /api/analytics/activity/track` – accepts `{ activity_type, activity_description, duration_seconds }` and auto-fills `user` and `company` from JWT. See [ACTIVITY-LOG-REAL-DATA-FLOW.md](./ACTIVITY-LOG-REAL-DATA-FLOW.md) for details.

### 1.5 Environment Variables

**Production checklist:**
- Set `NODE_ENV=production`
- Configure `DATABASE_*` for production DB
- Set secure `APP_KEYS`, `JWT_SECRET`, `API_TOKEN_SALT`, etc.
- Set `ADMIN_JWT_SECRET` for admin panel
- Configure `STRAPI_ADMIN_BACKEND_URL` if admin is on different domain

---

## 2. Other Related Changes

### 2.1 Media/Upload URLs

- Strapi serves uploads at `http://localhost:1337/uploads/...`
- In production, ensure `STRAPI_ADMIN_BACKEND_URL` or server URL is correct
- Frontend must use full URLs for images: `${API_URL}/uploads/filename.jpg`
- Consider CDN for production media

### 2.2 Pagination & Limits

- Default REST limit is 25 (configurable in `config/api.js`)
- For large lists (e.g., news, events), frontend should use `?pagination[page]=1&pagination[pageSize]=10`
- Analytics endpoints have their own limits (e.g., 5000 for user-progress, 10000 for activity logs)

### 2.3 Date/Time Format

- Strapi returns ISO 8601: `2025-01-29T14:30:00.000Z`
- Frontend should format for display (e.g., `toLocaleDateString()`, `toLocaleString()`)
- Be consistent with timezone handling (UTC vs local)

### 2.4 User Permissions Plugin

- Users are in `plugin::users-permissions.user`
- Frontend login: `POST /api/auth/local` with `identifier` (email/username) and `password`
- Returns JWT in response – store and send as `Authorization: Bearer <token>` header
- User profile: `GET /api/users/me` (requires auth)

### 2.5 Company/Department Filtering

- User schema has `company` (AIA/Vega) and `department` (relation)
- Frontend should filter content by user's company when applicable
- Some content types have `company` field; use `?filters[company][name][$eq]=AIA` or similar

---

## 3. Integrating Actual Data (Replacing Dummy Data)

### 3.1 Seed Data vs Production Data

| Data Type | Seed Script | Production |
|-----------|-------------|------------|
| Companies, Departments, Designations | Created by seed | Import from HR/ERP or manual entry |
| Users | Uses existing Strapi users | Real users from SSO/LDAP or manual |
| News, Events, Holidays | Dummy content | Created via Strapi Admin or CMS |
| Courses, Quizzes | Dummy | Created by L&D team |
| User Progress, Quiz Submissions | Dummy | Real data from LMS usage |
| Activity Logs | Dummy | Created by frontend when users act |

### 3.2 Steps to Integrate Actual Data

**Step 1: Stop using seed for production**
- Do NOT run `npm run seed:portal` in production
- Seed is for development/demo only

**Step 2: Data migration (if you have existing systems)**
- Export data from existing LMS, HR, or CMS
- Create migration scripts to insert into Strapi via API or direct DB
- Map old IDs to new Strapi document IDs

**Step 3: User sync**
- If using SSO/LDAP: Use Strapi's users-permissions or a custom provider
- Sync users with `company`, `department`, `username`, etc.
- Ensure `plugin::users-permissions.user` has required fields populated

**Step 4: Activity tracking**
- Implement frontend calls to create activity logs on user actions
- Backfill historical data if available (e.g., from old analytics)

**Step 5: Content creation**
- Use Strapi Admin for news, events, holidays, courses
- Or build an internal CMS UI that calls Strapi Content API

### 3.3 Clearing Dummy Data

```bash
# Development: Clear and reseed
npm run seed:portal

# Production: Manual cleanup or custom script
# Delete records from activity_logs, user_progress, quiz_submissions, etc.
# Keep: companies, departments, designations, users (real data)
```

---

## 4. Frontend-to-Backend Integration

### 4.1 API Base URL

```javascript
// Development
const API_URL = 'http://localhost:1337';

// Production (use env variable)
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.your-domain.com';
```

### 4.2 API Endpoints Summary

| Purpose | Method | Endpoint | Auth |
|---------|--------|----------|------|
| **Auth** | POST | `/api/auth/local` | No |
| **User profile** | GET | `/api/users/me` | Yes (JWT) |
| **News** | GET | `/api/news` | Depends on permissions |
| **Events** | GET | `/api/events` | Depends on permissions |
| **Holidays** | GET | `/api/holidays` | Depends on permissions |
| **Courses** | GET | `/api/courses` | Depends on permissions |
| **Activity Track** | POST | `/api/analytics/activity/track` | Yes (JWT required) |
| **Learning Analytics** | GET | `/api/analytics/learning/global` | Currently no |
| **Learning Analytics** | GET | `/api/analytics/learning/personal?userId=X` | Currently no |
| **Learning Analytics** | GET | `/api/analytics/learning/employee-table` | Currently no |
| **Overall Analytics** | GET | `/api/analytics/overall/global` | Currently no |
| **Overall Analytics** | GET | `/api/analytics/overall/personal?userId=X` | Currently no |
| **Activity Tracking** | GET | `/api/analytics/activity/time-by-type-and-day` | Currently no |
| **Activity Tracking** | GET | `/api/analytics/activity/log` | Currently no |
| **Filters** | GET | `/api/analytics/departments` | Currently no |
| **Filters** | GET | `/api/analytics/unit-locations` | Currently no |
| **Filters** | GET | `/api/analytics/employees` | Currently no |

### 4.3 Query Parameters for Analytics

**Learning Analytics – Global/Personal:**
- `dateFrom`, `dateTo` (YYYY-MM-DD)
- `company`, `department`, `unitLocation`, `courseCategory`

**Learning Analytics – Employee Table:**
- Same as above + `search` (employee ID/email), `sortBy`, `sortOrder`, `page`, `pageSize`

**Overall Analytics – Global/Personal:**
- `dateFrom`, `dateTo`, `company`, `unitLocation`

**Activity Tracking:**
- `dateFrom`, `dateTo`, `company`, `department`, `unitLocation`, `activityType`
- For log table: `page`, `pageSize`

### 4.4 Response Formats

**Analytics endpoints** return JSON in chart-ready format, e.g.:
```json
{
  "kpis": { "totalUsers": 100, "totalNews": 50, ... },
  "holidayByMonth": [{"name": "Jan 2025", "value": 5}, ...],
  "newsByCategory": [{"name": "Tech", "value": 10}, ...]
}
```

**Activity log:**
```json
{
  "rows": [
    {"userName": "John", "company": "AIA", "activity": "Viewed News", "duration": "5m 30s", "timestamp": "2025-01-29T14:30:00.000Z"}
  ],
  "total": 100,
  "page": 1,
  "pageSize": 10
}
```

**Strapi Content API** returns:
```json
{
  "data": [...],
  "meta": { "pagination": { "page": 1, "pageSize": 25, "total": 100 } }
}
```

### 4.5 Making Authenticated Requests

```javascript
const token = localStorage.getItem('jwt'); // or from auth context

fetch(`${API_URL}/api/analytics/learning/global?dateFrom=2025-01-01&dateTo=2025-01-31`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
```

---

## 5. Things to Keep in Mind During Frontend Building

### 5.1 Data Fetching

- Use React Query, SWR, or similar for caching and refetching
- Handle loading and error states
- Consider pagination for large lists
- Avoid over-fetching; request only needed fields with `?fields[]=`

### 5.2 Activity Tracking Implementation

- Call activity log API when user:
  - Opens/reads a news article (track time on page)
  - Views event details
  - Watches townhall video or views PDF
  - Opens holiday calendar
- Use `activity_type` enum: `News_Reading`, `Event_Info`, `Townhall_Video`, `Townhall_PDF`, `Holiday_View`
- Send `duration_seconds` (e.g., from `visibilitychange` or page unload)
- Include `activity_description` (e.g., "Read: News Title")

### 5.3 Company/User Context

- Store user's `company` (AIA/Vega) and `department` after login
- Use for filtering content and analytics
- Respect data isolation (e.g., AIA users see AIA content only if required)

### 5.4 Media/Images

- Strapi uploads: `${API_URL}/uploads/filename.jpg`
- For local development: `http://localhost:1337/uploads/...`
- Handle missing images with fallbacks

### 5.5 Responsive Design

- Analytics charts should be responsive (Recharts, Chart.js support this)
- Tables should be scrollable or use responsive layouts on mobile

### 5.6 Error Handling

- Handle 401 (unauthorized) – redirect to login
- Handle 403 (forbidden) – show "access denied"
- Handle 500 – show generic error, log for debugging
- Handle network errors – retry or offline message

### 5.7 Security

- Never store JWT in localStorage if XSS is a concern; consider httpOnly cookies
- Use HTTPS in production
- Validate/sanitize user input before sending to API
- Don't expose sensitive data in client-side code

---

## 6. Additional Information & Suggestions

### 6.1 Recommended Frontend Stack

- **React** or **Next.js** (SSR/SSG for SEO if needed)
- **React Query** or **SWR** for data fetching
- **Recharts** or **Chart.js** for charts (consistent with admin dashboard)
- **React Router** or Next.js routing
- **Tailwind CSS** or **Styled Components** for styling

### 6.2 API Documentation

- Strapi auto-generates OpenAPI docs at `http://localhost:1337/documentation` (if plugin enabled)
- Document your custom analytics endpoints in a separate API spec if needed

### 6.3 Testing

- Use MSW (Mock Service Worker) to mock API responses during frontend unit tests
- E2E tests (Playwright, Cypress) against a seeded backend
- Test with different user roles (AIA vs Vega, manager vs employee)

### 6.4 Performance

- Lazy-load analytics pages (they fetch heavy data)
- Cache analytics responses (e.g., 5–15 min) to reduce server load
- Use pagination for activity log table
- Consider server-side aggregation for very large datasets

### 6.5 Deployment

- Backend: Deploy Strapi to Node.js host (Railway, Render, AWS, etc.)
- Frontend: Deploy to Vercel, Netlify, or similar
- Ensure CORS allows frontend domain
- Use environment variables for API URL in frontend

### 6.6 Monitoring

- Log API errors on backend
- Monitor analytics endpoint response times
- Track frontend errors (e.g., Sentry)
- Consider analytics for portal usage (separate from activity log)

### 6.7 Future Considerations

- **SSO/LDAP:** Integrate with corporate identity provider
- **Real-time:** WebSockets for live notifications
- **Export:** Add CSV/Excel export for analytics
- **Scheduled reports:** Email digest of analytics to managers
- **Mobile app:** Same API can power React Native or Flutter app

---

## Quick Reference: Key Files

| Purpose | Path |
|---------|------|
| Analytics routes | `src/plugins/analytics-dashboard/strapi-server.js` |
| Analytics controller | `src/plugins/analytics-dashboard/controllers/analytics.js` |
| Analytics service | `src/plugins/analytics-dashboard/services/analytics.js` |
| CORS | `config/middlewares.js` |
| API config | `config/api.js` |
| Activity log schema | `src/api/activity-log/content-types/activity-log/schema.json` |
| Seed script | `scripts/seed-portal.js` |

---

*Last updated: January 2025*
