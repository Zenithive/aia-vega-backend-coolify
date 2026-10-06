// @ts-nocheck
/**
 * Media field backed by Strapi's own Media Library dialog (same picker/uploader the
 * Content Manager uses), so files land in the regular upload plugin.
 */
import React, { useState } from 'react';
import { Box, Flex, Typography, Button, IconButton } from '@strapi/design-system';
import { Plus, Trash, File as FileIcon, Play, ExternalLink } from '@strapi/icons';
import { useStrapiApp } from '@strapi/strapi/admin';
import { mediaUrl, thumbnailUrl } from '../utils/course';

function formatSize(kb) {
  if (kb == null) return '';
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

function Preview({ file }) {
  const mime = String(file?.mime || '');
  if (mime.startsWith('image/')) {
    return (
      <img
        src={thumbnailUrl(file)}
        alt={file.alternativeText || file.name || ''}
        style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 4, display: 'block' }}
      />
    );
  }
  const Icon = mime.startsWith('video/') ? Play : FileIcon;
  return (
    <Flex width="56px" height="40px" justifyContent="center" alignItems="center" background="neutral150" hasRadius>
      <Icon />
    </Flex>
  );
}

/**
 * @param {object} props
 * @param {object|object[]|null} props.value  media object(s) as returned by the API
 * @param {(value) => void} props.onChange
 * @param {boolean} [props.multiple]
 * @param {string[]} [props.allowedTypes] images | videos | files | audios
 */
export default function MediaPicker({ value, onChange, multiple = false, allowedTypes, disabled, emptyLabel = 'No file selected', addLabel }) {
  const [open, setOpen] = useState(false);
  const components = useStrapiApp('CourseManagementMediaPicker', (state) => state.components);
  const MediaLibraryDialog = components?.['media-library'];

  const files = multiple ? (Array.isArray(value) ? value : []) : value ? [value] : [];

  const handleSelect = (assets) => {
    const picked = (Array.isArray(assets) ? assets : []).filter(Boolean);
    if (multiple) {
      const existing = new Set(files.map((f) => f.id));
      onChange([...files, ...picked.filter((a) => !existing.has(a.id))]);
    } else {
      onChange(picked[0] || null);
    }
    setOpen(false);
  };

  const removeAt = (index) => {
    if (multiple) onChange(files.filter((_, i) => i !== index));
    else onChange(null);
  };

  return (
    <Box>
      {files.length === 0 ? (
        <Box padding={4} hasRadius borderStyle="dashed" borderWidth="1px" borderColor="neutral300" background="neutral100">
          <Typography variant="omega" textColor="neutral600">
            {emptyLabel}
          </Typography>
        </Box>
      ) : (
        <Flex direction="column" alignItems="stretch" gap={2}>
          {files.map((file, index) => (
            <Flex
              key={file.id ?? index}
              gap={3}
              padding={2}
              hasRadius
              borderStyle="solid"
              borderWidth="1px"
              borderColor="neutral200"
              background="neutral0"
            >
              <Preview file={file} />
              <Flex direction="column" alignItems="flex-start" flex="1" style={{ minWidth: 0 }}>
                <Typography variant="omega" fontWeight="semiBold" ellipsis style={{ maxWidth: '100%' }}>
                  {file.name || `File #${file.id}`}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {[file.ext?.replace('.', '').toUpperCase(), formatSize(file.size)].filter(Boolean).join(' · ')}
                </Typography>
              </Flex>
              {mediaUrl(file) && (
                <IconButton
                  label="Open file in a new tab"
                  variant="ghost"
                  tag="a"
                  href={mediaUrl(file)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink />
                </IconButton>
              )}
              {!disabled && (
                <IconButton label="Remove file" variant="ghost" onClick={() => removeAt(index)}>
                  <Trash />
                </IconButton>
              )}
            </Flex>
          ))}
        </Flex>
      )}
      {!disabled && (
        <Box marginTop={2}>
          <Button variant="secondary" size="S" startIcon={<Plus />} onClick={() => setOpen(true)} disabled={!MediaLibraryDialog}>
            {addLabel || (files.length && !multiple ? 'Replace file' : multiple ? 'Add files' : 'Choose file')}
          </Button>
        </Box>
      )}
      {open && MediaLibraryDialog && (
        <MediaLibraryDialog
          allowedTypes={allowedTypes}
          multiple={multiple}
          onClose={() => setOpen(false)}
          onSelectAssets={handleSelect}
        />
      )}
    </Box>
  );
}
