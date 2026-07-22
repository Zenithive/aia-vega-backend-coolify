// // @ts-nocheck
// import { useEffect } from 'react';

// function KeepRelationDropdownOpen() {
//   useEffect(() => {
//     const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
//     let reopenToken = 0;

//     const getOwnerCombobox = (listbox) => {
//       if (!listbox) return null;
//       if (listbox.id) {
//         const owner = document.querySelector(`input[aria-controls="${esc(listbox.id)}"]`);
//         if (owner) return owner;
//       }
//       return document.querySelector('input[aria-expanded="true"][aria-controls]');
//     };

//     const openCombobox = (combobox) => {
//       if (!combobox || !document.body.contains(combobox)) return;
//       combobox.focus();
//       combobox.dispatchEvent(new KeyboardEvent('keydown', {
//         key: 'ArrowDown',
//         code: 'ArrowDown',
//         keyCode: 40,
//         bubbles: true,
//         cancelable: true,
//       }));
//     };

//     const getOpenRelationListbox = () => {
//       const expandedOwner = document.querySelector('input[aria-expanded="true"][aria-controls]');
//       if (expandedOwner) {
//         const id = expandedOwner.getAttribute('aria-controls');
//         const lb = id ? document.getElementById(id) : null;
//         if (lb?.getAttribute('role') === 'listbox') return lb;
//       }
//       return document.querySelector('[role="listbox"]');
//     };

//     const isInsideActiveRelationUI = (target) => {
//       const listbox = getOpenRelationListbox();
//       if (!listbox) return false;
//       if (listbox.contains(target)) return true;
//       const owner = getOwnerCombobox(listbox);
//       if (owner && owner.contains(target)) return true;
//       if (listbox.id) {
//         const toggle = document.querySelector(`button[aria-controls="${esc(listbox.id)}"]`);
//         if (toggle && toggle.contains(target)) return true;
//       }
//       return false;
//     };

//     const onPointerDown = (e) => {
//       // Outside click must close and stay closed.
//       if (!isInsideActiveRelationUI(e.target)) {
//         reopenToken += 1;
//       }

//       const option = e.target.closest('[role="option"]');
//       if (!option) return;

//       const listbox = option.closest('[role="listbox"]');
//       if (!listbox) return;

//       const owner = getOwnerCombobox(listbox);
//       if (!owner) return;
//       const tokenAtClick = reopenToken;

//       // Reopen after selection close. Retry a few times for async relation refresh.
//       const delays = [30, 90, 180, 320];
//       delays.forEach((ms) => {
//         setTimeout(() => {
//           if (tokenAtClick !== reopenToken) return; // cancelled by outside click
//           const activeOwner = getOwnerCombobox(listbox) || owner;
//           if (!activeOwner || !document.body.contains(activeOwner)) return;
//           if (activeOwner.getAttribute('aria-expanded') === 'true') return;
//           openCombobox(activeOwner);
//         }, ms);
//       });
//     };

//     document.addEventListener('pointerdown', onPointerDown, true);
//     return () => {
//       document.removeEventListener('pointerdown', onPointerDown, true);
//     };
//   }, []);

//   return null;
// }

// export default KeepRelationDropdownOpen;

// @ts-nocheck
import { useEffect } from 'react';

function KeepRelationDropdownOpen() {
  useEffect(() => {
    const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    let reopenToken = 0;
      const getSelectedValues = () => {
    // Strapi shows selected items as tags/chips
    const chips = document.querySelectorAll('[data-strapi-relation-chip], [class*="Tag"]');

    const values = new Set();

    chips.forEach((chip) => {
      const text = chip.textContent?.trim();
      if (text) values.add(text);
    });

    return values;
};

    const getOwnerCombobox = (listbox) => {
      if (!listbox) return null;
      if (listbox.id) {
        const owner = document.querySelector(`input[aria-controls="${esc(listbox.id)}"]`);
        if (owner) return owner;
      }
      return document.querySelector('input[aria-expanded="true"][aria-controls]');
    };

    const openCombobox = (combobox) => {
      if (!combobox || !document.body.contains(combobox)) return;
      combobox.focus();
      combobox.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
        cancelable: true,
      }));
    };

    const getOpenRelationListbox = () => {
      const expandedOwner = document.querySelector('input[aria-expanded="true"][aria-controls]');
      if (expandedOwner) {
        const id = expandedOwner.getAttribute('aria-controls');
        const lb = id ? document.getElementById(id) : null;
        if (lb?.getAttribute('role') === 'listbox') return lb;
      }
      return document.querySelector('[role="listbox"]');
    };

    const isInsideActiveRelationUI = (target) => {
      const listbox = getOpenRelationListbox();
      if (!listbox) return false;
      if (listbox.contains(target)) return true;
      const owner = getOwnerCombobox(listbox);
      if (owner && owner.contains(target)) return true;
      if (listbox.id) {
        const toggle = document.querySelector(`button[aria-controls="${esc(listbox.id)}"]`);
        if (toggle && toggle.contains(target)) return true;
      }
      return false;
    };

    const onPointerDown = (e) => {

     // 🆕 ================= STRONG DUPLICATE PREVENTION =================
const option = e.target.closest('[role="option"]');
if (option) {
  const selectedValues = getSelectedValues();

  const optionText = option.textContent?.trim();

  if (selectedValues.has(optionText)) {
    // 🚫 Block duplicate selection (THIS WILL WORK)
    e.preventDefault();
    e.stopPropagation();
    return;
  }
}
      // 🆕 ========================================================


      // Outside click must close and stay closed.
      if (!isInsideActiveRelationUI(e.target)) {
        reopenToken += 1;
      }

      if (!option) return;

      const listbox = option.closest('[role="listbox"]');
      if (!listbox) return;

      const owner = getOwnerCombobox(listbox);
      if (!owner) return;
      const tokenAtClick = reopenToken;

      // Reopen after selection close. Retry a few times for async relation refresh.
      const delays = [30, 90, 180, 320];
      delays.forEach((ms) => {
        setTimeout(() => {
          if (tokenAtClick !== reopenToken) return; // cancelled by outside click
          const activeOwner = getOwnerCombobox(listbox) || owner;
          if (!activeOwner || !document.body.contains(activeOwner)) return;
          if (activeOwner.getAttribute('aria-expanded') === 'true') return;
          openCombobox(activeOwner);
        }, ms);
      });
    };

    document.addEventListener('pointerdown', onPointerDown, true);

    // 🆕 OPTIONAL: Disable already selected options visually on render/update
    const disableSelectedOptions = () => {
      document.querySelectorAll('[role="option"]').forEach((opt) => {
        if (opt.getAttribute('aria-selected') === 'true') {
          opt.style.pointerEvents = 'none';
          opt.style.opacity = '0.5';
        }
      });
    };

    const observer = new MutationObserver(disableSelectedOptions);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      observer.disconnect(); // 🆕 cleanup
    };
  }, []);

  return null;
}

export default KeepRelationDropdownOpen;