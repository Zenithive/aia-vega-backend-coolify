// @ts-nocheck
/**
 * The areas of Quiz Management, in the order an admin works through them: things that wait
 * on the admin first, then reports. (Offline module proof and feedback are in Course Management.)
 */
export const TABS = [
  {
    path: 'review',
    label: 'Answer review',
    description: "Read learners' written (descriptive) quiz answers, mark them correct or incorrect, and publish the score.",
    permission: 'canReview',
    countKey: 'pendingReviews',
  },
  {
    path: 'reattempts',
    label: 'Reattempt requests',
    description: 'Approve or reject learners asking to retake a quiz.',
    permission: 'canReattempts',
    countKey: 'pendingReattempts',
  },
  {
    path: 'quiz-results',
    label: 'Quiz results',
    description: "See each learner's quiz attempts per module, with every answer, and download them to Excel.",
    permission: 'canQuizResults',
  },
];
