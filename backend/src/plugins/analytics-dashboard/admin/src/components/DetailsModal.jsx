// @ts-nocheck
/**
 * "View more" popup: the details of one table row as sections of tiles.
 *
 * tags: short facts shown under the title (e.g. ['Mandatory', '5 modules'])
 * sections: [{ title, accent?, items: [[label, value, note?] | false] }]
 *   value is shown large; note is a small line under it (text or a node, e.g. a progress bar).
 */
import React from 'react';
import { Badge, Box, Button, Flex, Modal, Typography } from '@strapi/design-system';
import { CHART_COLORS } from './chartColors';

function Tile({ label, value, note }) {
  return (
    <Box
      padding={3}
      hasRadius
      background="neutral100"
      borderColor="neutral150"
      borderStyle="solid"
      borderWidth="1px"
      style={{ minWidth: 0 }}
    >
      <Typography variant="sigma" textColor="neutral600" tag="p">
        {label}
      </Typography>
      <Typography variant="beta" textColor="neutral800" tag="p" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>
        {value == null || value === '' ? '—' : value}
      </Typography>
      {note != null && note !== '' && (
        <Box marginTop={1}>{typeof note === 'string' ? <Typography variant="pi" textColor="neutral600">{note}</Typography> : note}</Box>
      )}
    </Box>
  );
}

function Section({ title, items, accent }) {
  return (
    <Box
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      borderColor="neutral200"
      borderStyle="solid"
      borderWidth="1px"
      marginBottom={4}
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <Box paddingTop={3} paddingBottom={3} paddingLeft={4} paddingRight={4} style={{ borderBottom: '1px solid #eaeaef' }}>
        <Typography variant="delta" tag="h4">
          {title}
        </Typography>
      </Box>
      <Box padding={3} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
        {items.filter(Boolean).map(([label, value, note]) => (
          <Tile key={label} label={label} value={value} note={note} />
        ))}
      </Box>
    </Box>
  );
}

export function DetailsModal({ title, tags = [], sections = [], onClose, children = null, maxWidth = 860 }) {
  return (
    <Modal.Root open onOpenChange={(o) => !o && onClose()}>
      <Modal.Content style={{ maxWidth, width: '94vw' }}>
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {tags.length > 0 && (
            <Flex gap={2} wrap="wrap" marginBottom={4}>
              {tags.filter(Boolean).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </Flex>
          )}
          {sections.map((s, i) => (
            <Section key={s.title} title={s.title} items={s.items} accent={s.accent || CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
          {children}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Close</Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
