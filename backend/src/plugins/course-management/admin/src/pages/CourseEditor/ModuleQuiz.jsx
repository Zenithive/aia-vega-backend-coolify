// @ts-nocheck
/**
 * Module quiz editor: an Online module has at most one quiz per language
 * (course.module.quiz). Questions are listed one per line and edited in a pop-up, so long
 * quizzes stay short on the page. Answers are marked directly on the options (radio /
 * checkbox) instead of typing option keys into separate fields.
 */
import React, { useEffect, useState } from 'react';
import {
  Box,
  Flex,
  Typography,
  Button,
  IconButton,
  TextInput,
  Textarea,
  NumberInput,
  Toggle,
  Tabs,
  Grid,
  SingleSelect,
  SingleSelectOption,
  Checkbox,
  Radio,
  TextButton,
  Divider,
  Badge,
  Modal,
} from '@strapi/design-system';
import { Plus, Trash, ArrowUp, ArrowDown, Duplicate, Question, Pencil, Eye } from '@strapi/icons';
import { Section, FormField, Callout, ConfirmDialog } from '../../components/ui.jsx';
import IconField from '../../components/IconField.jsx';
import {
  emptyQuiz,
  emptyQuestion,
  emptyInstruction,
  copyQuizForLanguage,
  nextOptionKey,
  newKey,
  nearLimit,

} from '../../utils/course';

const QUESTION_TYPE_LABELS = {
  Multiple_choice: 'Single choice (one correct answer)',
  Multiple_select: 'Multiple select (several correct answers)',
  Descriptive: 'Descriptive (written answer)',
};

function move(list, index, dir) {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(index + dir, 0, item);
  return next;
}

/* ------------------------------------------------------------------ question */

/** Compact one-line question row; the question itself is edited in QuestionModal. */
function QuestionRow({ question, index, total, onOpen, onMove, onDuplicate, onRemove, readOnly }) {
  const isDescriptive = question.question_type === 'Descriptive';
  const optionCount = (question.options || []).length;
  const hasAnswer = isDescriptive
    ? true
    : question.question_type === 'Multiple_select'
      ? (question.correct_multiSelect_answers || []).length > 0
      : !!question.correct_answer;

  return (
    <Flex
      gap={3}
      alignItems="center"
      padding={3}
      hasRadius
      background="neutral0"
      borderColor="neutral200"
      borderStyle="solid"
      borderWidth="1px"
    >
      <Flex
        gap={3}
        alignItems="center"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
        style={{ cursor: 'pointer', flex: '1 1 auto', minWidth: 0 }}
      >
        <Typography variant="sigma" textColor="neutral600" style={{ flexShrink: 0, minWidth: 28 }}>{`Q${index + 1}`}</Typography>
        <Typography textColor={question.question_text ? 'neutral800' : 'neutral500'} ellipsis style={{ flex: '1 1 auto', minWidth: 0 }}>
          {question.question_text || 'No question text yet'}
        </Typography>
        <Badge size="S" style={{ flexShrink: 0 }}>
          {QUESTION_TYPE_LABELS[question.question_type]?.split(' (')[0] || question.question_type}
        </Badge>
        {!isDescriptive && (
          <Typography variant="pi" textColor="neutral600" style={{ flexShrink: 0 }}>
            {`${optionCount} option${optionCount === 1 ? '' : 's'}`}
          </Typography>
        )}
        {(!question.question_text || !hasAnswer) && (
          <Typography variant="pi" fontWeight="bold" textColor="warning600" style={{ flexShrink: 0 }}>
            {!question.question_text ? 'Incomplete' : 'No correct answer'}
          </Typography>
        )}
      </Flex>
      <Flex gap={1} shrink={0}>
        <IconButton label={readOnly ? 'View question' : 'Edit question'} variant="ghost" onClick={onOpen}>
          {readOnly ? <Eye /> : <Pencil />}
        </IconButton>
        {!readOnly && (
          <>
            <IconButton label="Move up" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp />
            </IconButton>
            <IconButton label="Move down" variant="ghost" disabled={index === total - 1} onClick={() => onMove(1)}>
              <ArrowDown />
            </IconButton>
            <IconButton label="Duplicate question" variant="ghost" onClick={onDuplicate}>
              <Duplicate />
            </IconButton>
            <IconButton label="Delete question" variant="ghost" onClick={onRemove}>
              <Trash />
            </IconButton>
          </>
        )}
      </Flex>
    </Flex>
  );
}

/**
 * Pop-up editor for one question. Works on a local copy: "Save question" applies it to the
 * quiz, Cancel discards it, so a half-written question never lands in the course by accident.
 */
function QuestionModal({ question, index, isNew, options, readOnly, onSave, onClose }) {
  const [draft, setDraft] = useState(question);
  useEffect(() => setDraft(question), [question]);
  if (!question || !draft) return null;

  const missingText = !String(draft.question_text || '').trim();

  return (
    <Modal.Root open onOpenChange={(o) => !o && onClose()}>
      <Modal.Content style={{ maxWidth: 760, width: '90vw' }}>
        <Modal.Header>
          <Modal.Title>{isNew ? 'Add question' : `${readOnly ? 'Question' : 'Edit question'} ${index + 1}`}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <QuestionForm question={draft} onChange={setDraft} options={options} readOnly={readOnly} />
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{readOnly ? 'Close' : 'Cancel'}</Button>
          </Modal.Close>
          {!readOnly && (
            <Button onClick={() => onSave(draft)} disabled={missingText}>
              {isNew ? 'Add question' : 'Save question'}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

function QuestionForm({ question, onChange, options, readOnly }) {
  const set = (patch) => onChange({ ...question, ...patch });
  const opts = question.options || [];
  const multiKeys = (question.correct_multiSelect_answers || []).map((a) => a.answer);
  const types = options?.questionTypes?.length ? options.questionTypes : Object.keys(QUESTION_TYPE_LABELS);
  const limits = options?.limits || {};

  const changeType = (type) => {
    const patch = { question_type: type };
    if (type === 'Multiple_select' && question.question_type === 'Multiple_choice' && question.correct_answer) {
      patch.correct_multiSelect_answers = [{ __key: newKey('ms'), answer: question.correct_answer }];
      patch.correct_answer = '';
    }
    if (type === 'Multiple_choice' && question.question_type === 'Multiple_select') {
      patch.correct_answer = multiKeys[0] || '';
    }
    if (type === 'Descriptive' && question.question_type !== 'Descriptive') {
      patch.correct_answer = '';
    }
    if (type !== 'Descriptive' && question.question_type === 'Descriptive') {
      patch.correct_answer = '';
      if (opts.length < 2) {
        patch.options = [...opts];
        while (patch.options.length < 2) {
          patch.options.push({ __key: newKey('o'), option_key: nextOptionKey(patch.options), option_label: '' });
        }
      }
    }
    set(patch);
  };

  const setOption = (i, label) => set({ options: opts.map((o, j) => (j === i ? { ...o, option_label: label } : o)) });
  const addOption = () => set({ options: [...opts, { __key: newKey('o'), option_key: nextOptionKey(opts), option_label: '' }] });
  const removeOption = (i) => {
    const removedKey = opts[i]?.option_key;
    set({
      options: opts.filter((_, j) => j !== i),
      correct_answer: question.correct_answer === removedKey ? '' : question.correct_answer,
      correct_multiSelect_answers: (question.correct_multiSelect_answers || []).filter((a) => a.answer !== removedKey),
    });
  };
  const toggleMulti = (key, checked) => {
    const current = question.correct_multiSelect_answers || [];
    set({
      correct_multiSelect_answers: checked
        ? [...current.filter((a) => a.answer !== key), { __key: newKey('ms'), answer: key }]
        : current.filter((a) => a.answer !== key),
    });
  };

  return (
    <Box>
      <Grid.Root gap={4}>
        <Grid.Item col={8} s={12} direction="column" alignItems="stretch">
          <FormField
            name={`qt-${question.__key}`}
            label="Question"
            required
            hint={nearLimit(question.question_text, limits.questionText)}
          >
            <Textarea
              placeholder="Type the question learners will see"
              value={question.question_text || ''}
              maxLength={limits.questionText || undefined}
              disabled={readOnly}
              onChange={(e) => set({ question_text: e.target.value })}
            />
          </FormField>
        </Grid.Item>
        <Grid.Item col={4} s={12} direction="column" alignItems="stretch">
          <FormField name={`qtype-${question.__key}`} label="Answer type" required>
            <SingleSelect value={question.question_type} disabled={readOnly} onChange={changeType}>
              {types.map((t) => (
                <SingleSelectOption key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t] || t}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </FormField>
        </Grid.Item>
      </Grid.Root>

      {question.question_type === 'Descriptive' ? (
        <Box marginTop={4}>
          <FormField
            name={`qa-${question.__key}`}
            label="Model answer"
            hint="Reference answer for reviewers. Learners do not see it."
          >
            <Textarea
              value={question.correct_answer || ''}
              disabled={readOnly}
              onChange={(e) => set({ correct_answer: e.target.value })}
            />
          </FormField>
        </Box>
      ) : (
        <Box marginTop={4}>
          <Typography variant="pi" fontWeight="bold" textColor="neutral800">
            {question.question_type === 'Multiple_select'
              ? 'Answer options — tick every correct answer *'
              : 'Answer options — select the correct answer *'}
          </Typography>
          <Flex direction="column" alignItems="stretch" gap={2} marginTop={2}>
            {question.question_type === 'Multiple_choice' ? (
              <Radio.Group
                value={question.correct_answer || ''}
                onValueChange={(v) => set({ correct_answer: v })}
                disabled={readOnly}
                aria-label="Correct answer"
              >
                <Flex direction="column" alignItems="stretch" gap={2}>
                  {opts.map((o, i) => (
                    <OptionRow
                      key={o.__key || o.option_key}
                      option={o}
                      maxLength={limits.optionLabel}
                      readOnly={readOnly}
                      canRemove={opts.length > 2}
                      correct={question.correct_answer === o.option_key}
                      marker={<Radio.Item value={o.option_key} aria-label={`Mark option ${o.option_key} as correct`} />}
                      onLabel={(v) => setOption(i, v)}
                      onRemove={() => removeOption(i)}
                    />
                  ))}
                </Flex>
              </Radio.Group>
            ) : (
              opts.map((o, i) => (
                <OptionRow
                  key={o.__key || o.option_key}
                  option={o}
                  maxLength={limits.optionLabel}
                  readOnly={readOnly}
                  canRemove={opts.length > 2}
                  correct={multiKeys.includes(o.option_key)}
                  marker={
                    <Checkbox
                      aria-label={`Mark option ${o.option_key} as correct`}
                      checked={multiKeys.includes(o.option_key)}
                      disabled={readOnly}
                      onCheckedChange={(c) => toggleMulti(o.option_key, !!c)}
                    />
                  }
                  onLabel={(v) => setOption(i, v)}
                  onRemove={() => removeOption(i)}
                />
              ))
            )}
          </Flex>
          {!readOnly && (
            <Box marginTop={3}>
              <TextButton startIcon={<Plus />} onClick={addOption}>
                Add option
              </TextButton>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

function OptionRow({ option, marker, correct, onLabel, onRemove, canRemove, readOnly, maxLength }) {
  return (
    <Flex
      gap={3}
      padding={2}
      paddingLeft={3}
      hasRadius
      background={correct ? 'success100' : 'neutral100'}
      borderColor={correct ? 'success200' : 'neutral150'}
      borderStyle="solid"
      borderWidth="1px"
    >
      {marker}
      <Typography fontWeight="bold" textColor="neutral600" style={{ minWidth: 20 }}>
        {option.option_key}
      </Typography>
      <Box flex="1">
        <TextInput
          aria-label={`Option ${option.option_key}`}
          placeholder={`Option ${option.option_key}`}
          value={option.option_label || ''}
          maxLength={maxLength || undefined}
          disabled={readOnly}
          onChange={(e) => onLabel(e.target.value)}
        />
      </Box>
      {correct && (
        <Typography variant="pi" fontWeight="bold" textColor="success700">
          Correct
        </Typography>
      )}
      {!readOnly && (
        <IconButton label="Remove option" variant="ghost" disabled={!canRemove} onClick={onRemove}>
          <Trash />
        </IconButton>
      )}
    </Flex>
  );
}

/* ------------------------------------------------------------------ instructions */

/** Compact one-line instruction row; the block itself is edited in InstructionModal. */
function InstructionRow({ instruction, index, onOpen, onRemove, readOnly }) {
  const items = (instruction.checklist || []).length;
  return (
    <Flex
      gap={3}
      alignItems="center"
      padding={3}
      hasRadius
      background="neutral0"
      borderColor="neutral200"
      borderStyle="solid"
      borderWidth="1px"
    >
      <Flex
        gap={3}
        alignItems="center"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
        style={{ cursor: 'pointer', flex: '1 1 auto', minWidth: 0 }}
      >
        <Typography variant="sigma" textColor="neutral600" style={{ flexShrink: 0, minWidth: 28 }}>{`${index + 1}.`}</Typography>
        <Typography textColor={instruction.name ? 'neutral800' : 'neutral500'} fontWeight="bold" ellipsis style={{ flexShrink: 0, maxWidth: '40%' }}>
          {instruction.name || 'No heading yet'}
        </Typography>
        <Typography variant="pi" textColor="neutral600" ellipsis style={{ flex: '1 1 auto', minWidth: 0 }}>
          {instruction.description || ''}
        </Typography>
        <Typography variant="pi" textColor="neutral600" style={{ flexShrink: 0 }}>
          {`${items} checklist item${items === 1 ? '' : 's'}`}
        </Typography>
      </Flex>
      <Flex gap={1} shrink={0}>
        <IconButton label={readOnly ? 'View instruction' : 'Edit instruction'} variant="ghost" onClick={onOpen}>
          {readOnly ? <Eye /> : <Pencil />}
        </IconButton>
        {!readOnly && (
          <IconButton label="Remove instruction block" variant="ghost" onClick={onRemove}>
            <Trash />
          </IconButton>
        )}
      </Flex>
    </Flex>
  );
}

/** Pop-up editor for one instruction block; works on a local copy like QuestionModal. */
function InstructionModal({ instruction, index, isNew, options, readOnly, onSave, onClose }) {
  const [draft, setDraft] = useState(instruction);
  useEffect(() => setDraft(instruction), [instruction]);
  if (!instruction || !draft) return null;

  const limits = options?.limits || {};
  const checklist = draft.checklist || [];
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setItem = (k, description) => set({ checklist: checklist.map((c, m) => (m === k ? { ...c, description } : c)) });
  const empty = !String(draft.name || '').trim() && !String(draft.description || '').trim() && !checklist.some((c) => String(c.description || '').trim());

  return (
    <Modal.Root open onOpenChange={(o) => !o && onClose()}>
      <Modal.Content style={{ maxWidth: 680, width: '90vw' }}>
        <Modal.Header>
          <Modal.Title>{isNew ? 'Add instruction block' : `${readOnly ? 'Instruction block' : 'Edit instruction block'} ${index + 1}`}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <FormField name={`in-${draft.__key}`} label="Heading">
              <TextInput
                placeholder="e.g. Before you begin"
                value={draft.name || ''}
                maxLength={limits.instructionName || undefined}
                disabled={readOnly}
                onChange={(e) => set({ name: e.target.value })}
              />
            </FormField>
            <FormField name={`id-${draft.__key}`} label="Short description">
              <TextInput
                value={draft.description || ''}
                maxLength={limits.instructionDescription || undefined}
                disabled={readOnly}
                onChange={(e) => set({ description: e.target.value })}
              />
            </FormField>
            <IconField name={`icon-${draft.__key}`} value={draft.icon} disabled={readOnly} onChange={(icon) => set({ icon })} />
            <Box>
              <Typography variant="pi" fontWeight="bold" textColor="neutral800">
                Checklist items
              </Typography>
              <Flex direction="column" alignItems="stretch" gap={2} marginTop={2}>
                {checklist.length === 0 && (
                  <Typography variant="pi" textColor="neutral600">
                    No checklist items yet.
                  </Typography>
                )}
                {checklist.map((item, k) => (
                  <Flex key={item.__key || k} gap={2}>
                    <Typography textColor="neutral500">•</Typography>
                    <Box flex="1">
                      <TextInput
                        aria-label={`Checklist item ${k + 1}`}
                        placeholder="e.g. You have 30 minutes to finish"
                        value={item.description || ''}
                        maxLength={limits.checklistItem || undefined}
                        disabled={readOnly}
                        onChange={(e) => setItem(k, e.target.value)}
                      />
                    </Box>
                    {!readOnly && (
                      <IconButton
                        label="Remove checklist item"
                        variant="ghost"
                        onClick={() => set({ checklist: checklist.filter((_, m) => m !== k) })}
                      >
                        <Trash />
                      </IconButton>
                    )}
                  </Flex>
                ))}
              </Flex>
              {!readOnly && (
                <Box marginTop={2}>
                  <TextButton
                    startIcon={<Plus />}
                    onClick={() => set({ checklist: [...checklist, { __key: newKey('chk'), description: '' }] })}
                  >
                    Add checklist item
                  </TextButton>
                </Box>
              )}
            </Box>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{readOnly ? 'Close' : 'Cancel'}</Button>
          </Modal.Close>
          {!readOnly && (
            <Button onClick={() => onSave(draft)} disabled={empty}>
              {isNew ? 'Add instruction block' : 'Save instruction block'}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

function InstructionsEditor({ instructions, onChange, options, readOnly }) {
  // { index, instruction, isNew } of the block open in the pop-up editor.
  const [editing, setEditing] = useState(null);
  const save = (ins) => {
    if (editing.isNew) onChange([...instructions, ins]);
    else onChange(instructions.map((x, j) => (j === editing.index ? ins : x)));
    setEditing(null);
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      {instructions.length === 0 && <Typography textColor="neutral600">No instructions yet.</Typography>}
      {instructions.map((ins, i) => (
        <InstructionRow
          key={ins.__key || i}
          instruction={ins}
          index={i}
          readOnly={readOnly}
          onOpen={() => setEditing({ index: i, instruction: ins, isNew: false })}
          onRemove={() => onChange(instructions.filter((_, j) => j !== i))}
        />
      ))}
      {!readOnly && (
        <Box marginTop={2}>
          <Button
            variant="secondary"
            size="S"
            startIcon={<Plus />}
            onClick={() => setEditing({ index: instructions.length, instruction: emptyInstruction(), isNew: true })}
          >
            Add instruction block
          </Button>
        </Box>
      )}
      {editing && (
        <InstructionModal
          instruction={editing.instruction}
          index={editing.index}
          isNew={editing.isNew}
          options={options}
          readOnly={readOnly}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </Flex>
  );
}


/* ------------------------------------------------------------------ quiz settings + questions */

function QuizEditor({ quiz, onChange, options, readOnly, passMark, onPassMarkChange }) {
  const set = (patch) => onChange({ ...quiz, ...patch });
  const questions = quiz.quiz_questions || [];
  const setQuestions = (next) => set({ quiz_questions: next });
  // { index, question, isNew } of the question open in the pop-up editor.
  const [editing, setEditing] = useState(null);
  const addQuestion = () => setEditing({ index: questions.length, question: emptyQuestion(questions.length + 1), isNew: true });
  const saveQuestion = (q) => {
    if (editing.isNew) setQuestions([...questions, q]);
    else setQuestions(questions.map((x, j) => (j === editing.index ? q : x)));
    setEditing(null);
  };

  return (
    <Box paddingTop={3}>
      <Section title="Quiz settings">
        <Grid.Root gap={5}>
          <Grid.Item col={3} s={12} direction="column" alignItems="stretch">
            <FormField name={`qp-${quiz.__key}`} label="Pass mark (%)" hint="Same for every quiz in this course.">
              <NumberInput
                placeholder="e.g. 70"
                value={passMark ?? undefined}
                disabled={readOnly}
                onValueChange={(v) => onPassMarkChange(v ?? null)}
              />
            </FormField>
          </Grid.Item>
          <Grid.Item col={3} s={12} direction="column" alignItems="stretch">
            <FormField name={`qc-${quiz.__key}`} label="Compulsory">
              <Toggle
                onLabel="Yes"
                offLabel="No"
                checked={!!quiz.compulsory}
                disabled={readOnly}
                onChange={(e) => set({ compulsory: e.target.checked })}
              />
            </FormField>
          </Grid.Item>
          <Grid.Item col={3} s={12} direction="column" alignItems="stretch">
            <FormField name={`qm-${quiz.__key}`} label="Maximum attempts">
              <NumberInput
                placeholder="e.g. 3"
                value={quiz.max_attempt ?? undefined}
                disabled={readOnly}
                onValueChange={(v) => set({ max_attempt: v ?? null })}
              />
            </FormField>
          </Grid.Item>
          <Grid.Item col={3} s={12} direction="column" alignItems="stretch">
            <FormField name={`qd-${quiz.__key}`} label="Time limit (minutes)" hint="Default: 30 minutes">
              <NumberInput
                placeholder="e.g. 30"
                value={quiz.completion_time ?? undefined}
                disabled={readOnly}
                onValueChange={(v) => set({ completion_time: v ?? null })}
              />
            </FormField>
          </Grid.Item>
        </Grid.Root>
      </Section>

      <Section title={`Questions (${questions.length})`}>
        {questions.length === 0 && <Typography textColor="neutral600">No questions yet.</Typography>}
        <Flex direction="column" alignItems="stretch" gap={2} marginBottom={questions.length ? 4 : 0}>
        {questions.map((q, i) => (
          <QuestionRow
            key={q.__key || i}
            question={q}
            index={i}
            total={questions.length}
            readOnly={readOnly}
            onOpen={() => setEditing({ index: i, question: q, isNew: false })}
            onMove={(dir) => setQuestions(move(questions, i, dir))}
            onDuplicate={() => {
              const copy = JSON.parse(JSON.stringify(q));
              delete copy.id;
              copy.__key = newKey('q');
              copy.question_id = '';
              (copy.options || []).forEach((o) => {
                delete o.id;
                o.__key = newKey('o');
              });
              (copy.correct_multiSelect_answers || []).forEach((a) => {
                delete a.id;
                a.__key = newKey('ms');
              });
              const next = [...questions];
              next.splice(i + 1, 0, copy);
              setQuestions(next);
            }}
            onRemove={() => setQuestions(questions.filter((_, j) => j !== i))}
          />
        ))}
        </Flex>
        {!readOnly && (
          <Button variant="secondary" startIcon={<Plus />} onClick={addQuestion}>
            Add question
          </Button>
        )}
        {editing && (
          <QuestionModal
            question={editing.question}
            index={editing.index}
            isNew={editing.isNew}
            options={options}
            readOnly={readOnly}
            onSave={saveQuestion}
            onClose={() => setEditing(null)}
          />
        )}
      </Section>

      <Section title="Instructions" subtitle="Shown before the quiz starts.">
        <InstructionsEditor
          instructions={quiz.quiz_instruction || []}
          options={options}
          readOnly={readOnly}
          onChange={(next) => set({ quiz_instruction: next })}
        />
      </Section>
    </Box>
  );
}

/* ------------------------------------------------------------------ module quiz */

/**
 * Quiz of one Online module in one language. `siblingQuiz` is the same module's quiz in
 * another language, offered as a starting point (same questions and answers, to translate).
 */
export default function ModuleQuiz({ entry, siblingQuiz, onChange, options, readOnly, passMark, onPassMarkChange }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const quiz = entry.quiz;

  if (!quiz) {
    return (
      <Box padding={5} hasRadius background="neutral100" borderColor="neutral200" borderStyle="dashed" borderWidth="1px">
        <Flex direction="column" alignItems="flex-start" gap={3}>
          <Flex gap={2}>
            <Question />
            <Typography variant="delta">{`Quiz (${entry.language}) — optional`}</Typography>
          </Flex>
          <Typography textColor="neutral600">
            {siblingQuiz
              ? `Learners take the quiz after this module. Copy the ${siblingQuiz.language} quiz to keep the same questions and correct answers, then translate the text.`
              : 'Learners take the quiz after this module.'}
          </Typography>
          {!readOnly && (
            <Flex gap={2}>
              {siblingQuiz && (
                <Button startIcon={<Duplicate />} onClick={() => onChange(copyQuizForLanguage(siblingQuiz, entry.language))}>
                  {`Copy from ${siblingQuiz.language}`}
                </Button>
              )}
              <Button variant={siblingQuiz ? 'secondary' : 'default'} startIcon={<Plus />} onClick={() => onChange(emptyQuiz(entry.language))}>
                {siblingQuiz ? 'Start empty' : 'Add a quiz'}
              </Button>
            </Flex>
          )}
        </Flex>
      </Box>
    );
  }

  return (
    <Box padding={4} hasRadius background="neutral100">
      <Flex justifyContent="space-between" alignItems="center" marginBottom={2}>
        <Flex gap={2}>
          <Question />
          <Typography variant="delta">{`Quiz (${entry.language}) — ${(quiz.quiz_questions || []).length} question${(quiz.quiz_questions || []).length === 1 ? '' : 's'}`}</Typography>
        </Flex>
        {!readOnly && (
          <Button variant="danger-light" size="S" startIcon={<Trash />} onClick={() => setConfirmRemove(true)}>
            Remove quiz
          </Button>
        )}
      </Flex>
      <QuizEditor quiz={quiz} options={options} readOnly={readOnly} passMark={passMark} onPassMarkChange={onPassMarkChange} onChange={onChange} />
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove the ${entry.language} quiz of this module?`}
        confirmLabel="Remove quiz"
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => {
          onChange(null);
          setConfirmRemove(false);
        }}
      >
        All questions and instructions of this quiz will be removed when you save.
      </ConfirmDialog>
    </Box>
  );
}
