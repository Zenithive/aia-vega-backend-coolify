const QUIZ_UID = 'api::quiz-submission.quiz-submission';
const COURSE_UID = 'api::course.course';

function normalizeCompany(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text === 'aia') return 'AIA';
  if (text === 'vega') return 'Vega';
  return '';
}

function getEmployeeName(user = {}) {
  const first = String(user.firstname || '').trim();
  const last = String(user.lastname || '').trim();
  const full = `${first} ${last}`.trim();
  return full || user.username || user.email || '-';
}

function extractSelectedAnswer(answer = {}) {
  if (answer.question_type === 'Multiple_select') {
    const value = answer.selected_answer_for_multiSelect;
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return value ? String(value) : '-';
  }
  return answer.selected_answer_for_multiChoice || '-';
}

function appendCorrectnessSuffix(answerText, answer = {}) {
  const base = String(answerText ?? '-');
  const correctness = answer?.correct ?? answer?.is_correct;
  if (correctness === true) return `${base} (true)`;
  if (correctness === false) return `${base} (false)`;
  return `${base} (-)`;
}

function buildQuestionOptionMap(course = {}) {
  const map = new Map();
  const quizzes = Array.isArray(course?.quiz) ? course.quiz : [];
  for (const quiz of quizzes) {
    const questions = Array.isArray(quiz?.quiz_questions) ? quiz.quiz_questions : [];
    for (const question of questions) {
      const qId = String(question?.question_id || '').trim();
      if (!qId) continue;
      const options = Array.isArray(question?.options) ? question.options : [];
      const optionMap = new Map();
      for (const option of options) {
        const key = String(option?.option_key || '').trim();
        const label = String(option?.option_label || '').trim();
        if (key) optionMap.set(key, label || key);
      }
      if (optionMap.size) map.set(qId, optionMap);
    }
  }
  return map;
}

module.exports = ({ strapi }) => ({
  async getCourses(companyRaw) {
    const company = normalizeCompany(companyRaw);
    if (!company) return [];

    const courses = await strapi.db.query(COURSE_UID).findMany({
      populate: ['company'],
      orderBy: { title: 'asc' },
    });

    const filtered = (courses || [])
      .filter((course) =>
        Array.isArray(course.company)
          ? course.company.some((c) => String(c?.name || '').toLowerCase() === company.toLowerCase())
          : String(course.company?.name || '').toLowerCase() === company.toLowerCase()
      )
      .map((course) => ({ id: course.id, documentId: course.documentId || null, title: course.title }));

    // De-duplicate repeated titles in dropdown.
    const byTitle = new Map();
    for (const course of filtered) {
      const key = String(course.title || '').trim().toLowerCase();
      if (!key) continue;
      if (!byTitle.has(key)) byTitle.set(key, course);
    }
    return Array.from(byTitle.values());
  },

  async getSubmissions({ company: companyRaw, courseId }) {
    const company = normalizeCompany(companyRaw);
    const selectedCourseId = String(courseId || '').trim();
    const hasCourseFilter = selectedCourseId !== '';

    const submissions = await strapi.db.query(QUIZ_UID).findMany({
      populate: ['answers', 'submitted_by', 'course', 'course.company', 'course.quiz', 'course.quiz.quiz_questions', 'course.quiz.quiz_questions.options'],
      orderBy: { submitted_at: 'desc' },
    });

    const filtered = (submissions || []).filter((submission) => {
      const user = submission.submitted_by || {};
      const course = submission.course || {};
      const courseCompanies = Array.isArray(course.company) ? course.company : course.company ? [course.company] : [];
      const courseHasCompany = !company
        ? true
        : courseCompanies.some((c) => String(c?.name || '').toLowerCase() === company.toLowerCase());
      const userHasCompany = !company
        ? true
        : String(user.company || '').toLowerCase() === company.toLowerCase();
      if (company && !userHasCompany) return false;
      if (!company && !(courseHasCompany || userHasCompany)) return false;

      if (!hasCourseFilter) return true;
      const courseIdValue = String(course.id || '').trim();
      const courseDocumentIdValue = String(course.documentId || '').trim();
      return courseIdValue === selectedCourseId || courseDocumentIdValue === selectedCourseId;
    });

    // Keep only latest submission per user+course to avoid duplicate rows.
    const latestByUserCourse = new Map();
    for (const submission of filtered) {
      const user = submission.submitted_by || {};
      const course = submission.course || {};
      const userKey = String(user.id || user.documentId || user.emp_code || user.emp_id || 'unknown-user');
      const courseKey = String(course.id || course.documentId || 'unknown-course');
      const key = `${userKey}::${courseKey}`;
      const currentTs = new Date(submission.submitted_at || submission.createdAt || 0).getTime();
      const previous = latestByUserCourse.get(key);
      const previousTs = previous ? new Date(previous.submitted_at || previous.createdAt || 0).getTime() : -1;
      if (!previous || currentTs >= previousTs) {
        latestByUserCourse.set(key, submission);
      }
    }
    const deduped = Array.from(latestByUserCourse.values());

    const questionOrder = [];
    const questionKeyById = new Map();
    const rows = deduped.map((submission) => {
      const user = submission.submitted_by || {};
      const course = submission.course || {};
      const optionMapByQuestionId = buildQuestionOptionMap(course);
      const answers = Array.isArray(submission.answers) ? submission.answers : [];
      const totalQuestions = answers.length;
      const correct = answers.filter((answer) => answer?.correct === true).length;
      const percentage = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;

      const row = {
        id: submission.id,
        emp_name: getEmployeeName(user),
        emp_id: user.emp_id || '-',
        emp_code: user.emp_code || '-',
        score: `${correct}/${totalQuestions} (${percentage}%)`,
      };

      answers.forEach((answer, index) => {
        const qId = String(answer?.question_id || '').trim() || `idx_${index + 1}`;
        let key = questionKeyById.get(qId);
        if (!key) {
          key = `q_${questionOrder.length + 1}`;
          questionKeyById.set(qId, key);
          const questionLabel = String(answer?.question || '').trim() || `Question ${questionOrder.length + 1}`;
          questionOrder.push({ key, label: questionLabel });
        }
        const rawAnswer = extractSelectedAnswer(answer);
        const optionMap = optionMapByQuestionId.get(qId);
        if (!optionMap) {
          row[key] = appendCorrectnessSuffix(rawAnswer, answer);
          return;
        }
        // Convert option key(s) like A/B/C to option labels.
        if (Array.isArray(answer?.selected_answer_for_multiSelect)) {
          const label = answer.selected_answer_for_multiSelect
            .map((k) => optionMap.get(String(k).trim()) || String(k))
            .join(', ');
          row[key] = appendCorrectnessSuffix(label, answer);
          return;
        }
        const label = optionMap.get(String(rawAnswer).trim()) || rawAnswer;
        row[key] = appendCorrectnessSuffix(label, answer);
      });

      return row;
    });

    const columns = [
      { key: 'emp_name', label: 'Employee Name' },
      { key: 'emp_id', label: 'Employee ID (Vega)' },
      { key: 'emp_code', label: 'Employee Code (AIA)' },
      { key: 'score', label: 'Score' },
      ...questionOrder,
    ];

    return { columns, rows };
  },
});