// @ts-nocheck
/**
 * Modules: one card per logical module, with a tab per course language. Under the hood each
 * tab is one `course.module` component entry (language set automatically).
 *
 * A module is Online (content + optional quiz per language) or Offline (a practical
 * session; completed with proof in Course Management → Offline module proof).
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Flex,
  Typography,
  Button,
  IconButton,
  TextInput,
  NumberInput,
  Tabs,
  Grid,
  TextButton,
  Badge,
  Divider,
} from '@strapi/design-system';
import {
  Plus,
  Trash,
  ArrowUp,
  ArrowDown,
  Play,
  File as FileIcon,
  Feather,
  CaretDown,
  CaretUp,
  CheckCircle,
  WarningCircle,
  Monitor,
  User,
} from '@strapi/icons';
import { Section, FormField, ChoiceCards, Callout, ConfirmDialog } from '../../components/ui.jsx';
import MediaPicker from '../../components/MediaPicker.jsx';
import RichTextEditor from '../../components/RichTextEditor.jsx';
import ModuleQuiz from './ModuleQuiz.jsx';
import { emptyModule, newKey, blockTitle, isBlank, isOfflineModule, nearLimit, MODULE_TYPES } from '../../utils/course';
import { BASE_PATH } from '../../pluginId';

const CONTENT_TYPE_META = {
  Video: { label: 'Video', icon: <Play /> },
  Pdf: { label: 'PDF document', icon: <FileIcon /> },
  Text: { label: 'Text / article', icon: <Feather /> },
};

const MODULE_TYPE_ITEMS = [
  {
    value: MODULE_TYPES.ONLINE,
    label: 'Online',
    icon: <Monitor />,
  },
  {
    value: MODULE_TYPES.OFFLINE,
    label: 'Offline',
    icon: <User />,
  },
];

function ModuleEntryForm({ entry, onChange, options, readOnly, siblingQuiz, passMark, onPassMarkChange }) {
  const set = (patch) => onChange({ ...entry, ...patch });
  const limit = options?.limits?.moduleTitle;
  const types = options?.moduleContentTypes?.length ? options.moduleContentTypes : Object.keys(CONTENT_TYPE_META);
  const offline = isOfflineModule(entry);
  const navigate = useNavigate();

  return (
    <Flex direction="column" alignItems="stretch" gap={4} paddingTop={4}>
      <Grid.Root gap={4}>
        <Grid.Item col={9} s={12} direction="column" alignItems="stretch">
          <FormField
            name={`title-${entry.__key}`}
            label={`Module title (${entry.language})`}
            required
            hint={nearLimit(entry.title, limit)}
          >
            <TextInput
              placeholder="e.g. Introduction"
              value={entry.title || ''}
              maxLength={limit || undefined}
              disabled={readOnly}
              onChange={(e) => set({ title: e.target.value })}
            />
          </FormField>
        </Grid.Item>
        <Grid.Item col={3} s={12} direction="column" alignItems="stretch">
          <FormField name={`duration-${entry.__key}`} label="Duration (minutes)" required>
            <NumberInput
              placeholder="e.g. 15"
              value={entry.module_duration_min ?? undefined}
              disabled={readOnly}
              onValueChange={(v) => set({ module_duration_min: v ?? null })}
            />
          </FormField>
        </Grid.Item>
      </Grid.Root>

      {offline ? (
        <Callout
          variant="primary"
          title="Offline module"
          // action={
          //   <Button variant="secondary" size="S" onClick={() => navigate(`${BASE_PATH}/offline`)}>
          //     Open Offline module proof
          //   </Button>
          // }
        >
          No content or quiz is needed. Learners do this module in person. After the assessment, upload each
          learner’s proof in Course Management → Offline module proof; that completes the module and unlocks the next one.
        </Callout>
      ) : (
        <OnlineContent entry={entry} set={set} types={types} readOnly={readOnly} onChange={onChange} options={options} siblingQuiz={siblingQuiz} passMark={passMark} onPassMarkChange={onPassMarkChange} />
      )}
    </Flex>
  );
}

function OnlineContent({ entry, set, types, readOnly, onChange, options, siblingQuiz, passMark, onPassMarkChange }) {
  return (
    <>
      <Box>
        <Typography variant="pi" fontWeight="bold" textColor="neutral800">
          Content type *
        </Typography>
        <Box marginTop={2}>
          <ChoiceCards
            compact
            disabled={readOnly}
            value={entry.module_content_type}
            onChange={(v) => set({ module_content_type: v })}
            items={types.map((t) => ({ value: t, ...(CONTENT_TYPE_META[t] || { label: t }) }))}
          />
        </Box>
      </Box>

      {entry.module_content_type === 'Video' && (
        <>
          <FormField name={`video-${entry.__key}`} label="Video files" required>
            <MediaPicker
              multiple
              allowedTypes={['videos']}
              value={entry.video_file || []}
              disabled={readOnly}
              emptyLabel="No video selected yet"
              addLabel="Add video"
              onChange={(files) => set({ video_file: files })}
            />
          </FormField>
          <RichTextEditor
            key={`vd-${entry.__key}`}
            label="Video description (optional)"
            value={entry.video_description}
            disabled={readOnly}
            onChange={(html) => set({ video_description: html })}
          />
        </>
      )}

      {entry.module_content_type === 'Pdf' && (
        <FormField name={`pdf-${entry.__key}`} label="PDF files" required>
          <MediaPicker
            multiple
            allowedTypes={['files']}
            value={entry.pdf_file || []}
            disabled={readOnly}
            emptyLabel="No PDF selected yet"
            addLabel="Add PDF"
            onChange={(files) => set({ pdf_file: files })}
          />
        </FormField>
      )}

      {entry.module_content_type === 'Text' && (
        <RichTextEditor
          key={`tc-${entry.__key}`}
          label="Content"
          required
          value={entry.text_content}
          disabled={readOnly}
          onChange={(html) => set({ text_content: html })}
        />
      )}

      <ModuleQuiz
        entry={entry}
        siblingQuiz={siblingQuiz}
        options={options}
        readOnly={readOnly}
        passMark={passMark} onPassMarkChange={onPassMarkChange}
        onChange={(quiz) => onChange({ ...entry, quiz })}
      />
    </>
  );
}

/**
 * With several languages, each language's content sits in its own framed panel with a
 * coloured "<Language> version" strip, so it is clear which language is being edited.
 */
function LanguagePanel({ language, show, children }) {
  if (!show) return children;
  return (
    <Box hasRadius borderColor="primary200" borderStyle="solid" borderWidth="1px" marginTop={3} overflow="hidden">
      <Flex gap={2} alignItems="center" background="primary100" paddingTop={2} paddingBottom={2} paddingLeft={4} paddingRight={4}>
        <Badge active>{language}</Badge>
        <Typography variant="pi" fontWeight="bold" textColor="primary700">
          {`${language} version of this module`}
        </Typography>
      </Flex>
      <Box paddingLeft={4} paddingRight={4} paddingBottom={4}>
        {children}
      </Box>
    </Box>
  );
}

function entryComplete(entry) {
  if (!entry) return false;
  if (isBlank(entry.title) || !entry.module_duration_min) return false;
  if (isOfflineModule(entry)) return true;
  if (entry.module_content_type === 'Video') return (entry.video_file || []).length > 0;
  if (entry.module_content_type === 'Pdf') return (entry.pdf_file || []).length > 0;
  if (entry.module_content_type === 'Text') return !isBlank(entry.text_content);
  return false;
}

function ModuleCard({ block, index, total, languages, expanded, onToggle, onChange, onMove, onRemove, options, readOnly, passMark, onPassMarkChange }) {
  const [tab, setTab] = useState(languages[0]);
  const activeTab = languages.includes(tab) ? tab : languages[0];
  const firstExisting = languages.map((l) => block.byLang[l]).find(Boolean);
  const moduleType = firstExisting?.module_type || MODULE_TYPES.ONLINE;
  const offline = moduleType === MODULE_TYPES.OFFLINE;
  const quizLanguages = languages.filter((l) => block.byLang[l]?.quiz && !isOfflineModule(block.byLang[l]));

  const setEntry = (lang, entry) => onChange({ ...block, byLang: { ...block.byLang, [lang]: entry } });
  /** Online / Offline is a property of the module, so it is set for every language at once. */
  const setModuleType = (type) => {
    const byLang = {};
    Object.entries(block.byLang).forEach(([l, entry]) => {
      byLang[l] = { ...entry, module_type: type };
    });
    onChange({ ...block, byLang });
  };
  const siblingQuizFor = (lang) => quizLanguages.filter((l) => l !== lang).map((l) => block.byLang[l].quiz)[0] || null;
  const addLanguage = (lang) => setEntry(lang, emptyModule(lang, firstExisting || {}));
  const applyToAll = (source) => {
    const byLang = { ...block.byLang };
    languages.forEach((l) => {
      if (byLang[l] && l !== source.language) {
        byLang[l] = {
          ...byLang[l],
          module_content_type: source.module_content_type,
          module_duration_min: source.module_duration_min,
        };
      }
    });
    onChange({ ...block, byLang });
  };

  return (
    <Box
      background="neutral0"
      hasRadius
      marginBottom={3}
      borderColor={expanded ? "primary200" : "neutral200"}
      borderStyle="solid"
      borderWidth="1px"
      shadow={expanded ? "tableShadow" : undefined}
    >
      <Flex padding={4} gap={3} justifyContent="space-between" alignItems="center" wrap="wrap">
        <Flex
          gap={3}
          alignItems="center"
          style={{ cursor: 'pointer', flex: '1 1 300px', minWidth: 0 }}
          onClick={onToggle}
          role="button"
          aria-expanded={expanded}
        >
          <Flex
            width="32px"
            height="32px"
            hasRadius
            background="primary100"
            justifyContent="center"
            alignItems="center"
            shrink={0}
          >
            <Typography fontWeight="bold" textColor="primary600">
              {index + 1}
            </Typography>
          </Flex>
          <Flex direction="column" alignItems="flex-start" gap={1} style={{ minWidth: 0 }}>
            <Typography fontWeight="bold" ellipsis>
              {blockTitle(block, languages, index)}
            </Typography>
            <Flex gap={2} wrap="wrap">
              {languages.map((l) => {
                const ok = entryComplete(block.byLang[l]);
                return (
                  <Flex key={l} gap={1} alignItems="center">
                    {ok ? <CheckCircle fill="success600" width="12px" /> : <WarningCircle fill="warning600" width="12px" />}
                    <Typography variant="pi" textColor={ok ? 'neutral600' : 'warning700'}>
                      {l}
                    </Typography>
                  </Flex>
                );
              })}
              {offline ? (
                <Badge size="S">Offline</Badge>
              ) : (
                firstExisting?.module_content_type && <Badge size="S">{firstExisting.module_content_type}</Badge>
              )}
              {quizLanguages.length > 0 && <Badge size="S">Quiz</Badge>}
            </Flex>
          </Flex>
        </Flex>
        <Flex gap={1}>
          {!readOnly && (
            <>
              <IconButton label="Move up" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)}>
                <ArrowUp />
              </IconButton>
              <IconButton label="Move down" variant="ghost" disabled={index === total - 1} onClick={() => onMove(1)}>
                <ArrowDown />
              </IconButton>
              <IconButton label="Delete module" variant="ghost" onClick={onRemove}>
                <Trash />
              </IconButton>
            </>
          )}
          <IconButton label={expanded ? 'Collapse' : 'Expand'} variant="ghost" onClick={onToggle}>
            {expanded ? <CaretUp /> : <CaretDown />}
          </IconButton>
        </Flex>
      </Flex>

      {expanded && (
        <Box paddingLeft={4} paddingRight={4} paddingBottom={5}>
          <Divider marginBottom={4} />
          <Box marginBottom={4}>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800">
              Module type *
            </Typography>
            <Box marginTop={2}>
              <ChoiceCards compact disabled={readOnly} value={moduleType} onChange={setModuleType} items={MODULE_TYPE_ITEMS} />
            </Box>
          </Box>
          <Tabs.Root value={activeTab} onValueChange={setTab}>
            {/* Language tabs only when there is more than one language to switch between. */}
            {languages.length > 1 && (
              <Tabs.List aria-label="Module languages">
                {languages.map((l) => {
                  const ok = entryComplete(block.byLang[l]);
                  return (
                    <Tabs.Trigger key={l} value={l}>
                      <Flex gap={2} alignItems="center" justifyContent="center">
                        {ok ? <CheckCircle fill="success600" width="14px" /> : <WarningCircle fill="warning600" width="14px" />}
                        {l}
                      </Flex>
                    </Tabs.Trigger>
                  );
                })}
              </Tabs.List>
            )}
            {languages.map((l) => {
              const entry = block.byLang[l];
              return (
                <Tabs.Content key={l} value={l}>
                  <LanguagePanel language={l} show={languages.length > 1}>
                  {entry ? (
                    <>
                      <ModuleEntryForm
                        entry={entry}
                        options={options}
                        readOnly={readOnly}
                        passMark={passMark} onPassMarkChange={onPassMarkChange}
                        siblingQuiz={siblingQuizFor(l)}
                        onChange={(next) => setEntry(l, next)}
                      />
                      {!readOnly && !offline && languages.length > 1 && (
                        <Box marginTop={4}>
                          <TextButton onClick={() => applyToAll(entry)}>
                            {`Use this content type and duration for all languages`}
                          </TextButton>
                        </Box>
                      )}
                    </>
                  ) : (
                    <Flex direction="column" gap={3} padding={6} alignItems="center">
                      <Typography textColor="neutral600">{`This module has no ${l} version yet.`}</Typography>
                      {!readOnly && (
                        <Button variant="secondary" startIcon={<Plus />} onClick={() => addLanguage(l)}>
                          {`Add ${l} version`}
                        </Button>
                      )}
                    </Flex>
                  )}
                  </LanguagePanel>
                </Tabs.Content>
              );
            })}
          </Tabs.Root>
        </Box>
      )}
    </Box>
  );
}

export default function ModulesStep({ form, update, options, readOnly, onGoTo }) {
  const languages = form.course_language || [];
  const blocks = form.moduleBlocks || [];
  // Only one module is open at a time; opening another closes it. A module added now opens.
  const [expandedKey, setExpandedKey] = useState(null);
  const [removeIndex, setRemoveIndex] = useState(null);

  const setBlocks = (next) => update({ moduleBlocks: next });
  const toggle = (key) => setExpandedKey((prev) => (prev === key ? null : key));

  const addModule = () => {
    const template = blocks.length ? Object.values(blocks[blocks.length - 1].byLang)[0] : {};
    const block = {
      key: newKey('blk'),
      byLang: Object.fromEntries(
        languages.map((l) => [l, emptyModule(l, { module_content_type: template?.module_content_type || 'Video' })])
      ),
    };
    setBlocks([...blocks, block]);
    setExpandedKey(block.key);
  };

  const move = (index, dir) => {
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item);
    setBlocks(next);
  };

  if (languages.length === 0) {
    return (
      <Callout
        variant="warning"
        title="Choose languages first"
        action={<Button variant="secondary" onClick={() => onGoTo('basics')}>Go to Basics</Button>}
      >
        Modules are prepared per language. Select at least one course language in Basics.
      </Callout>
    );
  }

  return (
    <>
      <Section
        title={`Modules (${blocks.length})`}
        subtitle="Learners go through the modules in this order. Click a module to open it. Online modules can end with a quiz."
        padding={5}
      >

      {blocks.map((block, index) => (
        <ModuleCard
          key={block.key}
          block={block}
          index={index}
          total={blocks.length}
          languages={languages}
          options={options}
          readOnly={readOnly}
          passMark={form.min_passing_score}
          onPassMarkChange={(v) => update({ min_passing_score: v })}
          expanded={expandedKey === block.key}
          onToggle={() => toggle(block.key)}
          onChange={(next) => setBlocks(blocks.map((b, i) => (i === index ? next : b)))}
          onMove={(dir) => move(index, dir)}
          onRemove={() => setRemoveIndex(index)}
        />
      ))}

      {!readOnly && (
        <Box
          tag="button"
          type="button"
          onClick={addModule}
          padding={4}
          hasRadius
          background="neutral0"
          borderStyle="dashed"
          borderWidth="1px"
          borderColor="neutral300"
          width="100%"
          style={{ cursor: 'pointer' }}
        >
          <Flex justifyContent="center" gap={2}>
            <Plus />
            <Typography fontWeight="bold" textColor="primary600">
              Add module
            </Typography>
          </Flex>
        </Box>
      )}
      </Section>

      <ConfirmDialog
        open={removeIndex != null}
        title="Delete module?"
        confirmLabel="Delete module"
        onClose={() => setRemoveIndex(null)}
        onConfirm={() => {
          setBlocks(blocks.filter((_, i) => i !== removeIndex));
          setRemoveIndex(null);
        }}
      >
        {removeIndex != null &&
          `"${blockTitle(blocks[removeIndex], languages, removeIndex)}" will be removed in all languages when you save.`}
      </ConfirmDialog>
    </>
  );
}
