/**
 * Server-sent events, read a frame at a time.
 *
 * Both ends of the live compile use this file: the server writes `data:` frames as the model
 * produces them, and the screen reads them back out of the response body. The reader has to be
 * able to stop anywhere — a chunk boundary can fall inside a JSON payload, between two lines, or
 * between two frames — so it keeps the unfinished tail and the caller feeds it the next chunk.
 *
 * Providers disagree about the details: OpenAI-compatible hosts send a bare `data:` line per
 * frame and finish with `data: [DONE]`, Anthropic names its frames on an `event:` line, and both
 * occasionally send a `: ping` comment. All of that is one grammar, handled here once.
 */

export interface SseFrame {
  /** The frame's name; `message` when the stream did not name it. */
  event: string;
  /** Every `data:` line of the frame, joined the way the spec joins them. */
  data: string;
}

/** The empty line between frames, with whatever line endings the host uses. */
const FRAME_END = /\r?\n\r?\n/;

/**
 * Everything complete in `buffer`, plus the unfinished tail that belongs to the next chunk.
 *
 * A frame with no `data:` line (a keep-alive or a comment) is not an event and is dropped rather
 * than handed to the caller as an empty message.
 */
export function takeSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let rest = buffer;

  for (;;) {
    const match = FRAME_END.exec(rest);
    if (!match) break;
    const block = rest.slice(0, match.index);
    rest = rest.slice(match.index + match[0].length);
    const frame = readBlock(block);
    if (frame) frames.push(frame);
  }

  return { frames, rest };
}

function readBlock(block: string): SseFrame | null {
  let event = 'message';
  const data: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const colon = rawLine.indexOf(':');
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? '' : rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }

  if (!data.length) return null;
  return { event, data: data.join('\n') };
}
