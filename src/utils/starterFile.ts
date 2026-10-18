/**
 * The first file of a project that has none.
 *
 * A prompt with no file behind it is the one thing an agent cannot act on: asked to change a
 * project whose folder is empty, it answers "send me the project files" — and the loop then reviews
 * that answer, finds nothing done, and asks again for the next attempt. Four attempts of nothing is
 * exactly what the helper used to produce, so it now refuses to build a prompt for a project with no
 * files and offers the smallest honest remedy: one file the agent can open and fill.
 *
 * The name follows the stack the project was created with, because that is the only thing the app
 * knows about a folder it has never read. The reader can change it before the file is created.
 */
export interface StarterProject {
  projectType?: string;
  engineOrFramework?: string;
  language?: string;
}

export function suggestedStarterPath(project: StarterProject | null | undefined): string {
  const stack = `${project?.projectType || ''} ${project?.engineOrFramework || ''}`.toLowerCase();
  const language = (project?.language || '').toLowerCase();

  // Engine projects first: their folder layout is fixed by the engine, not by taste.
  if (stack.includes('unity')) return 'Assets/Scripts/Main.cs';
  if (stack.includes('godot')) return 'scripts/main.gd';
  if (stack.includes('unreal')) return 'Source/Main.cpp';
  if (stack.includes('flutter')) return 'lib/main.dart';

  if (stack.includes('next')) return language.includes('javascript') ? 'src/app/page.jsx' : 'src/app/page.tsx';
  if (stack.includes('react') || stack.includes('vue') || stack.includes('svelte') || stack.includes('angular')) {
    if (stack.includes('angular')) return 'src/app/app.component.ts';
    if (language.includes('javascript')) return 'src/App.jsx';
    return 'src/App.tsx';
  }
  if (stack.includes('python') || language.includes('python')) return 'main.py';
  if (stack.includes('node')) return 'src/index.js';
  // Phaser, Three.js and a plain browser project all start from one script in `src`.
  return 'src/main.js';
}

/**
 * What goes into that file before the agent ever sees it.
 *
 * A comment carrying the task is enough for the file to exist and to say why it exists; the agent
 * replaces it on the first attempt. An empty file would work too, but a folder holding a file with
 * no content reads as a mistake rather than a start.
 */
export function starterFileContent(path: string, task: string, ru = true): string {
  const note = task.trim() || (ru ? 'Здесь появится код задачи' : 'The task code goes here');

  if (/\.(md|markdown|txt)$/i.test(path)) return `# ${note}\n`;
  if (/\.(html?|xml|svg)$/i.test(path)) return `<!-- ${note} -->\n`;
  if (/\.(py|rb|sh|yml|yaml|toml|ini|conf)$/i.test(path)) return `# ${note}\n`;
  if (/\.(css|scss|less)$/i.test(path)) return `/* ${note} */\n`;
  if (/\.json$/i.test(path)) return `{\n  "todo": ${JSON.stringify(note)}\n}\n`;
  // Everything else — ts, tsx, js, jsx, cs, go, java, kotlin, swift, php, cpp — reads `//`.
  return `// ${note}\n`;
}
