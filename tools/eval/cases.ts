/**
 * The eval's fixture projects, declared as data and written to a temp folder at run time.
 *
 * Every case is built around the same failure the context plan is meant to fix: the task names
 * one file, and the answer is only correct if the model also saw a second one — the type it
 * imports, the code that imports it, or the test that calls it. `needsContext` says which file
 * that is, so a run can tell "the prompt was bigger" from "the prompt had what mattered".
 *
 * `solution` is a complete patch, keyed by path. The offline answerer only reproduces the parts
 * of it whose current file it was shown — a stand-in for a model that cannot edit what it never
 * saw, not a claim about any real model.
 */

export interface EvalCheck {
  path: string;
  /** Substrings the final file must contain. */
  includes?: string[];
  /** Substrings the final file must not contain. */
  excludes?: string[];
}

export interface EvalCase {
  id: string;
  stack: 'typescript' | 'python' | 'csharp';
  /** Whether the final state can be verified with `tsc --noEmit`. */
  typecheck: boolean;
  files: Record<string, string>;
  task: {
    title: string;
    goal: string;
    acceptanceCriteria: string[];
    targetFiles: string[];
  };
  /** Files the prompt must carry for the task to be answerable. */
  needsContext: string[];
  solution: Record<string, string>;
  checks: EvalCheck[];
}

const TS_TYPES = `export interface User {
  id: string;
  name: string;
}
`;

const TS_SERVICE = `import { User } from './types';

export function describe(user: User): string {
  return \`\${user.id}: \${user.name}\`;
}
`;

const TS_CONFIG = `export const PORT = 3000;
export const HOST = 'localhost';
`;

const TS_SERVER = `import { PORT } from './config';

export const url = \`http://localhost:\${PORT}\`;
`;

const TS_FORMAT = `export function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}
`;

const TS_FORMAT_TEST = `import { formatPrice } from './format';

const cases: Array<[number, string]> = [[1234, '12.34']];

export const ok = cases.every(([cents, expected]) => formatPrice(cents) === expected);
`;

const TS_FORMAT_TEST_FIXED = `import { formatPrice } from './format';

const cases: Array<[number, string, string]> = [[1234, '€', '€12.34']];

export const ok = cases.every(([cents, currency, expected]) => formatPrice(cents, currency) === expected);
`;

const TS_MATH = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const TS_BARREL = `export { add } from './math';
`;

const TS_APP = `import { add } from './lib/index';

export const total = add(1, 2);
`;

const PY_MODELS = `class User:
    def __init__(self, name: str) -> None:
        self.name = name
`;

const PY_SERVICE = `from app.models import User


def greet(user: User) -> str:
    return f"Hello, {user.name}"
`;

const CS_COMBAT = `namespace Game.Combat {
    public class Damage {
        public int Amount = 10;
    }
}
`;

const CS_HUD = `using Game.Combat;

public class Hud {
    public int Read(Damage damage) => damage.Amount;
}
`;

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'ts-service-types',
    stack: 'typescript',
    typecheck: true,
    files: {
      'src/types.ts': TS_TYPES,
      'src/service.ts': TS_SERVICE
    },
    task: {
      title: 'Users carry an email',
      goal: 'The User type gains an email field, and describe() prints it between id and name.',
      acceptanceCriteria: ['User has an email field', 'describe() returns id, email and name'],
      // Deliberately the caller only: the type lives in a file the task forgets to name.
      targetFiles: ['src/service.ts']
    },
    needsContext: ['src/types.ts'],
    solution: {
      'src/types.ts': `export interface User {
  id: string;
  name: string;
  email: string;
}
`,
      'src/service.ts': `import { User } from './types';

export function describe(user: User): string {
  return \`\${user.id}: \${user.email}: \${user.name}\`;
}
`
    },
    checks: [
      { path: 'src/types.ts', includes: ['email: string'] },
      { path: 'src/service.ts', includes: ['user.email'] }
    ]
  },
  {
    id: 'ts-importer-signature',
    stack: 'typescript',
    typecheck: true,
    files: {
      'src/config.ts': TS_CONFIG,
      'src/server.ts': TS_SERVER
    },
    task: {
      title: 'Rename PORT to PORT_NUMBER',
      goal: 'The constant is renamed everywhere it is used.',
      acceptanceCriteria: ['config.ts exports PORT_NUMBER', 'server.ts imports and uses PORT_NUMBER'],
      targetFiles: ['src/config.ts']
    },
    needsContext: ['src/server.ts'],
    solution: {
      'src/config.ts': `export const PORT_NUMBER = 3000;
export const HOST = 'localhost';
`,
      'src/server.ts': `import { PORT_NUMBER } from './config';

export const url = \`http://localhost:\${PORT_NUMBER}\`;
`
    },
    checks: [
      { path: 'src/config.ts', includes: ['PORT_NUMBER'], excludes: ['export const PORT '] },
      { path: 'src/server.ts', includes: ['PORT_NUMBER'], excludes: ['{ PORT }'] }
    ]
  },
  {
    id: 'ts-test-neighbour',
    stack: 'typescript',
    typecheck: true,
    files: {
      'src/format.ts': TS_FORMAT,
      'src/format.test.ts': TS_FORMAT_TEST
    },
    task: {
      title: 'formatPrice takes a currency',
      goal: 'The formatter prints the currency the caller passes, and its test calls it that way.',
      acceptanceCriteria: ['formatPrice(cents, currency) returns the symbol before the amount', 'the test passes a currency'],
      targetFiles: ['src/format.ts']
    },
    needsContext: ['src/format.test.ts'],
    solution: {
      'src/format.ts': `export function formatPrice(cents: number, currency: string): string {
  return \`\${currency}\${(cents / 100).toFixed(2)}\`;
}
`,
      'src/format.test.ts': TS_FORMAT_TEST_FIXED
    },
    checks: [
      { path: 'src/format.ts', includes: ['currency: string', '${currency}'] },
      { path: 'src/format.test.ts', includes: ['formatPrice(cents, currency)', '€12.34'] }
    ]
  },
  {
    id: 'ts-barrel-rename',
    stack: 'typescript',
    typecheck: true,
    files: {
      'src/lib/math.ts': TS_MATH,
      'src/lib/index.ts': TS_BARREL,
      'src/app.ts': TS_APP
    },
    task: {
      title: 'Call add() sum internally',
      goal: 'The implementation is renamed to sum, while the public name add keeps working through the barrel.',
      acceptanceCriteria: ['math.ts exports sum', 'index.ts still exports a working add', 'app.ts compiles untouched'],
      targetFiles: ['src/lib/math.ts']
    },
    needsContext: ['src/lib/index.ts'],
    solution: {
      'src/lib/math.ts': `export function sum(a: number, b: number): number {
  return a + b;
}
`,
      'src/lib/index.ts': `export { sum as add } from './math';
`
    },
    checks: [
      { path: 'src/lib/math.ts', includes: ['export function sum'] },
      { path: 'src/lib/index.ts', includes: ['sum as add'] }
    ]
  },
  {
    id: 'py-model-field',
    stack: 'python',
    typecheck: false,
    files: {
      'app/__init__.py': '',
      'app/models.py': PY_MODELS,
      'app/service.py': PY_SERVICE
    },
    task: {
      title: 'Users carry an email in Python too',
      goal: 'The model takes an email, and the greeting includes it.',
      acceptanceCriteria: ['User.__init__ takes email', 'greet() prints the email'],
      targetFiles: ['app/service.py']
    },
    needsContext: ['app/models.py'],
    solution: {
      'app/models.py': `class User:
    def __init__(self, name: str, email: str) -> None:
        self.name = name
        self.email = email
`,
      'app/service.py': `from app.models import User


def greet(user: User) -> str:
    return f"Hello, {user.name} <{user.email}>"
`
    },
    checks: [
      { path: 'app/models.py', includes: ['self.email'] },
      { path: 'app/service.py', includes: ['user.email'] }
    ]
  },
  {
    id: 'cs-namespace',
    stack: 'csharp',
    typecheck: false,
    files: {
      'Game/Combat.cs': CS_COMBAT,
      'Assets/Hud.cs': CS_HUD
    },
    task: {
      title: 'Damage.Amount becomes Damage.Value',
      goal: 'The field is renamed in the class and at its only use.',
      acceptanceCriteria: ['Damage exposes Value', 'Hud reads damage.Value'],
      targetFiles: ['Assets/Hud.cs']
    },
    needsContext: ['Game/Combat.cs'],
    solution: {
      'Game/Combat.cs': `namespace Game.Combat {
    public class Damage {
        public int Value = 10;
    }
}
`,
      'Assets/Hud.cs': `using Game.Combat;

public class Hud {
    public int Read(Damage damage) => damage.Value;
}
`
    },
    checks: [
      { path: 'Game/Combat.cs', includes: ['int Value'], excludes: ['Amount'] },
      { path: 'Assets/Hud.cs', includes: ['damage.Value'] }
    ]
  }
];
