import { describe, it, expect } from 'vitest';

import { AI_MAX_OUTPUT_TOKENS, isOutputLimit, repairTruncatedJson } from '../../server/ai/jsonRepair';
import { anthropicAnswer, openAiAnswer } from '../../server/ai/aiProvider';
import { geminiAnswer } from '../../server/ai/geminiProvider';

/**
 * An answer that runs out of room.
 *
 * This is the case that used to cost the whole answer: the model hits its output limit, the JSON
 * stops mid-sentence, and every parser in the chain correctly reports that it cannot read it. What is
 * tested here is the part that was lost — the files that had already arrived in full, the fields that
 * were already complete — and, just as importantly, that a cut-off answer is only ever salvaged when
 * the provider says it was cut off.
 */

/** A change set of the shape the app actually asks for, cut wherever a test needs it cut. */
function changeSet(files: number): string {
  return JSON.stringify(
    {
      summary: 'Adding the pour mechanic',
      files: Array.from({ length: files }, (_, index) => ({
        path: `src/game/file-${index}.ts`,
        reason: 'because the task needs it',
        content: `export function step${index}(delta: number) {\n  return delta * ${index};\n}\n`
      }))
    },
    null,
    2
  );
}

describe('Keeping the finished part of a cut-off answer', () => {
  it('1. keeps every complete field and drops the one that was still being written', () => {
    const full = changeSet(3);
    const cut = full.slice(0, full.indexOf('"content": "export function step2') + 30);

    const repaired = repairTruncatedJson(cut);

    expect(repaired.summary).toBe('Adding the pour mechanic');
    // The two files that arrived whole are there, in order, with their contents intact.
    expect(repaired.files.map((file: any) => file.path)).toEqual([
      'src/game/file-0.ts',
      'src/game/file-1.ts',
      'src/game/file-2.ts'
    ]);
    expect(repaired.files[0].content).toContain('step0');
    expect(repaired.files[1].content).toContain('step1');
    // The third file's content never arrived, and the repair does not invent one: the entry stops at
    // the last field that was actually written. A change set is applied from what the model returned,
    // and a file with no content is refused there rather than written as an empty file.
    expect(repaired.files[2]).toEqual({ path: 'src/game/file-2.ts', reason: 'because the task needs it' });
    expect('content' in repaired.files[2]).toBe(false);
  });

  it('2. drops a value whose string never ended, and keeps the list around it', () => {
    const repaired = repairTruncatedJson('{"names": ["alpha", "beta", "gam');

    expect(repaired).toEqual({ names: ['alpha', 'beta'] });
  });

  it('3. closes what is still open when the cut lands exactly on the end of a value', () => {
    // A list of objects where the cut happens right after a complete object.
    const repaired = repairTruncatedJson('{"files": [{"path": "a.ts", "reason": "r"}]');

    expect(repaired).toEqual({ files: [{ path: 'a.ts', reason: 'r' }] });
  });

  it('4. reads through an unterminated markdown fence, which is how a cut-off answer usually arrives', () => {
    const repaired = repairTruncatedJson('```json\n{"projectName": "Beer Sim", "mvpFeatures": ["brew", "po');

    expect(repaired).toEqual({ projectName: 'Beer Sim', mvpFeatures: ['brew'] });
  });

  it('5. leaves a complete answer to the ordinary parser', () => {
    const full = changeSet(2);

    expect(repairTruncatedJson(full)).toEqual(JSON.parse(full));
  });

  it('6. refuses to invent an answer out of nothing that finished', () => {
    // Nothing complete arrived: no cut point can produce an object, and an empty one would read as
    // "the model answered, and its answer was empty".
    expect(repairTruncatedJson('{"promptText": "You are Easy Project')).toBeNull();
    expect(repairTruncatedJson('{')).toBeNull();
    expect(repairTruncatedJson('Here is the plan you asked for')).toBeNull();
    expect(repairTruncatedJson('')).toBeNull();
  });

  it('7. never completes a number on its own, because half a number parses too', () => {
    // `123` finished before the cut; `45` did not — and `45` is also what a cut `4500` looks like,
    // so the number the cut lands in is dropped rather than guessed at.
    expect(repairTruncatedJson('{"a": 123, "b": 45')).toEqual({ a: 123 });
    expect(repairTruncatedJson('{"a": 123, "b": 4')).toEqual({ a: 123 });
    // Nothing at all was finished here: only a key and a number that may be half of a longer one.
    expect(repairTruncatedJson('{"width": 26')).toBeNull();
    // A literal is different: `tru` does not parse, so a literal that does is whole.
    expect(repairTruncatedJson('{"ready": true')).toEqual({ ready: true });
  });
});

describe('Reading a provider’s own account of the answer', () => {
  it('8. knows the three ways "the model ran out of room" is spelled', () => {
    expect(isOutputLimit('length')).toBe(true);
    expect(isOutputLimit('max_tokens')).toBe(true);
    expect(isOutputLimit('MAX_TOKENS')).toBe(true);
    expect(isOutputLimit('maxOutputTokens')).toBe(true);

    // A model that finished what it was saying, whatever else went wrong, is not truncated.
    expect(isOutputLimit('stop')).toBe(false);
    expect(isOutputLimit('end_turn')).toBe(false);
    expect(isOutputLimit('SAFETY')).toBe(false);
    expect(isOutputLimit(undefined)).toBe(false);
    expect(isOutputLimit(null)).toBe(false);
    expect(isOutputLimit(42)).toBe(false);
  });

  it('9. reads an OpenAI-compatible answer and its finish reason', () => {
    expect(openAiAnswer({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] })).toEqual({
      text: '{"ok":true}',
      truncated: false
    });
    // The same answer, cut off: text arrives, and the reason is the only thing that says so.
    expect(openAiAnswer({ choices: [{ message: { content: '{"ok":' }, finish_reason: 'length' }] })).toEqual({
      text: '{"ok":',
      truncated: true
    });
    expect(openAiAnswer({})).toEqual({ text: '', truncated: false });
  });

  it('10. reads an Anthropic answer and its stop reason', () => {
    expect(
      anthropicAnswer({ content: [{ type: 'text', text: '{"a":1}' }], stop_reason: 'max_tokens' })
    ).toEqual({ text: '{"a":1}', truncated: true });
    expect(anthropicAnswer({ content: [{ type: 'text', text: '{"a":1}' }], stop_reason: 'end_turn' })).toEqual({
      text: '{"a":1}',
      truncated: false
    });
    // Non-text blocks are not part of the answer.
    expect(anthropicAnswer({ content: [{ type: 'tool_use', text: 'nope' }] })).toEqual({ text: '', truncated: false });
  });

  it('11. reads a Gemini answer and its finish reason', () => {
    expect(geminiAnswer({ text: '{"a":1}', candidates: [{ finishReason: 'STOP' }] })).toEqual({
      text: '{"a":1}',
      truncated: false
    });
    expect(geminiAnswer({ text: '{"a":', candidates: [{ finishReason: 'MAX_TOKENS' }] })).toEqual({
      text: '{"a":',
      truncated: true
    });
    expect(geminiAnswer({})).toEqual({ text: '', truncated: false });
  });

  it('12. asks every provider for the same, explicit ceiling', () => {
    // The number is a promise the providers can be held to: leaving it to the host is what cut answers
    // in half without any field in the reply saying so.
    expect(AI_MAX_OUTPUT_TOKENS).toBeGreaterThan(8000);
    expect(Number.isFinite(AI_MAX_OUTPUT_TOKENS)).toBe(true);
  });
});
