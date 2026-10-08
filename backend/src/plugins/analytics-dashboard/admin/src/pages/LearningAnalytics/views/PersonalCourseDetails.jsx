// @ts-nocheck
/**
 * Personal view: one learner across every assigned course, module by module.
 * Data: `courseDetails` + `personalSummary` from /api/analytics/learning/personal.
 */
import React, { useState } from 'react';
import { Badge, Box, Button, Flex, Modal, Typography } from '@strapi/design-system';
import { StatCard } from '../../../components/StatCard';
import { DataTable } from '../../../components/DataTable';
import {
  CardRow,
  CourseStatusBadge,
  Fact,
  ModuleStatusBadge,
  ModuleTypeBadge,
  ProgressBar,
  SectionTitle,
  formatDate,
  formatDateTime,
  formatDays,
  formatMinutes,
  formatScore,
  plural,
} from '../../../components/learningDetailUi';

function AttemptsModal({ module, onClose }) {
  const q = module.quiz;
  return (
    <Modal.Root open onOpenChange={(o) => !o && onClose()}>
      <Modal.Content style={{ maxWidth: 820, width: '90vw' }}>
        <Modal.Header>
          <Modal.Title>{`Quiz attempts — ${module.title}`}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Typography textColor="neutral600" tag="p" marginBottom={4}>
            {`Pass mark ${q.passMark}% · ${q.attempts} of ${q.maxAttempt} attempts used · best ${formatScore(q.bestScore)} · ${
              q.passed ? 'passed' : q.pendingReview ? 'waiting for answer review' : 'not passed yet'
            }`}
          </Typography>
          <DataTable
            data={q.history}
            title="Attempts"
            exportFileName={`quiz-attempts-${module.title}.xlsx`}
            fontSize="14px"
            columns={[
              { key: 'attempt', label: 'Attempt' },
              { key: 'score', label: 'Score', render: formatScore, exportValue: formatScore },
              {
                key: 'passed',
                label: 'Result',
                render: (v, h) =>
                  h.reviewStatus === 'Pending_review' ? (
                    <Badge variant="warning">Waiting for review</Badge>
                  ) : v ? (
                    <Badge variant="success">Passed</Badge>
                  ) : (
                    <Badge variant="danger">Not passed</Badge>
                  ),
                exportValue: (v, h) => (h.reviewStatus === 'Pending_review' ? 'Waiting for review' : v ? 'Passed' : 'Not passed'),
              },
              { key: 'submittedAt', label: 'Submitted', render: formatDateTime, exportValue: formatDateTime },
              { key: 'timeTakenMinutes', label: 'Time taken', render: formatMinutes, exportValue: formatMinutes },
              { key: 'submissionType', label: 'How it ended', render: (v) => v || '—' },
              { key: 'reviewedAt', label: 'Reviewed', render: formatDateTime, exportValue: formatDateTime },
            ]}
          />
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Close</Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

function moduleResult(m, onAttempts) {
  if (m.offline) {
    if (m.offline.proofUploaded) {
      return (
        <Flex direction="column" alignItems="flex-start">
          <Typography variant="pi">{`Proof uploaded (${m.offline.proofCount} file${m.offline.proofCount === 1 ? '' : 's'})`}</Typography>
          {m.offline.assessedBy && (
            <Typography variant="pi" textColor="neutral600">{`by ${m.offline.assessedBy}`}</Typography>
          )}
        </Flex>
      );
    }
    return <Typography variant="pi" textColor="neutral600">{m.unlocked ? 'Waiting for proof' : 'Not reached yet'}</Typography>;
  }
  if (m.quiz) {
    if (!m.quiz.attempts) return <Typography variant="pi" textColor="neutral600">No attempt yet</Typography>;
    return (
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <Typography variant="pi">
          {`Best ${formatScore(m.quiz.bestScore)} · latest ${formatScore(m.quiz.latestScore)}`}
        </Typography>
        <Button size="S" variant="tertiary" onClick={() => onAttempts(m)}>
          {`${m.quiz.attempts} attempt${m.quiz.attempts === 1 ? '' : 's'}`}
        </Button>
      </Flex>
    );
  }
  if (m.video) {
    return (
      <Typography variant="pi" textColor="neutral600">
        {m.video.durationMinutes ? `Video ${m.video.watchedMinutes ?? 0}/${m.video.durationMinutes} min` : `Video ${m.video.watchedMinutes ?? 0} min`}
      </Typography>
    );
  }
  return <Typography variant="pi" textColor="neutral600">No quiz</Typography>;
}

function CourseCard({ course, expanded, onToggle, onAttempts }) {
  const feedbackText = !course.feedback.enabled
    ? 'Not required'
    : course.feedback.submitted
      ? `Given ${formatDate(course.feedback.submittedAt)}`
      : course.feedback.pending
        ? `Pending${course.feedback.compulsory ? ' (required)' : ''}`
        : 'After all modules';

  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" padding={5} marginBottom={4}>
      <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
        <Box style={{ flex: '1 1 320px' }}>
          <Flex gap={2} alignItems="center" wrap="wrap">
            <Typography variant="delta" tag="h3">{course.courseTitle}</Typography>
            {course.courseVersion && <Badge>{`v${String(course.courseVersion).replace(/^v/i, '')}`}</Badge>}
            <CourseStatusBadge status={course.status} />
            {course.overdue && <Badge variant="danger">Overdue</Badge>}
          </Flex>
          <Typography variant="pi" textColor="neutral600" tag="p" marginTop={1}>
            {[
              `${course.completedModules} of ${course.totalModules} modules done`,
              course.offlineModules ? `${course.offlineCompleted}/${course.offlineModules} offline` : null,
              course.currentModule ? `now on "${course.currentModule.title}" (${course.currentModule.status.toLowerCase()})` : null,
              course.language,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Box>
        <Flex gap={3} alignItems="center">
          <ProgressBar value={course.progressPercent} />
          <Button variant="tertiary" size="S" onClick={onToggle}>
            {expanded ? 'Hide modules' : 'Show modules'}
          </Button>
        </Flex>
      </Flex>

      <Flex gap={6} wrap="wrap" marginTop={4}>
        <Fact label="Assigned">{formatDate(course.assignedAt)}</Fact>
        <Fact label="Started">{formatDate(course.startedAt)}</Fact>
        <Fact label="Completed">{formatDate(course.completedAt)}</Fact>
        <Fact label="Due">{formatDate(course.dueDate)}</Fact>
        <Fact label="Took">{formatDays(course.completionDays)}</Fact>
        <Fact label="Learning time">
          {`${formatMinutes(course.time.totalMinutes)} (content ${formatMinutes(course.time.contentMinutes)}, quiz ${formatMinutes(course.time.quizMinutes)})`}
        </Fact>
        <Fact label="Last activity">
          {course.lastActivityAt ? `${formatDate(course.lastActivityAt)} (${course.inactiveDays}d ago)` : '—'}
        </Fact>
        <Fact label="Feedback">{feedbackText}</Fact>
      </Flex>

      {expanded && (
        <Box marginTop={4}>
          <DataTable
            data={course.modules}
            title="Modules"
            exportFileName={`modules-${course.courseTitle}.xlsx`}
            fontSize="14px"
            columns={[
              { key: 'index', label: '#', render: (v) => v + 1, exportValue: (v) => v + 1 },
              { key: 'title', label: 'Module' },
              { key: 'type', label: 'Type', render: (v) => <ModuleTypeBadge type={v} />, exportValue: (v) => v },
              { key: 'status', label: 'Status', render: (v) => <ModuleStatusBadge status={v} />, exportValue: (v) => v },
              { key: 'startedAt', label: 'Started', render: formatDateTime, exportValue: formatDateTime },
              { key: 'completedAt', label: 'Completed', render: formatDateTime, exportValue: formatDateTime },
              {
                key: 'timeSpentMinutes',
                label: 'Time',
                render: (v, m) =>
                  v == null
                    ? '—'
                    : m.quizMinutes
                      ? `${formatMinutes(v)} (quiz ${formatMinutes(m.quizMinutes)})`
                      : formatMinutes(v),
                exportValue: (v) => formatMinutes(v),
              },
              {
                key: 'result',
                label: 'Quiz / proof',
                render: (_, m) => moduleResult(m, onAttempts),
                exportValue: (_, m) =>
                  m.offline
                    ? m.offline.proofUploaded ? 'Proof uploaded' : 'Waiting for proof'
                    : m.quiz
                      ? `${plural(m.quiz.attempts, 'attempt')}, best ${m.quiz.bestScore ?? '—'}%, latest ${m.quiz.latestScore ?? '—'}%, ${m.quiz.passed ? 'passed' : 'not passed'}`
                      : '—',
              },
            ]}
          />
        </Box>
      )}
    </Box>
  );
}

export function PersonalCourseDetails({ courses = [], summary }) {
  const [expanded, setExpanded] = useState(() => new Set(courses.length === 1 ? [courses[0].courseDocumentId] : []));
  const [attemptsFor, setAttemptsFor] = useState(null);

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!courses.length) {
    return (
      <Box padding={6} background="neutral0" hasRadius shadow="tableShadow">
        <Typography textColor="neutral600">No course is assigned to this employee right now.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {summary && (
        <CardRow>
          <StatCard label="Courses assigned" value={summary.coursesAssigned} subtext={summary.coursesOverdue ? `${summary.coursesOverdue} overdue` : null} colorIndex={0} />
          <StatCard label="Completed" value={summary.coursesCompleted} colorIndex={3} />
          <StatCard label="In progress" value={summary.coursesInProgress} subtext={`${summary.coursesNotStarted} not started`} colorIndex={2} />
          <StatCard label="Average progress" value={`${summary.avgProgress}%`} colorIndex={4} />
          <StatCard label="Online modules done" value={`${summary.onlineModulesCompleted}/${summary.onlineModulesTotal}`} colorIndex={0} />
          {summary.offlineModulesTotal > 0 && (
            <StatCard
              label="Offline modules done"
              value={`${summary.offlineModulesCompleted}/${summary.offlineModulesTotal}`}
              subtext={summary.offlineProofPending ? `${summary.offlineProofPending} waiting for proof` : null}
              colorIndex={1}
            />
          )}
          <StatCard
            label="Quizzes"
            value={formatScore(summary.avgQuizScore)}
            subtext={`avg score · ${summary.quizModulesPassed}/${summary.quizModulesTotal} passed · ${plural(summary.quizAttempts, 'attempt')}`}
            colorIndex={5}
          />
          <StatCard label="Feedback" value={`${summary.feedbackSubmitted} given`} subtext={`${summary.feedbackPending} pending`} colorIndex={1} />
          <StatCard
            label="Learning time"
            value={formatMinutes(summary.learningMinutes)}
            subtext={`content ${formatMinutes(summary.contentMinutes)} · quiz ${formatMinutes(summary.quizMinutes)}`}
            colorIndex={2}
          />
        </CardRow>
      )}

      <SectionTitle hint="Each assigned course with every module. Times are recorded values: time on a module until it was marked done, and quiz time.">
        Courses
      </SectionTitle>
      {courses.map((c) => (
        <CourseCard
          key={c.courseDocumentId}
          course={c}
          expanded={expanded.has(c.courseDocumentId)}
          onToggle={() => toggle(c.courseDocumentId)}
          onAttempts={setAttemptsFor}
        />
      ))}

      {attemptsFor && <AttemptsModal module={attemptsFor} onClose={() => setAttemptsFor(null)} />}
    </Box>
  );
}
