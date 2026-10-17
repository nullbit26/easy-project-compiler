import { describe, it, expect } from 'vitest';
import { toStrictJsonSchema } from '../../server/ai/aiProvider';
import { Type } from '../../server/ai/geminiProvider';

/**
 * The same response schema, written for two different hosts.
 *
 * The schemas in the controllers are built from the Gemini SDK's `Type` enum, whose values are the
 * OpenAPI spelling — `Type.OBJECT` is the string "OBJECT". Gemini accepts that; an OpenAI-compatible
 * host does not, and answers with `400 Grammar error: Invalid type: OBJECT` before it ever looks at
 * the task. That is what this translation is for, and the three things it changes are the three
 * things strict mode refuses without: a lowercase type, a closed object, and a required list.
 */
describe('Translating a schema for an OpenAI-compatible host', () => {
  const schema = {
    type: Type.OBJECT,
    properties: {
      status: { type: Type.STRING },
      progressPercent: { type: Type.INTEGER },
      missingCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
      includedFiles: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            path: { type: Type.STRING },
            tokensEstimate: { type: Type.INTEGER }
          },
          required: ['path', 'tokensEstimate']
        }
      }
    },
    required: ['status', 'progressPercent', 'missingCriteria', 'includedFiles']
  };

  it('1. lowercases every type, at every depth', () => {
    const strict = toStrictJsonSchema(schema);

    expect(strict.type).toBe('object');
    expect(strict.properties.status.type).toBe('string');
    expect(strict.properties.progressPercent.type).toBe('integer');
    expect(strict.properties.missingCriteria.items.type).toBe('string');
    expect(strict.properties.includedFiles.items.properties.path.type).toBe('string');
    // Nothing in the tree kept the OpenAPI spelling.
    expect(JSON.stringify(strict)).not.toMatch(/"OBJECT"|"STRING"|"INTEGER"|"ARRAY"/);
  });

  it('2. closes every object and lists every property as required', () => {
    const strict = toStrictJsonSchema(schema);

    expect(strict.additionalProperties).toBe(false);
    expect(strict.required).toEqual(['status', 'progressPercent', 'missingCriteria', 'includedFiles']);
    expect(strict.properties.includedFiles.items.additionalProperties).toBe(false);
    expect(strict.properties.includedFiles.items.required).toEqual(['path', 'tokensEstimate']);
  });

  it('3. leaves anything that is not a schema alone, and never mutates the input', () => {
    const before = JSON.stringify(schema);
    toStrictJsonSchema(schema);
    expect(JSON.stringify(schema)).toBe(before);

    expect(toStrictJsonSchema(null)).toBeNull();
    expect(toStrictJsonSchema(undefined)).toBeUndefined();
    expect(toStrictJsonSchema('STRING')).toBe('STRING');
  });
});
