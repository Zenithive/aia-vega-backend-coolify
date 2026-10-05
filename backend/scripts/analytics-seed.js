
// Standalone Strapi bootstrap seed script
'use strict';
const { createStrapi, compileStrapi } = require('@strapi/strapi');
const COUNT = 15;

async function seedAnalytics(strapi) {
  // --- Helper: Get users and courses ---
  const users = await strapi.db.query('plugin::users-permissions.user').findMany({ limit: COUNT });
  const userIds = users.map(u => u.id).filter(id => typeof id === 'string' || typeof id === 'number');
  const courses = await strapi.db.query('api::course.course').findMany({ limit: COUNT });
  const courseIds = courses.map(c => c.id).filter(id => typeof id === 'string' || typeof id === 'number');
  // Fail fast if any ID is not a string or number
  if (userIds.length !== users.length) throw new Error('Some user IDs are not plain string/number');
  if (courseIds.length !== courses.length) throw new Error('Some course IDs are not plain string/number');
  console.log('userIds:', userIds);
  console.log('courseIds:', courseIds);

  // --- 1. Course Assignment ---
  for (let i = 0; i < COUNT; i++) {
    const courseId = courseIds[i % courseIds.length];
    const userId = userIds[i % userIds.length];
    // Try all possible formats for many-to-many relation
    const payloads = [
      { individual_user: [userId] },
      { individual_user: [{ id: userId }] },
      { individual_users: [userId] },
      { individual_users: [{ id: userId }] },
    ];
    let created = false;
    for (const rel of payloads) {
      const data = {
        assignment_target_type: 'Individual',
        due_date: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
        course: courseId,
        ...rel,
      };
      if (i === 0) {
        console.log('Trying Course Assignment payload:', JSON.stringify(data));
      }
      try {
        await strapi.entityService.create('api::course-assignment.course-assignment', { data });
        created = true;
        if (i === 0) {
          console.log('SUCCESS with payload:', JSON.stringify(data));
        }
        break;
      } catch (e) {
        if (i === 0) {
          console.log('FAILED with payload:', JSON.stringify(data), 'Error:', e.message);
        }
      }
    }
    if (!created) {
      throw new Error('All payload formats failed for Course Assignment');
    }
  }

  // --- 2. Feedback Submission ---
  const answerTypesSubmission = ['Rating', 'Text', 'AgreeOrDisagree', 'YesOrNo'];
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let fIdx = 0; fIdx < Math.min(courseIds.length, 10); fIdx++) {
      const courseId = courseIds[fIdx % courseIds.length];
      const userId = userIds[uIdx % userIds.length];
      // Check if user and course exist in DB
      const userExists = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: userId } });
      const courseExists = await strapi.db.query('api::course.course').findOne({ where: { id: courseId } });
      if (!userExists) {
        throw new Error(`User with id ${userId} does not exist in DB`);
      }
      if (!courseExists) {
        throw new Error(`Course with id ${courseId} does not exist in DB`);
      }
      // Generate unique question_ids per answer per submission
      const qid1 = `fb-1-u${userId}-c${courseId}`;
      const qid2 = `fb-2-u${userId}-c${courseId}`;
      const data = {
        course: courseId,
        users_permissions_user: userId,
        answers: [
          { question_id: qid1, question: 'How would you rate?', answer_type: answerTypesSubmission[(uIdx + fIdx) % 4], answer: (uIdx + fIdx) % 5 <= 2 ? '4' : 'Good' },
          { question_id: qid2, question: 'Comments', answer_type: 'Text', answer: `Feedback user ${uIdx + 1} course ${fIdx + 1}.` },
        ],
      };
      // Fail fast if relation fields are not plain IDs
      if (typeof data.course !== 'string' && typeof data.course !== 'number') throw new Error('FeedbackSubmission: course is not a plain ID');
      if (typeof data.users_permissions_user !== 'string' && typeof data.users_permissions_user !== 'number') throw new Error('FeedbackSubmission: users_permissions_user is not a plain ID');
      if (uIdx === 0 && fIdx === 0) {
        console.log('Feedback Submission payload:', JSON.stringify(data));
      }
      await strapi.db.query('api::feedback-submission.feedback-submission').create({ data });
    }
  }

  // --- 3. Module Video Progress ---
  const videoTypes = ['full_watch', 'skipped_to_end', 'in_progress', 'not_started'];
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < Math.min(courseIds.length, 12); cIdx++) {
      for (let mIdx = 0; mIdx < 3; mIdx++) {
        const durationSec = 120 + mIdx * 60;
        const vtype = videoTypes[(uIdx + cIdx + mIdx) % 4];
        const watchedSec = vtype === 'not_started' ? 0 : vtype === 'full_watch' ? durationSec : Math.floor(durationSec * 0.6);
        const userId = userIds[uIdx % userIds.length];
        const courseId = courseIds[cIdx % courseIds.length];
        const data = {
          user: userId,
          course: courseId,
          module_index: mIdx,
          module_title: `Module ${mIdx + 1}`,
          video_completion_type: vtype,
          time_watched_seconds: watchedSec,
          video_duration_seconds: durationSec,
          last_updated: new Date().toISOString(),
        };
        if (typeof data.user !== 'string' && typeof data.user !== 'number') throw new Error('ModuleVideoProgress: user is not a plain ID');
        if (typeof data.course !== 'string' && typeof data.course !== 'number') throw new Error('ModuleVideoProgress: course is not a plain ID');
        if (uIdx === 0 && cIdx === 0 && mIdx === 0) {
          console.log('Module Video Progress payload:', JSON.stringify(data));
        }
        await strapi.db.query('api::module-video-progress.module-video-progress').create({ data });
      }
    }
  }

  // --- 4. Quiz Reattempt Requests ---
  const requestStatuses = ['Pending', 'Approved', 'Rejected'];
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < Math.min(courseIds.length, 8); cIdx++) {
      const courseId = courseIds[cIdx % courseIds.length];
      const userId = userIds[uIdx % userIds.length];
      const data = {
        course: courseId,
        users_permissions_user: userId,
        request_status: requestStatuses[(uIdx + cIdx) % 3],
        requested_for_attempt: (cIdx % 3) + 1,
      };
      if (typeof data.course !== 'string' && typeof data.course !== 'number') throw new Error('QuizReattemptRequest: course is not a plain ID');
      if (typeof data.users_permissions_user !== 'string' && typeof data.users_permissions_user !== 'number') throw new Error('QuizReattemptRequest: users_permissions_user is not a plain ID');
      if (uIdx === 0 && cIdx === 0) {
        console.log('Quiz Reattempt Request payload:', JSON.stringify(data));
      }
      await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').create({ data });
    }
  }

  // --- 5. Quiz Submissions ---
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < Math.min(courseIds.length, 8); cIdx++) {
      const score = 60 + (uIdx + cIdx) % 40;
      const passed = score >= 60;
      const userId = userIds[uIdx % userIds.length];
      const courseId = courseIds[cIdx % courseIds.length];
      const data = {
        answers: [
          { question_id: `q-${cIdx}-1`, question: 'Sample question 1', question_type: 'Multiple_choice', answer: 'A', point: score > 70 ? 1 : 0, correct: score > 70 },
          { question_id: `q-${cIdx}-2`, question: 'Sample question 2', question_type: 'Multiple_select', answer: 'A,B', point: score > 70 ? 1 : 0, correct: score > 70 },
        ],
        score,
        passed,
        attempt_number: (cIdx % 3) + 1,
        submitted_by: userId,
        course: courseId,
        submitted_at: new Date().toISOString(),
      };
      if (typeof data.submitted_by !== 'string' && typeof data.submitted_by !== 'number') throw new Error('QuizSubmission: submitted_by is not a plain ID');
      if (typeof data.course !== 'string' && typeof data.course !== 'number') throw new Error('QuizSubmission: course is not a plain ID');
      if (uIdx === 0 && cIdx === 0) {
        console.log('Quiz Submission payload:', JSON.stringify(data));
      }
      await strapi.db.query('api::quiz-submission.quiz-submission').create({ data });
    }
  }

  // --- 6. User Progress ---
  const statuses = ['Not_started', 'In_progress', 'Completed', 'Failed'];
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < Math.min(courseIds.length, 12); cIdx++) {
      const status = statuses[(uIdx + cIdx) % 4];
      const isCompleted = status === 'Completed';
      let completedModules = [];
      if (isCompleted) {
        const num = 2 + ((uIdx + cIdx) % 3);
        completedModules = Array.from({ length: num }, (_, i) => `mod-${cIdx + 1}-${i + 1}`);
      } else if (status === 'In_progress') {
        completedModules = [`mod-${cIdx + 1}-1`];
      }
      const userId = userIds[uIdx % userIds.length];
      const courseId = courseIds[cIdx % courseIds.length];
      const data = {
        user: userId,
        course: courseId,
        progress_status: status,
        progress_percentage: isCompleted ? 100 : Math.min(90, (uIdx + cIdx) * 8),
        completed_modules: completedModules,
        last_accessed_at: new Date().toISOString(),
        time_spent_minutes: 10 + (uIdx % 5) * 10 + (cIdx % 3) * 5,
        certificate_issued: isCompleted && cIdx % 2 === 0,
        completed_at: isCompleted ? new Date().toISOString() : undefined,
      };
      if (typeof data.user !== 'string' && typeof data.user !== 'number') throw new Error('UserProgress: user is not a plain ID');
      if (typeof data.course !== 'string' && typeof data.course !== 'number') throw new Error('UserProgress: course is not a plain ID');
      if (uIdx === 0 && cIdx === 0) {
        console.log('User Progress payload:', JSON.stringify(data));
      }
      await strapi.db.query('api::user-progress.user-progress').create({ data });
    }
  }
}

async function main() {
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  try {
    await seedAnalytics(app);
    console.log('Analytics seed complete.');
  } catch (error) {
    console.error('Analytics seed failed:', error);
  }
  await app.destroy();
  process.exit(0);
}

main();
