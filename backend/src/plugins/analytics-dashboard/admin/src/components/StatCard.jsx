import React from 'react';
import { Box, Flex, Typography, Button } from '@strapi/design-system';
import { CHART_COLORS } from './chartColors';

const CARD_ACCENT_COLORS = CHART_COLORS.slice(0, 6);

/**
 * `textValue`: the value is text (e.g. a course title) rather than a number — rendered smaller,
 * wrapped to two lines with an ellipsis so long titles stay inside the card (full text on hover).
 */
export function StatCard({ label, value, subtext = null, colorIndex = 0, action = null, textValue = false }) {
  const accentColor = CARD_ACCENT_COLORS[colorIndex % CARD_ACCENT_COLORS.length];
  const valueStyle = textValue
    ? {
        fontSize: '1.125rem',
        color: accentColor,
        lineHeight: 1.3,
        minWidth: 0,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflowWrap: 'anywhere',
      }
    : { fontSize: '1.75rem', color: accentColor, flexShrink: 0, lineHeight: 1.1 };
  return (
    <Box
      padding={4}
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      borderColor="neutral200"
      borderWidth="1px"
      borderStyle="solid"
      style={{
        borderLeftWidth: '4px',
        borderLeftColor: accentColor,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <Flex alignItems="flex-start" justifyContent="space-between" gap={2}>
        <Typography variant="sigma" textColor="neutral600" fontWeight="regular">
          {label}
        </Typography>
        {action && (
          <Button variant="secondary" size="S" onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </Button>
        )}
      </Flex>
      <Flex
        alignItems="baseline"
        gap={2}
        wrap="nowrap"
        style={{ marginTop: 4, minHeight: '2.25rem' }}
      >
        <Typography
          variant="alpha"
          fontWeight="bold"
          as="span"
          style={valueStyle}
          title={textValue && value != null ? String(value) : undefined}
        >
          {value ?? '—'}
        </Typography>
        {subtext && String(subtext).trim() ? (
          <Typography
            variant="pi"
            textColor="neutral500"
            as="span"
            style={{
              fontSize: '11px',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {subtext}
          </Typography>
        ) : null}
      </Flex>
    </Box>
  );
}
