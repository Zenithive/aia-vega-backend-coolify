import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const WORKFLOW_MODEL = 'api::course-workflow.course-workflow';
const STYLE_ID = 'wf-module-idx-style';

function isBefore(a, b) {
  return Boolean(a?.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function isModuleTriggerButton(btn) {
  if (!btn || btn.getAttribute('aria-expanded') == null) return false;

  const item = btn.closest('[data-state]');
  if (!item) return false;

  const region = item.querySelector('[role="region"]');
  if (!region) return false;

  const txt = (region.textContent || '').toLowerCase();
  return txt.includes('module_type');
}

function getTopLevelButtonsInWrapper(wrapper) {
  const allBtns = [...wrapper.querySelectorAll('button[aria-expanded]')];
  if (allBtns.length === 0) return [];

  const withDepth = allBtns.map((btn) => {
    let d = 0;
    let p = btn;
    while (p && p !== wrapper) {
      p = p.parentElement;
      d++;
    }
    return { btn, d };
  });

  const minDepth = Math.min(...withDepth.map((x) => x.d));
  return withDepth.filter((x) => x.d === minDepth).map((x) => x.btn);
}

function findModulesHeading() {
  for (const el of document.querySelectorAll('span, p, h1, h2, h3, h4, h5, h6, div, label, strong')) {
    const txt = (el.textContent || '').trim();
    if (/^modules(\s*\(\d+\))?$/i.test(txt)) {
      return el;
    }
  }
  return null;
}

function getModuleTriggerButtons(expectedCount) {
  const expected = typeof expectedCount === 'number' ? expectedCount : 0;

  const heading = findModulesHeading();
  if (heading) {
    const allHeadings = [...document.querySelectorAll('span, p, h1, h2, h3, h4, h5, h6, div, label, strong')];
    const nextCategoryHeading = allHeadings.find(
      (el) =>
        el !== heading &&
        /^category$/i.test((el.textContent || '').trim()) &&
        isBefore(heading, el),
    );

    const candidates = [...document.querySelectorAll('button[aria-expanded]')].filter((btn) => {
      if (!isBefore(heading, btn)) return false;
      if (nextCategoryHeading && !isBefore(btn, nextCategoryHeading)) return false;
      // Exclude nested form controls inside module body; keep top-level module triggers.
      if (btn.closest('[role="region"]')) return false;
      return true;
    });

    if (candidates.length > 0) {
      if (expected > 0) return candidates.slice(0, expected);
      return candidates;
    }
  }

  // Fallback when heading-based lookup fails.
  const byRegion = [...document.querySelectorAll('button[aria-expanded]')].filter(isModuleTriggerButton);
  if (expected > 0 && byRegion.length > 0) return byRegion.slice(0, expected);
  return byRegion;
}

function CourseWorkflowModuleIndexLabel({ slug, model }) {
  const uid = slug || model;
  const modules = useForm('CourseWorkflowModuleIndexLabel.modules', (s) => {
    const m = s?.values?.modules;
    return Array.isArray(m) ? m : [];
  }, false);
  const modulesLen = useForm(
    'CourseWorkflowModuleIndexLabel',
    (s) => {
      const m = s?.values?.modules;
      return Array.isArray(m) ? m.length : 0;
    },
    false,
  );

  useEffect(() => {
    if (uid !== WORKFLOW_MODEL) return;

    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = `
        [data-wf-module-idx]::after {
          content: "Module (" attr(data-wf-module-idx) ") - " attr(data-wf-module-type);
          font-weight: 600;
          font-size: 14px;
          margin-left: 8px;
        }
      `;
      document.head.appendChild(st);
    }

    function applyLabels() {
      const moduleBtns = getModuleTriggerButtons(modulesLen);
      if (moduleBtns.length === 0) return;

      moduleBtns.forEach((btn, idx) => {
        const moduleType = String(modules?.[idx]?.module_type || '').trim();
        btn.setAttribute('data-wf-module-idx', String(idx + 1));
        if (moduleType) {
          btn.setAttribute('data-wf-module-type', moduleType);
        }
      });
    }

    // Apply labels only when modules array actually changes
    applyLabels();

    return () => {
      document
        .querySelectorAll('[data-wf-module-idx]')
        .forEach((el) => {
          el.removeAttribute('data-wf-module-idx');
          el.removeAttribute('data-wf-module-type');
        });
      document.getElementById(STYLE_ID)?.remove();
    };
  }, [uid, modulesLen, modules]);

  return null;
}

export default CourseWorkflowModuleIndexLabel;
