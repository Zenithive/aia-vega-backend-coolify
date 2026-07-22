import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_WORKFLOW_MODEL = 'api::course-workflow.course-workflow';
const DISABLED_ATTR = 'data-course-workflow-offline-module-add-disabled';
const DELETE_DISABLED_ATTR = 'data-course-workflow-offline-module-delete-disabled';
const STYLE_ID = 'course-workflow-offline-module-add-disabled-style';
const OFFLINE_MODULE_HEADING_RE = /^offline[_\s]modules?\s*(\(\d+\))?$/i;
const DELETE_TOOLTIP = 'Remove user to delete this offline module';
const HEADING_SELECTOR = 'span,p,label,strong,div,h1,h2,h3,h4,h5,h6';

function isInsideAccordionPanel(el) {
  let node = el?.parentElement || null;
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

function isOfflineModulesHeading(el) {
  const txt = (el?.textContent || '').replace(/\s+/g, ' ').trim();
  return OFFLINE_MODULE_HEADING_RE.test(txt);
}

function attrsText(el) {
  if (!el) return '';
  const raw = [];
  raw.push(el.textContent || '');
  raw.push(el.getAttribute?.('aria-label') || '');
  raw.push(el.getAttribute?.('title') || '');
  raw.push(el.getAttribute?.('data-testid') || '');
  raw.push(el.getAttribute?.('name') || '');

  if (el.attributes) {
    for (const attr of el.attributes) {
      raw.push(attr.name || '');
      raw.push(attr.value || '');
    }
  }

  return raw.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isLikelyDragHandle(btn) {
  const txt = attrsText(btn);
  return txt.includes('drag') || txt.includes('reorder') || txt.includes('sort') || txt.includes('move');
}

function isLikelyDeleteButton(btn) {
  const txt = attrsText(btn);
  if (txt.includes('delete') || txt.includes('trash') || txt.includes('remove')) return true;

  // Fallback: in Strapi repeatable entry action area there are typically icon-only
  // buttons for delete + drag. If this button is icon-only and its sibling set
  // contains a drag-handle button, treat this as delete when it is not the drag button.
  const hasSvg = !!btn.querySelector('svg');
  const hasVisibleText = (btn.textContent || '').replace(/\s+/g, '').length > 0;
  if (!hasSvg || hasVisibleText) return false;

  const actionWrap = btn.parentElement;
  if (!actionWrap) return false;
  const siblingButtons = [...actionWrap.querySelectorAll(':scope > button')];
  if (siblingButtons.length < 2) return false;

  const hasDragSibling = siblingButtons.some((s) => s !== btn && isLikelyDragHandle(s));
  if (!hasDragSibling) return false;

  return !isLikelyDragHandle(btn);
}

// ── Custom tooltip for disabled delete buttons ──────────────────────────────

function getDeleteTooltipEl() {
  const ID = 'cw-offline-delete-tip';
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ID;
    el.style.cssText = [
      'position:fixed',
      'z-index:99999',
      'background:#212134',
      'color:#fff',
      'font-size:11px',
      'line-height:1.4',
      'padding:4px 10px',
      'border-radius:4px',
      'pointer-events:none',
      'display:none',
      'white-space:nowrap',
      'box-shadow:0 2px 6px rgba(0,0,0,.3)',
    ].join(';');
    document.body.appendChild(el);
  }
  return el;
}

function showDeleteTooltip(e) {
  const btn = e.currentTarget;
  const tip = getDeleteTooltipEl();
  tip.textContent = DELETE_TOOLTIP;
  tip.style.display = 'block';
  requestAnimationFrame(() => {
    const rect = btn.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = rect.left + rect.width / 2 - tw / 2;
    let top = rect.top - th - 6;
    if (top < 4) top = rect.bottom + 6;
    left = Math.max(4, Math.min(window.innerWidth - tw - 4, left));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  });
}

function hideDeleteTooltip() {
  const tip = document.getElementById('cw-offline-delete-tip');
  if (tip) tip.style.display = 'none';
}

// ── Identify an offline_module entry delete button ───────────────────────────
//
// Key constraint: the button's nearest role="region" ancestor must be the SAME
// region that directly contains the offline_module heading. This excludes:
//   - the module-level trash (its region is the outer modules list, not a module panel)
//   - delete buttons inside expanded entry content (their region is the entry panel)

function isOfflineModuleDeleteButton(btn) {
  // Quick path: already marked by MutationObserver
  if (btn.getAttribute(DELETE_DISABLED_ATTR) === 'true') return true;

  if (!isLikelyDeleteButton(btn)) return false;

  // Walk UP through every ancestor region until we find one that directly
  // contains an offline_module heading. This handles all Strapi accordion
  // structures regardless of whether the entry item itself is wrapped in a
  // region (which would make btn.closest('[role=region]') !== moduleRegion).
  let node = btn.parentElement;
  while (node && node !== document.body) {
    if (node.getAttribute('role') === 'region') {
      const hasHeading = [...node.querySelectorAll(
        HEADING_SELECTOR
      )].some((el) => {
        if (!isOfflineModulesHeading(el)) return false;
        // The heading must be a direct member of this region, not a deeper nested one
        return el.closest('[role="region"]') === node;
      });
      if (hasHeading) return true;
    }
    node = node.parentElement;
  }
  return false;
}

// ── Visual marking (cursor + tooltip binding) ────────────────────────────────

function markOfflineModuleDeleteButtons() {
  const headings = [...document.querySelectorAll(HEADING_SELECTOR)].filter((el) => {
    if (!isInsideAccordionPanel(el)) return false;
    return isOfflineModulesHeading(el);
  });

  for (const heading of headings) {
    const moduleRegion = heading.closest('[role="region"]');
    if (!moduleRegion) continue;

    // querySelectorAll already scopes to moduleRegion descendants; no need for
    // a region-equality check — that was filtering out buttons when Strapi
    // wraps each accordion entry (header + content) in its own role="region".
    const deleteBtns = [...moduleRegion.querySelectorAll('button')].filter((btn) => {
      return isLikelyDeleteButton(btn);
    });

    deleteBtns.forEach((btn) => {
      if (btn.getAttribute(DELETE_DISABLED_ATTR) === 'true') return; // already patched
      btn.setAttribute(DELETE_DISABLED_ATTR, 'true');
      btn.setAttribute('aria-disabled', 'true');
      btn.style.cursor = 'not-allowed';
      btn.addEventListener('mouseenter', showDeleteTooltip);
      btn.addEventListener('mouseleave', hideDeleteTooltip);
    });
  }
}

function applyDisabledVisual(btn, tooltip) {
  btn.setAttribute(DISABLED_ATTR, 'true');
  btn.setAttribute('aria-disabled', 'true');
  btn.style.color = '#8e8ea9';
  btn.style.backgroundColor = '#f6f6f9';
  btn.style.borderColor = '#d9d9e3';
  btn.style.pointerEvents = 'auto';
  btn.style.cursor = 'not-allowed';
  btn.disabled = true;
  btn.title = tooltip;
}

function disableOfflineModuleAddButtons() {
  const tooltip = 'Offline module entries are managed automatically from selected users.';

  // We only target headings inside accordion panels, so top-level repeatables are not affected.
  const headings = [...document.querySelectorAll(HEADING_SELECTOR)].filter((el) => {
    if (!isInsideAccordionPanel(el)) return false;
    return isOfflineModulesHeading(el);
  });

  for (const heading of headings) {
    let container = heading.parentElement;

    // Walk up to find the immediate field section that owns this offline_module block.
    for (let i = 0; i < 12; i++) {
      if (!container || container === document.body) break;

      const addBtns = [...container.querySelectorAll('button')].filter((btn) => {
        if (!isAddEntryControl(btn)) return false;
        if (!isInsideAccordionPanel(btn)) return false;
        // Keep it inside the same workflow module panel as heading.
        const headingPanel = heading.closest('[role="region"]');
        const buttonPanel = btn.closest('[role="region"]');
        return headingPanel && buttonPanel && headingPanel === buttonPanel;
      });

      if (addBtns.length > 0) {
        addBtns.forEach((btn) => applyDisabledVisual(btn, tooltip));
        break;
      }

      container = container.parentElement;
    }
  }
}

export default function CourseWorkflowDisableOfflineModuleAddButtons({ slug, model }) {
  const uid = slug || model;

  // Re-run when module list changes or module_type values toggle between Online/Offline.
  useForm(
    'CourseWorkflowDisableOfflineModuleAddButtons',
    (s) => {
      const modules = Array.isArray(s?.values?.modules) ? s.values.modules : [];
      return modules.map((m) => String(m?.module_type || '')).join('|');
    },
    false,
  );

  const timerRef = useRef(null);
  const docClickRef = useRef(null);

  useEffect(() => {
    if (uid !== COURSE_WORKFLOW_MODEL) return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        button[${DISABLED_ATTR}="true"],
        button[${DISABLED_ATTR}="true"]:hover,
        button[${DISABLED_ATTR}="true"]:focus {
          cursor: not-allowed !important;
          pointer-events: auto !important;
          color: #8e8ea9 !important;
          background: #f6f6f9 !important;
          border-color: #d9d9e3 !important;
          opacity: 1 !important;
        }

        button[${DISABLED_ATTR}="true"] *,
        button[${DISABLED_ATTR}="true"]:hover *,
        button[${DISABLED_ATTR}="true"]:focus * {
          color: #8e8ea9 !important;
        }

        button[${DISABLED_ATTR}="true"] svg,
        button[${DISABLED_ATTR}="true"] svg * {
          color: #8e8ea9 !important;
          fill: currentColor !important;
          stroke: currentColor !important;
        }

        button[${DELETE_DISABLED_ATTR}="true"],
        button[${DELETE_DISABLED_ATTR}="true"]:hover,
        button[${DELETE_DISABLED_ATTR}="true"]:focus {
          cursor: not-allowed !important;
          pointer-events: auto !important;
          color: #8e8ea9 !important;
          opacity: 0.55 !important;
        }

        button[${DELETE_DISABLED_ATTR}="true"] svg,
        button[${DELETE_DISABLED_ATTR}="true"] svg * {
          color: #8e8ea9 !important;
          fill: currentColor !important;
          stroke: currentColor !important;
        }
      `;
      document.head.appendChild(style);
    }

    // ── Document-level capture click interceptor ─────────────────────────────
    // Attaching to `document` in capture phase means this fires BEFORE React's
    // root-level capture listeners, so stopPropagation() prevents React from
    // ever receiving the click and triggering the delete action.
    const handleDocClick = (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const btn = target.closest('button');
      if (!btn) return;
      if (!isOfflineModuleDeleteButton(btn)) return;
      e.stopPropagation();
      e.preventDefault();
      hideDeleteTooltip();
    };

    document.addEventListener('click', handleDocClick, true);
    docClickRef.current = handleDocClick;

    function schedule() {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        disableOfflineModuleAddButtons();
        markOfflineModuleDeleteButtons();
      }, 200);
    }

    schedule();

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clearTimeout(timerRef.current);
      if (docClickRef.current) {
        document.removeEventListener('click', docClickRef.current, true);
        docClickRef.current = null;
      }
      hideDeleteTooltip();
      const tip = document.getElementById('cw-offline-delete-tip');
      if (tip) tip.remove();
    };
  }, [uid]);

  return null;
}
