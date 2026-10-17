import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A control that cannot be pressed does not react to the pointer.
 *
 * The app's one signal for "this is the button to press" is the colour it takes under the pointer.
 * A disabled button used the same signal — «Дальше» in the step-by-step helper glowed brighter while
 * the folder was not connected — so the screen said "press me" with the same breath as "you cannot".
 * The cursor changed too, from the arrow to a hand.
 *
 * The fix lives in the utilities: on a button that can be disabled, `hover:` and `active:` are written
 * as `enabled:hover:` and `enabled:active:`, and the pointer cursor as `enabled:cursor-pointer`, so
 * there is nothing for the disabled state to rise to. This test is what keeps that from drifting back
 * file by file, which is how it arrived: one button at a time, and none of them looked wrong in a
 * screenshot — a hover only shows under the pointer.
 *
 * `cursor-not-allowed` is deliberately not allowed either: the arrow that every other inert pixel on
 * the page shows is quieter than a cursor that keeps announcing a button.
 */

const ROOT = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourceFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

interface Tag {
  name: string;
  text: string;
  index: number;
  classValues: string[];
  canBeDisabled: boolean;
}

/**
 * Every JSX opening tag of a file, with the class strings it carries.
 *
 * The scan tracks what the parser tracks and nothing else: quotes, template literals, and the braces
 * of a `{…}` expression, so a `>` inside an arrow function or a string does not end the tag early.
 */
function tagsOf(source: string): Tag[] {
  const tags: Tag[] = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] !== '<' || !/[A-Za-z_>]/.test(source[i + 1] || '')) {
      i += 1;
      continue;
    }
    const start = i;
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let j = i + 1; j < source.length; j += 1) {
      const c = source[j];
      if (quote) {
        if (c === '\\') j += 1;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === '`') {
        let inner = 0;
        for (let k = j + 1; k < source.length; k += 1) {
          if (source[k] === '\\') k += 1;
          else if (source[k] === '{' && source[k - 1] === '$') inner += 1;
          else if (source[k] === '}' && inner > 0) inner -= 1;
          else if (source[k] === '`' && inner === 0) {
            j = k;
            break;
          }
        }
        continue;
      }
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) {
      i += 1;
      continue;
    }
    const text = source.slice(start, end + 1);
    const classValues: string[] = [];
    const classRe = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g;
    let match: RegExpExecArray | null;
    while ((match = classRe.exec(text))) {
      classValues.push(match[1] ?? match[2] ?? match[3] ?? '');
    }
    const withoutClasses = classRe[Symbol.replace](text, 'className=…');
    tags.push({
      name: (text.match(/^<([A-Za-z_][\w.]*)/) || [, '?'])[1],
      text,
      index: start,
      classValues,
      canBeDisabled: /\sdisabled(?:[=\s/>])/.test(withoutClasses) || /\saria-disabled=/.test(withoutClasses)
    });
    i = end + 1;
  }
  return tags;
}

/** The class tokens of a disabled-capable tag that would make it react to the pointer. */
function reactiveTokens(tag: Tag): string[] {
  const offenders: string[] = [];
  for (const value of tag.classValues) {
    for (const token of value.split(/\s+/).filter(Boolean)) {
      const segments = token.split(':');
      const utility = segments.pop() ?? '';
      const gated = segments.includes('enabled') || segments.includes('disabled');
      const stateful = segments.includes('hover') || segments.includes('active');
      if (stateful && !gated) offenders.push(token);
      else if (utility.startsWith('cursor-') && utility !== 'cursor-default' && !gated) offenders.push(token);
      else if (utility === 'cursor-not-allowed') offenders.push(token);
    }
  }
  return offenders;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

describe('disabled controls do not react to the pointer', () => {
  it('1. no button that can be disabled keeps a bare hover, active or pointer cursor', () => {
    const offenders: string[] = [];
    let disabledTags = 0;

    for (const file of sourceFiles(ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const tag of tagsOf(source)) {
        if (!tag.canBeDisabled) continue;
        disabledTags += 1;
        const tokens = reactiveTokens(tag);
        if (tokens.length > 0) {
          offenders.push(
            `${path.relative(ROOT, file)}:${lineOf(source, tag.index)} <${tag.name}> ${tokens.join(' ')}`
          );
        }
      }
    }

    // The scan is only worth anything if it is looking at something: the app has dozens of them.
    expect(disabledTags).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });

  it('2. the stylesheet keeps the arrow on anything switched off by an attribute', () => {
    const css = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');
    expect(css).toMatch(/:disabled,\s*\[aria-disabled='true'\]\s*\{\s*cursor:\s*default;/);
  });
});
