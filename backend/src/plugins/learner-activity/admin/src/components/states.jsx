// @ts-nocheck
/** Loading / error / empty blocks shared by the tabs. */
import React from 'react';
import { Box, EmptyStateLayout, Flex, Loader, Typography } from '@strapi/design-system';

export function Loading({ children = 'Loading…' }) {
  return (
    <Flex justifyContent="center" padding={8}>
      <Loader>{children}</Loader>
    </Flex>
  );
}

export function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <Box padding={4} marginBottom={4} background="danger100" hasRadius>
      <Typography textColor="danger700">{message}</Typography>
    </Box>
  );
}

export function Empty({ icon, content, action }) {
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow">
      <EmptyStateLayout icon={icon} content={content} action={action} />
    </Box>
  );
}

/** "12 submissions" style counter shown above a table. */
export function CountLine({ count, noun }) {
  return (
    <Typography variant="pi" textColor="neutral600" tag="p" marginBottom={3}>
      {`${count} ${noun}${count === 1 ? '' : 's'}`}
    </Typography>
  );
}
