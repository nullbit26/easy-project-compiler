import { describe, it, expect } from 'vitest';
import { resilientJsonParse, Type } from '../../server/ai/geminiProvider';

describe('Phase 4 - Structured Outputs & Resilient Parsing Tests', () => {
  describe('Resilient JSON Parser (resilientJsonParse)', () => {
    it('1. Parses perfect valid JSON', () => {
      const input = '{"success": true, "data": [1, 2, 3]}';
      const output = resilientJsonParse(input);
      expect(output).toEqual({ success: true, data: [1, 2, 3] });
    });

    it('2. Extracts and parses JSON wrapped in markdown code blocks with "json" language tag', () => {
      const input = `
Here is your parsed project definition:
\`\`\`json
{
  "name": "Brewery Sim",
  "mechanics": ["Brew", "Pour"]
}
\`\`\`
Hope this helps!
      `;
      const output = resilientJsonParse(input);
      expect(output).toEqual({ name: 'Brewery Sim', mechanics: ['Brew', 'Pour'] });
    });

    it('3. Extracts and parses JSON wrapped in plain markdown blocks without "json" tag', () => {
      const input = `
\`\`\`
{
  "framework": "React",
  "version": 19
}
\`\`\`
      `;
      const output = resilientJsonParse(input);
      expect(output).toEqual({ framework: 'React', version: 19 });
    });

    it('4. Handles prefix and suffix conversational text surrounding the JSON object', () => {
      const input = 'The final result of the adapt-plan request is: {"phases": [{"phaseNumber": 1, "title": "Base Setup"}]} which meets your requirements.';
      const output = resilientJsonParse(input);
      expect(output).toEqual({ phases: [{ phaseNumber: 1, title: 'Base Setup' }] });
    });

    it('5. Handles trailing commas gracefully inside JSON objects and arrays', () => {
      const input = '{"projectName": "Simple Game", "mvpFeatures": ["Feature 1", "Feature 2",],}';
      const output = resilientJsonParse(input);
      expect(output).toEqual({ projectName: 'Simple Game', mvpFeatures: ['Feature 1', 'Feature 2'] });
    });

    it('6. Returns null gracefully for completely invalid non-JSON texts', () => {
      const input = 'This is a completely normal text and has no braces at all.';
      const output = resilientJsonParse(input);
      expect(output).toBeNull();
    });
  });

  describe('An answer the provider itself cut off', () => {
    const CUT = '```json\n{"summary": "Add the pour step", "files": [{"path": "src/a.ts", "content": "export const a = 1;\n"}, {"path": "src/b.ts", "co';

    it('8. keeps the finished files when the provider said the answer ran out of room', () => {
      // Without the flag the repair is off, and this is the answer that used to be thrown away whole.
      expect(resilientJsonParse(CUT)).toBeNull();

      const salvaged = resilientJsonParse(CUT, { repair: true });
      expect(salvaged.summary).toBe('Add the pour step');
      expect(salvaged.files).toHaveLength(1);
      expect(salvaged.files[0]).toMatchObject({ path: 'src/a.ts' });
    });

    it('9. does not turn a badly broken answer into a plausible one', () => {
      // The model considered this finished, so nothing here is "the part that arrived": there is no
      // cut to keep, and a partial object would read to the caller as a real answer.
      expect(resilientJsonParse('{"summary":', { repair: true })).toBeNull();
      expect(resilientJsonParse('I could not do this task.', { repair: true })).toBeNull();
    });
  });

  describe('Google Gemini SDK Structured Schema Type Verification', () => {
    it('7. Exports Type enum correctly from the @google/genai SDK', () => {
      expect(Type).toBeDefined();
      expect(Type.OBJECT).toBe('OBJECT');
      expect(Type.ARRAY).toBe('ARRAY');
      expect(Type.STRING).toBe('STRING');
      expect(Type.INTEGER).toBe('INTEGER');
    });
  });
});
