import { GoogleGenAI, Type } from '@google/genai';
import { AI_MAX_OUTPUT_TOKENS, isOutputLimit, repairTruncatedJson } from './jsonRepair';

export { Type };

export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

/**
 * The text of a Gemini answer, and whether the model ran out of room producing it.
 *
 * The finish reason is the only place that fact exists: an answer cut off by the output limit is
 * valid-looking text that simply stops, so without reading it the app cannot tell "the model ran out
 * of room" from "the model answered badly" — and those need different handling.
 */
export function geminiAnswer(response: any): { text: string; truncated: boolean } {
  const candidate = response?.candidates?.[0];
  const text = typeof response?.text === 'string' ? response.text : '';
  return { text, truncated: isOutputLimit(candidate?.finishReason ?? candidate?.finish_reason) };
}

/**
 * Highly resilient JSON parser that can handle raw JSON strings,
 * markdown code blocks, stray text prefixing/suffixing, and minor syntax issues.
 *
 * `repair` is for an answer the provider itself reported as cut off by its output limit: there the
 * unfinished tail is dropped and the open containers are closed, so the part that did arrive — the
 * files that were already complete, say — is used instead of thrown away. It is off by default on
 * purpose: an answer that the model considered finished and that does not parse is not a truncated
 * one, and silently returning part of it would hand a caller something that looks whole.
 */
export function resilientJsonParse(text: string, options: { repair?: boolean } = {}): any {
  if (!text) return null;
  
  let cleanText = text.trim();
  
  // 1. Direct parse attempt
  try {
    return JSON.parse(cleanText);
  } catch (e) {
    // Continue to other resilient methods
  }
  
  // 2. Extract content between ```json and ``` or ``` and ```
  const markdownRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const markdownMatch = cleanText.match(markdownRegex);
  if (markdownMatch && markdownMatch[1]) {
    try {
      return JSON.parse(markdownMatch[1].trim());
    } catch (e) {
      cleanText = markdownMatch[1].trim(); // Fall back to checking this text block
    }
  }
  
  // 3. Find the outermost curly braces { ... }
  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonSub = cleanText.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonSub);
    } catch (e) {
      // Continue
    }
  }

  // 4. Find the outermost square brackets [ ... ]
  const firstBracket = cleanText.indexOf('[');
  const lastBracket = cleanText.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const jsonSub = cleanText.substring(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(jsonSub);
    } catch (e) {
      // Continue
    }
  }

  // 5. Try to clean up trailing commas before closing symbols ,} or ,]
  try {
    const fixedCommaJson = cleanText.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(fixedCommaJson);
  } catch (e) {
    // All parsing methods failed
  }

  // 6. The answer was cut off by the model's own output limit, and the provider said so: keep what
  // is finished rather than losing the whole answer.
  if (options.repair) {
    const salvaged = repairTruncatedJson(text);
    if (salvaged) return salvaged;
  }

  return null;
}

export async function safeCallGemini(
  ai: any,
  promptText: string,
  responseSchema?: any,
  /**
   * Reports which model actually answered, and whether it ran out of room — the UI names the engine
   * from this, and the caller decides what to do with a cut-off answer.
   */
  onModelUsed?: (model: string, truncated: boolean) => void
): Promise<any | null> {
  if (!ai) return null;
  // Current-generation model aliases, ordered from newest to lightest fallback.
  const modelsToTry = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

  for (const model of modelsToTry) {
    try {
      const config: any = {
        responseMimeType: 'application/json',
        // Asked for explicitly: the default is the host's business, and a low default silently cuts
        // a long answer in half.
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS
      };
      
      if (responseSchema) {
        config.responseSchema = responseSchema;
      }

      const response = await ai.models.generateContent({
        model,
        contents: promptText,
        config
      });
      const answer = geminiAnswer(response);
      if (answer.text) {
        if (answer.truncated) {
          console.info(
            `[Gemini Engine] ${model} hit its output limit; keeping the finished part of the answer.`
          );
        }
        const parsed = resilientJsonParse(answer.text, { repair: answer.truncated });
        if (parsed && typeof parsed === 'object') {
          onModelUsed?.(model, answer.truncated);
          return parsed;
        }
      }
    } catch (err: any) {
      const status = err?.status || err?.code || 0;
      const msg = String(err?.message || err);
      if (status === 429 || status === 'RESOURCE_EXHAUSTED' || msg.includes('429') || msg.includes('quota') || status === 404 || msg.includes('404')) {
        console.info(`[Gemini Engine] Model ${model} unavailable (${status || 'quota limit'}), checking fallback candidate...`);
        continue;
      }
      console.info(`[Gemini Engine] API call notice on ${model}: ${msg.slice(0, 100)}... Switching to Local AI Compiler engine.`);
      break;
    }
  }
  console.info('[Gemini Engine] API candidates unavailable or quota limit reached. Activated Local Project Compiler engine.');
  return null;
}
