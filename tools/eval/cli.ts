import { hasAiProvider } from '../../server/ai/aiProvider';
import { initApiKeyStore } from '../../server/store/apiKeyStore';
import { liveAnswer } from './liveAnswer';
import { formatReport, runEval } from './run';

/**
 * `npm run eval` — the offline measurement, safe in CI and on a machine with no keys:
 * the context-limited answerer, the six fixtures, `tsc` for the TypeScript ones.
 *
 * `npm run eval -- --live` asks the configured provider instead, one attempt per case.
 * `--fast` skips `tsc`; `--json` prints the report object for a diff between two runs.
 */

const args = process.argv.slice(2);
const live = args.includes('--live');
// The server calls this at boot; a CLI has to as well, or the keys saved through the app are
// invisible and `--live` refuses a machine that has one configured.
initApiKeyStore();
const fast = args.includes('--fast');
const json = args.includes('--json');

if (live && !hasAiProvider()) {
  console.error('No AI provider key is configured, so --live has nobody to ask.');
  process.exit(2);
}

const report = await runEval({
  answer: live ? liveAnswer : undefined,
  typecheck: !fast
});

console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
