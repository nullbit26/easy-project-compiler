import { ProjectBrief, ArchitectureProposal, ProjectPhase, ProjectMap, CompiledPrompt, SessionReview, ErrorDiagnosis, ProjectFile, FileInsights, WorkspaceFacts } from '../types';
import type { RulesContent } from '../utils/rulesFiles';
import type { CheckEvidence } from '../utils/checkEvidence';
import { trackAiRequest } from './aiActivity';
import { notifyWorkspaceBatchWritten } from './rulesWatch';

export class ApiError extends Error {
  constructor(public status: number, public userMessage: string, public details?: any) {
    super(userMessage);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorData;
    try {
      errorData = await res.json();
    } catch (e) {
      throw new ApiError(res.status, `Server error: ${res.statusText}`);
    }
    throw new ApiError(
      res.status,
      errorData.userMessage || errorData.message || errorData.error || 'An unexpected API error occurred.',
      errorData.details || errorData
    );
  }
  const json = await res.json();
  /*
   * Which engine answered rides on the envelope, next to `data`, because it describes the request,
   * not the result. It used to be dropped here, so a prompt or a verdict written by the offline rule
   * engine arrived at the screen looking exactly like one a model wrote.
   */
  if (json && json.engine && json.data && typeof json.data === 'object') {
    return { ...json.data, engine: json.engine } as T;
  }
  return json.data as T;
}

export interface IdeaAnalysisData {
  isTooShort?: boolean;
  validationMessage?: string;
  clarifyingQuestions?: string[];
  preferredStack?: string;
  architecturalPattern?: string;
  targetPlatform?: string;
  explanation?: string;
  selectedAgent?: string;
  technicalLevel?: string;
}

/**
 * AI Smart Auto-Select: analyzes the idea and returns the recommended stack,
 * architectural pattern and target platform (or a "too short" validation).
 */
export async function analyzeIdeaApi(params: { ideaText: string; title?: string; language?: string }) {
  return trackAiRequest('idea', async () => {
    const res = await fetch('/api/project/analyze-idea', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<IdeaAnalysisData>(res);
  });
}

export async function generateProjectQuestionsApi(params: {
  idea: string;
  platform?: string;
  stack?: string;
  agent?: string;
  skillLevel?: string;
  architecturalPattern?: string;
  reliabilityGuarantees?: string[];
  mvpDepth?: string;
  language?: string;
}) {
  return trackAiRequest('questions', async () => {
    const res = await fetch('/api/project/generate-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<{
      questions: {
        id: string;
        topic: string;
        questionText: string;
        placeholder: string;
        defaultSuggestion: string;
      }[];
      tradeOffs?: {
        id: string;
        title: string;
        optionA: string;
        optionB: string;
        recommendation: string;
      }[];
    }>(res);
  });
}

export async function createProjectFromIdea(params: {
  idea: string;
  projectName?: string;
  platform?: string;
  stack?: string;
  agent?: string;
  skillLevel?: string;
  architecturalPattern?: string;
  reliabilityGuarantees?: string[];
  mvpDepth?: string;
  userAnswers?: Record<string, string>;
  tradeOffChoices?: Record<string, string>;
  language?: string;
}) {
  return trackAiRequest('project', async () => {
    const res = await fetch('/api/project/create-idea', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<{
      projectName: string;
      projectType: 'Unity' | 'Phaser.js' | 'Godot' | 'Three.js' | 'Unreal Engine' | 'React' | 'Next.js' | 'Node.js' | 'Python' | 'Flutter' | 'Generic';
      engineOrFramework: string;
      language: string;
      tagline: string;
      targetAudience: string;
      coreProblem: string;
      coreValue: string;
      mvpFeatures: string[];
      futureFeatures: string[];
      nonGoals: string[];
      technicalConstraints: string[];
      successCriteria: string[];
      clarifyingQuestions: string[];
      architecture: ArchitectureProposal;
      phases: {
        phaseNumber: number;
        title: string;
        purpose: string;
        deliverable: string;
        tasks: any[];
      }[];
    }>(res);
  });
}

/** What the app understood about an existing project folder during the import. */
export interface WorkspaceUnderstanding {
  source: 'folder' | 'paths';
  root: string | null;
  fileCount: number;
  keyFiles: string[];
  evidence: string[];
  projectType: string;
  engineOrFramework: string;
  language: string;
  /** What the files themselves already contain — absent when only paths were pasted. */
  facts?: WorkspaceFacts;
}

/**
 * Asks what the project already implements. The server reads the real files again, so this works
 * from the folder rather than from what the browser happens to hold.
 */
export async function describeImplementedApi(params: {
  paths?: string[];
  projectName?: string;
  language?: string;
}) {
  return trackAiRequest('map', async () => {
    const res = await fetch('/api/project/describe-implemented', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<FileInsights>(res);
  });
}

/**
 * Reads the connected folder (or a pasted list of paths) and has the project understood — the
 * result carries the same plan shape as `createProjectFromIdea`, plus what was found in the files.
 */
export async function importWorkspaceApi(params: { paths?: string[]; projectName?: string; language?: string }) {
  return trackAiRequest('project', async () => {
    const res = await fetch('/api/project/import-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<{
      projectName: string;
      projectType: 'Unity' | 'Phaser.js' | 'Godot' | 'Three.js' | 'Unreal Engine' | 'React' | 'Next.js' | 'Node.js' | 'Python' | 'Flutter' | 'Generic';
      engineOrFramework: string;
      language: string;
      tagline: string;
      targetAudience: string;
      coreProblem: string;
      coreValue: string;
      mvpFeatures: string[];
      futureFeatures: string[];
      nonGoals: string[];
      technicalConstraints: string[];
      successCriteria: string[];
      clarifyingQuestions: string[];
      architecture: ArchitectureProposal;
      phases: {
        phaseNumber: number;
        title: string;
        purpose: string;
        deliverable: string;
        tasks: any[];
      }[];
      understanding: WorkspaceUnderstanding;
      engine: string;
    }>(res);
  });
}

export async function adaptProjectPlanApi(params: {
  project: any;
  userGoal?: string;
  targetPhaseId?: string;
  language?: string;
}) {
  return trackAiRequest('plan', async () => {
    const res = await fetch('/api/project/adapt-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<{
      phases: {
        phaseNumber: number;
        title: string;
        purpose: string;
        deliverable: string;
        tasks: any[];
      }[];
    }>(res);
  });
}

export async function compilePromptApi(params: {
  userRequest: string;
  taskTitle?: string;
  projectMap: ProjectMap;
  brief?: ProjectBrief;
  agent: string;
  contextMode: 'Minimal' | 'Balanced' | 'Full';
  /** The project's working mode: it shapes how the prompt talks, never how strict it is. */
  skillLevel?: string;
  language?: string;
  /**
   * The project's agent rules. The server reads them against the connected folder, so the compiled
   * prompt can say which lines no longer describe the project instead of passing them on as if
   * they were true.
   */
  rules?: RulesContent;
  projectName?: string;
}) {
  return trackAiRequest('compile', async () => {
    const res = await fetch('/api/prompt/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<CompiledPrompt>(res);
  });
}

export async function reviewSessionApi(params: {
  agentOutput: string;
  task: any;
  projectMap: ProjectMap;
  stepNumber?: number;
  previousHistory?: any[];
  /**
   * What the app's own run of the folder's commands found, when it has run them.
   *
   * The reviewer needs it for the same reason a person does: "the code you pasted looks complete"
   * and "the folder compiles" are different claims, and only one of them is measured. It also stops
   * the verdict from asking the user to run `npm install` and `tsc` — commands the app runs itself.
   */
  checkEvidence?: CheckEvidence | null;
  /** The project's working mode: it shapes the wording of the verdict, not its strictness. */
  skillLevel?: string;
  language?: string;
}) {
  return trackAiRequest('review', async () => {
    const res = await fetch('/api/session/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<SessionReview>(res);
  });
}

export async function diagnoseErrorApi(params: {
  errorText: string;
  codeContext?: string;
  projectType?: string;
  framework?: string;
  /** The project's working mode: it shapes how much the diagnosis explains, nothing else. */
  skillLevel?: string;
  language?: string;
}) {
  return trackAiRequest('diagnose', async () => {
    const res = await fetch('/api/error/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<ErrorDiagnosis>(res);
  });
}

/* ------------------------------------------------------------------ *
 * Real project folder (read / write) — /api/files
 * ------------------------------------------------------------------ */

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  dir: string;
  type: ProjectFile['type'];
  sizeBytes: number;
  isText: boolean;
}

export interface WorkspaceBackup {
  id: string;
  createdAt: string;
  root: string;
  fileCount: number;
  applied: number;
  failed: number;
}

export interface WorkspaceState {
  root: string | null;
  files: WorkspaceFileEntry[];
  truncated?: boolean;
  skipped?: number;
  scannedAt?: string;
  backups: WorkspaceBackup[];
  /** Every write into this folder, newest first. */
  timeline?: WorkspaceChangeset[];
  checkpoints?: WorkspaceCheckpoint[];
}

/** One applied batch of file changes, as the timeline shows it. */
export interface WorkspaceChangeset extends WorkspaceBackup {
  paths: string[];
  label?: string;
  verification?: VerificationSummary;
  /** What the project's own formatter tidied after this write, when it ran. */
  formatting?: FormattingSummary;
  /** How heavy this batch was, and how heavy the project is after it. */
  weight?: WriteWeight;
  rolledBackAt?: string;
}

/**
 * How heavy the change was: the exact byte math of the batch, the size of the project now, and
 * what it was the last time the app wrote here.
 */
export interface WriteWeight {
  at: string;
  changesetId: string | null;
  files: number;
  beforeBytes: number;
  afterBytes: number;
  netBytes: number;
  heaviest: { path: string; deltaBytes: number; afterBytes: number } | null;
  projectBytes: number;
  projectFileCount: number;
  /** True when the walk hit its cap, which makes the size a floor rather than a total. */
  projectTruncated: boolean;
  projectDeltaBytes: number | null;
  projectDeltaPct: number | null;
  /** Part of the project delta this batch cannot explain (hand edits, another tool). */
  otherBytes: number | null;
  heavy: boolean;
  note?: 'first_measurement';
}

/** The size of the folder's build output, measured right after the folder's own build ran. */
export interface BuildWeight {
  at: string;
  dir: string;
  bytes: number;
  fileCount: number;
  truncated: boolean;
  deltaBytes: number | null;
  deltaPct: number | null;
  heavy: boolean;
  note?: 'first_measurement';
}

/**
 * Tidying the files that were just written, done with the project's own formatter.
 * It never installs anything and never touches files the app did not write.
 */
export type FormatterId = 'prettier' | 'biome' | 'ruff';
export type FormatterNote = 'no_files' | 'no_formatter' | 'nothing_to_format';

export interface FormattingResult {
  ran: boolean;
  tool: FormatterId | null;
  toolLabel: string | null;
  commandLine: string | null;
  files: string[];
  changed: string[];
  skipped: string[];
  error?: string;
  note?: FormatterNote;
  durationMs: number;
}

export interface FormattingSummary {
  at: string;
  tool: string;
  changed: number;
  files: number;
  error?: string;
}

export interface WorkspaceCheckpoint {
  id: string;
  name: string;
  createdAt: string;
  changesetId: string | null;
}

export type CheckKind = 'typecheck' | 'lint' | 'test' | 'build' | 'custom';
export type CheckStatus = 'passed' | 'failed' | 'timeout' | 'unavailable' | 'skipped';

export interface ProjectCheckDefinition {
  id: string;
  kind: CheckKind;
  key: string;
  labelRu: string;
  labelEn: string;
  commandLine: string;
  tokens: string[];
}

export interface CheckProblem {
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  severity: 'error' | 'warning';
  message: string;
  raw: string;
  /** Whether the run that produced this report brought the problem or it was already there. */
  change?: 'new' | 'persistent';
}

/**
 * The verdict of a check run: what changed compared with the previous run in this folder.
 * "The tests failed" is a fact; "this change broke the two tests that used to pass" is an answer.
 */
export interface VerificationProblemRef {
  checkId: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface CheckTransition {
  id: string;
  labelRu: string;
  labelEn: string;
  from: CheckStatus;
  to: CheckStatus;
}

export interface VerificationDelta {
  compared: boolean;
  baselineRanAt: string | null;
  baselineChangesetId: string | null;
  regressedChecks: CheckTransition[];
  recoveredChecks: CheckTransition[];
  newProblems: VerificationProblemRef[];
  fixedProblems: VerificationProblemRef[];
  persistentProblems: VerificationProblemRef[];
}

export interface CheckRunResult extends ProjectCheckDefinition {
  status: CheckStatus;
  exitCode: number | null;
  durationMs: number;
  problems: CheckProblem[];
  output: string;
  outputTruncated: boolean;
  error?: string;
}

export interface VerificationSummary {
  ranAt: string;
  ok: boolean;
  passed: number;
  failed: number;
  problemCount: number;
  errors: number;
  warnings: number;
  /** How heavy the build output is, when the folder's own build ran in this pass. */
  build?: BuildWeight;
  /** The same number against the ceiling this project set for itself, when it has one. */
  budget?: BuildBudgetVerdict;
}

/**
 * The measured build output against the project's own ceiling.
 *
 * `over` is null when this project set no ceiling: "not over budget" and "no budget" are two
 * different answers, and only one of them is good news.
 */
export interface BuildBudgetVerdict {
  bytes: number | null;
  actual: number;
  over: boolean | null;
  deltaBytes: number | null;
  usedPct: number | null;
}

export interface WeightBudget {
  bytes: number | null;
  setAt: string | null;
  /** Null when this folder's build was never measured here, so the ceiling cannot be judged yet. */
  verdict: BuildBudgetVerdict | null;
}

export interface VerificationReport {
  ranAt: string;
  root: string;
  ok: boolean;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  problems: CheckProblem[];
  results: CheckRunResult[];
  delta?: VerificationDelta | null;
  /** The measured build output, when the folder's own build ran in this pass. */
  build?: BuildWeight | null;
  /** The same number against the project's own ceiling, when it has one. */
  budget?: BuildBudgetVerdict | null;
}

export interface VerificationResponse extends VerificationReport {
  summary: VerificationSummary;
  /** The measured build output, when the folder's own build ran in this pass. */
  build?: BuildWeight | null;
  timeline: WorkspaceChangeset[];
  checkpoints: WorkspaceCheckpoint[];
}

export interface RollbackResponse {
  checkpointId: string;
  checkpointName: string;
  undoneChangesets: number;
  applied: number;
  failed: number;
  results: FileChangeResult[];
  timeline: WorkspaceChangeset[];
  checkpoints: WorkspaceCheckpoint[];
  scan: WorkspaceState;
}

export interface FolderEntry {
  name: string;
  path: string;
}

export interface FolderBrowseResult {
  path: string;
  parent: string | null;
  entries: FolderEntry[];
  roots: FolderEntry[];
}

export interface FileChangeProposal {
  path: string;
  action: 'create' | 'update' | 'delete';
  content: string;
  reason: string;
  exists: boolean;
  oldContent?: string;
  oldTruncated?: boolean;
  warnings: string[];
}

export interface FileChangeResult {
  path: string;
  action: 'create' | 'update' | 'delete';
  status: 'created' | 'updated' | 'deleted' | 'skipped' | 'failed' | 'restored' | 'removed';
  error?: string;
  sizeBytes?: number;
  /** What the file weighed before this write, used to weigh the batch itself. */
  previousBytes?: number;
}

export interface ApplyChangesResult {
  backupId: string;
  root: string;
  results: FileChangeResult[];
  applied: number;
  failed: number;
  /** Present unless the caller turned the tidy-up off; null when it was not attempted. */
  formatting?: FormattingResult | null;
  /** How heavy this batch was, measured against the undo copies and the folder itself. */
  weight?: WriteWeight | null;
  backups: WorkspaceBackup[];
  timeline?: WorkspaceChangeset[];
  checkpoints?: WorkspaceCheckpoint[];
}

export interface GeneratedChanges {
  summary: string;
  warnings: string[];
  changes: FileChangeProposal[];
  root: string;
  engine?: string;
}

/** A repair proposal carries the checks that produced it, so they can be re-run after applying. */
export interface GeneratedFix extends GeneratedChanges {
  verification?: { summary: VerificationSummary; results: Array<{ id: string; status: CheckStatus }> };
  recheckIds?: string[];
}

/**
 * The sandbox: what the connected folder can be started from, and the built document itself.
 * The build happens on the server because only there is the real folder and a bundler available.
 */
export interface PreviewDiagnostic {
  file: string;
  line: number | null;
  column: number | null;
  text: string;
}

export interface PreviewCandidate {
  path: string;
  kind: 'static' | 'bundle';
}

/** One thing that ended up in the bundle: the folder's own file, or a package it pulled in. */
export interface BundleCompositionPart {
  name: string;
  kind: 'local' | 'package';
  bytes: number;
  pct: number;
}

/** What the bundle is made of, from the bundler's own report. */
export interface BundleComposition {
  bytes: number;
  parts: BundleCompositionPart[];
  /** Packages the folder does not have installed: they are fetched, not bundled. */
  externals: string[];
  truncated: boolean;
}

export interface PreviewBuild {
  ok: boolean;
  kind: 'static' | 'bundle' | null;
  entry: string | null;
  html: string | null;
  diagnostics: PreviewDiagnostic[];
  warnings: string[];
  candidates: PreviewCandidate[];
  durationMs: number;
  root: string;
  /** What the bundle is made of. Null when the entry was a page and nothing was bundled. */
  composition?: BundleComposition | null;
  /** Address of the preview origin when the project is served over HTTP. */
  url?: string | null;
  origin?: string;
  port?: number;
  /** True when the project asked for cross-origin isolation (threads, SharedArrayBuffer). */
  isolation?: boolean;
  /** True when a file change reloads the page by itself. */
  liveReload?: boolean;
  /** Where the document came from: a served origin, or the inline fallback. */
  mode?: 'origin' | 'inline';
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return handleResponse<T>(res);
}

export async function buildPreviewApi(params: { entry?: string | null; language?: string } = {}) {
  return jsonRequest<PreviewBuild>('/api/preview/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: params.entry || null, language: params.language || 'ru' })
  });
}

export async function fetchWorkspaceApi(language?: string) {
  return jsonRequest<WorkspaceState>(`/api/files/workspace?language=${language || 'ru'}`);
}

export async function bindWorkspaceApi(params: { path: string; language?: string }) {
  return jsonRequest<WorkspaceState>(`/api/files/bind?language=${params.language || 'ru'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: params.path, language: params.language })
  });
}

export async function unbindWorkspaceApi() {
  return jsonRequest<WorkspaceState>('/api/files/unbind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
}

export interface FolderPickResponse {
  supported: boolean;
  path: string | null;
  cancelled?: boolean;
}

/**
 * Opens the operating system's own folder dialog (Windows Explorer style) on the machine
 * running the app. The request stays open until the dialog is closed.
 */
export async function pickFolderApi(params: { initialPath?: string; title?: string; language?: string }) {
  return jsonRequest<FolderPickResponse>(`/api/files/pick-folder?language=${params.language || 'ru'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
}

export async function browseFoldersApi(dir?: string) {
  const query = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  return jsonRequest<FolderBrowseResult>(`/api/files/browse${query}`);
}

export async function scanWorkspaceApi() {
  return jsonRequest<WorkspaceState>('/api/files/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
}

export async function readWorkspaceFileApi(path: string) {
  return jsonRequest<{ path: string; content: string; truncated: boolean; sizeBytes: number }>(
    `/api/files/file?path=${encodeURIComponent(path)}`
  );
}

export async function writeWorkspaceFileApi(params: { path: string; content: string }) {
  return jsonRequest<FileChangeResult>('/api/files/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
}

export async function generateFileChangesApi(params: {
  taskTitle: string;
  goal?: string;
  instructions?: string;
  acceptanceCriteria?: string[];
  targetFiles?: string[];
  projectName?: string;
  projectType?: string;
  engineOrFramework?: string;
  language?: string;
  brief?: ProjectBrief;
}) {
  return trackAiRequest('edit', async () => {
    const res = await fetch('/api/files/generate-changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<GeneratedChanges>(res);
  });
}

export async function applyFileChangesApi(
  changes: Array<{ path: string; action: string; content?: string }>,
  label?: string,
  options: { format?: boolean } = {}
) {
  const result = await jsonRequest<ApplyChangesResult>('/api/files/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `format` is only sent when it is turned off: the default is to tidy up after writing.
    body: JSON.stringify({ changes, label, ...(options.format === false ? { format: false } : {}) })
  });
  announceWrittenBatch('apply', result);
  return result;
}

export async function undoFileChangesApi(backupId: string) {
  const result = await jsonRequest<ApplyChangesResult>('/api/files/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupId })
  });
  announceWrittenBatch('undo', result);
  return result;
}

/**
 * Tells whoever is listening that the folder changed, so the project's rules can be compared with it
 * again. A batch that wrote nothing is not announced: the folder it describes is the same one.
 */
function announceWrittenBatch(kind: 'apply' | 'undo', result: ApplyChangesResult): void {
  if (!result || result.applied <= 0) return;
  notifyWorkspaceBatchWritten({
    kind,
    applied: result.applied,
    paths: (result.results || []).map((entry) => entry.path)
  });
}

/*
 * The autonomous coding loop — /api/autonomous/start, /stream, /status
 * Local only: one run at a time on the server, its progress read over SSE.
 */

export type AutonomousEventType =
  | 'run_started'
  | 'attempt_started'
  | 'proposal_summary'
  | 'files_written'
  | 'formatting'
  | 'verifying'
  | 'verdict'
  | 'repairing'
  | 'attempt_failed'
  | 'run_completed'
  | 'run_failed';

export interface AutonomousEvent {
  runId: string;
  seq: number;
  type: AutonomousEventType;
  at: string;
  attempt?: number;
  maxAttempts?: number;
  text: string;
  detail?: Record<string, unknown>;
}

export interface AutonomousRunHandle {
  runId: string | null;
  events: AutonomousEvent[];
  /** The terminal event, when the stream has already delivered it. */
  ended: boolean;
}

export async function startAutonomousRunApi(params: {
  taskTitle: string;
  goal?: string;
  acceptanceCriteria?: string[];
  targetFiles?: string[];
  projectName?: string;
  projectType?: string;
  engineOrFramework?: string;
  language?: string;
}): Promise<{ started: boolean; runId: string; maxAttempts: number }> {
  const res = await fetch('/api/autonomous/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  return handleResponse<{ started: boolean; runId: string; maxAttempts: number }>(res);
}

/**
 * Opens the run's SSE stream. The server replays everything that already happened, so a
 * reconnecting watcher picks the run up mid-flight; the promise resolves when the run ends.
 */
export function streamAutonomousRun(
  runId: string,
  onEvent: (event: AutonomousEvent) => void
): { close: () => void; done: Promise<void> } {
  const source = new EventSource(`/api/autonomous/stream?runId=${encodeURIComponent(runId)}`);
  const closed = () => source.close();

  const done = new Promise<void>((resolve) => {
    const onAny = (raw: MessageEvent) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as AutonomousEvent;
        onEvent(event);
        if (event.type === 'run_completed' || event.type === 'run_failed') {
          source.close();
          resolve();
        }
      } catch {
        /* a malformed frame is skipped, the stream itself stays */
      }
    };
    for (const type of [
      'run_started',
      'attempt_started',
      'proposal_summary',
      'files_written',
      'formatting',
      'verifying',
      'verdict',
      'repairing',
      'attempt_failed',
      'run_completed',
      'run_failed'
    ]) {
      source.addEventListener(type, onAny as EventListener);
    }
    source.addEventListener('stream_end', () => {
      source.close();
      resolve();
    });
    source.onerror = () => {
      /* EventSource retries on its own; nothing to do here */
    };
  });

  return { close: closed, done };
}

/*
 * The task pipeline — /api/autonomous/pipeline
 * A queue of plan tasks, run back to back; each verdict lands as a pipeline_task_done event.
 */

export interface PipelineTaskInput {
  id: string;
  title: string;
  goal?: string;
  acceptanceCriteria?: string[];
  targetFiles?: string[];
  dependencies?: string[];
}

export interface PipelineTaskDone {
  taskId: string;
  taskTitle: string;
  result: 'completed' | 'failed';
  done: number;
  total: number;
}

export interface PipelineRunRecord {
  runId: string;
  tasks: Array<PipelineTaskDone & { attempts: number; verdict: 'pass' | 'fail' | 'none' }>;
  stoppedBecause: 'queue_empty' | 'task_failed' | 'no_workspace' | 'no_ai_key';
}

export async function startPipelineApi(params: {
  tasks: PipelineTaskInput[];
  projectName?: string;
  projectType?: string;
  engineOrFramework?: string;
  language?: string;
}): Promise<{ started: boolean; runId: string; queued: number }> {
  const res = await fetch('/api/autonomous/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  return handleResponse<{ started: boolean; runId: string; queued: number }>(res);
}

export async function fetchPipelineResultApi(runId: string): Promise<PipelineRunRecord> {
  const res = await fetch(`/api/autonomous/pipeline/${encodeURIComponent(runId)}`);
  return handleResponse<PipelineRunRecord>(res);
}

/*
 * Git — /api/files/git/status, /git/diff, /git/commit
 * Local only: the app shows what changed in the connected folder and can save one commit
 * of the selected files. It never pushes, fetches or pulls.
 */

export type GitFileState =
  | 'untracked'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'conflicted'
  | 'typechange';

export interface GitFileStatus {
  path: string;
  state: GitFileState;
  code: string;
  staged: boolean;
  untracked: boolean;
  sensitive: boolean;
}

export interface GitStatus {
  available: boolean;
  isRepo: boolean;
  branch: string | null;
  /** The branch this one tracks, when it tracks one. The app never fetches, so it is a prefix. */
  upstream: string | null;
  /** Commits this branch has that its upstream does not, and the other way round. */
  ahead: number | null;
  behind: number | null;
  clean: boolean;
  files: GitFileStatus[];
  identityMissing: boolean;
  message: string | null;
}

/** One local branch, as the branch picker shows it. */
export interface GitBranchInfo {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  tip: string;
}

export interface GitBranches {
  available: boolean;
  isRepo: boolean;
  current: string | null;
  branches: GitBranchInfo[];
  suggestedBase: string | null;
  /** Set when Git is in the middle of a merge, rebase or cherry-pick. */
  operationInProgress: string | null;
  message: string | null;
}

/** What the current branch has that another one does not — the branch's own work. */
export interface GitBranchDiff {
  base: string;
  head: string;
  files: Array<{
    path: string;
    state: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }>;
  additions: number;
  deletions: number;
  patch: string;
  truncated: boolean;
  same: boolean;
}

export interface GitCreateBranch {
  branch: string;
  previous: string | null;
  fromCommit: string;
  /** Uncommitted files that came along, because creating a branch does not touch the worktree. */
  carriedChanges: number;
  branches: GitBranches;
  status: GitStatus;
}

export interface GitDiff {
  path: string;
  diff: string;
  truncated: boolean;
  binary: boolean;
  note: 'sensitive' | 'empty' | null;
}

export interface GitCommit {
  hash: string;
  subject: string;
  committed: string[];
  remaining: string[];
}

export async function fetchGitStatusApi(language?: string) {
  return jsonRequest<GitStatus>(`/api/files/git/status?language=${language || 'ru'}`);
}

export async function fetchGitDiffApi(file: string, language?: string) {
  return jsonRequest<GitDiff>(
    `/api/files/git/diff?file=${encodeURIComponent(file)}&language=${language || 'ru'}`
  );
}

export async function commitGitChangesApi(params: {
  files: string[];
  message: string;
  language?: string;
}) {
  return jsonRequest<GitCommit>('/api/files/git/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: params.files,
      message: params.message,
      language: params.language || 'ru'
    })
  });
}

export async function fetchGitBranchesApi(language?: string) {
  return jsonRequest<GitBranches>(`/api/files/git/branches?language=${language || 'ru'}`);
}

/** Starts a branch where the current one points: no commit moves, no file is switched. */
export async function createGitBranchApi(params: { name: string; language?: string }) {
  return jsonRequest<GitCreateBranch>('/api/files/git/branches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: params.name, language: params.language || 'ru' })
  });
}

/** What the checked-out branch has that `base` does not. Read-only. */
export async function fetchGitBranchDiffApi(base: string, language?: string) {
  return jsonRequest<GitBranchDiff>(
    `/api/files/git/branch-diff?base=${encodeURIComponent(base)}&language=${language || 'ru'}`
  );
}

/*
 * Verification loop — /api/files/checks, /verify, /fix-checks
 * and checkpoints — /api/files/checkpoints, /rollback
 */

export async function fetchChecksApi() {
  return jsonRequest<{ checks: ProjectCheckDefinition[] }>('/api/files/checks');
}

export async function runVerificationApi(params: {
  ids?: string[];
  customCommand?: string;
  changesetId?: string | null;
  language?: string;
}) {
  // Running the project's own commands needs no model, so this is not an "AI is working" wait.
  return jsonRequest<VerificationResponse>(`/api/files/verify?language=${params.language || 'ru'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ids: params.ids,
      customCommand: params.customCommand,
      changesetId: params.changesetId ?? null
    })
  });
}

/**
 * Asks the model to repair exactly what the checks reported. The proposal comes back in the
 * same shape as a normal generation, so it is reviewed and applied the same way.
 */
export async function fixChecksApi(params: {
  verification: VerificationReport;
  /** The over-budget verdict, so a build that is too heavy can be sent back like a failed test. */
  budget?: BuildBudgetVerdict | null;
  taskTitle?: string;
  instructions?: string;
  projectName?: string;
  projectType?: string;
  engineOrFramework?: string;
  language?: string;
  brief?: ProjectBrief;
}) {
  return trackAiRequest('edit', async () => {
    const res = await fetch('/api/files/fix-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return handleResponse<GeneratedFix>(res);
  });
}

/** The ceiling this project has, and what the last measured build makes of it. */
export async function fetchWeightBudgetApi(language?: string) {
  return jsonRequest<WeightBudget>(`/api/files/weight/budget?language=${language || 'ru'}`);
}

/** Writes the ceiling down, or removes it when the value is empty. */
export async function saveWeightBudgetApi(params: { bytes: string; language?: string }) {
  return jsonRequest<WeightBudget>('/api/files/weight/budget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bytes: params.bytes, language: params.language || 'ru' })
  });
}

export async function createCheckpointApi(params: { name: string }) {
  return jsonRequest<{
    checkpoint: WorkspaceCheckpoint;
    checkpoints: WorkspaceCheckpoint[];
    timeline: WorkspaceChangeset[];
  }>('/api/files/checkpoints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
}

export async function deleteCheckpointApi(id: string) {
  return jsonRequest<{ checkpoints: WorkspaceCheckpoint[] }>(
    `/api/files/checkpoints/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
}

export async function rollbackToCheckpointApi(checkpointId: string) {
  return jsonRequest<RollbackResponse>('/api/files/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkpointId })
  });
}
