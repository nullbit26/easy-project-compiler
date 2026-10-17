import type { RuleAuditResult } from '../utils/rulesAudit';
import type { RulesCheckStamp } from '../utils/rulesCheckStamp';

export type ProjectType =
  | 'Unity'
  | 'Phaser.js'
  | 'Godot'
  | 'Three.js'
  | 'Unreal Engine'
  | 'PlayCanvas'
  | 'PixiJS'
  | 'React'
  | 'Next.js'
  | 'Node.js'
  | 'Python'
  | 'Flutter'
  | 'Generic';

export type AgentType = 
  | 'Cursor'
  | 'Claude Code'
  | 'Windsurf'
  | 'GitHub Copilot'
  | 'Cline'
  | 'Roo Code'
  | 'Replit'
  | 'Lovable'
  | 'Bolt'
  | 'ChatGPT / API'
  | 'DeepSeek / Web Chat';

export type TechnicalLevel = 'Beginner / Non-coder' | 'Vibe-coder' | 'Intermediate' | 'Advanced';

/**
 * The interface part of the working mode: which screens a project gets. "guided" is the four-step
 * helper with the technical sections hidden away, "full" is the whole workspace.
 */
export type InterfaceMode = 'guided' | 'full';

/**
 * The autonomy part: how much the agent does by itself and how much the user has to read. It is the
 * value every AI request carries, and the only thing that decides how a result is worded.
 */
export type AutonomyLevel = TechnicalLevel;

export type ContextMode = 'Minimal' | 'Balanced' | 'Full';

export type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'review' | 'partial' | 'blocked' | 'completed';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

/** How much of a file is actually written, judged from its real text. */
export type FileImplementation = 'implemented' | 'partial' | 'stub' | 'empty';

/** What a single file of the project already contains — read from the file itself, no AI. */
export interface FileFacts {
  path: string;
  symbols: string[];
  imports: string[];
  codeLines: number;
  totalLines: number;
  status: FileImplementation;
  isEntryPoint: boolean;
  isTest: boolean;
}

/** The picture of an existing project built from its own files. */
export interface WorkspaceFacts {
  files: FileFacts[];
  analyzedFiles: number;
  scannedFiles: number;
  detectedArchitecture: {
    mainEntry: string;
    componentsOrScriptsCount: number;
    hasTests: boolean;
    implementedFiles: number;
    stubFiles: number;
    emptyFiles: number;
  };
}

/**
 * The optional second layer: an AI reading of the same files, saying in words what is already
 * implemented in each of them. Always layered on top of `FileFacts`, never instead of it.
 */
export interface FileInsights {
  generatedAt: string;
  engine?: string;
  overall: string;
  files: { path: string; status?: FileImplementation; implemented: string[] }[];
  nextSteps: string[];
}

export interface ProjectFile {
  path: string;
  type: 'code' | 'scene' | 'prefab' | 'config' | 'test' | 'rule' | 'asset' | 'json';
  symbols?: string[];
  imports?: string[];
  exports?: string[];
  relatedFiles?: string[];
  description?: string;
  sizeBytes?: number;
  contentSnippet?: string;
  content?: string;
  /** Filled from the real file text, so the map can say what is already written. */
  status?: FileImplementation;
  codeLines?: number;
}

export interface ProjectMap {
  projectName: string;
  projectType: ProjectType;
  engineOrFramework: string;
  language: string;
  version?: string;
  rulesFiles: string[];
  files: ProjectFile[];
  detectedArchitecture?: {
    componentsOrScriptsCount: number;
    hasTests: boolean;
    hasSaveSystem?: boolean;
    mainEntry: string;
    /** Only present when the files were actually read and analysed. */
    fileCount?: number;
    implementedFiles?: number;
    stubFiles?: number;
    emptyFiles?: number;
  };
  /** The AI reading of the files, when the user asked for it. */
  insights?: FileInsights;
}

export interface ProjectBrief {
  id: string;
  projectName: string;
  tagline: string;
  targetAudience: string;
  coreProblem: string;
  coreValue: string;
  mvpFeatures: string[];
  futureFeatures: string[];
  nonGoals: string[];
  technicalConstraints: string[];
  successCriteria: string[];
}

export interface ArchitectureProposal {
  technologyStack: string[];
  folderStructure: string[];
  coreEntities: string[];
  dataFlow: string;
  apiEndpointsOrRoutes?: string[];
  testingStrategy: string;
  deploymentPlan: string;
  securityRisks: string[];
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  passed?: boolean;
  notes?: string;
}

export interface ProjectTask {
  id: string;
  phaseId: string;
  title: string;
  goal: string;
  status: TaskStatus;
  relevantFiles: string[];
  forbiddenFiles?: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  testRequirements: string[];
  estimatedComplexity:
    | 'Small (1 prompt)'
    | 'Medium (2-3 prompts)'
    | 'Large (Needs splitting)'
    | 'Малая (1 промпт)'
    | 'Средняя (2-3 промпта)'
    | 'Крупная (Требует декомпозиции)';
  dependencies: string[];
  progressPercent: number;
  reviewHistory?: ReviewAttempt[];
  /**
   * Where the card sits on the infinite board. Absent until someone drags it, and absent is
   * meaningful: a task without a position is laid out by the board instead of at 0:0.
   */
  canvasPosition?: { x: number; y: number };
}

export interface ProjectPhase {
  id: string;
  phaseNumber: number;
  title: string;
  purpose: string;
  deliverable: string;
  tasks: ProjectTask[];
}

/**
 * The colours a lane can be given. A named set rather than a free colour picker: every one of these
 * is already part of the board's palette, so a recoloured lane still reads as part of the app, and
 * the darkness of the board is not something the user has to get right themselves.
 */
export type LaneColor = 'slate' | 'indigo' | 'purple' | 'emerald' | 'amber' | 'rose' | 'cyan';

/**
 * What the user changed about one status lane on the board: where it sits, what it is called, and
 * how it is drawn. Every field is optional, and an absent field means "what the board would have
 * done anyway" — so the lanes of a project nobody has touched carry none of this at all.
 */
export interface CanvasLaneSkin {
  /** How far the lane was dragged from where the board lays it out, in world units. */
  offsetX?: number;
  offsetY?: number;
  /**
   * The size the user stretched the zone to, in world units. Both are the user's own numbers rather
   * than a size the board derives, which is what makes a stretched zone stay stretched when the plan
   * grows: the cards inside it are laid out by the board, the plate around them is the author's.
   */
  width?: number;
  height?: number;
  /** The name the user gave it. Absent means the lane's own name from the interface language. */
  label?: string;
  color?: LaneColor;
}

/**
 * The rules check as the compiled prompt carries it: what the project's agent rules say against the
 * folder that actually exists. `audit` is exactly what the rules panel runs — one checker, so the
 * prompt and the panel can never tell the user two different things.
 */
export interface RulesCheckSummary {
  audit: RuleAuditResult;
  facts: { files: number; scripts: string[] | null; connected: boolean };
  /** When this particular check ran, so the prompt and the screen can date the facts in them. */
  checkedAt: string;
}

export interface CompiledPrompt {
  id: string;
  taskId: string;
  agent: AgentType;
  projectType: ProjectType;
  engineOrFramework: string;
  language: string;
  taskTitle: string;
  confidence: number;
  includedFiles: { path: string; reason: string; tokensEstimate: number }[];
  excludedFiles: { path: string; reason: string }[];
  missingContext: string[];
  architectureWarnings: string[];
  promptText: string;
  acceptanceCriteria: string[];
  tests: string[];
  estimatedTokens: number;
  nextBestAction: string;
  securityWarnings: string[];
  contextMode: ContextMode;
  createdAt: string;
  /** What the prompt was told about the project's rules, when they were checked. */
  rulesCheck?: RulesCheckSummary;
}

export interface SessionReview {
  id: string;
  taskId: string;
  status: 'Completed' | 'Partially Completed' | 'Blocked' | 'Failed';
  progressPercent: number;
  completedCriteria: string[];
  missingCriteria: string[];
  warnings: string[];
  unintendedChanges: string[];
  nextBestAction: string;
  agentOutputSummary: string;
  continuationPrompt?: string;
}

export interface ReviewAttempt {
  id: string;
  attemptNumber: number;
  timestamp: string;
  agentOutput: string;
  review: SessionReview;
}

export interface CauseChainNode {
  label: string;
  type: 'component' | 'file' | 'issue' | 'outcome';
  detail: string;
}

export interface ErrorDiagnosis {
  id: string;
  errorType: string;
  location: string;
  whenOccurs: string;
  explanations: {
    verySimple: string;
    clear: string;
    technical: string;
  };
  likelyCauses: string[];
  affectedFeatures: string[];
  visualCauseChain: CauseChainNode[];
  codeDiff?: {
    filePath: string;
    oldCode: string;
    newCode: string;
    highlightReason: string;
  };
  repairPrompt: string;
  verificationSteps: string[];
  confidenceScore: number;
  missingContextNeeded?: string[];
}

export interface ProjectState {
  id: string;
  name: string;
  projectType: ProjectType;
  engineOrFramework: string;
  language: string;
  selectedAgent: AgentType;
  /** The preset picked when the project was created: it seeds both parts below. */
  technicalLevel: TechnicalLevel;
  /**
   * Interface part. Absent means "whatever the preset says", which is how projects saved before the
   * split keep working.
   */
  interfaceMode?: InterfaceMode;
  /**
   * True only when the user picked the interface themselves. A preset writes its own interface into
   * the project too, and the two have to be told apart: otherwise the value a preset left behind
   * would count as a choice forever and changing the preset's default would reach nobody.
   */
  interfaceModeChosen?: boolean;
  /**
   * Autonomy part. Absent means "whatever the preset says", and it is what is sent as `skillLevel`,
   * so the two parts can be changed independently without touching the quality demands.
   */
  autonomyLevel?: AutonomyLevel;
  brief?: ProjectBrief;
  architecture?: ArchitectureProposal;
  phases: ProjectPhase[];
  projectMap: ProjectMap;
  /** Real folder on disk this project is connected to ("Project Files" screen). */
  workspaceRoot?: string;
  activeTaskId?: string;
  recentErrors: ErrorDiagnosis[];
  nextBestAction: string;
  rulesFilesContent: {
    agentsMd: string;
    claudeMd: string;
    cursorRules: string;
  };
  /**
   * When the rules were last compared with the connected folder and what that found. Written by the
   * check that runs after every accepted batch of changes, and by the button on the rules panel;
   * absent until one of those really happened.
   */
  lastRulesCheck?: RulesCheckStamp;
  /**
   * The board's lanes as the user arranged them: name, colour, and how far each was dragged from
   * where the board would put it. Keyed by lane (`ready`, `active`, `blocked`, `done`), and absent
   * for every lane nobody has touched.
   */
  canvasLanes?: Record<string, CanvasLaneSkin>;
}
