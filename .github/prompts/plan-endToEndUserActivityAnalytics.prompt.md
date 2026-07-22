## Plan: End-to-End User Activity Analytics

Implement a frontend-first telemetry pipeline (React -> Strapi ingest API -> raw event store -> 5-15 minute aggregations -> dashboard APIs) while reusing existing `analytics-dashboard` plugin patterns. This approach supports exact route-level tracking, learning-flow granularity (module/video/quiz/feedback), and stable dashboard performance by querying aggregated tables for charts and KPIs.

**Steps**
1. Phase 1 - Event Contract and Architecture Baseline
2. Define a single analytics event schema for all frontend events: `event_name`, `occurred_at`, `user_id`, `session_id`, `route_path`, `page_type`, `entity_type`, `entity_id`, `duration_seconds`, `click_count`, `metadata_json`, `client_ts`, `tz_offset`.
3. Define event taxonomy with required fields per domain:
4. Portal events: `page_view_started`, `page_view_ended`, `page_click`, `heartbeat`.
5. Learning events: `learning_module_enter`, `learning_module_exit`, `learning_video_progress`, `learning_video_completed`, `learning_quiz_started`, `learning_quiz_submitted`, `learning_feedback_opened`, `learning_feedback_submitted`.
6. Define idempotency strategy (`event_id` UUID + unique DB index) to avoid double-counting from retries. *blocks phase 2*
7. Phase 2 - Data Model and Ingestion APIs
8. Add raw event storage (new content-type/table, e.g., `analytics_event`) optimized for append-only writes and replay.
9. Add/extend migration scripts under `backend/database/migrations/` for new tables and indexes (`event_id`, `user_id+occurred_at`, `route_path+occurred_at`, `entity_type+entity_id+occurred_at`).
10. Add authenticated ingest endpoint in plugin route registry (`POST /api/analytics/events/ingest`) for batched payloads (up to N events/request) with schema validation.
11. Reuse auth/user-resolution patterns in existing analytics controller/service to map JWT user and company context consistently.
12. Add strict server-side validation and normalization (seconds->seconds only; keep one canonical unit in raw store). *depends on 1-6*
13. Phase 3 - Frontend Instrumentation Contract (React Integration Spec)
14. Define React tracker SDK contract (documented integration) for route enter/leave timers, heartbeat, click capture, and learning event dispatch.
15. Track exact `route_path` and route params for unique-user-per-page metrics; include `page_type` for rollups.
16. Define click tracking scope for phase 1: count actionable UI interactions only (buttons/links/tabs/CTA), exclude noisy DOM clicks.
17. Add offline/retry rules (local queue + exponential backoff) and guaranteed flush on tab hidden/unload. *parallel with phase 4 once schema is stable*
18. Phase 4 - Aggregation Pipeline (5-15 Minute Freshness)
19. Create aggregation jobs (cron in Strapi plugin) every 5-15 minutes to compute materialized metrics from raw events.
20. Build aggregate tables/views:
21. `analytics_page_metrics_5m`: visits, unique_users, total_time_seconds, total_clicks by `route_path/page_type/time_bucket`.
22. `analytics_learning_metrics_5m`: module_time, video_time, quiz_time, feedback_time, unique_users, dropoff counters by `course/module/video/quiz/time_bucket`.
23. Define sessionization rule (30-minute inactivity boundary) for duration accuracy and drop-off logic.
24. Add late-event handling window (e.g., recalculate previous 2 buckets) to tolerate delayed frontend uploads.
25. Phase 5 - Dashboard API Extensions (Reuse Existing Plugin)
26. Extend analytics plugin service/controller to read aggregate tables for fast dashboard responses.
27. Add/extend endpoints for required metrics:
28. Page analytics: unique users per exact route, time spent per route, clicks per route, trend over time.
29. Learning analytics: time spent per module/video/quiz/feedback, unique users per module/video/page, drop-off by module.
30. Keep existing endpoints backward-compatible where possible; add versioned response keys if needed.
31. Wire filters to existing conventions (`company`, `department`, `location`, `dateFrom/dateTo`) via shared filter logic where reusable. *depends on 19-24*
32. Phase 6 - Data Quality, Security, and Governance
33. Enforce non-PII analytics payload policy: user ID allowed; no free-text personal data in event metadata.
34. Add ingestion rate limits and max payload size to protect Strapi API.
35. Add monitoring counters (ingest success/failure, dedupe count, lag to aggregation completion).
36. Add admin-safe data retention policy (e.g., raw events 90-180 days; aggregates retained longer) and optional user-data delete hook for compliance operations.
37. Phase 7 - Rollout and Verification
38. Roll out behind feature flags: ingest endpoint first, then frontend events for selected pages/modules, then full coverage.
39. Run backfill/replay scripts from raw events to validate aggregate correctness before dashboard switch.
40. Switch dashboard queries from raw scans to aggregate tables and validate parity against current numbers.

**Relevant files**
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\plugins\analytics-dashboard\strapi-server.js` - register new ingest and aggregate-read endpoints using existing plugin route pattern.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\plugins\analytics-dashboard\controllers\analytics.js` - add batched event ingest controller and route-level analytics handlers.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\plugins\analytics-dashboard\services\analytics.js` - orchestrate new aggregate services and maintain existing response shape compatibility.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\plugins\analytics-dashboard\services\analyticsShared.js` - reuse and extend filter normalization and date/company scoping.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\plugins\analytics-dashboard\controllers\learning.js` - add learning metric endpoints backed by aggregate learning tables.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\plugins\analytics-dashboard\services\learning\learningQuiz.js` - extend for quiz-time/attempt trend fields where needed.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\api\module-video-progress\controllers\module-video-progress.js` - emit/validate learning video telemetry alignment with canonical event schema.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\api\user-progress\controllers\user-progress.js` - align module enter/exit and course/session timing hooks.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\api\quiz-submission\controllers\quiz-submission.js` - guarantee `quiz_time_seconds` capture and event emission.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\api\feedback-submission\controllers\feedback-submission.js` - capture feedback open/submit durations and completion events.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\database\migrations\` - create raw event and aggregate schema/index migrations.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\docs\ACTIVITY-LOG-REAL-DATA-FLOW.md` - update frontend integration docs with new event taxonomy and batching contract.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\plugins\analytics-dashboard\admin\src\hooks\useAnalytics.js` - add client calls for new dashboard endpoints.
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\plugins\analytics-dashboard\admin\src\pages\OverallAnalytics\index.jsx` - render route-level page analytics (unique users, clicks, time spent).
- `c:\WORK\AIA-VEGA\AIA-VEGA-project\backend\src\plugins\analytics-dashboard\admin\src\pages\LearningAnalytics\index.jsx` - render module/video/quiz/feedback time and drop-off metrics.

**Verification**
1. API contract tests: validate ingest endpoint rejects malformed events, accepts valid batched payloads, and deduplicates repeated `event_id`.
2. Unit/integration tests for aggregation jobs: verify 5-minute bucket outputs for visits, unique users, duration, clicks, and learning metrics.
3. Accuracy checks: compare aggregate metrics vs sampled raw-event SQL for identical filter windows.
4. Performance checks: confirm dashboard endpoints avoid raw full-table scans and meet target latency under expected data volume.
5. End-to-end manual test with React app: open pages, click CTAs, watch video, submit quiz/feedback; verify events ingested and dashboard updates within configured interval.
6. Regression validation: existing analytics endpoints still respond and prior dashboard pages remain functional.
7. Operational checks: verify ingestion error logs, aggregation lag metrics, and retry behavior for delayed/batched uploads.

**Decisions**
- Frontend telemetry is primary; backend domain hooks provide fallback and authoritative learning milestones.
- Metric granularity is exact route/path plus learning entity IDs (course/module/video/quiz/feedback).
- Dashboard freshness target is 5-15 minutes via scheduled aggregation, not real-time streaming.
- Privacy scope for phase 1 stores user IDs for filtering; excludes PII from metadata payloads.
- Included phase 1 metrics: page visits/time/clicks/unique users, learning time by module/video/quiz/feedback, unique users by learning entity, module drop-off.
- Excluded from phase 1: full clickstream replay UX, per-question quiz dwell heatmaps, and real-time websocket dashboards.

**Further Considerations**
1. Canonical event unit recommendation: store all durations in seconds in raw events and only convert to minutes at API response layer.
2. If analytics volume is expected to grow quickly, use partitioning by day/month on raw event table early to avoid migration later.
3. Consider keeping current `activity-log` for legacy compatibility while introducing `analytics_event` as the long-term source-of-truth.
