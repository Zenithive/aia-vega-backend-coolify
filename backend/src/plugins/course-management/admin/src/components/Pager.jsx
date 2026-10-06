// @ts-nocheck
/** Client-side paging for the result lists. */
import React, { useEffect, useState } from 'react';
import { Button, Flex, Typography } from '@strapi/design-system';

const PAGE_SIZE = 20;

export function usePaged(list) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  useEffect(() => setPage(1), [list]);
  const current = Math.min(page, pageCount);
  return {
    rows: list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pageCount,
    total: list.length,
    setPage,
  };
}

export default function Pager({ paged }) {
  if (paged.pageCount <= 1) return null;
  const from = (paged.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(paged.page * PAGE_SIZE, paged.total);
  return (
    <Flex justifyContent="space-between" alignItems="center" marginTop={4}>
      <Typography variant="pi" textColor="neutral600">{`Showing ${from}–${to} of ${paged.total}`}</Typography>
      <Flex gap={2} alignItems="center">
        <Button variant="tertiary" size="S" disabled={paged.page <= 1} onClick={() => paged.setPage(paged.page - 1)}>
          Previous
        </Button>
        <Typography variant="pi">{`Page ${paged.page} of ${paged.pageCount}`}</Typography>
        <Button variant="tertiary" size="S" disabled={paged.page >= paged.pageCount} onClick={() => paged.setPage(paged.page + 1)}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}
