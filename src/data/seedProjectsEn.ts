import { ProjectState } from '../types';

/**
 * English twins of the demo seed projects in seedProjects.ts.
 * Same ids and structure so switching the UI language never changes behaviour —
 * only the visible text.
 */

export const UNITY_SEED_PROJECT_EN: ProjectState = {
  id: 'proj_unity_survival',
  name: 'Island Survival 3D',
  projectType: 'Unity',
  engineOrFramework: 'Unity 6 (URP)',
  language: 'C#',
  selectedAgent: 'DeepSeek / Web Chat',
  technicalLevel: 'Beginner / Non-coder',
  nextBestAction: 'Assign the missing PlayerStats reference on the PlayerHealth component of Player.prefab.',
  brief: {
    id: 'brief_unity_1',
    projectName: 'Island Survival 3D',
    tagline: 'Explore an uninhabited island, gather wood and stone, manage hunger and health, build a shelter, and defend against wild animals.',
    targetAudience: 'Indie game and survival simulator fans',
    coreProblem: 'Survival game prototypes often suffer from chaotic component wiring and empty inspector references.',
    coreValue: 'A modular survival gameplay loop with clean C# events and a reliable separation of logic.',
    mvpFeatures: [
      'Character movement with the Unity Input System',
      'Health and hunger HUD indicators',
      'Automatic hunger drain over time',
      'Resource gathering (wood, stone)',
      'Basic inventory UI'
    ],
    futureFeatures: [
      'Wild animal AI and pathfinding',
      'Advanced crafting system',
      'Day and night cycle',
      'Co-op multiplayer mode'
    ],
    nonGoals: [
      'No procedural island generation in the MVP',
      'No multiplayer',
      'No microtransactions'
    ],
    technicalConstraints: [
      'Unity 6 (URP) for PC',
      'Unity Input System package',
      'UI isolated through C# events'
    ],
    successCriteria: [
      'The character moves freely around the ForestLevel scene',
      'The hunger bar drains smoothly',
      'Health decreases when hunger reaches zero',
      'Zero NullReferenceException errors in the console'
    ]
  },
  architecture: {
    technologyStack: ['Unity 6.0', 'C#', 'Universal Render Pipeline (URP)', 'Unity Input System 1.7'],
    folderStructure: [
      'Assets/Core/ (GameManager, EventBus)',
      'Assets/Features/Player/ (PlayerController, PlayerHealth, PlayerStats)',
      'Assets/Features/Survival/ (HungerSystem, ResourceCollector)',
      'Assets/UI/HUD/ (SurvivalStatusBar, InventoryUI)',
      'Assets/Scenes/ (ForestLevel.unity)',
      'Assets/Prefabs/ (Player.prefab, TreeResource.prefab)'
    ],
    coreEntities: ['Player', 'PlayerStats', 'PlayerHealth', 'HungerSystem', 'ResourceItem'],
    dataFlow: 'Player input updates movement and stats -> OnStatChanged C# event -> HUD refreshes the bar -> Zero hunger deals damage to health.',
    testingStrategy: 'Unity Test Runner for the stat calculation logic plus HUD binding checks in Play mode.',
    deploymentPlan: 'Standalone 64-bit Windows build.',
    securityRisks: ['Validate local save file serialization']
  },
  projectMap: {
    projectName: 'Island Survival 3D',
    projectType: 'Unity',
    engineOrFramework: 'Unity 6 (URP)',
    language: 'C#',
    version: '6000.0.23f1',
    rulesFiles: ['AGENTS.md', 'CLAUDE.md', '.cursor/rules'],
    files: [
      {
        path: 'Assets/Features/Player/PlayerController.cs',
        type: 'code',
        symbols: ['PlayerController', 'HandleMovement', 'OnJump'],
        imports: ['UnityEngine', 'UnityEngine.InputSystem'],
        description: 'Handles 3D character physics and Unity Input System bindings.'
      },
      {
        path: 'Assets/Features/Player/PlayerHealth.cs',
        type: 'code',
        symbols: ['PlayerHealth', 'TakeDamage', 'Heal', 'currentHealth'],
        imports: ['UnityEngine'],
        relatedFiles: ['Assets/Prefabs/Player.prefab', 'Assets/Features/Player/PlayerStats.cs'],
        description: 'Manages health points, damage events, and the death trigger.'
      },
      {
        path: 'Assets/Features/Player/PlayerStats.cs',
        type: 'code',
        symbols: ['PlayerStats', 'hunger', 'maxHunger', 'OnHungerDepleted'],
        imports: ['UnityEngine'],
        relatedFiles: ['Assets/UI/HUD/SurvivalStatusBar.cs'],
        description: 'Stores hunger, stamina, and temperature values.'
      },
      {
        path: 'Assets/UI/HUD/SurvivalStatusBar.cs',
        type: 'code',
        symbols: ['SurvivalStatusBar', 'UpdateHealthBar', 'UpdateHungerBar'],
        imports: ['UnityEngine', 'UnityEngine.UI'],
        description: 'HUD sliders for health and hunger.'
      },
      {
        path: 'Assets/Prefabs/Player.prefab',
        type: 'prefab',
        symbols: ['Player GameObject', 'PlayerController', 'PlayerHealth', 'PlayerStats'],
        description: 'Main player GameObject with all attached components.'
      },
      {
        path: 'Assets/Scenes/ForestLevel.unity',
        type: 'scene',
        symbols: ['Main Light', 'Terrain', 'Player (Prefab Instance)', 'Canvas'],
        description: 'Main gameplay scene ForestLevel.'
      },
      {
        path: 'Assets/Tests/PlayerSurvivalTests.cs',
        type: 'test',
        symbols: ['TestHungerDepletion', 'TestDamageAtZeroHunger'],
        imports: ['UnityEngine.TestTools', 'NUnit.Framework'],
        description: 'Unit tests for the stat mechanics.'
      }
    ],
    detectedArchitecture: {
      componentsOrScriptsCount: 5,
      hasTests: true,
      hasSaveSystem: false,
      mainEntry: 'Assets/Scenes/ForestLevel.unity'
    }
  },
  phases: [
    {
      id: 'p0',
      phaseNumber: 0,
      title: 'Phase 0 - Foundation',
      purpose: 'Set up the player prefab, URP scene lighting, and character controls.',
      deliverable: 'A playable character moving on the ForestLevel terrain.',
      tasks: [
        {
          id: 't0_1',
          phaseId: 'p0',
          title: 'Set Up Player Prefab & Input System',
          goal: 'Connect the character controller to the Unity Input System.',
          status: 'completed',
          relevantFiles: ['Assets/Features/Player/PlayerController.cs', 'Assets/Prefabs/Player.prefab'],
          acceptanceCriteria: [
            { id: 'ac0_1', description: 'The character moves with the WASD keys', passed: true },
            { id: 'ac0_2', description: 'The camera rotates with mouse movement', passed: true }
          ],
          testRequirements: ['Verify input action bindings'],
          estimatedComplexity: 'Small (1 prompt)',
          dependencies: [],
          progressPercent: 100
        }
      ]
    },
    {
      id: 'p1',
      phaseNumber: 1,
      title: 'Phase 1 - Survival Stats',
      purpose: 'Add the health system, hunger depletion, and the HUD interface.',
      deliverable: 'Hunger depletion system that damages health when empty.',
      tasks: [
        {
          id: 't1_1',
          phaseId: 'p1',
          title: 'Implement Hunger Mechanic & Damage Loop',
          goal: 'Drain hunger over time and damage health when hunger reaches zero.',
          status: 'partial',
          relevantFiles: [
            'Assets/Features/Player/PlayerStats.cs',
            'Assets/Features/Player/PlayerHealth.cs',
            'Assets/UI/HUD/SurvivalStatusBar.cs',
            'Assets/Prefabs/Player.prefab'
          ],
          forbiddenFiles: ['Assets/Legacy/OldHealthSystem.cs'],
          acceptanceCriteria: [
            { id: 'ac1_1', description: 'Hunger decreases every 2 seconds', passed: true },
            { id: 'ac1_2', description: 'The hunger bar in the HUD updates in real time', passed: true },
            { id: 'ac1_3', description: 'Health decreases when hunger reaches zero', passed: false, notes: 'Missing inspector reference' },
            { id: 'ac1_4', description: 'Unit tests added to PlayerSurvivalTests.cs', passed: false }
          ],
          testRequirements: ['Verify that TakeDamage(5) fires at zero hunger'],
          estimatedComplexity: 'Medium (2-3 prompts)',
          dependencies: ['t0_1'],
          progressPercent: 60
        }
      ]
    },
    {
      id: 'p2',
      phaseNumber: 2,
      title: 'Phase 2 - Inventory & Crafting',
      purpose: 'Gather wood and stone and store them in the inventory.',
      deliverable: 'A working inventory grid and a crafting workbench.',
      tasks: [
        {
          id: 't2_1',
          phaseId: 'p2',
          title: 'Resource Gathering & Inventory Grid',
          goal: 'Interact with trees to gather wood and display the result in the UI.',
          status: 'backlog',
          relevantFiles: ['Assets/UI/HUD/InventoryUI.cs'],
          acceptanceCriteria: [
            { id: 'ac2_1', description: 'Gather a resource by pressing the E key', passed: false }
          ],
          testRequirements: ['Verify stacked item counting'],
          estimatedComplexity: 'Medium (2-3 prompts)',
          dependencies: ['t1_1'],
          progressPercent: 0
        }
      ]
    }
  ],
  recentErrors: [
    {
      id: 'err_null_ref_1',
      errorType: 'NullReferenceException',
      location: 'Assets/Features/Player/PlayerHealth.cs, line 42',
      whenOccurs: 'When the hunger value reaches 0 and PlayerHealth calls playerStats.TakeDamage()',
      explanations: {
        verySimple: 'The game is looking for the player stats component, but it was never assigned in the Inspector panel.',
        clear: 'The PlayerHealth script expects a reference to PlayerStats, but the playerStats field is empty (null).',
        technical: 'The playerStats variable in PlayerHealth.cs is not initialized. Calling playerStats.hunger throws a NullReferenceException.'
      },
      likelyCauses: [
        'PlayerHealth.cs declares [SerializeField] private PlayerStats playerStats, but it is not assigned in the Player prefab inspector.',
        'The PlayerStats component was accidentally removed from the Player prefab.'
      ],
      affectedFeatures: ['Hunger damage over time', 'Health bar animation while starving'],
      visualCauseChain: [
        { label: 'Player.prefab prefab', type: 'component', detail: 'Contains the PlayerHealth and PlayerStats scripts' },
        { label: 'PlayerHealth.cs file', type: 'file', detail: 'Line 42: playerStats.TakeDamage()' },
        { label: 'Unassigned field', type: 'issue', detail: 'playerStats = null in the Unity inspector' },
        { label: 'NullReferenceException', type: 'outcome', detail: 'The game halts with an error at zero hunger' }
      ],
      codeDiff: {
        filePath: 'Assets/Features/Player/PlayerHealth.cs',
        oldCode: 'private PlayerStats playerStats; // Unassigned field',
        newCode: '[SerializeField] private PlayerStats playerStats;\n\nvoid Awake() {\n    if (playerStats == null) playerStats = GetComponent<PlayerStats>();\n}',
        highlightReason: 'Automatically resolve the component via GetComponent in Awake'
      },
      repairPrompt: 'Edit Assets/Features/Player/PlayerHealth.cs: if playerStats is null in Awake(), call GetComponent<PlayerStats>() automatically. Make sure the NullReferenceException no longer occurs when hunger damage is applied.',
      verificationSteps: [
        'Open the Assets/Prefabs/Player.prefab prefab in Unity',
        'Select the PlayerHealth script component',
        'Drag the PlayerStats component into the Player Stats field (or rely on the Awake auto-lookup)',
        'Enter Play mode and wait for hunger to drop to 0'
      ],
      confidenceScore: 92
    }
  ],
  rulesFilesContent: {
    agentsMd: `# Instructions for DeepSeek and Web Chats\n- Provide the complete working file code with no omissions\n- Isolate logic through C# events\n- Place scripts under Assets/Features/<FeatureName>/\n- Use the Unity Input System`,
    claudeMd: `# Claude Code Rules\n- Target Unity 6 URP\n- Maintain clean MonoBehaviour event hooks`,
    cursorRules: `# Cursor Rules\n- Check @Assets/Prefabs/Player.prefab references before modifying PlayerHealth.cs`
  }
};

export const REACT_SEED_PROJECT_EN: ProjectState = {
  id: 'proj_react_saas',
  name: 'TaskMaster AI SaaS',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite + Express',
  language: 'TypeScript',
  selectedAgent: 'DeepSeek / Web Chat',
  technicalLevel: 'Vibe-coder',
  nextBestAction: 'Finish the /api/tasks route in server.ts for server-side filtering.',
  brief: {
    id: 'brief_react_1',
    projectName: 'TaskMaster AI SaaS',
    tagline: 'An intelligent task manager with automatic priority sorting and deadline forecasting.',
    targetAudience: 'Individual developers and project managers',
    coreProblem: 'Traditional planners are overloaded with manual routine and tags.',
    coreValue: 'Automatic task categorization and top-3 focus recommendations for the day.',
    mvpFeatures: [
      'Interactive Kanban board',
      'Automatic task tagging',
      'Priority and status filtering',
      'Local data persistence'
    ],
    futureFeatures: ['Calendar synchronization', 'Team workspaces'],
    nonGoals: ['No Gantt charts in the MVP', 'No video calls'],
    technicalConstraints: ['React 19', 'Gemini API calls only through Express'],
    successCriteria: ['Create a task in under 200 ms', 'Auto-generate tags within 1.5 s']
  },
  architecture: {
    technologyStack: ['React 19', 'TypeScript', 'Tailwind CSS', 'Express', 'Vite'],
    folderStructure: [
      'src/components/ (TaskCard.tsx, KanbanBoard.tsx)',
      'src/services/ (api.ts)',
      'src/types/ (index.ts)',
      'server.ts (Express backend)'
    ],
    coreEntities: ['Task', 'Tag', 'UserPreference'],
    dataFlow: 'Client UI -> POST /api/tasks -> Express server -> Auto-tagging -> Task returned to the client.',
    testingStrategy: 'Vitest for component rendering and API unit tests.',
    deploymentPlan: 'Docker container for Cloud Run.',
    securityRisks: ['Keys are stored server-side only, in process.env']
  },
  projectMap: {
    projectName: 'TaskMaster AI SaaS',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite + Express',
    language: 'TypeScript',
    version: '1.0.0',
    rulesFiles: ['AGENTS.md', 'CLAUDE.md'],
    files: [
      {
        path: 'src/App.tsx',
        type: 'code',
        symbols: ['App', 'useTasks'],
        description: 'Main dashboard layout with the Kanban board.'
      },
      {
        path: 'src/components/KanbanBoard.tsx',
        type: 'code',
        symbols: ['KanbanBoard', 'TaskColumn'],
        description: 'Multi-column task board.'
      },
      {
        path: 'src/types/index.ts',
        type: 'code',
        symbols: ['Task', 'TaskStatus', 'TaskPriority'],
        description: 'TypeScript interface definitions.'
      },
      {
        path: 'server.ts',
        type: 'code',
        symbols: ['express', 'POST /api/tasks/auto-tag'],
        description: 'Express server entry point.'
      }
    ]
  },
  phases: [
    {
      id: 'p0',
      phaseNumber: 0,
      title: 'Phase 0 - React & Server Setup',
      purpose: 'Connect the Vite client to the Express server.',
      deliverable: 'A running server with a health check and the base UI.',
      tasks: [
        {
          id: 't0_react',
          phaseId: 'p0',
          title: 'Set Up the Express Server & API Proxy',
          goal: 'Create server.ts with the POST /api/tasks route.',
          status: 'completed',
          relevantFiles: ['server.ts'],
          acceptanceCriteria: [{ id: 'ac1', description: 'GET /api/health returns ok', passed: true }],
          testRequirements: ['Verify with a curl health check'],
          estimatedComplexity: 'Small (1 prompt)',
          dependencies: [],
          progressPercent: 100
        }
      ]
    }
  ],
  recentErrors: [],
  rulesFilesContent: {
    agentsMd: `# Instructions for DeepSeek and Web Chats\n- Provide complete working file code\n- Route all API calls through /api/*\n- Never expose secret keys in the client`,
    claudeMd: `# Claude Rules\n- Use Tailwind utility classes for styling`,
    cursorRules: `# Cursor Rules\n- Prefer functional components with hooks`
  }
};

export const PHASER_SEED_PROJECT_EN: ProjectState = {
  id: 'proj_phaser_beer_simulator',
  name: 'Beer Simulator 2D',
  projectType: 'Phaser.js',
  engineOrFramework: 'Phaser.js 3 (HTML5 Canvas / WebGL)',
  language: 'TypeScript',
  selectedAgent: 'DeepSeek / Web Chat',
  technicalLevel: 'Beginner / Non-coder',
  nextBestAction: 'Implement CapPhysicsCollider in MainScene.ts to handle opener movement.',
  brief: {
    id: 'brief_phaser_1',
    projectName: 'Beer Simulator 2D',
    tagline: 'A playful 2D browser game with vector physics: open the drink, pour the liquid, and keep the foam under control.',
    targetAudience: 'Browser game and indie arcade fans',
    coreProblem: 'Browser game prototypes often drop frames without proper asset preloading.',
    coreValue: 'Smooth 60 fps on HTML5 Canvas, sound effects, and a modular Phaser 3 scene architecture.',
    mvpFeatures: [
      'Interactive opener with drag physics',
      'Cap pop sound and foam particles',
      'Liquid level detector for the glass',
      'Timer and score counter'
    ],
    futureFeatures: ['Drink menu', 'Global leaderboard'],
    nonGoals: ['No complex 3D rendering in the 2D MVP'],
    technicalConstraints: ['Phaser 3.80+ in the browser', 'Asset preloading in BootScene'],
    successCriteria: [
      'The cap flies off smoothly on impact',
      'The liquid fills the glass without overflowing',
      'A stable 60 frames per second'
    ]
  },
  architecture: {
    technologyStack: ['Phaser 3.80', 'TypeScript', 'HTML5 Canvas', 'Vite', 'Web Audio API'],
    folderStructure: [
      'src/scenes/BootScene.ts (Asset preloader)',
      'src/scenes/MainScene.ts (Physics world and bottle)',
      'src/scenes/HUDScene.ts (Score and meter UI)',
      'src/objects/Bottle.ts (Bottle and cap container)',
      'public/assets/ (Sprites and sounds)'
    ],
    coreEntities: ['Bottle', 'Opener', 'LiquidParticle', 'GlassMeter', 'ScoreTracker'],
    dataFlow: 'Drag gesture -> Opener physics body -> Collision with the cap -> Liquid particles -> HUD score update.',
    testingStrategy: 'Physics boundary checks and Phaser scene simulation.',
    deploymentPlan: 'Static Vite web bundle.',
    securityRisks: ['Validate score submissions']
  },
  projectMap: {
    projectName: 'Beer Simulator 2D',
    projectType: 'Phaser.js',
    engineOrFramework: 'Phaser.js 3 (HTML5 Canvas / WebGL)',
    language: 'TypeScript',
    version: '3.80.0',
    rulesFiles: ['AGENTS.md', 'CLAUDE.md'],
    files: [
      {
        path: 'src/scenes/MainScene.ts',
        type: 'code',
        symbols: ['MainScene', 'create', 'update', 'handleOpenerDrag'],
        imports: ['phaser'],
        description: 'Main gameplay scene: physics bodies, collisions, and score tracking.'
      },
      {
        path: 'src/objects/Bottle.ts',
        type: 'code',
        symbols: ['Bottle', 'popCap', 'pourLiquid'],
        imports: ['phaser'],
        description: 'Bottle game object, cap attachment, and the liquid emitter.'
      },
      {
        path: 'src/scenes/HUDScene.ts',
        type: 'code',
        symbols: ['HUDScene', 'updatePourMeter', 'showScore'],
        imports: ['phaser'],
        description: 'Overlay UI with the pour meter and a restart button.'
      }
    ]
  },
  phases: [
    {
      id: 'p0_phaser',
      phaseNumber: 0,
      title: 'Phase 0 - Phaser Scenes & Physics Setup',
      purpose: 'Configure the Phaser 3 game, the BootScene loader, and the canvas area.',
      deliverable: 'A running HTML5 Canvas with preloaded sprites.',
      tasks: [
        {
          id: 't0_phaser_1',
          phaseId: 'p0_phaser',
          title: 'Create the Phaser Instance and BootScene',
          goal: 'Initialize Phaser 3 with Arcade Physics and a loading screen.',
          status: 'completed',
          relevantFiles: ['src/scenes/BootScene.ts', 'src/scenes/MainScene.ts'],
          acceptanceCriteria: [
            { id: 'ac_p1', description: 'The Phaser canvas renders at 60 fps', passed: true },
            { id: 'ac_p2', description: 'BootScene transitions to MainScene after loading', passed: true }
          ],
          testRequirements: ['Verify canvas mounting'],
          estimatedComplexity: 'Small (1 prompt)',
          dependencies: [],
          progressPercent: 100
        }
      ]
    },
    {
      id: 'p1_phaser',
      phaseNumber: 1,
      title: 'Phase 1 - Opener Physics & Pouring',
      purpose: 'Opener control, cap collision, and liquid particles.',
      deliverable: 'A gameplay loop for opening the drink and filling the glass.',
      tasks: [
        {
          id: 't1_phaser_1',
          phaseId: 'p1_phaser',
          title: 'Create the Drag Gesture and Collision',
          goal: 'Let the player drag the opener, pop the cap, and start the stream.',
          status: 'ready',
          relevantFiles: ['src/scenes/MainScene.ts', 'src/objects/Bottle.ts'],
          acceptanceCriteria: [
            { id: 'ac_p3', description: 'The opener follows the cursor with physics damping', passed: false },
            { id: 'ac_p4', description: 'A collision with the cap sends it flying upward', passed: false },
            { id: 'ac_p5', description: 'Tilting the bottle emits liquid particles into the glass', passed: false }
          ],
          testRequirements: ['Verify the collision callback'],
          estimatedComplexity: 'Medium (2-3 prompts)',
          dependencies: ['t0_phaser_1'],
          progressPercent: 0
        }
      ]
    }
  ],
  recentErrors: [],
  rulesFilesContent: {
    agentsMd: `# Instructions for DeepSeek and Web Chats\n- Provide complete working code\n- Use scene lifecycle methods (preload, create, update)\n- Preload assets in BootScene`,
    claudeMd: `# Claude Rules for Phaser\n- Avoid direct DOM manipulation inside the Phaser render loop`,
    cursorRules: `# Cursor Rules\n- Ensure Phaser.GameConfig scale mode is set to FIT`
  }
};

export const GODOT_SEED_PROJECT_EN: ProjectState = {
  id: 'proj_godot_action',
  name: 'Pixel Knight 2D',
  projectType: 'Godot',
  engineOrFramework: 'Godot 4.3 (GDScript)',
  language: 'GDScript',
  selectedAgent: 'DeepSeek / Web Chat',
  technicalLevel: 'Vibe-coder',
  nextBestAction: 'Connect the CharacterBody2D signals in Player.gd to AnimatedSprite2D.',
  brief: {
    id: 'brief_godot_1',
    projectName: 'Pixel Knight 2D',
    tagline: 'A fast-paced 2D action platformer built on Godot 4 nodes with CharacterBody2D physics and TileMap layers.',
    targetAudience: 'Indie game developers and retro platformer fans',
    coreProblem: 'GDScript node signals break when paths are hardcoded without @export references.',
    coreValue: 'A modular node hierarchy with typed exports and an isolated state machine.',
    mvpFeatures: [
      'CharacterBody2D movement, jumping, and wall sliding',
      'Level collisions via TileMapLayer',
      'Enemy patrol AI and a damage system',
      'HUD with health and coins'
    ],
    futureFeatures: ['Boss battle scene', 'Gamepad support'],
    nonGoals: ['No 3D lighting in the 2D MVP'],
    technicalConstraints: ['Godot 4.3+ engine', 'Strict static typing in GDScript'],
    successCriteria: ['Smooth 60 fps movement', 'Zero runtime errors in the console']
  },
  architecture: {
    technologyStack: ['Godot 4.3', 'GDScript', 'CharacterBody2D', 'TileMapLayer'],
    folderStructure: [
      'scenes/player/Player.tscn',
      'scenes/levels/Level01.tscn',
      'scripts/player/Player.gd',
      'scripts/enemies/PatrolEnemy.gd',
      'assets/sprites/'
    ],
    coreEntities: ['Player', 'PatrolEnemy', 'Coin', 'HUD'],
    dataFlow: 'Player input -> CharacterBody2D velocity calculation -> move_and_slide() -> Area2D signal updates the HUD.',
    testingStrategy: 'Unit testing of player stats with GUT.',
    deploymentPlan: 'Export to Web (HTML5 / WebAssembly) or desktop.',
    securityRisks: []
  },
  projectMap: {
    projectName: 'Pixel Knight 2D',
    projectType: 'Godot',
    engineOrFramework: 'Godot 4.3 (GDScript)',
    language: 'GDScript',
    version: '4.3.0',
    rulesFiles: ['AGENTS.md', 'CLAUDE.md'],
    files: [
      {
        path: 'scripts/player/Player.gd',
        type: 'code',
        symbols: ['Player', '_physics_process', '_handle_jump'],
        description: 'GDScript handling 2D movement, gravity, and jumping.'
      },
      {
        path: 'scenes/player/Player.tscn',
        type: 'scene',
        symbols: ['CharacterBody2D', 'AnimatedSprite2D', 'CollisionShape2D'],
        description: 'Player scene tree with the physics body, collision shape, and animation.'
      }
    ]
  },
  phases: [
    {
      id: 'p0_godot',
      phaseNumber: 0,
      title: 'Phase 0 - Godot Nodes Setup',
      purpose: 'Create the player scene and the input map.',
      deliverable: 'A controllable character moving across the TileMap.',
      tasks: [
        {
          id: 't0_godot_1',
          phaseId: 'p0_godot',
          title: 'Set Up CharacterBody2D and the Input Map',
          goal: 'Configure the move_and_slide() call in Player.gd.',
          status: 'completed',
          relevantFiles: ['scripts/player/Player.gd', 'scenes/player/Player.tscn'],
          acceptanceCriteria: [{ id: 'ac_g1', description: 'The character moves left and right and can jump', passed: true }],
          testRequirements: ['Test character movement'],
          estimatedComplexity: 'Small (1 prompt)',
          dependencies: [],
          progressPercent: 100
        }
      ]
    }
  ],
  recentErrors: [],
  rulesFilesContent: {
    agentsMd: `# Instructions for DeepSeek and Web Chats\n- Provide complete working code\n- Use typed GDScript\n- Prefer @onready and @export references over get_node()`,
    claudeMd: `# Claude Godot Rules\n- Target Godot 4.3 compatibility`,
    cursorRules: `# Cursor Rules\n- Ensure signal connections are declared in GDScript or the editor`
  }
};
