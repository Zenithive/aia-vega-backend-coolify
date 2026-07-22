# Activity Log – Real Data Flow

This document explains how activity log entries are created with **real data** (vs dummy seed data).

## Telemetry V2 (Recommended)

Use the new batched endpoint for route-level and learning-level analytics. This is designed for exact page paths, click counts, durations in seconds, and deduplication using `event_id`.

### Endpoint: `POST /api/analytics/events/ingest`

**Authentication:** Required (JWT)

**Request body:**

```json
{
  "events": [
    {
      "event_id": "1f7c9871-7465-4f60-a042-5d53e63d65db",
      "event_name": "page_view_started",
      "occurred_at": "2026-03-09T12:00:00.000Z",
      "session_id": "sess_abc_123",
      "route_path": "/course/42/module/3",
      "page_type": "CourseModule",
      "entity_type": "module",
      "entity_id": "3",
      "duration_seconds": 0,
      "click_count": 0,
      "metadata_json": {
        "referrer": "/course/42"
      },
      "client_ts": "2026-03-09T12:00:00.000Z",
      "tz_offset": -330,
      "source": "web"
    },
    {
      "event_id": "2cb67096-c2fd-4496-a810-5a15179fbaef",
      "event_name": "learning_video_progress",
      "occurred_at": "2026-03-09T12:05:00.000Z",
      "session_id": "sess_abc_123",
      "route_path": "/course/42/module/3",
      "page_type": "CourseModule",
      "entity_type": "video",
      "entity_id": "vid_17",
      "duration_seconds": 300,
      "click_count": 1,
      "metadata_json": {
        "current_position_sec": 300,
        "video_duration_sec": 840
      },
      "source": "web"
    }
  ]
}
```

**Supported event names:**
- `page_view_started`
- `page_view_ended`
- `page_click`
- `heartbeat`
- `learning_module_enter`
- `learning_module_exit`
- `learning_video_progress`
- `learning_video_completed`
- `learning_quiz_started`
- `learning_quiz_submitted`
- `learning_feedback_opened`
- `learning_feedback_submitted`

**Response:**

```json
{
  "success": true,
  "ingested": 2,
  "duplicates": 0,
  "rejected": 0,
  "errors": []
}
```

### Aggregate Read Endpoints

- `GET /api/analytics/events/page-stats`
  - Returns route-level metrics: `visits`, `unique_users`, `total_time_seconds`, `total_clicks`.
- `GET /api/analytics/events/page-trend`
  - Returns 5-minute buckets for trend charts.
- `GET /api/analytics/events/learning-stats`
  - Returns learning totals: module/video/quiz/feedback time, unique users, drop-off count.
- `GET /api/analytics/events/aggregation-status`
  - Returns cache refresh status for scheduled aggregation warmup.

### Notes

- Send all durations in **seconds**.
- Generate stable UUID `event_id` per event; retries with same ID are deduplicated.
- The backend always resolves `user` from JWT and ignores user spoofing in payload.
- Aggregation cache refresh runs every 5 minutes by default (`ANALYTICS_AGGREGATION_INTERVAL_MS`).

---

## Dummy Data vs Real Data

| Source | When | How |
|--------|------|-----|
| **Seed script** | Development only | `npm run seed:portal` creates ~100 fake activity logs with random users, types, and durations |
| **Frontend** | Production (real users) | Frontend calls `POST /api/analytics/activity/track` when a user performs an action |

---

## How Real Activity Logs Are Created

### Flow

```
User action on portal (e.g. reads news article)
    ↓
Frontend detects action + measures duration
    ↓
Frontend calls POST /api/analytics/activity/track with JWT
    ↓
Backend validates JWT, extracts user from token
    ↓
Backend creates activity_log entry (user, company, type, description, duration)
    ↓
Entry appears in Activity Tracking dashboard
```

### Endpoint: `POST /api/analytics/activity/track`

**Authentication:** Required (JWT from users-permissions login)

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request body:**
```json
{
  "activity_type": "News_Reading",
  "activity_description": "Read: Introduction to New Policies",
  "duration_seconds": 180
}
```

**activity_type** (required) – one of:
- `News_Reading`
- `Event_Info`
- `Townhall_Video`
- `Townhall_PDF`
- `Holiday_View`

**activity_description** (required) – string, e.g.:
- "Read: News Title"
- "Viewed Event: Workshop 2025"
- "Watched Townhall Video: Q1 Review"
- "Viewed Townhall PDF: Annual Report"
- "Checked Holiday Calendar"

**duration_seconds** (required) – integer, time spent in seconds (0 or more)

**Response (201):**
```json
{
  "success": true,
  "id": 123
}
```

**Backend behavior:**
- `user` – taken from JWT (not from request body)
- `company` – taken from user profile (AIA/Vega)
- `timestamp` – set to current server time

---

## Frontend Implementation

### When to Call the API

| User action | activity_type | Example description |
|-------------|---------------|---------------------|
| Opens/reads a news article | News_Reading | "Read: [News Title]" |
| Views event details | Event_Info | "Viewed Event: [Event Title]" |
| Watches townhall video | Townhall_Video | "Watched: [Video Title]" |
| Views townhall PDF | Townhall_PDF | "Viewed PDF: [Document Title]" |
| Opens holiday calendar | Holiday_View | "Checked Holiday Calendar" |

### Measuring Duration

**Option 1: On page leave (beforeunload / visibilitychange)**

```javascript
let startTime = Date.now();

// When user leaves or tab becomes hidden
const handleLeave = () => {
  const durationSeconds = Math.floor((Date.now() - startTime) / 1000);
  trackActivity('News_Reading', `Read: ${newsTitle}`, durationSeconds);
};

window.addEventListener('beforeunload', handleLeave);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) handleLeave();
});
```

**Option 2: On explicit action (e.g. close modal, navigate away)**

```javascript
// When user closes news article view
const onCloseArticle = () => {
  const durationSeconds = Math.floor((Date.now() - openTime) / 1000);
  trackActivity('News_Reading', `Read: ${articleTitle}`, durationSeconds);
};
```

**Option 3: Periodic heartbeat (for long sessions)**

```javascript
// Every 60 seconds while user is on page
const interval = setInterval(() => {
  trackActivity('News_Reading', `Read: ${title}`, 60);
}, 60000);
// Clear on leave
```

### Example `trackActivity` Function

```javascript
async function trackActivity(activityType, activityDescription, durationSeconds) {
  const token = localStorage.getItem('jwt'); // or from auth context
  if (!token) return;

  try {
    await fetch(`${API_URL}/api/analytics/activity/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        activity_type: activityType,
        activity_description: activityDescription,
        duration_seconds: durationSeconds,
      }),
    });
  } catch (err) {
    console.warn('Activity tracking failed:', err);
  }
}
```

---

## Security

- **User identity** – Always from JWT; frontend cannot spoof another user.
- **Company** – Taken from user profile; frontend cannot override.
- **Validation** – `activity_type` must be one of the allowed enum values.
- **Duration** – Clamped to non‑negative integer.

---

## Permissions

- `POST /api/analytics/activity/track` uses `auth: { scope: ['authenticated'] }`
- User must be logged in via `POST /api/auth/local` (users-permissions)
- Ensure the **Authenticated** role in Strapi has access to this route (or it is handled by the plugin)

---

## Testing Without Frontend

**Using curl (after getting JWT from login):**

```bash
# 1. Login to get JWT
curl -X POST http://localhost:1337/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{"identifier":"user@example.com","password":"password"}'

# 2. Track activity (use jwt from step 1)
curl -X POST http://localhost:1337/api/analytics/activity/track \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_HERE" \
  -d '{"activity_type":"News_Reading","activity_description":"Read: Test Article","duration_seconds":120}'
```

---

## Summary

| Question | Answer |
|----------|--------|
| Who creates real activity logs? | The frontend, when users perform actions |
| Which endpoint? | `POST /api/analytics/activity/track` |
| Auth required? | Yes (JWT) |
| Who is the user? | From JWT (backend, not request body) |
| Seed data? | Only for development; not used in production |
