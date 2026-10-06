// @ts-nocheck
import { createContext, useContext } from 'react';

/** Pending counts for the tabs; pages call refresh() after an approval or a saved review. */
export const SummaryContext = createContext({ summary: {}, refresh: () => {} });

export const useSummary = () => useContext(SummaryContext);
