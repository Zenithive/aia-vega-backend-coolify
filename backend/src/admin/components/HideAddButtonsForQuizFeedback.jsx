/**
 * Disables the top-level "Add an entry" button for the `quiz` and `feedback`
 * repeatable fields on the Course edit view.
 *
 * These fields must only be populated by selecting languages in the
 * "Course language" field (which auto-creates one entry per language).
 *
 * Inner component repeatables (quiz_questions, feedback_question, etc.) are
 * intentionally NOT affected -- only the top-level quiz/feedback add buttons.
 *
 * Why the previous "nearest preceding label" approach failed:
 *   The accordion entry labels (e.g. "English", "Gujarati") are the closest
 *   preceding text nodes before the add-entry button, not the section heading
 *   "Quiz (3)" / "Feedback (3)".
 *
 * Correct strategy (heading-first, walk-up):
 *   1. Find the "Quiz (N)" / "Feedback (N)" heading element (outside any
 *      accordion panel so it is genuinely top-level).
 *   2. Walk UP the DOM from that heading until we reach the containing section
 *      that also wraps the "Add an entry" button.
 *   3. Disable all add-entry buttons found inside that section that are NOT
 *      themselves inside a nested accordion panel (role="region").
 */

import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_MODEL = 'api::course.course';
const DISABLED_BTN_ATTR = 'data-course-auto-disabled-add-entry';
const STYLE_ID = 'course-auto-disabled-add-entry-style';

// Match "Quiz", "Quiz (3)", "Feedback", "Feedback (3)", etc. -- case-insensitive
const QUIZ_HEADING_RE     = /^quiz\s*(\(\d+\))?$/i;
const FEEDBACK_HEADING_RE = /^feedback\s*(\(\d+\))?$/i;

const TOOLTIP =
  'Entries are managed automatically. Select languages in "Course language" to add or remove entries.';

/** Returns true when el is inside a Radix/Strapi accordion content panel (role="region"). */
function isInsideAccordionPanel(el) {
  let node = el.parentElement;
  while (node && node !== document.body) {
    if (node.getAttribute('role') === 'region') return true;
    node = node.parentElement;
  }
  return false;
}

function isAddEntryControl(btn) {
  const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    /add\s+(an|another)\s+entry/.test(text) ||
    /click\s*to\s*add(\s+one)?/.test(text) ||
    /no\s+entry\s+yet/.test(text)
  );
}

function disableAddButtons() {
  // Step 1: find all Quiz / Feedback section headings at the true top level.
  const headings = [...document.querySelectorAll('span, p, label, strong, h1, h2, h3, h4, h5, h6')].filter(
    (el) => {
      if (el.childElementCount !== 0) return false;
      if (isInsideAccordionPanel(el)) return false;
      const txt = (el.textContent || '').trim();
      return QUIZ_HEADING_RE.test(txt) || FEEDBACK_HEADING_RE.test(txt);
    }
  );

  // Step 2: for each heading walk UP until we reach the section that also
  // contains the "Add an entry" button, then disable it.
  for (const heading of headings) {
    let container = heading.parentElement;
    for (let i = 0; i < 15; i++) {
      if (!container || container === document.body) break;

      // Find add-entry buttons inside this container that are NOT nested inside
      // an accordion panel (those belong to inner repeatable components).
      const addBtns = [...container.querySelectorAll('button')].filter(
        (btn) => isAddEntryControl(btn) && !isInsideAccordionPanel(btn),
      );

      if (addBtns.length > 0) {
        addBtns.forEach((btn) => {
          btn.setAttribute(DISABLED_BTN_ATTR, 'true');
          btn.setAttribute('aria-disabled', 'true');
          btn.style.color = '#8e8ea9';
          btn.style.backgroundColor = '#f6f6f9';
          btn.style.borderColor = '#d9d9e3';
          btn.style.pointerEvents = 'auto';
          btn.style.cursor = 'not-allowed';
          if (!btn.disabled) {
            btn.disabled = true;
            btn.title = TOOLTIP;
          }
        });
        break; // section found and handled
      }

      container = container.parentElement;
    }
  }
}

function HideAddButtonsForQuizFeedback({ slug, model }) {
  const uid = slug || model;

  // Re-run when quiz/feedback array lengths change (after language-sync
  // creates or removes entries the heading text updates to e.g. "Quiz (2)").
  useForm(
    'HideAddButtonsForQuizFeedback',
    (s) => {
      const q = s?.values?.quiz;
      const f = s?.values?.feedback;
      return `${Array.isArray(q) ? q.length : 0}-${Array.isArray(f) ? f.length : 0}`;
    },
    false,
  );

  const timerRef = useRef(null);

  useEffect(() => {
    if (uid !== COURSE_MODEL) return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        button[${DISABLED_BTN_ATTR}="true"],
        button[${DISABLED_BTN_ATTR}="true"]:hover,
        button[${DISABLED_BTN_ATTR}="true"]:focus {
          cursor: not-allowed !important;
          pointer-events: auto !important;
          color: #8e8ea9 !important;
          background: #f6f6f9 !important;
          border-color: #d9d9e3 !important;
          opacity: 1 !important;
        }

        button[${DISABLED_BTN_ATTR}="true"] *,
        button[${DISABLED_BTN_ATTR}="true"]:hover *,
        button[${DISABLED_BTN_ATTR}="true"]:focus * {
          color: #8e8ea9 !important;
        }

        button[${DISABLED_BTN_ATTR}="true"] svg,
        button[${DISABLED_BTN_ATTR}="true"] svg * {
          color: #8e8ea9 !important;
          fill: currentColor !important;
          stroke: currentColor !important;
        }
      `;
      document.head.appendChild(style);
    }

    function schedule() {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(disableAddButtons, 250);
    }

    schedule();

    // Re-apply after any structural DOM change (React reconciliation can reset
    // attributes) -- observe childList only so setting btn.disabled does not
    // trigger a new cycle.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clearTimeout(timerRef.current);
    };
  }, [uid]);

  return null;
}

export default HideAddButtonsForQuizFeedback;
