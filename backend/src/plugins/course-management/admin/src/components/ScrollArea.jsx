// @ts-nocheck
/**
 * The plugin's own scroll area: exactly one screen high, so long pages scroll inside it
 * while the Strapi menu stays in place (when the browser window scrolls instead, the left
 * menu scrolls away with the page). Also leaves room at the bottom of every page.
 */
import React from 'react';
import { Box } from '@strapi/design-system';

export const SCROLL_AREA_ID = 'course-management-scroll';

/** Scroll the plugin page (not the window) back to the top. */
export function scrollToTop() {
  document.getElementById(SCROLL_AREA_ID)?.scrollTo?.({ top: 0, behavior: 'smooth' });
}

/**
 * position: relative matters: inputs of selects / checkboxes / radios contain visually hidden,
 * absolutely positioned elements. Without a positioned scroll area they are placed against the
 * document, make it taller than the screen and bring back a second (window) scrollbar.
 */
export const scrollAreaStyle = { position: 'relative', height: '100vh', overflowY: 'auto', overflowX: 'hidden' };

export default function ScrollArea({ id = SCROLL_AREA_ID, children }) {
  return (
    <Box id={id} style={scrollAreaStyle}>
      <Box paddingBottom={10}>{children}</Box>
    </Box>
  );
}
