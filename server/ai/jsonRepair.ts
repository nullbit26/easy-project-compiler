/**
 * The end of an answer: the limit that cuts it, and the repair that keeps its finished part.
 *
 * A model that hits its output limit stops mid-sentence, and what arrives is JSON that is not broken
 * so much as unfinished: the last string is unterminated, or a field stops halfway through, or a list
 * is missing its closing bracket. Until now that answer was thrown away whole — the router moved to
 * the next model and the work already paid for was lost — even though nine tenths of it, including
 * every complete file in a change set, was sitting right there.
 *
 * The rule here is the one a reader would use: keep what is finished, drop what is not. The text is
 * scanned once, tracking which containers are open and remembering each place where the cut could
 * have landed on a boundary between two finished values. The repair then tries those boundaries from
 * the end backwards — the latest one loses the least — and closes whatever is still open at that
 * point. Nothing is invented: no value is completed, no field is guessed, and an answer whose cut
 * lands inside the only field it had still comes back as null rather than as an empty object that
 * looks like a real answer.
 *
 * A cut in the middle of a number is not a boundary between values. `45` parses, and so does the
 * `4500` the model may have been writing, so a number whose last character is also the last
 * character of the answer is dropped rather than guessed — the bytes on the wire cannot tell the two
 * apart. The same reasoning does not apply to `true`, `false` and `null`: a half-written literal
 * does not parse at all, so reading one is enough to know it is whole.
 *
 * It is used only when the provider itself says the answer was cut off (a finish reason of `length`,
 * `max_tokens` or `MAX_TOKENS`). A malformed answer that the model considered finished is a different
 * problem, and quietly turning one into a partial object is how a caller ends up trusting half a plan.
 */

/**
 * How many tokens an answer is allowed to spend.
 *
 * Left unset, the ceiling is whatever each host happens to default to — and a host that defaults low
 * cuts a change set in half without saying so in any field this app reads. Asking for the ceiling
 * explicitly is what makes a cut-off answer a known event rather than a surprise, and it is set to a
 * number every current model of the three providers accepts: a request for more than a model's own
 * maximum is refused outright, which would lose the provider instead of the answer.
 */
export const AI_MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS) || 16000;
/** The ceiling Anthropic is known to accept, used when the configured one is refused. */
export const ANTHROPIC_SAFE_OUTPUT_TOKENS = 8000;

/**
 * Whether a provider's own finish reason means "the answer ran out of room".
 *
 * The three providers spell it three ways — `length` for OpenAI-compatible hosts, `max_tokens` for
 * Anthropic, `MAX_TOKENS` for Gemini — and a host that reports nothing is not treated as truncated:
 * an answer nobody called cut off is either complete or broken, and those are different problems.
 */
export function isOutputLimit(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  return /^(length|max_?tokens|max_?output_?tokens)$/i.test(reason.trim());
}

/** A place where the answer could be cut without breaking a value: after a completed one. */
interface CutPoint {
  /** Everything up to here, without the separator that follows. */
  index: number;
  /** The closers that finish the containers still open at this point, innermost first. */
  closers: string;
}

const MAX_CUT_POINTS = 400;

/**
 * Reads the answer and reports how many containers are open at each boundary it passes.
 *
 * A single pass, with string and escape state, because a brace inside a code file is a character in
 * a string and not a container: `"content": "function f() {"` must not open anything.
 */
function scan(text: string): { cuts: CutPoint[]; open: string[]; inString: boolean } {
  const open: string[] = [];
  const cuts: CutPoint[] = [];
  let inString = false;
  let escaped = false;

  const closersNow = () => [...open].reverse().map((char) => (char === '{' ? '}' : ']')).join('');

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        inString = false;
        // A finished string is a finished value: the cut can land right after it.
        cuts.push({ index: index + 1, closers: closersNow() });
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      open.push(char);
      continue;
    }
    if (char === '}' || char === ']') {
      open.pop();
      cuts.push({ index: index + 1, closers: closersNow() });
      continue;
    }
    // A separator, or the last letter of a literal: a boundary between two finished values.
    if (char === ',' || char === 'e' || char === 'l') {
      cuts.push({ index: index + 1, closers: closersNow() });
    }
  }

  return { cuts, open, inString };
}

function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  // An unterminated fence is the normal shape of a cut-off answer: the opening marker arrived, the
  // closing one never did.
  const opened = text.match(/```(?:json)?\s*([\s\S]*)$/i);
  return (opened && opened[1] ? opened[1] : text).trim();
}

/**
 * The finished part of a cut-off answer, or null when there is nothing finished to keep.
 *
 * `text` is expected to be the model's raw answer; a markdown fence around it is removed first.
 */
export function repairTruncatedJson(text: string): any {
  if (typeof text !== 'string' || !text.trim()) return null;

  const source = stripFence(text);
  const start = source.search(/[[{]/);
  if (start === -1) return null;

  const body = source.slice(start);
  const { cuts, open, inString } = scan(body);

  // The cut landed exactly on the end of a value: only the open containers have to be closed.
  if (!inString && cuts.length && cuts[cuts.length - 1].index === body.length && open.length) {
    const attempt = `${body}${[...open].reverse().map((char) => (char === '{' ? '}' : ']')).join('')}`;
    try {
      return JSON.parse(attempt);
    } catch {
      // Fall through to the boundaries below: the last value may itself be a half-written number.
    }
  }

  // From the end backwards: the latest boundary loses the least, and the first one that parses wins.
  const candidates = cuts.slice(-MAX_CUT_POINTS);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const { index: end, closers } = candidates[index];
    const attempt = body.slice(0, end).replace(/[,\s]+$/, '') + closers;
    try {
      const parsed = JSON.parse(attempt);
      // A repair that produced an empty container would read as "the model answered, and its answer
      // was empty" — the one outcome that is worse than admitting the answer was lost.
      if (parsed && typeof parsed === 'object' && (Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length)) {
        return parsed;
      }
      return null;
    } catch {
      // This boundary did not parse either: try the one before it.
    }
  }

  return null;
}
