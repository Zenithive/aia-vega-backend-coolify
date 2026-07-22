const FEEDBACK_UID = 'api::feedback-submission.feedback-submission';
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

    const submissions = await strapi.db.query(FEEDBACK_UID).findMany({
      populate: ['answers', 'users_permissions_user', 'course', 'course.company'],
      orderBy: { createdAt: 'desc' },
    });

    const filtered = (submissions || []).filter((submission) => {
      const user = submission.users_permissions_user || {};
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
      const user = submission.users_permissions_user || {};
      const course = submission.course || {};
      const userKey = String(user.id || user.documentId || user.emp_code || user.emp_id || 'unknown-user');
      const courseKey = String(course.id || course.documentId || 'unknown-course');
      const key = `${userKey}::${courseKey}`;
      const currentTs = new Date(submission.createdAt || submission.updatedAt || 0).getTime();
      const previous = latestByUserCourse.get(key);
      const previousTs = previous ? new Date(previous.createdAt || previous.updatedAt || 0).getTime() : -1;
      if (!previous || currentTs >= previousTs) {
        latestByUserCourse.set(key, submission);
      }
    }
    const deduped = Array.from(latestByUserCourse.values());

    const questionOrder = [];
    const questionKeyById = new Map();
    const rows = deduped.map((submission) => {
      const user = submission.users_permissions_user || {};
      const answers = Array.isArray(submission.answers) ? submission.answers : [];

      const row = {
        id: submission.id,
        emp_name: getEmployeeName(user),
        emp_id: user.emp_id || '-',
        emp_code: user.emp_code || '-',
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
        row[key] = answer?.answer || '-';
      });

      return row;
    });

    const columns = [
      { key: 'emp_name', label: 'Employee Name' },
      { key: 'emp_id', label: 'Employee ID' },
      { key: 'emp_code', label: 'Employee Code' },
      ...questionOrder,
    ];

    return { columns, rows };
  },
});
