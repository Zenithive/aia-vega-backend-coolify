
// @ts-nocheck

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Layouts } from "@strapi/strapi/admin";
import { Box, Typography, Flex, Loader, Badge } from "@strapi/design-system";
import { getFetchClient } from "@strapi/strapi/admin";

const QUIZ_REATTEMPT_TYPES = [
  "quiz_reattempt_requested",
  "quiz_reattempt_approved",
  "quiz_reattempt_rejected",
];

const PROFILE_EDIT_REQUEST_TYPE = "profile_edit_request";
const QUIZ_SUBMITTED_TYPE = "quiz_submitted";
const FEEDBACK_SUBMITTED_TYPE = "feedback_submitted";
const SUBMISSION_ADMIN_COMPANIES = ["AIA", "Vega"];

function canonicalSubmissionCompany(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  const hit = SUBMISSION_ADMIN_COMPANIES.find((x) => x.toLowerCase() === s);
  return hit || null;
}

function submissionAdminSearchFromMeta(meta) {
  const params = new URLSearchParams();
  const company = canonicalSubmissionCompany(meta?.company);
  if (company) params.set("company", company);
  const courseId = String(meta?.courseDocumentId || meta?.courseId || "").trim();
  if (courseId) params.set("courseId", courseId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTypeBadgeVariant(type) {
  if (QUIZ_REATTEMPT_TYPES.includes(type)) return "alternative";
  if (type === PROFILE_EDIT_REQUEST_TYPE) return "primary";
  if (type === "feedback_submitted") return "success";
  if (type === "news_liked") return "warning";
  return "neutral";
}

function getNormalizedType(notification) {
  const rawType = notification?.type || "";
  const source = notification?.meta?.source || "";

  if (rawType === PROFILE_EDIT_REQUEST_TYPE) return PROFILE_EDIT_REQUEST_TYPE;
  if (source === "profile_edit_request") return PROFILE_EDIT_REQUEST_TYPE;

  return rawType;
}

function getTypeLabel(notification) {
  const type = getNormalizedType(notification);
  if (type === PROFILE_EDIT_REQUEST_TYPE) return "profile edit request";
  return type || "custom";
}

const quizResultStyle = (passed) => /** @type {React.CSSProperties} */ ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: "4px",
  fontSize: "11px",
  fontWeight: 700,
  background: passed ? "#c6f0c2" : "#fce4e4",
  color: passed ? "#1c6118" : "#b72b1a",
  marginLeft: "4px",
});

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Record the visit timestamp BEFORE fetching so any notification that arrives
    // during this page view is still counted on the next badge poll.
    localStorage.setItem('aia_notif_last_visit', new Date().toISOString());

    const { get } = getFetchClient();
    get("/modules-sidebar/admin-notifications?limit=100")
      .then(({ data }) => {
        if (cancelled || !isMounted.current) return;
        const list = data?.data ?? data ?? [];
        setNotifications(Array.isArray(list) ? list : []);
      })
      .catch((e) => {
        if (cancelled || !isMounted.current) return;
        setError(e?.message || "Failed to load notifications");
        setNotifications([]);
      })
      .finally(() => {
        if (isMounted.current) setLoading(false);
      });
    return () => {
      cancelled = true;
      isMounted.current = false;
    };
  }, []);

  const handleNotificationClick = (notification) => {
    const type = getNormalizedType(notification);
    if (QUIZ_REATTEMPT_TYPES.includes(type)) {
      navigate("/plugins/quiz-reattempt-requests");
      return;
    }
    if (type === PROFILE_EDIT_REQUEST_TYPE) {
      navigate("/plugins/profile-edit-requests");
      return;
    }
    if (type === QUIZ_SUBMITTED_TYPE) {
      navigate(`/plugins/quiz-submission-admin${submissionAdminSearchFromMeta(notification?.meta)}`);
      return;
    }
    if (type === FEEDBACK_SUBMITTED_TYPE) {
      navigate(`/plugins/feedback-submission-admin${submissionAdminSearchFromMeta(notification?.meta)}`);
    }
  };

  const isQuizReattempt = (n) => QUIZ_REATTEMPT_TYPES.includes(n?.type || "");
  const isProfileEditRequest = (n) => getNormalizedType(n) === PROFILE_EDIT_REQUEST_TYPE;
  const isQuizSubmitted = (n) => n?.type === QUIZ_SUBMITTED_TYPE;
  const isFeedbackSubmitted = (n) => n?.type === FEEDBACK_SUBMITTED_TYPE;

  return (
    <Layouts.Root>
      <Layouts.Header
        title="My Notifications"
        subtitle={
          loading
            ? "Loading…"
            : `${notifications.length} notification${notifications.length === 1 ? "" : "s"}`
        }
      />
      <Layouts.Content>
        <Box paddingLeft={8} paddingRight={8} paddingTop={6} paddingBottom={8}>
          {error && (
            <Box padding={4} background="danger100" hasRadius marginBottom={4}>
              <Typography textColor="danger700">{error}</Typography>
            </Box>
          )}

          {loading ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>Loading...</Loader>
            </Flex>
          ) : notifications.length === 0 ? (
            <Box padding={6} background="neutral100" hasRadius>
              <Typography textColor="neutral600">
                No notifications yet.
              </Typography>
            </Box>
          ) : (
            <Box
              background="neutral0"
              hasRadius
              shadow="tableShadow"
              padding={0}
              borderColor="neutral200"
              borderWidth="1px"
              borderStyle="solid"
            >
              {notifications.map((n) => {
                const clickable = isQuizReattempt(n) || isProfileEditRequest(n) || isQuizSubmitted(n) || isFeedbackSubmitted(n);
                const isQuizSubmit = n.type === QUIZ_SUBMITTED_TYPE;
                const hasPassed = n.meta?.passed;
                const score = n.meta?.score;
                return (
                  <Box
                    key={n.id ?? n.documentId ?? n.createdAt + n.title}
                    padding={4}
                    borderColor="neutral200"
                    borderWidth="1px"
                    borderStyle="solid"
                    style={{
                      borderLeft: "none",
                      borderRight: "none",
                      borderTop: "none",
                      cursor: clickable ? "pointer" : "default",
                    }}
                    onClick={() => clickable && handleNotificationClick(n)}
                    textAlign="left"
                    background={clickable ? "neutral50" : undefined}
                    hasRadius={false}
                  >
                    <Flex
                      gap={2}
                      wrap="wrap"
                      alignItems="center"
                      marginBottom={1}
                    >
                      <Badge variant={getTypeBadgeVariant(getNormalizedType(n))}>
                        {getTypeLabel(n)}
                      </Badge>
                      {isQuizSubmit && score != null && (
                        <span style={quizResultStyle(hasPassed)}>
                          {hasPassed ? "PASSED" : "FAILED"} — {score}%
                        </span>
                      )}
                      <Typography variant="sigma" textColor="neutral700">
                        {formatDate(n.createdAt)}
                      </Typography>
                      {clickable && (
                        <Typography variant="pi" textColor="primary600">
                          {isProfileEditRequest(n)
                            ? "Click to open Profile Edit Requests →"
                            : isQuizSubmitted(n)
                            ? "Click to open Quiz Submissions →"
                            : isFeedbackSubmitted(n)
                            ? "Click to open Feedback Submissions →"
                            : "Click to open Quiz Reattempt Requests →"}
                        </Typography>
                      )}
                    </Flex>
                    {n.meta &&
                      (n.meta.userId != null ||
                        n.meta.userName ||
                        n.meta.courseId != null ||
                        n.meta.courseTitle ||
                        n.meta.newsId != null ||
                        n.meta.newsTitle) && (
                        <Box marginTop={2}>
                          {(n.meta.userId != null || n.meta.userName) && (
                            <Typography variant="pi" textColor="primary700">
                             User: {n.meta.userName}
                            </Typography>
                          )}
                          {(n.meta.courseId != null || n.meta.courseTitle) && (
                            <Typography variant="pi" textColor="primary700">
                              <><br />Course: {n.meta.courseTitle}</>
                            </Typography>
                          )}
                          {n.meta.courseId == null &&
                            (n.meta.newsId != null || n.meta.newsTitle) && (
                              <Typography variant="pi" textColor="primary700">
                               <><br /> News: {n.meta.newsTitle}</>
                              </Typography>
                            )}
                        </Box>
                      )}
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
}
