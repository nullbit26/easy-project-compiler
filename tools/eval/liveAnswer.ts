import { callAiJson } from '../../server/ai/aiProvider';
import { Type } from '../../server/ai/geminiProvider';
import type { AnswerFn } from './run';

/**
 * The same eval, against a real model.
 *
 * Nothing about the prompts, the fixtures or the scorer changes — only who answers. The schema is
 * the loop's own JSON contract, so a live run measures the product's prompt path rather than a
 * simplified one written for the benchmark.
 */
const changesSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    changes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          action: { type: Type.STRING },
          content: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ['path', 'content']
      }
    }
  },
  required: ['summary', 'changes']
};

export const liveAnswer: AnswerFn = async (prompt) => {
  const parsed: any = await callAiJson(prompt, changesSchema);
  const changes = Array.isArray(parsed?.changes) ? parsed.changes : [];
  return {
    summary: String(parsed?.summary || ''),
    changes: changes
      .filter((change: any) => typeof change?.path === 'string' && typeof change?.content === 'string')
      .map((change: any) => ({ path: change.path, content: change.content }))
  };
};
