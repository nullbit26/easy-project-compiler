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
