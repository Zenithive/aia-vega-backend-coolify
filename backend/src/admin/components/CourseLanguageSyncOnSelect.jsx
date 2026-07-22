// One entry per language for quiz/feedback/orientation. When removing languages, entries for removed languages are dropped.
function syncComponentArray(current, languages, createPlaceholder) {
  const N = languages.length;
  const list = Array.isArray(current) ? [...current] : [];

  if (N === 0) return []; // no languages = remove all entries
  const out = [];

  for (let i = 0; i < N; i++) {
    const lang = languages[i];
    if (list[i]) {
      out.push({ ...list[i], language: lang });
    } else {
      const entry = createPlaceholder(lang, i);
      if (!entry.__temp_key__) {
        entry.__temp_key__ = `lang-${lang}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
      out.push(entry);
    }
  }

  return out;
}
/**
 * When the Course edit view is open and the user changes "Course language",
 * this syncs the 3 repeatables (modules, quiz, feedback) to one entry per
 * language. Inner repeatables (quiz_questions, feedback_question, etc.) are
 * not synced – only the top-level 3 component entries are created per language.
 */

import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_MODEL = 'api::course.course';
const LANGUAGES = ['English', 'Hindi', 'Gujarati'];

function getLanguageList(raw) {
  let arr = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  const langLower = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
  const matchLang = (v) => {
    const s = typeof v === 'object' && v != null && typeof v.value === 'string' ? v.value : v;
    if (typeof s !== 'string') return null;
    const lower = langLower(s);
    return LANGUAGES.find((l) => langLower(l) === lower) || null;
  };
  const out = [];
  for (const v of arr) {
    const matched = matchLang(v);
    if (matched && !out.includes(matched)) out.push(matched);
  }
  return out;
}

function normalizeLang(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneWithoutKeys(obj, keys) {
  const out = { ...(obj || {}) };
  (keys || []).forEach((k) => {
    if (k in out) delete out[k];
  });
  return out;
}

// For modules: keep "blocks" of entries per module, one entry per language per block.
// Storage shape becomes: [mod1-en, mod1-hi, mod1-gu, mod2-en, mod2-hi, mod2-gu, ...]
// When removing languages: entries for removed languages are dropped from each block.
function syncModuleBlocks(current, prevLanguages, nextLanguages, createPlaceholder) {
  const nextN = nextLanguages.length;
  const list = Array.isArray(current) ? [...current] : [];

  // When no languages selected: remove all entries (or keep as-is if that's preferred)
  if (nextN === 0) return [];

  // If empty, create the first module block (one per language)
  if (list.length === 0) {
    return nextLanguages.map((lang, i) => createPlaceholder(lang, i));
  }

  // Infer block size using previous language count whenever possible.
  // This preserves existing module blocks when languages are added (e.g. 4 entries at 2 langs -> 6 at 3 langs).
  const prevLangN = Array.isArray(prevLanguages) && prevLanguages.length > 0 ? prevLanguages.length : nextN;
  // Always chunk by previous language count when possible, even if list is not perfectly divisible.
  // This preserves logical blocks after a manual single-row delete (e.g. 4 -> 3 with 2 languages => 2 blocks).
  const prevN = prevLangN > 0 ? prevLangN : (nextN > 0 ? nextN : list.length);

  // Chunk into blocks of prevN (ragged last block allowed).
  const blocks = [];
  if (prevN > 0) {
    for (let i = 0; i < list.length; i += prevN) {
      blocks.push(list.slice(i, i + prevN));
    }
  } else {
    blocks.push(list);
  }

  const out = [];

  blocks.forEach((block, blockIdx) => {
    // index by language for best preservation when removing/adding languages
    const byLang = new Map();
    block.forEach((m) => {
      const key = normalizeLang(m?.language);
      if (key) byLang.set(key, m);
    });

    nextLanguages.forEach((lang, langIdx) => {
      const found = byLang.get(normalizeLang(lang));
      if (found) {
        out.push({ ...found, language: lang });
      } else {
        // New language added: create a clean placeholder with its own unique module_id
        out.push(createPlaceholder(lang, langIdx));
      }

      const last = out[out.length - 1];
      if (last && !last.__temp_key__) {
        last.__temp_key__ = `mod-${blockIdx}-${langIdx}-lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
    });
  });

  return out;
}

// Generic block sync for repeatables that should maintain one entry per selected language in each block.
// Example with 2 languages and 2 blocks: [b1-en, b1-hi, b2-en, b2-hi]
function syncRepeatableBlocks(current, prevLanguages, nextLanguages, createPlaceholder, keyPrefix = 'item') {
  const nextN = nextLanguages.length;
  const list = Array.isArray(current) ? [...current] : [];

  if (nextN === 0) return [];

  if (list.length === 0) {
    return nextLanguages.map((lang, i) => createPlaceholder(lang, i));
  }

  const prevLangN = Array.isArray(prevLanguages) && prevLanguages.length > 0 ? prevLanguages.length : nextN;
  const prevN = prevLangN > 0 ? prevLangN : (nextN > 0 ? nextN : list.length);

  const blocks = [];
  if (prevN > 0) {
    for (let i = 0; i < list.length; i += prevN) {
      blocks.push(list.slice(i, i + prevN));
    }
  } else {
    blocks.push(list);
  }

  const out = [];

  blocks.forEach((block, blockIdx) => {
    const byLang = new Map();
    block.forEach((item) => {
      const key = normalizeLang(item?.language);
      if (key) byLang.set(key, item);
    });

    nextLanguages.forEach((lang, langIdx) => {
      const found = byLang.get(normalizeLang(lang));
      if (found) {
        out.push({ ...found, language: lang });
      } else {
        out.push(createPlaceholder(lang, langIdx));
      }

      const last = out[out.length - 1];
      if (last && !last.__temp_key__) {
        last.__temp_key__ = `${keyPrefix}-${blockIdx}-${langIdx}-lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
    });
  });

  return out;
}

function createModulePlaceholder(lang) {
  return {
    __temp_key__: `lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    module_id: generateId('mod'),
    title: '',
    module_content_type: 'Text',
    mark_as_read: false,
    module_duration_min: 1,
  };
}

function createQuizPlaceholder(lang) {
  return {
    __temp_key__: `lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    quiz_id: generateId('quiz'),
    title: '',
    quiz_questions: [],
    quiz_instruction: [],
  };
}

function createFeedbackPlaceholder(lang) {
  return {
    __temp_key__: `lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    feedback_question: [],
  };
}

function createOrientationPlaceholder(lang) {
  return {
    __temp_key__: `orient-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    orientation_flow: 'Before Course Completion',
    trainer_name: '',
    topics_to_cover: '',
  };
}

function ensureArray(val) {
  return Array.isArray(val) ? val : [];
}

function ensureRichTextString(val) {
  return typeof val === 'string' ? val : '';
}

function shouldExpandAfterSingleAdd(currentLength, previousLength, languageCount) {
  if (languageCount <= 0 || currentLength <= 0) return false;
  if (typeof previousLength !== 'number') return false;
  // Only treat as an add when list length increased by exactly one.
  return currentLength === previousLength + 1;
}

function buildSyncedValues(values, nextLanguages, prevLanguages) {
  // For modules: blocks (supports add-entry); for quiz/feedback: one entry per language
  const syncedModules = syncModuleBlocks(values.modules, prevLanguages, nextLanguages, (lang) => createModulePlaceholder(lang));
  const syncedQuiz = syncRepeatableBlocks(values.quiz, prevLanguages, nextLanguages, (lang) => createQuizPlaceholder(lang), 'quiz');
  const syncedFeedback = syncRepeatableBlocks(values.feedback, prevLanguages, nextLanguages, (lang) => createFeedbackPlaceholder(lang), 'fb');
  const orientationRequired = values.orientation_required === true;
  const syncedOrientation = orientationRequired
    ? syncComponentArray(values.orientation_detail, nextLanguages, (lang) => createOrientationPlaceholder(lang))
    : ensureArray(values.orientation_detail);

  // Ensure every repeatable value is an array and nested repeatables are arrays (avoids value.map is not a function)
  const normalizedModules = ensureArray(syncedModules);
  const normalizedQuiz = ensureArray(syncedQuiz).map((q) => ({
    ...q,
    quiz_questions: ensureArray(q.quiz_questions),
    quiz_instruction: ensureArray(q.quiz_instruction),
  }));
  const normalizedFeedback = ensureArray(syncedFeedback).map((f) => ({
    ...f,
    feedback_question: ensureArray(f.feedback_question),
  }));
  const normalizedOrientation = ensureArray(syncedOrientation).map((o) => ({
    ...(o || {}),
    topics_to_cover: ensureRichTextString(o?.topics_to_cover),
  }));

  return {
    ...values,
    modules: normalizedModules,
    quiz: normalizedQuiz,
    feedback: normalizedFeedback,
    orientation_detail: normalizedOrientation,
  };
}

/** When user added exactly one entry, expand it to N entries (one per language). */
function expandLastSetToLanguages(current, languages, createPlaceholder) {
  const N = languages.length;
  if (N <= 0 || !Array.isArray(current)) return null;
  // Fan out the last added row to one row per selected language.
  if (current.length < 1) return null;
  const kept = current.slice(0, current.length - 1);
  const last = current[current.length - 1];
  // Clone the last added entry for each language
  const newEntries = languages.map((lang, i) => ({ ...last, language: lang, __temp_key__: `lang-${lang}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }));
  return [...kept, ...newEntries];
}

function expandLastModuleSetToLanguages(modules, languages) {
  const expanded = expandLastSetToLanguages(modules, languages);
  if (!expanded) return null;

  const bulkStartIdx = Math.max(0, expanded.length - languages.length);

  return expanded.map((m, idx) => {
    if (idx < bulkStartIdx) return m;

    const base = typeof m === 'object' && m != null ? m : {};
    const cleaned = cloneWithoutKeys(base, ['module_id', '__temp_key__']);
    return {
      ...cleaned,
      language: cleaned.language,
      module_id: generateId('mod'),   // each language variant gets its own unique id
      module_duration_min: cleaned.module_duration_min ?? 1,
      __temp_key__: `mod-expand-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  });
}

function moduleEntryKey(entry, idx) {
  if (!entry || typeof entry !== 'object') return `idx:${idx}`;

  if (typeof entry.__temp_key__ === 'string' && entry.__temp_key__.trim()) {
    return `tmp:${entry.__temp_key__.trim()}`;
  }
  if (entry.id != null) return `id:${String(entry.id)}`;
  if (typeof entry.documentId === 'string' && entry.documentId.trim()) {
    return `doc:${entry.documentId.trim()}`;
  }

  const moduleId = typeof entry.module_id === 'string' ? entry.module_id.trim() : '';
  const lang = normalizeLang(entry.language);
  const title = typeof entry.title === 'string' ? entry.title.trim().toLowerCase() : '';

  if (moduleId) return `mid:${moduleId}|lang:${lang}|title:${title}`;
  if (lang || title) return `lang:${lang}|title:${title}|idx:${idx}`;
  return `idx:${idx}`;
}

function findRemovedEntryIndex(previousItems, currentItems) {
  if (!Array.isArray(previousItems) || !Array.isArray(currentItems)) return -1;

  const currentCount = new Map();
  currentItems.forEach((entry, idx) => {
    const key = moduleEntryKey(entry, idx);
    currentCount.set(key, (currentCount.get(key) || 0) + 1);
  });

  for (let i = 0; i < previousItems.length; i += 1) {
    const key = moduleEntryKey(previousItems[i], i);
    const count = currentCount.get(key) || 0;
    if (count === 0) return i;
    currentCount.set(key, count - 1);
  }

  return -1;
}

function expandLastQuizSetToLanguages(quiz, languages) {
  const expanded = expandLastSetToLanguages(quiz, languages);
  if (!expanded) return null;

  return expanded.map((q, idx) => {
    const base = typeof q === 'object' && q != null ? q : {};
    const cleaned = cloneWithoutKeys(base, ['quiz_id', '__temp_key__']);
    return {
      ...cleaned,
      language: cleaned.language,
      quiz_id: generateId('quiz'),
      quiz_questions: ensureArray(cleaned.quiz_questions),
      quiz_instruction: ensureArray(cleaned.quiz_instruction),
      __temp_key__: `quiz-expand-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  });
}

function expandLastFeedbackSetToLanguages(feedback, languages) {
  const expanded = expandLastSetToLanguages(feedback, languages);
  if (!expanded) return null;

  return expanded.map((f, idx) => {
    const base = typeof f === 'object' && f != null ? f : {};
    const cleaned = cloneWithoutKeys(base, ['__temp_key__']);
    return {
      ...cleaned,
      language: cleaned.language,
      feedback_question: ensureArray(cleaned.feedback_question),
      __temp_key__: `fb-expand-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  });
}

function expandLastOrientationSetToLanguages(orientation, languages) {
  const expanded = expandLastSetToLanguages(orientation, languages);
  if (!expanded) return null;

  return expanded.map((o, idx) => {
    const base = typeof o === 'object' && o != null ? o : {};
    const cleaned = cloneWithoutKeys(base, ['__temp_key__']);
    return {
      ...cleaned,
      language: cleaned.language,
      orientation_flow: cleaned.orientation_flow ?? 'Before Course Completion',
      trainer_name: cleaned.trainer_name ?? '',
      topics_to_cover: ensureRichTextString(cleaned.topics_to_cover),
      __temp_key__: `orient-expand-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  });
}

/**
 * Injected into content-manager editView.right-links.
 * When user selects languages in Course language dropdown, auto-creates one entry per language for:
 * modules, quiz, feedback, and orientation_detail (when orientation is required).
 */
function CourseLanguageSyncOnSelect({ slug, model }) {
  const uid = slug || model;
  const values = useForm('useContentManagerContext', (state) => state?.values, false);
  const setValues = useForm('useContentManagerContext', (state) => state?.setValues, false);
  const prevLangRef = useRef(null);
  const prevOrientationRequiredRef = useRef(null);
  const prevModulesRef = useRef([]);
  const prevLengthsRef = useRef({
    modules: 0,
    quiz: 0,
    feedback: 0,
    orientation_detail: 0,
  });

  useEffect(() => {
    if (uid !== COURSE_MODEL || !values || typeof setValues !== 'function') return;

    const languages = getLanguageList(values.course_language);
    const N = languages.length;
    const modules = ensureArray(values.modules);
    const quiz = ensureArray(values.quiz);
    const feedback = ensureArray(values.feedback);
    const orientationRequired = values.orientation_required === true;
    const orientationDetail = ensureArray(values.orientation_detail);
    const prevModules = ensureArray(prevModulesRef.current);
    const prevLengths = prevLengthsRef.current;

    // 1. When course_language changed, sync all components (add/remove entries per language).
    const prevLang = prevLangRef.current;
    const prevKey = prevLang ? JSON.stringify(prevLang) : null;
    const currKey = JSON.stringify(languages);

    if (prevKey !== currKey) {
      prevLangRef.current = languages;
      prevOrientationRequiredRef.current = orientationRequired;
      const synced = buildSyncedValues(values, languages, prevLang);
      prevLengthsRef.current = {
        modules: synced.modules.length,
        quiz: synced.quiz.length,
        feedback: synced.feedback.length,
        orientation_detail: synced.orientation_detail.length,
      };
      prevModulesRef.current = synced.modules;
      setValues(synced);
      return;
    }

    // 2. When orientation_required changed from false to true: create orientation entries per selected language.
    const prevOrientationRequired = prevOrientationRequiredRef.current;
    if (orientationRequired && !prevOrientationRequired && N >= 1) {
      prevOrientationRequiredRef.current = orientationRequired;
      const synced = buildSyncedValues(values, languages, prevLang);
      prevLengthsRef.current = {
        modules: synced.modules.length,
        quiz: synced.quiz.length,
        feedback: synced.feedback.length,
        orientation_detail: synced.orientation_detail.length,
      };
      prevModulesRef.current = synced.modules;
      setValues(synced);
      return;
    }
    // When orientation_required changed from true to false: clear orientation entries.
    if (!orientationRequired && prevOrientationRequired) {
      prevOrientationRequiredRef.current = orientationRequired;
      prevLengthsRef.current = {
        modules: modules.length,
        quiz: quiz.length,
        feedback: feedback.length,
        orientation_detail: 0,
      };
      prevModulesRef.current = modules;
      setValues({ ...values, orientation_detail: [] });
      return;
    }

    // 3. If one module row from a bulk-created group is deleted, confirm and delete the full group.
    if (N > 1 && modules.length === prevModules.length - 1) {
      const removedIndex = findRemovedEntryIndex(prevModules, modules);

      if (removedIndex >= 0) {
        const blockStart = Math.floor(removedIndex / N) * N;
        const blockEnd = Math.min(blockStart + N, prevModules.length);
        const grouped = prevModules.slice(blockStart, blockEnd);

        if (grouped.length > 1) {
          const ok = window.confirm(
            'This module was created in bulk for selected languages. Press OK to delete all entries in this bulk.',
          );

          if (!ok) {
            prevOrientationRequiredRef.current = orientationRequired;
            prevLengthsRef.current = {
              modules: prevModules.length,
              quiz: quiz.length,
              feedback: feedback.length,
              orientation_detail: orientationDetail.length,
            };
            prevModulesRef.current = prevModules;
            setValues({ ...values, modules: prevModules });
            return;
          }

          const filteredModules = prevModules.filter((_, idx) => idx < blockStart || idx >= blockEnd);

          prevOrientationRequiredRef.current = orientationRequired;
          prevLengthsRef.current = {
            modules: filteredModules.length,
            quiz: quiz.length,
            feedback: feedback.length,
            orientation_detail: orientationDetail.length,
          };
          prevModulesRef.current = filteredModules;
          setValues({ ...values, modules: filteredModules });
          return;
        }
      }
    }

    // 4. When user clicks "Add an entry", Strapi adds 1 row. Expand it to N rows (one per language).
    // Use two triggers:
    // (a) Classic: length went up by exactly 1 (primary fast-path).
    // (b) Fallback: module count is not a multiple of N AND grew vs prevLengths — means a row was
    //     added while our prevLengths was stale from a prior race condition.
    const hasMisalignedModules = N > 0 && modules.length > prevLengths.modules && modules.length % N !== 0;
    if (shouldExpandAfterSingleAdd(modules.length, prevLengths.modules, N) || hasMisalignedModules) {
      const expanded = expandLastModuleSetToLanguages(modules, languages);
      if (expanded) {
        prevLangRef.current = languages;
        prevLengthsRef.current = {
          ...prevLengths,
          modules: expanded.length,
        };
        prevModulesRef.current = expanded;
        setValues({ ...values, modules: expanded });
        return;
      }
    }
    if (shouldExpandAfterSingleAdd(quiz.length, prevLengths.quiz, N)) {
      const expanded = expandLastQuizSetToLanguages(quiz, languages);
      if (expanded) {
        prevLangRef.current = languages;
        prevLengthsRef.current = {
          ...prevLengths,
          quiz: expanded.length,
        };
        setValues({ ...values, quiz: expanded });
        return;
      }
    }
    if (shouldExpandAfterSingleAdd(feedback.length, prevLengths.feedback, N)) {
      const expanded = expandLastFeedbackSetToLanguages(feedback, languages);
      if (expanded) {
        prevLangRef.current = languages;
        prevLengthsRef.current = {
          ...prevLengths,
          feedback: expanded.length,
        };
        setValues({ ...values, feedback: expanded });
        return;
      }
    }
    if (
      orientationRequired &&
      shouldExpandAfterSingleAdd(orientationDetail.length, prevLengths.orientation_detail, N)
    ) {
      const expanded = expandLastOrientationSetToLanguages(orientationDetail, languages);
      if (expanded) {
        prevLangRef.current = languages;
        prevLengthsRef.current = {
          ...prevLengths,
          orientation_detail: expanded.length,
        };
        setValues({ ...values, orientation_detail: expanded });
        return;
      }
    }

    prevOrientationRequiredRef.current = orientationRequired;
    prevLengthsRef.current = {
      modules: modules.length,
      quiz: quiz.length,
      feedback: feedback.length,
      orientation_detail: orientationDetail.length,
    };
    prevModulesRef.current = modules;
  }, [uid, values, setValues]);

  return null;
}

export default CourseLanguageSyncOnSelect;
