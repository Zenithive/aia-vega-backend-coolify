// @ts-nocheck
/**
 * Editor model helpers.
 *
 * The editor works on the same shape the Course API returns (the schema stays the source of
 * truth). The only UI-specific structure is `moduleBlocks`: course.modules is stored as a flat
 * list with one entry per language per module ([m1-en, m1-hi, m2-en, m2-hi, ...]), which the
 * editor groups into logical modules so admins edit "Module 1" with a tab per language.
 *
 * Quizzes belong to Online modules (course.module.quiz), one per module language. Offline
 * modules happen outside the portal and are completed with proof in Course Management → Offline module proof.
 */

let keySeq = 0;
export const newKey = (prefix = 'k') => `${prefix}-${Date.now().toString(36)}-${(keySeq++).toString(36)}`;

const UI_KEY = '__key';

export function parseLanguages(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = raw ? [raw] : [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((item) => {
    const v = typeof item === 'object' && item != null ? item.value : item;
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  });
  return out;
}

export function isBlank(v) {
  return v == null || String(v).trim() === '';
}

/** "45/50 characters" once a text is within 20% of its limit, otherwise nothing. */
export function nearLimit(value, limit) {
  const length = String(value || '').length;
  return limit && length >= limit * 0.8 ? `${length}/${limit} characters` : undefined;
}

/** Strip HTML so empty CKEditor output ("<p>&nbsp;</p>") counts as empty. */
export function isBlankHtml(v) {
  if (isBlank(v)) return true;
  const text = String(v)
    .replace(/<(img|video|iframe|audio|table)\b/gi, 'X<$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text === '';
}

export function mediaUrl(file) {
  const url = file?.url;
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const backend = (typeof window !== 'undefined' && window.strapi?.backendURL) || '';
  return `${backend}${url}`;
}

export function thumbnailUrl(file) {
  if (!file) return null;
  const small = file.formats?.thumbnail || file.formats?.small;
  return mediaUrl(small || file);
}

/* ------------------------------------------------------------------ factories */

export const MODULE_TYPES = { ONLINE: 'Online', OFFLINE: 'Offline' };

export const isOfflineModule = (m) => m?.module_type === MODULE_TYPES.OFFLINE;

export function emptyModule(language, template = {}) {
  return {
    [UI_KEY]: newKey('mod'),
    module_id: '',
    language,
    module_type: template.module_type || MODULE_TYPES.ONLINE,
    title: '',
    module_content_type: template.module_content_type || 'Video',
    video_file: [],
    pdf_file: [],
    mark_as_read: template.mark_as_read ?? false,
    module_duration_min: template.module_duration_min ?? null,
    text_content: '',
    video_description: '',
    quiz: null,
  };
}

export function emptyQuestion(order = 1) {
  return {
    [UI_KEY]: newKey('q'),
    question_id: '',
    question_text: '',
    question_type: 'Multiple_choice',
    order,
    options: [
      { [UI_KEY]: newKey('o'), option_key: 'A', option_label: '' },
      { [UI_KEY]: newKey('o'), option_key: 'B', option_label: '' },
    ],
    correct_answer: '',
    correct_multiSelect_answers: [],
  };
}

export function emptyInstruction() {
  return {
    [UI_KEY]: newKey('ins'),
    name: '',
    description: '',
    checklist: [{ [UI_KEY]: newKey('chk'), description: '' }],
  };
}

export function emptyQuiz(language) {
  return {
    [UI_KEY]: newKey('quiz'),
    quiz_id: '',
    language,
    quiz_questions: [emptyQuestion(1)],
    quiz_instruction: [emptyInstruction()],
    max_attempt: null,
    completion_time: 30,
    compulsory: true,
  };
}

/** Copy of a quiz for another language: same structure/answers, ids cleared so the server issues new ones. */
export function copyQuizForLanguage(quiz, language) {
  const clone = JSON.parse(JSON.stringify(quiz));
  const strip = (obj) => {
    if (Array.isArray(obj)) return obj.forEach(strip);
    if (!obj || typeof obj !== 'object') return;
    delete obj.id;
    if (UI_KEY in obj) obj[UI_KEY] = newKey('c');
    Object.values(obj).forEach(strip);
  };
  strip(clone);
  clone.quiz_id = '';
  clone.language = language;
  (clone.quiz_questions || []).forEach((q) => {
    q.question_id = '';
  });
  return clone;
}

export function emptyFeedback(language) {
  return { [UI_KEY]: newKey('fb'), language, compulsory: false, feedback_template: null };
}

/** Next unused option key: A, B, … Z, then A1, B1 … Existing keys never change (submissions reference them). */
export function nextOptionKey(options) {
  const used = new Set((options || []).map((o) => String(o.option_key || '').toUpperCase()));
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < 26; i++) {
      const key = String.fromCharCode(65 + i) + (round ? String(round) : '');
      if (!used.has(key)) return key;
    }
  }
  return newKey('opt');
}

/* ------------------------------------------------------------------ module blocks */

/**
 * Group the flat modules list into logical modules: a new block starts whenever a language
 * repeats, which matches the CM storage order and tolerates ragged legacy data.
 */
export function groupModules(modules) {
  const blocks = [];
  let current = null;
  (Array.isArray(modules) ? modules : []).forEach((m) => {
    const entry = {
      ...m,
      [UI_KEY]: m[UI_KEY] || newKey('mod'),
      module_type: m.module_type || MODULE_TYPES.ONLINE,
      quiz: m.quiz ? prepareQuiz(m.quiz) : null,
    };
    const lang = entry.language || '';
    if (!current || current.byLang[lang]) {
      current = { key: newKey('blk'), byLang: {} };
      blocks.push(current);
    }
    current.byLang[lang] = entry;
  });
  return blocks;
}

/** Flatten blocks back into storage order, selected languages first (in course order), then any others. */
export function flattenModules(blocks, languages) {
  const out = [];
  (blocks || []).forEach((block) => {
    const langs = [
      ...languages.filter((l) => block.byLang[l]),
      ...Object.keys(block.byLang).filter((l) => !languages.includes(l)),
    ];
    langs.forEach((l) => out.push(block.byLang[l]));
  });
  return out;
}

export function blockTitle(block, languages, index) {
  const first = languages.map((l) => block.byLang[l]).find((m) => m && !isBlank(m.title));
  return first ? first.title : `Module ${index + 1}`;
}

/* ------------------------------------------------------------------ form <-> payload */

function withKeys(list, prefix) {
  return (Array.isArray(list) ? list : []).map((item) => ({ ...item, [UI_KEY]: item[UI_KEY] || newKey(prefix) }));
}

function prepareQuiz(quiz) {
  return {
    ...quiz,
    [UI_KEY]: quiz[UI_KEY] || newKey('quiz'),
    quiz_questions: withKeys(quiz.quiz_questions, 'q').map((q) => ({
      ...q,
      options: withKeys(q.options, 'o'),
      correct_multiSelect_answers: withKeys(q.correct_multiSelect_answers, 'ms'),
    })),
    quiz_instruction: withKeys(quiz.quiz_instruction, 'ins').map((ins) => ({
      ...ins,
      checklist: withKeys(ins.checklist, 'chk'),
    })),
  };
}

/** API course → editor form state. */
export function toForm(course, options = {}) {
  const c = course || {};
  return {
    ...c,
    course_language: parseLanguages(c.course_language),
    company: Array.isArray(c.company) ? c.company : [],
    moduleBlocks: groupModules(c.modules),
    feedback: withKeys(c.feedback, 'fb'),
    active: c.active ?? options.activeDefault ?? null,
  };
}

export function newCourseForm(options = {}) {
  const firstLanguage = options.languages?.[0];
  const languages = firstLanguage ? [firstLanguage] : [];
  return {
    title: '',
    course_version: '1.0',
    course_category: null,
    course_language: languages,
    active: options.activeDefault ?? null,
    company: [],
    thumbnail: null,
    min_passing_score: 70,
    moduleBlocks: [{ key: newKey('blk'), byLang: Object.fromEntries(languages.map((l) => [l, emptyModule(l)])) }],
    feedback: [],
  };
}

/** Editor form → payload for the plugin API (same attribute names as the schema). */
export function toPayload(form) {
  const languages = form.course_language || [];
  // A course-level `quiz` is legacy (not in the schema any more); quizzes travel inside modules.
  const { moduleBlocks, quiz: _legacyQuiz, ...rest } = form;
  const payload = {
    ...rest,
    // Both are required by the schema but no longer asked up front: visible by default, 70% pass mark.
    active: rest.active || 'published',
    min_passing_score: rest.min_passing_score ?? 70,
    course_language: languages,
    modules: flattenModules(moduleBlocks, languages).map((m) =>
      isOfflineModule(m) || !m.quiz
        ? { ...m, quiz: null }
        : {
            ...m,
            quiz: {
              ...m.quiz,
              language: m.language,
              quiz_questions: (m.quiz.quiz_questions || []).map((q, i) => ({ ...q, order: i + 1 })),
            },
          }
    ),
  };
  // Remove UI-only keys everywhere.
  return JSON.parse(JSON.stringify(payload, (k, v) => (k === UI_KEY ? undefined : v)));
}

/* ------------------------------------------------------------------ validation */

export const STEPS = [
  { id: 'basics', label: 'Details', description: 'Name, type, languages' },
  { id: 'modules', label: 'Modules', description: 'What learners study, and quizzes' },
  { id: 'feedback', label: 'Feedback', description: 'Optional form at the end' },
  { id: 'review', label: 'Publish', description: 'Check and make it live' },
];

const typeLabel = { Multiple_choice: 'single choice', Multiple_select: 'multiple select', Descriptive: 'descriptive' };

/** Checks for one module quiz; `report(message, severity)`. */
function validateQuiz(quiz, where, report) {
  const questions = quiz.quiz_questions || [];
  if (questions.length === 0) report(`${where}: add at least one question`, 'error');
  questions.forEach((q, j) => {
    const qn = `${where}, question ${j + 1}`;
    if (isBlank(q.question_text)) report(`${qn}: question text is required`, 'error');
    const opts = q.options || [];
    if (q.question_type !== 'Descriptive') {
      if (opts.length < 2) report(`${qn}: add at least two answer options`, 'error');
      if (opts.some((o) => isBlank(o.option_label))) report(`${qn}: every answer option needs text`, 'error');
    }
    if (q.question_type === 'Multiple_choice') {
      const keys = opts.map((o) => o.option_key);
      if (isBlank(q.correct_answer) || !keys.includes(q.correct_answer)) report(`${qn}: mark the correct answer`, 'error');
    } else if (q.question_type === 'Multiple_select') {
      if (!(q.correct_multiSelect_answers || []).length) report(`${qn}: mark at least one correct answer`, 'error');
    } else if (q.question_type === 'Descriptive' && isBlank(q.correct_answer)) {
      report(`${qn}: enter a model answer for this ${typeLabel.Descriptive} question`, 'warning');
    }
  });
  const instructions = quiz.quiz_instruction || [];
  if (instructions.length === 0) report(`${where}: add the instructions learners see before starting`, 'warning');
  instructions.forEach((ins, k) => {
    if (!(ins.checklist || []).length) report(`${where}, instruction ${k + 1}: add at least one checklist item`, 'warning');
  });
}

/**
 * Client-side checks mirroring the schema's required rules, so admins see problems before
 * publishing. Errors block publishing; warnings are advisory. The server re-validates anyway.
 */
export function validateCourse(form, limits = {}) {
  const issues = [];
  const add = (step, message, severity = 'error', target) => issues.push({ step, message, severity, target });
  const languages = form.course_language || [];

  if (isBlank(form.title)) add('basics', 'Course title is required', 'error', 'title');
  else if (limits.title && form.title.length > limits.title) add('basics', `Title must be at most ${limits.title} characters`, 'error', 'title');
  if (isBlank(form.course_version)) add('basics', 'Course version is required', 'error', 'course_version');
  if (isBlank(form.course_category)) add('basics', 'Choose a course category', 'error', 'course_category');
  if (languages.length === 0) add('basics', 'Select at least one language', 'error', 'course_language');
  if (!form.thumbnail) add('basics', 'No course picture selected — learners will see a placeholder image', 'warning', 'thumbnail');

  // The pass mark only matters once a module has a quiz; it is edited in the quiz settings.
  const hasQuiz = (form.moduleBlocks || []).some((b) => Object.values(b.byLang).some((m) => m?.quiz && !isOfflineModule(m)));
  const mark = form.min_passing_score;
  if (hasQuiz && (mark == null || mark === '' || mark < 0 || mark > 100)) {
    add('modules', 'Quiz pass mark must be a number from 0 to 100 (in any quiz’s settings)', 'error');
  }

  const blocks = form.moduleBlocks || [];
  if (blocks.length === 0) add('modules', 'Add at least one module', 'error');
  blocks.forEach((block, i) => {
    const name = `Module ${i + 1}`;
    languages.forEach((lang) => {
      const m = block.byLang[lang];
      const where = `${name} (${lang})`;
      if (!m) return add('modules', `${where}: ${lang} version is missing`, 'error', block.key);
      if (isBlank(m.title)) add('modules', `${where}: title is required`, 'error', block.key);
      else if (limits.moduleTitle && m.title.length > limits.moduleTitle) add('modules', `${where}: title must be at most ${limits.moduleTitle} characters`, 'error', block.key);
      if (m.module_duration_min == null || m.module_duration_min === '' || Number(m.module_duration_min) <= 0) {
        add('modules', `${where}: duration (minutes) is required`, 'error', block.key);
      }
      // Offline modules have no content or quiz: they are completed with proof in Course Management → Offline module proof.
      if (isOfflineModule(m)) return;
      if (isBlank(m.module_content_type)) add('modules', `${where}: choose a content type`, 'error', block.key);
      if (m.module_content_type === 'Video' && !(m.video_file || []).length) add('modules', `${where}: upload or select a video`, 'error', block.key);
      if (m.module_content_type === 'Pdf' && !(m.pdf_file || []).length) add('modules', `${where}: upload or select a PDF`, 'error', block.key);
      if (m.module_content_type === 'Text' && isBlankHtml(m.text_content)) add('modules', `${where}: text content is required`, 'error', block.key);
      if (m.quiz) validateQuiz(m.quiz, `${where} quiz`, (message, severity) => add('modules', message, severity, block.key));
    });
    const types = new Set(languages.map((l) => block.byLang[l]?.module_type).filter(Boolean));
    if (types.size > 1) add('modules', `${name}: is Online in one language and Offline in another`, 'error', block.key);
    const withQuiz = languages.filter((l) => block.byLang[l] && !isOfflineModule(block.byLang[l]) && block.byLang[l].quiz);
    if (withQuiz.length && withQuiz.length < languages.length) {
      languages
        .filter((l) => !withQuiz.includes(l) && block.byLang[l] && !isOfflineModule(block.byLang[l]))
        .forEach((l) => add('modules', `${name}: has a quiz in ${withQuiz.join(', ')} but not in ${l}`, 'warning', block.key));
    }
  });

  const feedbacks = form.feedback || [];
  feedbacks.forEach((fb) => {
    const where = `Feedback (${fb.language})`;
    if (!languages.includes(fb.language)) add('feedback', `${where}: language is not selected for this course`, 'warning');
    // Compulsory feedback with no form would stop learners from ever completing the course.
    if (!fb.feedback_template) {
      add('feedback', `${where}: choose a feedback form`, fb.compulsory ? 'error' : 'warning', fb.language);
    }
  });

  return issues;
}

/* ------------------------------------------------------------------ server errors */

const prettify = (key) => String(key).replace(/_/g, ' ').replace(/\bmin\b/, '(min)').trim();

/** Turn a Strapi ValidationError path (e.g. ["modules", 3, "video_file"]) into admin-friendly text. */
export function describeServerError(detail, payload) {
  const path = Array.isArray(detail?.path) ? detail.path : [];
  const parts = [];
  let node = payload;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const next = path[i + 1];
    if (typeof next === 'number' || /^\d+$/.test(String(next ?? ''))) {
      const item = node?.[seg]?.[next];
      if (seg === 'modules') parts.push(`Module "${item?.title || `#${Number(next) + 1}`}" (${item?.language || '?'})`);
      else if (seg === 'feedback') parts.push(`Feedback (${item?.language || '?'})`);
      else if (seg === 'quiz_questions') parts.push(`Question ${Number(next) + 1}`);
      else parts.push(`${prettify(seg)} ${Number(next) + 1}`);
      node = item;
      i++;
    } else {
      parts.push(prettify(seg));
      node = node?.[seg];
    }
  }
  const msg = String(detail?.message || 'is invalid').replace(/^[\w.[\]]+ (must|is|should)/, '$1');
  return parts.length ? `${parts.join(' › ')}: ${msg}` : msg;
}

export function stepForPath(path) {
  const head = Array.isArray(path) ? path[0] : null;
  if (head === 'modules') return 'modules';
  if (head === 'feedback') return 'feedback';
  return 'basics';
}

/** Suggest the next version: "1.0" → "1.1", "2" → "3", "v1.9" → "v1.10". */
export function suggestNextVersion(version) {
  const v = String(version || '').trim();
  const match = v.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return v ? `${v}-2` : '1.0';
  return `${match[1]}${Number(match[2]) + 1}${match[3]}`;
}

export const STATUS_META = {
  draft: { label: 'Draft', variant: 'secondary', hint: 'Not visible to learners yet' },
  published: { label: 'Published', variant: 'success', hint: 'Live for assigned learners' },
  modified: { label: 'Published (changed)', variant: 'alternative', hint: 'Live, with unpublished changes' },
};

export function formatDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}
