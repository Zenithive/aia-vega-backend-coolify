'use strict';

/**
 * Seed data for analytics dashboards: all enums, all relations, and enough variety
 * so filters (company, view, date range, unit location, pages, department) and
 * charts work in both Overall and Learning dashboards.
 *
 * Run:  npm run seed:all     (delete all seeded content, then add fresh data)
 *       npm run seed:clear   (only remove all seeded data)
 *       npm run seed:reseed  (only add seed data; does not delete)
 *
 * Analytics dates: 2024-06-01 to 2025-02-04. Use Date From/To in dashboard to see data.
 *
 * Prerequisites: At least one user must exist (Content-Manager > Users & Permissions > User)
 * and courses must be created successfully. Otherwise Feedback Submission, Course Assignments,
 * Module Video Progress, Quiz Submissions, Quiz Reattempt Requests, and User Progress will have 0 entries.
 */

const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

const COUNT = 15;

// Analytics date range: spread data so Date From / Date To filters show different results
const ANALYTICS_DATE_START = new Date('2024-06-01T00:00:00.000Z');
const ANALYTICS_DATE_END = new Date('2025-02-04T23:59:59.999Z');
function dateInRange(daysFromStart) {
  const d = new Date(ANALYTICS_DATE_START);
  d.setUTCDate(d.getUTCDate() + daysFromStart);
  if (d > ANALYTICS_DATE_END) return ANALYTICS_DATE_END.toISOString();
  return d.toISOString();
}
function isoDateOnly(daysFromStart) {
  return dateInRange(daysFromStart).slice(0, 10);
}

const SEED_CLEAR_ONLY = process.argv.includes('--clear');
const SEED_ADD_ONLY = process.argv.includes('--add');

// --- Helpers (reuse pattern from seed.js) ---
function getFileSizeInBytes(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

function getFileData(fileName) {
  const filePath = path.join(__dirname, '..', 'data', 'uploads', fileName);
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split('.').pop();
  const mimeType = mime.lookup(ext || '') || 'application/octet-stream';
  return { filepath: filePath, originalFileName: fileName, size, mimetype: mimeType };
}

async function uploadFile(fileInfo, name) {
  const result = await strapi.plugin('upload').service('upload').upload({
    files: fileInfo,
    data: { fileInfo: { alternativeText: name, caption: name, name } },
  });
  return Array.isArray(result) ? result[0] : result;
}

async function getOrUploadImage(fileName = 'default-image.png') {
  const files = await strapi.query('plugin::upload.file').findMany({
    where: { name: { $containsi: fileName.replace(/\.[^.]+$/, '') } },
    limit: 1,
  });
  if (files && files.length > 0) return files[0];
  try {
    const fileData = getFileData(fileName);
    if (fileData.size === 0) return null;
    return await uploadFile(fileData, fileName.replace(/\.[^.]+$/, ''));
  } catch (e) {
    console.warn('Upload image failed:', e?.message);
    return null;
  }
}

async function createAndPublish(uid, data) {
  const doc = await strapi.documents(uid).create({ data });
  if (doc && doc.documentId && strapi.documents(uid).publish) {
    try {
      await strapi.documents(uid).publish({ documentId: doc.documentId });
    } catch (e) {
      console.warn('Publish failed for', uid, e?.message);
    }
  }
  return doc;
}

// Delete in dependency order (children first) so re-seed does not grow counts
async function resetSeedData() {
  const uids = [
    'api::feedback-submission.feedback-submission',
    'api::quiz-reattempt-request.quiz-reattempt-request',
    'api::module-video-progress.module-video-progress',
    'api::quiz-submission.quiz-submission',
    'api::user-progress.user-progress',
    'api::activity-log.activity-log',
    'api::notification.notification',
    'api::course-assignment.course-assignment',
    'api::course.course',
    'api::gallery-item.gallery-item',
    'api::form-template.form-template',
    'api::townhall.townhall',
    'api::holiday.holiday',
    'api::company-policy.company-policy',
    'api::important-link.important-link',
    'api::event.event',
    'api::news.news',
    'api::news-category.news-category',
    'api::unit-location.unit-location',
    'api::department.department',
    'api::city.city',
    'api::company.company',
  ];
  for (const uid of uids) {
    try {
      const { count } = await strapi.db.query(uid).deleteMany({ where: { id: { $gte: 0 } } });
      if (count > 0) console.log('Reset:', uid, count, 'deleted');
    } catch (e) {
      console.warn('Reset', uid, 'failed:', e?.message);
    }
  }
}

async function run() {
  if (SEED_CLEAR_ONLY) {
    console.log('Removing all seeded data...');
    await resetSeedData();
    console.log('Done. Run npm run seed:reseed to add data.');
    return;
  }
  if (!SEED_ADD_ONLY) {
    console.log('Resetting all seeded content (delete then add fresh data)...');
    await resetSeedData();
  } else {
    console.log('Adding seed data (no delete)...');
  }

  const totalDays = Math.max(1, Math.floor((Number(ANALYTICS_DATE_END) - Number(ANALYTICS_DATE_START)) / 86400000));

  const imageFile = await getOrUploadImage('default-image.png');
  const imageId = imageFile?.id ?? imageFile?.documentId ?? null;

  // --- Users: assign company (AIA/Vega) and department for filter/chart variety ---
  const users = await strapi.db.query('plugin::users-permissions.user').findMany({ limit: 20 });
  // Prefer documentId (Strapi 5); fallback to id for relations
  const userIds = users.map((u) => u.documentId ?? u.document_id ?? u.id).filter(Boolean);
  const connectUser = (idx) => {
    if (userIds.length === 0) return undefined;
    const uid = userIds[idx % userIds.length];
    // Strapi 5 document service expects documentId; plugin may use id for relations
    const isNumeric = typeof uid === 'number' || (typeof uid === 'string' && /^\d+$/.test(uid));
    return { connect: [isNumeric ? { id: Number(uid) } : { documentId: uid }] };
  };
  console.log('Using', userIds.length, 'user(s) for analytics (notifications, activity logs, progress).');
  if (userIds.length === 0) {
    console.warn(
      'No users found. Feedback Submission, Course Assignments, Module Video Progress, Quiz Submissions, Quiz Reattempt Requests, and User Progress will have 0 entries. Create at least one user (Users & Permissions > User) then run the seed again.'
    );
  }

  // --- 1. Company (2: AIA, Vega) - use existing if already present to avoid "unique" publish error ---
  const companyIds = [];
  for (const name of ['AIA', 'Vega']) {
    const existing = await strapi.db.query('api::company.company').findMany({
      where: { name: { $eqi: name } },
      limit: 1,
    });
    if (existing && existing.length > 0) {
      const c = existing[0];
      companyIds.push(c.documentId ?? c.id);
    } else {
      const doc = await createAndPublish('api::company.company', {
        name,
        website: `https://${name.toLowerCase()}.com`,
        address: `${name} HQ, 123 Main St`,
        active: true,
        company_type: 'Corporate',
      });
      if (doc) companyIds.push(doc.documentId || doc.id);
    }
  }
  if (companyIds.length === 0) {
    const existing = await strapi.documents('api::company.company').findMany({ status: 'published', limit: 2 });
    existing.forEach((c) => companyIds.push(c.documentId || c.id));
  }
  console.log('Companies:', companyIds.length);

  const connectCompany = (n) => ({ connect: [{ documentId: companyIds[n % companyIds.length] }] });

  // --- 2. City (COUNT) ---
  const cityIds = [];
  for (let i = 0; i < COUNT; i++) {
    const doc = await createAndPublish('api::city.city', {
      name: `City ${i + 1}`,
      state: `State ${(i % 5) + 1}`,
      country: i % 2 === 0 ? 'India' : 'USA',
      active: true,
      company: connectCompany(i),
    });
    if (doc?.documentId) cityIds.push(doc.documentId);
  }
  console.log('Cities:', cityIds.length);

  // --- 3. Unit-location (COUNT) - uses city; route_id/bus_stop_id auto-generated on save ---
  const minimalBusRoute = {
    route_name: 'Seed Route 1',
    route_stops: [{ stop_name: 'Stop 1', bus_sifts: [{ sift_name: 'Shift 1', sift_time: '08:00:00' }] }],
  };
  const unitLocationIds = [];
  for (let i = 0; i < COUNT; i++) {
    try {
      const doc = await createAndPublish('api::unit-location.unit-location', {
        name: `Location ${i + 1}`,
        address: `${i + 1} Industrial Area`,
        contact: `+91 98765${String(i).padStart(5, '0')}`,
        active: true,
        office_location: i % 2 === 0,
        factory_location: i % 2 === 1,
        city: cityIds[i] ? { connect: [{ documentId: cityIds[i] }] } : undefined,
        company: connectCompany(i),
        bus_routes: [minimalBusRoute],
      });
      if (doc?.documentId) unitLocationIds.push(doc.documentId);
    } catch (e) {
      console.warn('Unit-location create failed:', e?.message);
    }
  }
  console.log('Unit locations:', unitLocationIds.length);

  // --- 4. Department (for dashboard Department filter: 2–3 per company, all relations) ---
  const departmentIds = [];
  const departmentNamesByCompany = { 0: [], 1: [] };
  for (let cIdx = 0; cIdx < companyIds.length; cIdx++) {
    const names = cIdx === 0 ? ['HR', 'Engineering', 'Operations'] : ['Sales', 'Support', 'Finance'];
    for (const name of names) {
      try {
        const doc = await createAndPublish('api::department.department', {
          name,
          company: { connect: [{ documentId: companyIds[cIdx] }] },
        });
        if (doc?.documentId) {
          departmentIds.push(doc.documentId);
          if (!departmentNamesByCompany[cIdx]) departmentNamesByCompany[cIdx] = [];
          departmentNamesByCompany[cIdx].push(name);
        }
      } catch (e) {
        console.warn('Department create failed:', e?.message);
      }
    }
  }
  console.log('Departments:', departmentIds.length);

  // Assign some users a department name so dashboard Department filter returns results (user.department is string)
  // db.query uses integer id; userIds may be documentId (string), so use numeric id for update
  const userNumericIds = users.map((u) => u.id).filter((id) => id != null && (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(String(id)))));
  const allDeptNames = departmentNamesByCompany[0]?.concat(departmentNamesByCompany[1] || []) || ['HR', 'Engineering', 'Operations', 'Sales', 'Support', 'Finance'];
  for (let uIdx = 0; uIdx < Math.min(userNumericIds.length, 15); uIdx++) {
    const uid = userNumericIds[uIdx];
    if (uid == null) continue;
    try {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: typeof uid === 'number' ? uid : Number(uid) },
        data: { department: allDeptNames[uIdx % allDeptNames.length] },
      });
    } catch (e) {
      console.warn('User department update skipped:', e?.message);
    }
  }

  // --- 5. News-category (COUNT) - all companies ---
  const newsCategoryIds = [];
  for (let i = 0; i < COUNT; i++) {
    const doc = await createAndPublish('api::news-category.news-category', {
      name: `News Category ${i + 1}`,
      active: true,
      company: connectCompany(i),
    });
    if (doc?.documentId) newsCategoryIds.push(doc.documentId);
  }
  console.log('News categories:', newsCategoryIds.length);

  // --- 7. News (COUNT) - required: title, description, cover_image, active, visible_on_homepage; publish_date future ---
  const futureDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let newsCount = 0;
  if (imageId) {
    for (let i = 0; i < COUNT; i++) {
      try {
        await createAndPublish('api::news.news', {
          title: `News Title ${i + 1}`,
          description: `<p>News description for entry ${i + 1}.</p>`,
          cover_image: { connect: [{ id: imageId }] },
          active: true,
          visible_on_homepage: i % 3 === 0,
          news_category: newsCategoryIds[i] ? { connect: [{ documentId: newsCategoryIds[i] }] } : undefined,
          company: connectCompany(i),
          publish_date: futureDate,
        });
        newsCount++;
      } catch (e) {
        console.warn('News create failed:', e?.message);
      }
    }
  } else {
    console.warn('News skipped: no image for required cover_image.');
  }
  console.log('News:', newsCount);

  // --- 8. Event (COUNT) - all enums: event_type (Training session, Conference, Workshop), event_created_for (All, department) ---
  const eventTypes = ['Training session', 'Conference', 'Workshop'];
  const start = new Date();
  const end = new Date(Date.now() + 86400000 * 2);
  for (let i = 0; i < COUNT; i++) {
    const useDept = i % 5 === 4 && departmentIds.length > 0;
    const entry = {
      title: `Event ${i + 1}`,
      description: `<p>Event description ${i + 1}.</p>`,
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      event_location: `Venue ${i + 1}`,
      active: true,
      visible_on_homepage: i % 2 === 0,
      company: connectCompany(i),
      event_created_for: useDept ? 'department' : 'All',
      event_type: eventTypes[i % eventTypes.length],
    };
    if (useDept) entry.department = { connect: [{ documentId: departmentIds[i % departmentIds.length] }] };
    await createAndPublish('api::event.event', entry);
  }
  console.log('Events:', COUNT);

  // --- 9. Holiday (COUNT) - all enums: holiday_for (All, Unit_location, City, Department) with relations ---
  const holidayForOptions = ['All', 'Unit_location', 'City', 'Department'];
  for (let i = 0; i < Math.max(COUNT, holidayForOptions.length * 2); i++) {
    const holidayFor = holidayForOptions[i % holidayForOptions.length];
    const entry = {
      title: `Holiday ${i + 1} (${holidayFor})`,
      date: new Date(Date.now() + 86400000 * (i + 10)).toISOString().slice(0, 10),
      active: true,
      holiday_for: holidayFor,
      companies: connectCompany(i),
    };
    if (holidayFor === 'Unit_location' && unitLocationIds.length > 0) {
      entry.unit_location = { connect: [{ documentId: unitLocationIds[i % unitLocationIds.length] }] };
    } else if (holidayFor === 'City' && cityIds.length > 0) {
      entry.city = { connect: [{ documentId: cityIds[i % cityIds.length] }] };
    } else if (holidayFor === 'Department' && departmentIds.length > 0) {
      entry.departments = { connect: [{ documentId: departmentIds[i % departmentIds.length] }] };
    }
    try {
      await createAndPublish('api::holiday.holiday', entry);
    } catch (e) {
      console.warn('Holiday create failed:', e?.message);
    }
  }
  console.log('Holidays: all holiday_for enums + relations');

  // --- 10. Company-policy (COUNT) ---
  for (let i = 0; i < COUNT; i++) {
    await createAndPublish('api::company-policy.company-policy', {
      title: `Policy ${i + 1}`,
      description: `<p>Policy content for policy ${i + 1}.</p>`,
      active: true,
      company: connectCompany(i),
    });
  }
  console.log('Company policies:', COUNT);

  // --- 11. Important-link (COUNT) - required: title, url, active, icon (iconhub: iconName + iconData) ---
  const minimalIcon = {
    iconName: 'mdi:link',
    iconData: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>',
  };
  for (let i = 0; i < COUNT; i++) {
    try {
      await createAndPublish('api::important-link.important-link', {
        title: `Important Link ${i + 1}`,
        url: `https://example.com/link-${i + 1}`,
        active: true,
        company: connectCompany(i),
        icon: minimalIcon,
      });
    } catch (e) {
      console.warn('Important-link create failed (icon?):', e?.message);
    }
  }
  console.log('Important links:', COUNT);

  // --- 12. Notifications (COUNT) - need user (plugin user uses id) ---
  for (let i = 0; i < COUNT; i++) {
    if (userIds.length === 0) break;
    try {
      await createAndPublish('api::notification.notification', {
        type: ['Course_assigned', 'Quiz_passed', 'Quiz_failed', 'Certificate_issued', 'Due_date_reminder'][i % 5],
        title: `Notification ${i + 1}`,
        message: `Message for notification ${i + 1}`,
        is_read: false,
        sent_via_email: false,
        user: connectUser(i),
      });
    } catch (e) {
      console.warn('Notification create failed:', e?.message);
    }
  }
  console.log('Notifications:', COUNT);

  // --- 13. Townhall (COUNT) - meeting_video or meeting_document required ---
  for (let i = 0; i < COUNT; i++) {
    const usePdf = i % 2 === 0;
    const entry = {
      name: `Townhall ${i + 1}`,
      meeting_date: new Date(Date.now() + 86400000 * (i + 5)).toISOString().slice(0, 10),
      description: `<p>Townhall description ${i + 1}.</p>`,
      meeting_content_type: usePdf ? 'Pdf' : 'Video',
      company: connectCompany(i),
      active: true,
    };
    if (imageId) {
      entry.meeting_video = usePdf ? undefined : { connect: [{ id: imageId }] };
      entry.meeting_document = usePdf ? { connect: [{ id: imageId }] } : undefined;
    }
    try {
      await createAndPublish('api::townhall.townhall', entry);
    } catch (e) {
      console.warn('Townhall create failed:', e?.message);
    }
  }
  console.log('Townhalls:', COUNT);

  // --- 14. Course (COUNT) - required: title, description, active, course_category, modules, course_duration_min, min_passing_score, course_language; feedback = component with language + feedback_question ---
  const courseIds = [];
  const minimalModule = {
    language: 'English',
    title: 'Module 1',
    module_content_type: 'Text',
    mark_as_read: false,
    module_duration_min: 10,
    text_content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Seed content.' }] }],
  };
  const minimalQuizQuestion = {
    question_text: 'Sample question?',
    question_type: 'Multiple_choice',
    order: 1,
    point: 1,
    options: [{ option_key: 'A', option_label: 'Option A' }, { option_key: 'B', option_label: 'Option B' }],
  };
  const minimalQuiz = {
    language: 'English',
    title: 'Quiz 1',
    quiz_questions: [minimalQuizQuestion],
    quiz_instruction: [{ name: 'Instructions', description: 'Answer the question.' }],
    quiz_instruction_checklist: [{ discription: 'Complete the quiz.' }],
  };
  for (let i = 0; i < COUNT; i++) {
    const minimalFeedbackQuestion = {
      question_id: `course-feedback-q-${i}`,
      qestion: 'How would you rate this course?',
      answer_type: 'Rating',
      mandatory: true,
      compulsory: true,
    };
    const minimalFeedbackForm = {
      language: 'English',
      feedback_question: [minimalFeedbackQuestion],
    };
    try {
      const doc = await createAndPublish('api::course.course', {
        title: `Course ${i + 1}`,
        description: [{ type: 'paragraph', children: [{ type: 'text', text: `Course description ${i + 1}.` }] }],
        active: true,
        course_category: ['Mandatory', 'Orientation', 'Other'][i % 3],
        course_duration_min: 30 + (i % 5) * 10,
        min_passing_score: 60,
        course_language: ['English', 'Hindi', 'Gujarati'].slice(0, (i % 3) + 1),
        modules: [{ ...minimalModule, title: `Course ${i + 1} - Module 1` }],
        quiz: [minimalQuiz],
        feedback: [minimalFeedbackForm],
        company: connectCompany(i),
      });
      if (doc?.documentId) courseIds.push(doc.documentId);
    } catch (e) {
      console.warn('Course create failed:', e?.message);
    }
  }
  console.log('Courses:', courseIds.length);
  if (courseIds.length === 0) {
    console.warn(
      'No courses created. Feedback Submission, Course Assignments, Module Video Progress, Quiz Submissions, Quiz Reattempt Requests, and User Progress will have 0 entries. Fix course creation errors above then run the seed again.'
    );
  }

  // --- 14b. Feedback-submission (requires: users + courses) ---
  let feedbackSubmissionCount = 0;
  const answerTypesSubmission = ['Rating', 'Text', 'AgreeOrDisagree', 'YesOrNo'];
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let fIdx = 0; fIdx < Math.min(courseIds.length, 10); fIdx++) {
      const courseId = courseIds[fIdx] || courseIds[0];
      if (!courseId || userIds.length === 0) continue;
      try {
        await createAndPublish('api::feedback-submission.feedback-submission', {
          course: { connect: [{ documentId: courseId }] },
          users_permissions_user: connectUser(uIdx),
          answers: [
            { question_id: `fb-1`, question: 'How would you rate?', answer_type: answerTypesSubmission[(uIdx + fIdx) % 4], answer: (uIdx + fIdx) % 5 <= 2 ? '4' : 'Good' },
            { question_id: `fb-2`, question: 'Comments', answer_type: 'Text', answer: `Analytics feedback user ${uIdx + 1} course ${fIdx + 1}.` },
          ],
        });
        feedbackSubmissionCount++;
      } catch (e) {
        console.warn('Feedback-submission create failed:', e?.message);
      }
    }
  }
  console.log('Feedback submissions (analytics):', feedbackSubmissionCount);

  // --- 14c. Quiz-reattempt-request (analytics: course + user only; no quiz relation) ---
  const requestStatuses = ['Pending', 'Approved', 'Rejected'];
  let quizReattemptCount = 0;
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < Math.min(courseIds.length, 8); cIdx++) {
      const courseId = courseIds[cIdx] || courseIds[0];
      if (!courseId || userIds.length === 0) continue;
      try {
        await createAndPublish('api::quiz-reattempt-request.quiz-reattempt-request', {
          course: { connect: [{ documentId: courseId }] },
          users_permissions_user: connectUser(uIdx),
          request_status: requestStatuses[(uIdx + cIdx) % 3],
          requested_for_attempt: (cIdx % 3) + 1,
        });
        quizReattemptCount++;
      } catch (e) {
        console.warn('Quiz-reattempt-request create failed:', e?.message);
      }
    }
  }
  console.log('Quiz reattempt requests (analytics):', quizReattemptCount);

  // --- 16. Gallery-item (COUNT) - required: title, media_type, visibility, description, date, location; when media_type Image: image required ---
  for (let i = 0; i < COUNT; i++) {
    const entry = {
      title: `Gallery ${i + 1}`,
      media_type: 'Image',
      visibility: true,
      description: `Seed gallery item ${i + 1} description.`,
      date: dateInRange(i % Math.max(1, totalDays)).slice(0, 10),
      location: `Location ${(i % 5) + 1}`,
      company: connectCompany(i),
    };
    if (imageId) entry.image = { connect: [{ id: imageId }] };
    try {
      await createAndPublish('api::gallery-item.gallery-item', entry);
    } catch (e) {
      console.warn('Gallery-item create failed:', e?.message);
    }
  }
  console.log('Gallery items:', COUNT);

  // --- 18. Form-template (COUNT) - required: title, custom_yes_no, form_type, description, active; PDF/Excel/Word: form_* media + is_downloadable; URL: form_url ---
  for (let i = 0; i < COUNT; i++) {
    const formType = ['PDF', 'URL', 'Excel', 'Word'][i % 4];
    const entry = {
      title: `Form Template ${i + 1}`,
      description: `Form template description ${i + 1}.`,
      custom_yes_no: i % 2 === 0,
      form_type: formType,
      active: true,
      company: connectCompany(i),
    };
    if (formType === 'URL') {
      entry.form_url = `https://example.com/form-${i + 1}`;
    } else {
      entry.is_downloadable = false;
      if (imageId) {
        if (formType === 'PDF') entry.form_pdf = { connect: [{ id: imageId }] };
        else if (formType === 'Excel') entry.form_excel = { connect: [{ id: imageId }] };
        else if (formType === 'Word') entry.form_word = { connect: [{ id: imageId }] };
      }
    }
    try {
      await createAndPublish('api::form-template.form-template', entry);
    } catch (e) {
      console.warn('Form-template create failed:', e?.message);
    }
  }
  console.log('Form templates:', COUNT);

  // --- 19. Activity-log: all enums (every page type) + all relations (both companies) so dashboard filters/charts work ---
  const activityPageTypes = ['News', 'Event', 'Course', 'Quiz', 'Feedback', 'Location', 'Routes', 'People', 'Gallery', 'Home', 'Company policy', 'Form & Templates', 'Calendar'];
  /** @typedef {'News'|'Event'|'Course'|'Quiz'|'Feedback'|'Location'|'Routes'|'People'|'Gallery'|'Home'|'Company policy'|'Form & Templates'|'Calendar'} ActivityPageType */
  let activityLogCount = 0;
  // Guarantee at least one log per (activity_type, company) so Pages + Company filters always have data
  if (userIds.length > 0) {
    for (let tIdx = 0; tIdx < activityPageTypes.length; tIdx++) {
      for (let cIdx = 0; cIdx < companyIds.length; cIdx++) {
        try {
          const pageType = /** @type {ActivityPageType} */ (activityPageTypes[tIdx]);
          await strapi.documents('api::activity-log.activity-log').create({
            data: {
              user: userIds[(tIdx + cIdx) % userIds.length],
              company: { connect: [{ documentId: companyIds[cIdx] }] },
              activity_type: pageType,
              activity_description: `Seed ${pageType} activity (company ${cIdx + 1})`,
              activity_duration: Math.max(1, (tIdx % 5) + 1),
              timestamp: dateInRange((tIdx * 7 + cIdx) % Math.max(1, totalDays)),
            },
          });
          activityLogCount++;
        } catch (e) {
          console.warn('Activity-log create failed:', e?.message);
        }
      }
    }
  }
  // Extra volume across date range for charts
  for (let i = 0; i < COUNT * 3; i++) {
    if (userIds.length === 0) break;
    const dayOffset = (i * 11) % Math.max(1, totalDays);
    const activityType = /** @type {ActivityPageType} */ (activityPageTypes[i % activityPageTypes.length]);
    try {
      await strapi.documents('api::activity-log.activity-log').create({
        data: {
          user: userIds[i % userIds.length],
          company: connectCompany(i),
          activity_type: activityType,
          activity_description: `Activity ${i + 1} (${activityType})`,
          activity_duration: Math.max(1, (i % 5) + 1),
          timestamp: dateInRange(dayOffset),
        },
      });
      activityLogCount++;
    } catch (e) {
      console.warn('Activity-log create failed:', e?.message);
    }
  }
  console.log('Activity logs (analytics):', activityLogCount);

  // --- 20. Course-assignment (to individual users, not department) ---
  let courseAssignmentCount = 0;
  for (let i = 0; i < COUNT; i++) {
    const courseId = courseIds[i] || courseIds[0];
    if (!courseId || userIds.length === 0) continue;
    try {
      await createAndPublish('api::course-assignment.course-assignment', {
        assignment_target_type: 'Individual',
        due_date: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
        active: true,
        course: { connect: [{ documentId: courseId }] },
        individual_user: connectUser(i),
      });
      courseAssignmentCount++;
    } catch (e) {
      console.warn('Course-assignment create failed:', e?.message);
    }
  }
  console.log('Course assignments (individual):', courseAssignmentCount);

  // --- 21. Quiz-submission (analytics: repeatable quiz.answer; submitted_at spread for date filter) ---
  let quizSubmissionCount = 0;
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < Math.min(courseIds.length, 8); cIdx++) {
      const courseId = courseIds[cIdx] || courseIds[0];
      if (!courseId) continue;
      const score = 60 + (uIdx + cIdx) % 40;
      const passed = score >= 60;
      const dayOffset = (uIdx * 7 + cIdx * 5) % Math.max(1, totalDays);
      try {
        await createAndPublish('api::quiz-submission.quiz-submission', {
          answers: [
            { question_id: `q-${cIdx}-1`, question: 'Sample question 1', question_type: 'Multiple_choice', answer: 'A', point: score > 70 ? 1 : 0, correct: score > 70 },
            { question_id: `q-${cIdx}-2`, question: 'Sample question 2', question_type: 'Multiple_select', answer: 'A,B', point: score > 70 ? 1 : 0, correct: score > 70 },
          ],
          score,
          passed,
          attempt_number: (cIdx % 3) + 1,
          submitted_by: connectUser(uIdx),
          course: { connect: [{ documentId: courseId }] },
          submitted_at: dateInRange(dayOffset),
        });
        quizSubmissionCount++;
      } catch (e) {
        console.warn('Quiz-submission create failed:', e?.message);
      }
    }
  }
  console.log('Quiz submissions (analytics):', quizSubmissionCount);

  // --- 22. User-progress (analytics-centric: last_accessed_at/completed_at spread for date filters & monthly trend) ---
  const statuses = ['Not_started', 'In_progress', 'Completed', 'Failed'];
  const monthsForCompleted = ['2024-09', '2024-10', '2024-11', '2024-12', '2025-01', '2025-02'];
  let userProgressCount = 0;
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < Math.min(courseIds.length, 12); cIdx++) {
      const courseId = courseIds[cIdx];
      if (!courseId) continue;
      const status = statuses[(uIdx + cIdx) % 4];
      const isCompleted = status === 'Completed';
      const monthIdx = cIdx % monthsForCompleted.length;
      const completedAt = isCompleted
        ? `${monthsForCompleted[monthIdx]}-${String((uIdx + cIdx) % 28 + 1).padStart(2, '0')}T12:00:00.000Z`
        : null;
      const dayOffset = (uIdx * 20 + cIdx * 5) % Math.max(1, totalDays);
      const lastAccessed = dateInRange(dayOffset);

      // Populate completed_modules based on status
      let completedModules = [];
      if (isCompleted) {
        // 2-4 modules completed
        const num = 2 + ((uIdx + cIdx) % 3); // 2, 3, or 4
        completedModules = Array.from({ length: num }, (_, i) => `mod-${cIdx + 1}-${i + 1}`);
      } else if (status === 'In_progress') {
        // 1 module started
        completedModules = [`mod-${cIdx + 1}-1`];
      }
      // Not_started and Failed: leave empty

      try {
        await createAndPublish('api::user-progress.user-progress', {
          user: connectUser(uIdx),
          course: { connect: [{ documentId: courseId }] },
          progress_status: status,
          progress_percentage: isCompleted ? 100 : Math.min(90, (uIdx + cIdx) * 8),
          completed_modules: completedModules,
          last_accessed_at: lastAccessed,
          time_spent_minutes: 10 + (uIdx % 5) * 10 + (cIdx % 3) * 5,
          certificate_issued: isCompleted && cIdx % 2 === 0,
          completed_at: completedAt || undefined,
        });
        userProgressCount++;
      } catch (e) {
        console.warn('User-progress create failed:', e?.message);
      }
    }
  }
  console.log('User progress (analytics):', userProgressCount);

  // --- 23. Module-video-progress (same courses as user-progress so "Module video details" has data for every course in dropdown) ---
  const videoTypes = ['full_watch', 'skipped_to_end', 'in_progress', 'not_started'];
  let moduleVideoCount = 0;
  const numCoursesForModuleVideo = Math.min(courseIds.length, 12);
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < numCoursesForModuleVideo; cIdx++) {
      const courseId = courseIds[cIdx];
      if (!courseId) continue;
      for (let mIdx = 0; mIdx < 3; mIdx++) {
        const durationSec = 120 + mIdx * 60;
        const vtype = videoTypes[(uIdx + cIdx + mIdx) % 4];
        const watchedSec = vtype === 'not_started' ? 0 : vtype === 'full_watch' ? durationSec : Math.floor(durationSec * 0.6);
        const dayOffset = (uIdx * 15 + cIdx * 3 + mIdx) % Math.max(1, totalDays);
        try {
          await createAndPublish('api::module-video-progress.module-video-progress', {
            user: connectUser(uIdx),
            course: { connect: [{ documentId: courseId }] },
            module_index: mIdx,
            module_title: `Module ${mIdx + 1}`,
            video_completion_type: vtype,
            time_watched_seconds: watchedSec,
            video_duration_seconds: durationSec,
            last_updated: dateInRange(dayOffset),
          });
          moduleVideoCount++;
        } catch (e) {
          console.warn('Module-video-progress create failed:', e?.message);
        }
      }
    }
  }
  console.log('Module video progress (analytics):', moduleVideoCount);

  console.log('Seed complete.');
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  // Expose Strapi so run() and helpers (createAndPublish, getOrUploadImage, etc.) can use strapi.documents / strapi.db
  global.strapi = app;
  try {
    await run();
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
  await app.destroy();
  process.exit(0);
}

main();
