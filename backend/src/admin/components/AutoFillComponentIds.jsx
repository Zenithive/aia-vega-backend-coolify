/**
 * Fills component id fields (module_id, quiz_id, question_id, route_id, stop_id, etc.)
 * in the form as soon as the user adds a new component entry, so ids appear before save.
 * Uses the same prefixes as the server-side auto-generate (mod, quiz, q, fb, route, stop).
 */

import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';
import {
  markDuplicateCourseFlowActive,
  clearDuplicateCourseFlow,
} from '../utils/vegaDuplicateCourseFetch.js';

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Config per content-type: key = form field name (component array),
 * value = { idKey, prefix, nested?: { key: { idKey, prefix, nested? } } }
 */
const CONTENT_TYPE_ID_CONFIG = {
  'api::course.course': {
    // Keep top-level module_id generation controlled by CourseLanguageSyncOnSelect
    // to avoid racing with language fanout on "Add an entry".
    modules: { nested: {} },
    quiz: {
      // Keep top-level quiz_id generation controlled by CourseLanguageSyncOnSelect.
      nested: {
        quiz_questions: { idKey: 'question_id', prefix: 'q', nested: {} },
      },
    },
    // feedback is single component; feedback_question is inside it (repeatable)
    feedback: {
      nested: {
        feedback_question: { idKey: 'question_id', prefix: 'fb', nested: {} },
      },
    },
  },
  'api::unit-location.unit-location': {
    Units: {
      // Each Unit is an object with routes array
      nested: {
        routes: {
          idKey: 'route_id',
          prefix: 'route',
          nested: {
            bus_stops: {
              idKey: 'stop_id',
              prefix: 'stop',
              nested: {
                bus_shifts: {
                  idKey: 'shift_id', // If shift_id is needed, otherwise remove
                  prefix: 'shift',
                  nested: {},
                },
              },
            },
          },
        },
      },
    },
  },
};

function fillIdsInObject(obj, config, didFillRef, options = {}) {
  if (!obj || typeof obj !== 'object') return;
  const forceRegenerate = !!options.forceRegenerate;
  for (const [key, spec] of Object.entries(config)) {
    if (!spec) continue;
    const val = obj[key];
    // Nested only, single object (e.g. old feedback as single)
    if (spec.nested && Object.keys(spec.nested).length > 0 && !spec.idKey && val && typeof val === 'object' && !Array.isArray(val)) {
      fillIdsInObject(val, spec.nested, didFillRef, options);
      continue;
    }
    // Nested only, repeatable (e.g. feedback: array of { feedback_question: ... })
    if (spec.nested && Object.keys(spec.nested).length > 0 && !spec.idKey && Array.isArray(val)) {
      val.forEach((item) => fillIdsInObject(item, spec.nested, didFillRef, options));
      continue;
    }
    if (!spec.idKey) continue;
    const arr = val;
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (!item || typeof item !== 'object') continue;
      const current = item[spec.idKey];
      if (forceRegenerate || current === undefined || current === null || String(current).trim() === '') {
        item[spec.idKey] = generateId(spec.prefix);
        didFillRef.current = true;
      }
      if (spec.nested && Object.keys(spec.nested).length > 0) {
        fillIdsInObject(item, spec.nested, didFillRef, options);
      }
    }
  }
}

function forceRegenerateCourseIds(values) {
  if (!values || typeof values !== 'object') return false;
  let changed = false;

  const regen = (prefix) => generateId(prefix);

  if (Array.isArray(values.modules)) {
    values.modules.forEach((m) => {
      if (!m || typeof m !== 'object') return;
      m.module_id = regen('mod');
      changed = true;
    });
  }

  if (Array.isArray(values.quiz)) {
    values.quiz.forEach((q) => {
      if (!q || typeof q !== 'object') return;
      q.quiz_id = regen('quiz');
      changed = true;
      if (Array.isArray(q.quiz_questions)) {
        q.quiz_questions.forEach((qq) => {
          if (!qq || typeof qq !== 'object') return;
          qq.question_id = regen('q');
          changed = true;
        });
      }
    });
  }

  // feedback can be single component object or repeatable array depending on schema evolution
  const feedbackItems = Array.isArray(values.feedback)
    ? values.feedback
    : (values.feedback && typeof values.feedback === 'object' ? [values.feedback] : []);
  feedbackItems.forEach((fb) => {
    if (!fb || typeof fb !== 'object') return;
    if (Array.isArray(fb.feedback_question)) {
      fb.feedback_question.forEach((fq) => {
        if (!fq || typeof fq !== 'object') return;
        fq.question_id = regen('fb');
        changed = true;
      });
    }
  });

  return changed;
}

/** Strapi duplicate titles often look like "Copy of …" or contain "(copy)". Used when admin redirects to /create without /clone/ in the URL. */
function titleLooksLikeDuplicatedCourse(title) {
  const raw = String(title ?? '').trim();
  if (!raw) return false;
  const s = raw.toLowerCase();
  if (s.startsWith('copy of ')) return true;
  if (s.includes('(copy')) return true;
  if (/\bduplicate\b/.test(s)) return true;
  return false;
}

function hasCourseAssignmentsInFormValues(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const rel = obj.course_assignments;
  if (rel == null) return false;
  if (Array.isArray(rel)) return rel.length > 0;
  if (typeof rel === 'object') {
    const c = rel.connect;
    const st = rel.set;
    if (Array.isArray(c) && c.length > 0) return true;
    if (Array.isArray(st) && st.length > 0) return true;
    return Object.keys(rel).length > 0;
  }
  return true;
}

/**
 * Remove course_assignments from duplicated-course form state so Save does not link the new course
 * to existing assignment rows (same M2M rows as the source course → users stay assigned).
 */
function stripCourseAssignmentsFromCourseFormCopy(copy) {
  if (!copy || !hasCourseAssignmentsInFormValues(copy)) return false;
  delete copy.course_assignments;
  return true;
}

/**
 * Injected into content-manager editView. For content types that have component id fields,
 * fills missing ids whenever form values change (e.g. user added a new component row).
 */
function AutoFillComponentIds({ slug, model }) {
  const uid = slug || model;
  const config = uid ? CONTENT_TYPE_ID_CONFIG[uid] : null;
  const values = useForm('useContentManagerContext', (state) => state.values, false);
  const setValues = useForm('useContentManagerContext', (state) => state.setValues, false);
  const didFillRef = useRef(false);
  const forceRegeneratedOnceRef = useRef(false);
  const replayCreateClickRef = useRef(false);
  const wasCreateRouteRef = useRef(false);
  /** After we strip inherited assignments once, allow the user to add assignments manually before save. */
  const strippedDuplicateCourseAssignmentsRef = useRef(false);

  useEffect(() => {
    if (!config || !values || typeof setValues !== 'function') return;

    const path = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
    const pathNoQuery = path.replace(/\?.*$/, '');
    const isCreateRoute = /\/content-manager\/collection-types\/api::course\.course\/create$/i.test(path);
    const isCloneRoute = /\/content-manager\/collection-types\/api::course\.course\/clone\/[^/]+$/i.test(path);
    const isCourseCmList =
      /\/content-manager\/collection-types\/api::course\.course\/?$/i.test(pathNoQuery);

    if (uid === 'api::course.course' && isCourseCmList) {
      clearDuplicateCourseFlow();
    }

    if (isCloneRoute && uid === 'api::course.course') {
      markDuplicateCourseFlowActive();
    }

    if (isCreateRoute || isCloneRoute) wasCreateRouteRef.current = true;

    const shouldForceRegenerate =
      uid === 'api::course.course' && isCloneRoute && !forceRegeneratedOnceRef.current;

    didFillRef.current = false;
    const copy = JSON.parse(JSON.stringify(values));

    if (uid === 'api::course.course') {
      const isCourseCreateOrClone =
        /\/content-manager\/collection-types\/api::course\.course\/(create|clone\/[^/]+)$/i.test(path);

      if (!isCourseCreateOrClone) {
        strippedDuplicateCourseAssignmentsRef.current = false;
        forceRegeneratedOnceRef.current = false;
        wasCreateRouteRef.current = false;
      }

      if (!strippedDuplicateCourseAssignmentsRef.current && hasCourseAssignmentsInFormValues(copy)) {
        const stripOnCloneRoute = isCloneRoute;
        const createWithDuplicateTitle =
          isCreateRoute && !isCloneRoute && titleLooksLikeDuplicatedCourse(copy.title);
        if (stripOnCloneRoute || createWithDuplicateTitle) {
          markDuplicateCourseFlowActive();
          delete copy.course_assignments;
          didFillRef.current = true;
          strippedDuplicateCourseAssignmentsRef.current = true;
        }
      }
    }

    if (shouldForceRegenerate && uid === 'api::course.course') {
      const changedByHardCourseRegeneration = forceRegenerateCourseIds(copy);
      if (changedByHardCourseRegeneration) didFillRef.current = true;
    }
    fillIdsInObject(copy, config, didFillRef, { forceRegenerate: shouldForceRegenerate });

    if (didFillRef.current) {
      if (shouldForceRegenerate) {
        forceRegeneratedOnceRef.current = true;
      }
      setValues(copy);
    }
  }, [uid, values, setValues, config]);

  // Duplicate modal: when user clicks "Create", regenerate unique component ids
  // just-in-time, then replay the click so submit continues with fresh ids.
  useEffect(() => {
    if (uid !== 'api::course.course' || !config || typeof setValues !== 'function') return;

    const onPointerDown = (e) => {
      const btn = e.target.closest?.('button');
      if (!btn) return;
      const label = String(btn.textContent || '').trim().toLowerCase();
      if (label !== 'create') return;

      const dialog = btn.closest('[role="dialog"]');
      const dialogText = String(dialog?.textContent || '').toLowerCase();
      if (!dialog || !dialogText.includes('duplicate')) return;

      if (replayCreateClickRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      markDuplicateCourseFlowActive();

      const copy = JSON.parse(JSON.stringify(values || {}));
      didFillRef.current = false;
      if (stripCourseAssignmentsFromCourseFormCopy(copy)) {
        didFillRef.current = true;
        strippedDuplicateCourseAssignmentsRef.current = true;
      }
      fillIdsInObject(copy, config, didFillRef, { forceRegenerate: true });

      if (didFillRef.current) {
        setValues(copy);
      }

      replayCreateClickRef.current = true;
      setTimeout(() => {
        btn.click();
        setTimeout(() => {
          replayCreateClickRef.current = false;
        }, 0);
      }, 0);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [uid, config, values, setValues]);

  return null;
}

export default AutoFillComponentIds;
