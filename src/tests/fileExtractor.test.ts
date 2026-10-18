import { describe, it, expect } from 'vitest';
import { extractFilesFromAgentOutput } from '../utils/fileExtractor';

describe('fileExtractor utility', () => {
  it('extracts files with comment header inside code block', () => {
    const output = `
Here is the implementation:
\`\`\`tsx
// File: src/components/Counter.tsx
import React, { useState } from 'react';

export const Counter = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
};
\`\`\`
Hope this works!
`;
    const files = extractFilesFromAgentOutput(output);
    expect(files.length).toBe(1);
    expect(files[0].path).toBe('src/components/Counter.tsx');
    expect(files[0].content).toContain('export const Counter');
  });

  it('extracts files with path in code fence tag line', () => {
    const output = `
\`\`\`typescript src/utils/math.ts
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\`
`;
    const files = extractFilesFromAgentOutput(output);
    expect(files.length).toBe(1);
    expect(files[0].path).toBe('src/utils/math.ts');
    expect(files[0].content).toContain('export function add');
  });

  it('extracts files with markdown heading before code block', () => {
    const output = `
### \`src/services/api.ts\`
\`\`\`ts
export async function fetchData() {
  return { ok: true };
}
\`\`\`
`;
    const files = extractFilesFromAgentOutput(output);
    expect(files.length).toBe(1);
    expect(files[0].path).toBe('src/services/api.ts');
  });

  it('extracts multiple files from a single multi-file agent response', () => {
    const output = `
I updated two files for you:

\`\`\`tsx
// File: src/App.tsx
import React from 'react';
export default function App() { return <div>App</div>; }
\`\`\`

And helper file:
\`\`\`ts
// File: src/types.ts
export interface User { id: string; }
\`\`\`
`;
    const files = extractFilesFromAgentOutput(output);
    expect(files.length).toBe(2);
    expect(files[0].path).toBe('src/App.tsx');
    expect(files[1].path).toBe('src/types.ts');
  });

  it('takes the header closest to each fence, so a second file is not named after the first', () => {
    /*
     * The regression that kept config files out of the folder: the search for a Markdown header
     * looked at the last 200 characters and took the *first* heading in them — which, for the second
     * fence of a two-file answer, is the heading of the first file. The second block was then either
     * misnamed or dropped by the dedupe, and the beginner pressed "write the code" and got one file
     * out of four.
     */
    const output = `
Готово. Добавил шкалу голода.

### src/main.ts
\`\`\`ts
export function hunger(level: number): number {
  return Math.max(0, level - 1);
}
\`\`\`

### package.json
\`\`\`json
{ "name": "island", "scripts": { "build": "tsc" } }
\`\`\`

### tsconfig.json
\`\`\`json
{ "compilerOptions": { "strict": true } }
\`\`\`
`;

    const files = extractFilesFromAgentOutput(output);

    expect(files.map((file) => file.path)).toEqual(['src/main.ts', 'package.json', 'tsconfig.json']);
    expect(files[1].content).toContain('"scripts"');
  });

  it('reads a file name written as a plain line, a bold line or a File: line', () => {
    const bold = extractFilesFromAgentOutput(
      '**jest.config.js**\n\`\`\`js\nmodule.exports = { testEnvironment: "jsdom" };\n\`\`\`\n'
    );
    const plain = extractFilesFromAgentOutput(
      'File: .eslintrc.json\n\`\`\`json\n{ "extends": "eslint:recommended" }\n\`\`\`\n'
    );

    expect(bold[0].path).toBe('jest.config.js');
    expect(plain[0].path).toBe('.eslintrc.json');
  });

  it('does not read a sentence above the fence as a file name', () => {
    const output = `
Вот как это можно сделать, и вот получившийся код:
\`\`\`ts
export const answer = 42;
\`\`\`
`;

    expect(extractFilesFromAgentOutput(output)).toEqual([]);
  });

  it('uses defaultPath fallback when code has no explicit filename', () => {
    const output = `
\`\`\`tsx
export function SoloComponent() {
  return <div>Solo</div>;
}
\`\`\`
`;
    const files = extractFilesFromAgentOutput(output, 'src/SoloComponent.tsx');
    expect(files.length).toBe(1);
    expect(files[0].path).toBe('src/SoloComponent.tsx');
    expect(files[0].content).toContain('export function SoloComponent');
  });
});
