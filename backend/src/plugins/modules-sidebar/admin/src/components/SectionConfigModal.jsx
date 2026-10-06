import React, { useState, useEffect } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import {
  Modal,
  Box,
  Typography,
  Button,
  Flex,
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';

const ICON_OPTIONS = ['Briefcase', 'User', 'PinMap', 'Message', 'Book', 'Question', 'PuzzlePiece', 'Cog'];

export function SectionConfigModal({ onClose, onSave, initialConfig, collectionTypes }) {
  const fetchClient = useFetchClient();
  const [config, setConfig] = useState(initialConfig || { sections: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (initialConfig) setConfig(initialConfig);
  }, [initialConfig]);

  const assignedUids = new Set();
  config.sections?.forEach((s) => s.collectionUids?.forEach((uid) => assignedUids.add(uid)));
  const unassignedCollections = (collectionTypes || []).filter((ct) => !assignedUids.has(ct.uid));

  const handleAddToSection = (sectionId, uid) => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId
          ? { ...s, collectionUids: [...(s.collectionUids || []), uid] }
          : s
      ),
    }));
  };

  const handleRemoveFromSection = (sectionId, uid) => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId
          ? { ...s, collectionUids: (s.collectionUids || []).filter((u) => u !== uid) }
          : s
      ),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await fetchClient.put('/modules-sidebar/section-config', config);
      onSave?.(config);
      onClose?.();
    } catch (err) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Save failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Root open={true} onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Configure Section Layout</Modal.Title>
        </Modal.Header>
        <Modal.Body>
        <Box paddingBottom={4}>
          <Typography variant="pi" textColor="neutral600">
            Assign collections to sections. Unassigned collections are not shown on All Modules.
          </Typography>
        </Box>
        {unassignedCollections.length > 0 && (
          <Box marginBottom={4} padding={3} background="neutral100" hasRadius>
            <Typography variant="sigma" marginBottom={2}>
              Unassigned collections ({unassignedCollections.length})
            </Typography>
            <Flex gap={2} wrap="wrap">
              {unassignedCollections.map((ct) => (
                <Box
                  key={ct.uid}
                  padding={2}
                  background="neutral0"
                  hasRadius
                  borderColor="neutral200"
                  borderWidth="1px"
                  borderStyle="solid"
                >
                  <Typography variant="pi">{ct.displayName || ct.uid}</Typography>
                </Box>
              ))}
            </Flex>
          </Box>
        )}
        {config.sections?.map((section) => (
          <Box key={section.id} marginBottom={4} padding={3} background="neutral50" hasRadius>
            <Typography variant="sigma" marginBottom={2}>
              {section.title}
            </Typography>
            <Flex gap={2} wrap="wrap">
              {(section.collectionUids || []).map((uid) => {
                const ct = collectionTypes?.find((c) => c.uid === uid);
                return (
                  <Box
                    key={uid}
                    padding={2}
                    background="neutral0"
                    hasRadius
                    borderColor="neutral200"
                    borderWidth="1px"
                    borderStyle="solid"
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <Typography variant="pi">{ct?.displayName || uid}</Typography>
                    <Button
                      size="S"
                      variant="tertiary"
                      onClick={() => handleRemoveFromSection(section.id, uid)}
                    >
                      Remove
                    </Button>
                  </Box>
                );
              })}
            </Flex>
            <Box marginTop={2}>
              <SingleSelect
                placeholder="Add collection..."
                value=""
                onChange={(v) => v && handleAddToSection(section.id, v)}
              >
                {collectionTypes
                  ?.filter((ct) => !(section.collectionUids || []).includes(ct.uid))
                  .map((ct) => (
                    <SingleSelectOption key={ct.uid} value={ct.uid}>
                      {ct.displayName || ct.uid}
                    </SingleSelectOption>
                  ))}
              </SingleSelect>
            </Box>
          </Box>
        ))}
        {error && (
          <Box padding={2} background="danger100" hasRadius marginTop={2}>
            <Typography textColor="danger700">{error}</Typography>
          </Box>
        )}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary" onClick={onClose}>Cancel</Button>
          </Modal.Close>
          <Button onClick={handleSave} loading={saving}>
            Save
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
