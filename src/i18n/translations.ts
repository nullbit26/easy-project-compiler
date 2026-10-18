export type Language = 'ru' | 'en';

export interface Translations {
  common: {
    brandTitle: string;
    brandSubtitle: string;
    newProject: string;
    createProject: string;
    save: string;
    saved: string;
    cancel: string;
    delete: string;
    close: string;
    copy: string;
    copied: string;
    /** Shown where a button tried to copy and the window would not let it. */
    copyFailed: string;
    export: string;
    apply: string;
    applied: string;
    edit: string;
    back: string;
    next: string;
    run: string;
    running: string;
    loading: string;
    error: string;
    success: string;
    warning: string;
    noProjectSelected: string;
    noProjectSubtext: string;
    projectsCount: string;
    version: string;
    workspace: string;
    /**
     * The three groups the workspace list is split into. Ten sections in one flat list gave the
     * reader no clue which of them belong together — the four steps of the AI loop sat between a
     * dashboard and a file browser as if they were the same kind of thing.
     */
    groupStart: string;
    groupLoop: string;
    groupProject: string;
    targetAgent: string;
    mode: string;
    language: string;
    status: string;
    errorBoundaryTitle: string;
    errorBoundaryHint: string;
    errorBoundaryRetry: string;
    aiWorkingTitle: string;
    aiTaskIdea: string;
    aiTaskQuestions: string;
    aiTaskProject: string;
    aiTaskMap: string;
    aiTaskPlan: string;
    aiTaskCompile: string;
    aiTaskReview: string;
    aiTaskDiagnose: string;
    aiTaskEdit: string;
    aiWorkingHint: string;
    aiWorkingSlowHint: string;
    aiWorkingDone: string;
    aiWorkingFailed: string;
    aiSecondsShort: string;
  };
  tabs: {
    dashboard: string;
    compiler: string;
    review: string;
    preview: string;
    coach: string;
    plan: string;
    map: string;
    brief: string;
    apiSettings: string;
  };
  /**
   * The one journey every screen is a step of. The helper spells each step out on its own screen;
   * the workspace loop shows the last two in depth. Both read their number from here, so switching
   * interfaces carries on from where the reader was instead of starting the count again.
   */
  journey: {
    stepWord: string;
    folder: string;
    task: string;
    prompt: string;
    check: string;
  };
  simple: {
    navLabel: string;
    title: string;
    subtitle: string;
    showAllPanels: string;
    hideExtraPanels: string;
    back: string;
    next: string;
    folderTitle: string;
    folderHelp: string;
    folderConnected: string;
    noFolderHint: string;
    createProjectWithFolder: string;
    refreshFiles: string;
    savedFolderHint: string;
    connectSavedFolder: string;
    filesCountLabel: string;
    taskTitle: string;
    taskHelp: string;
    otherTask: string;
    otherTaskPlaceholder: string;
    compileButton: string;
    promptTitle: string;
    promptHelp: string;
    agentLabel: string;
    copyPrompt: string;
    promptCopied: string;
    readyButton: string;
    answerTitle: string;
    answerHelp: string;
    answerPlaceholder: string;
    checkButton: string;
    checking: string;
    verdictReady: string;
    verdictPartial: string;
    verdictFailed: string;
    filesDetected: string;
    writeFiles: string;
    writtenFiles: string;
    undoWrite: string;
    undone: string;
    markDone: string;
    missingTitle: string;
    nextActionTitle: string;
    continuationTitle: string;
    copyContinuation: string;
    continuationCopied: string;
    attemptLabel: string;
    restartPrompt: string;
    errorHelpTitle: string;
    errorHelpPlaceholder: string;
    explainError: string;
    explaining: string;
    simpleExplanation: string;
    repairStepsTitle: string;
    copyFix: string;
    noProject: string;
    noProjectHelp: string;
    createProject: string;
  };
  technicalLevels: {
    beginner: string;
    vibecoder: string;
    intermediate: string;
    advanced: string;
  };
  mode: {
    interfaceLabel: string;
    interfaceGuided: string;
    interfaceFull: string;
    interfaceGuidedHint: string;
    interfaceFullHint: string;
    autonomyLabel: string;
    /** What each AI autonomy level means, as the option label in a picker. */
    autonomyLevels: {
      beginner: string;
      vibecoder: string;
      intermediate: string;
      advanced: string;
    };
    /** The same levels spelled out — shown on hover, never as body text. */
    autonomyHints: {
      beginner: string;
      vibecoder: string;
      intermediate: string;
      advanced: string;
    };
  };
  contextModes: {
    minimal: string;
    balanced: string;
    full: string;
    minimalDesc: string;
    balancedDesc: string;
    fullDesc: string;
  };
  taskStatuses: {
    ready: string;
    in_progress: string;
    partial: string;
    review: string;
    completed: string;
    blocked: string;
  };
  navbar: {
    toggleMenu: string;
  };
  dashboard: {
    welcomeTitle: string;
    welcomeSubtitle: string;
    emptySubtitle: string;
    presetTemplatesTitle: string;
    presetTemplatesSubtitle: string;
    selectTemplate: string;
    featuresTitle: string;
    feature1Title: string;
    feature1Desc: string;
    feature2Title: string;
    feature2Desc: string;
    feature3Title: string;
    feature3Desc: string;
    feature4Title: string;
    feature4Desc: string;
    mvpCompletion: string;
    tasksFinished: string;
    nextAction: string;
    compilePromptNow: string;
    metricsCompleted: string;
    metricsCompletedSub: string;
    metricsInProgress: string;
    metricsInProgressSub: string;
    metricsBlocked: string;
    metricsBlockedSub: string;
    metricsErrors: string;
    metricsErrorsSub: string;
    phasesTitle: string;
    viewKanban: string;
    deliverable: string;
  };
  compiler: {
    goToReview: string;
    reviewPastedCode: string;
    panel1Title: string;
    taskPlaceholder: string;
    chooseTaskFromPlan: string;
    panel2Title: string;
    verifiedFileIndex: string;
    autoChosen: string;
    customizeContext: string;
    hideContextSetup: string;
    recompilePrompt: string;
    startCompile: string;
    startHint: string;
    outdatedNotice: string;
    emptyTaskNotice: string;
    compilingPrompt: string;
    rulesCheckTitle: string;
    rulesCheckSubtext: string;
    rulesCheckClean: string;
    rulesCheckNoFolder: string;
    rulesCheckCheckedAt: string;
    compiledOutputTitle: string;
    safetyGuard: string;
    compilingNotice: string;
    panel4Title: string;
    panel4Subtext: string;
    simulatedResultPlaceholder: string;
  };
  review: {
    selectTaskToReview: string;
    pasteAgentOutputLabel: string;
    pasteAgentPlaceholder: string;
    runReviewButton: string;
    reviewing: string;
    filesDetectedTitle: string;
    applyFilesButton: string;
    filesApplied: string;
    verdictTitle: string;
    criteriaTitle: string;
    testRequirementsTitle: string;
    continuationPromptTitle: string;
    copyContinuation: string;
    openInCompiler: string;
    openPreview: string;
    markCompleted: string;
    markCompletedAndNext: string;
    attemptHistoryTitle: string;
    /** One pass of the AI loop — compile, run, check. Never called a "step": the steps are the two
     *  screens of the loop, and one word for both is what made the screen read ambiguously. */
    attempt: string;
    /** The label over a percentage that belongs to this verdict, not to the task's saved progress. */
    measuredProgress: string;
    showPrompt: string;
    hidePrompt: string;
    copyPrompt: string;
    initialPromptTitle: string;
    initialPromptHint: string;
    verdictPass: string;
    verdictPartial: string;
    verdictFail: string;
  };
  coach: {
    errorInputLabel: string;
    errorInputPlaceholder: string;
    explanationLevelLabel: string;
    levelVerySimple: string;
    levelClear: string;
    levelTechnical: string;
    diagnoseButton: string;
    diagnosing: string;
    presetsLabel: string;
    rootCauseTitle: string;
    mentalModelTitle: string;
    suggestedFixTitle: string;
    applyFixButton: string;
    sendFixToCompilerButton: string;
  };
  preview: {
    runCode: string;
    resetCode: string;
    fullscreen: string;
    sendToCoach: string;
    sourceCode: string;
    copyCode: string;
    emptyCodeNotice: string;
    /** The connected folder is the default subject of this screen; a pasted file is the fallback. */
    modeProject: string;
    modeSnippet: string;
    entryLabel: string;
    entryHint: string;
    kindStatic: string;
    kindBundle: string;
    building: string;
    builtIn: string;
    buildFailed: string;
    diagnosticsTitle: string;
    explainWithAi: string;
    /** What the bundle is made of, module by module — the half of "how heavy" that names a cause. */
    compositionTitle: string;
    compositionHint: string;
    compositionTruncated: string;
    compositionExternals: string;
    compositionPackage: string;
    compositionFile: string;
    warningsTitle: string;
    noFolder: string;
    noFolderHint: string;
    snippetHint: string;
    consoleTitle: string;
    consoleEmpty: string;
    clear: string;
    jsErrorTitle: string;
  };
  plan: {
    allPhases: string;
    phase: string;
    addTaskButton: string;
    adaptPlanButton: string;
    compilePrompt: string;
    tasksCount: string;
    addTaskModalTitle: string;
    taskTitleLabel: string;
    taskGoalLabel: string;
    createTaskButton: string;
    adaptModalTitle: string;
    adaptModalPlaceholder: string;
    adaptSubmitButton: string;
    canvasTitle: string;
    viewCanvas: string;
    viewKanban: string;
    arrange: string;
    arrangeHint: string;
    zoomIn: string;
    zoomOut: string;
    resetZoom: string;
    fitView: string;
    minimapTitle: string;
    minimapHint: string;
    laneReady: string;
    laneActive: string;
    laneBlocked: string;
    laneDone: string;
    phaseOf: string;
    emptyLane: string;
    linksShow: string;
    linksLegendTitle: string;
    linkReady: string;
    linkWaiting: string;
    linkBlocked: string;
    linkDone: string;
    waitsBadge: string;
    linksMissing: string;
    laneMenuRename: string;
    laneMenuColor: string;
    laneMenuReset: string;
    laneRenamePlaceholder: string;
    /** The strip at the top of a zone, and the only place a zone can be dragged from. */
    laneHandle: string;
    laneResize: string;
    cardMenuRename: string;
    cardRenamePlaceholder: string;
    colorSlate: string;
    colorIndigo: string;
    colorPurple: string;
    colorEmerald: string;
    colorAmber: string;
    colorRose: string;
    colorCyan: string;
  };
  map: {
    projectFilesTitle: string;
    rulesFilesTitle: string;
    copyRulesButton: string;
    rulesWriteButton: string;
    rulesNoFolder: string;
    rulesConfirmTitle: string;
    rulesCreate: string;
    rulesReplace: string;
    rulesReplaceNote: string;
    rulesWriteConfirm: string;
    rulesWriting: string;
    rulesWriteFailed: string;
    rulesWritten: string;
    rulesStatusCreated: string;
    rulesStatusUpdated: string;
    rulesStatusSkipped: string;
    rulesFormatted: string;
    rulesUndo: string;
    rulesUndoing: string;
    rulesUndone: string;
    rulesUndoFailed: string;
    rulesDone: string;
    rulesAuditTitle: string;
    rulesAuditSubtext: string;
    rulesLastCheck: string;
    rulesLastCheckNever: string;
    rulesStaleAfterWrite: string;
    rulesStaleAfterWriteHint: string;
    rulesAuditRecheck: string;
    rulesAuditChecking: string;
    rulesAuditClean: string;
    rulesAuditProblems: string;
    rulesAuditNotes: string;
    rulesAuditProblemTag: string;
    rulesAuditNoteTag: string;
    rulesAuditNoFolder: string;
    rulesAuditNoPackageJson: string;
    rulesAuditFix: string;
    rulesAuditFixHint: string;
    rulesAuditFixed: string;
    rulesAuditRemovedDuplicates: string;
    rulesAuditRemovedReferences: string;
    rulesAuditAddedFrontmatter: string;
    rulesAuditSaved: string;
    rulesAuditFailed: string;
    rulesAuditLine: string;
    rulesAuditAlso: string;
    rulesAuditKindDuplicateLine: string;
    rulesAuditKindDuplicateAcrossFiles: string;
    rulesAuditKindContradiction: string;
    rulesAuditKindMissingFile: string;
    rulesAuditKindMissingCommand: string;
    rulesAuditKindMissingFrontmatter: string;
    rulesAuditKindInactiveFrontmatter: string;
    rulesAuditKindEmptyDocument: string;
    filesCount: string;
    fileMetadataTitle: string;
    symbolsTitle: string;
    rulesTitle: string;
    factsTitle: string;
    factsSubtext: string;
    statusImplemented: string;
    statusPartial: string;
    statusStub: string;
    statusEmpty: string;
    mainEntryLabel: string;
    scriptsWithCode: string;
    testsPresent: string;
    testsMissing: string;
    analyzedFilesLabel: string;
    describeButton: string;
    describingButton: string;
    describeFailed: string;
    insightsTitle: string;
    insightsEngine: string;
    insightsNextSteps: string;
    fileInsightTitle: string;
    fileInsightEmpty: string;
    importsTitle: string;
    codeLinesLabel: string;
  };
  brief: {
    overviewTitle: string;
    mvpScopeTitle: string;
    nonGoalsTitle: string;
    constraintsTitle: string;
    architectureTitle: string;
    dataFlowTitle: string;
    coreProblem: string;
    coreValue: string;
    mvpFeaturesTitle: string;
    techStack: string;
    folderStructure: string;
    dataFlow: string;
    successCriteria: string;
  };
  savedDrawer: {
    title: string;
    subtitle: string;
    emptyNotice: string;
    currentBadge: string;
    openProject: string;
  };
  drawer: {
    title: string;
    subtitle: string;
    emptyTitle: string;
    emptyNotice: string;
    currentBadge: string;
    openProject: string;
    /** Tooltip of the trash button on a project row. */
    deleteHint: string;
    /** Nothing is deleted until these two have been on screen. */
    deleteConfirmTitle: string;
    deleteConfirmNotice: string;
  };
  setup: {
    modalTitle: string;
    tabIdea: string;
    tabImport: string;
    projectNameLabel: string;
    projectNamePlaceholder: string;
    ideaLabel: string;
    ideaPlaceholder: string;
    platformLabel: string;
    stackLabel: string;
    agentLabel: string;
    techLevelLabel: string;
    autoSelectToggle: string;
    createButton: string;
    analyzing: string;
    presetStacksTitle: string;
    step1Title: string;
    step2Title: string;
    questionsTitle: string;
    backButton: string;
    confirmCreateButton: string;
    importNotice: string;
    folderLabel: string;
    folderHelp: string;
    folderChoose: string;
    folderPlaceholder: string;
    folderConnect: string;
    folderConnected: string;
    folderNotConnectedHint: string;
    folderFiles: string;
    folderChange: string;
    folderKeepConnected: string;
    engineLabel: string;
    enginePlaceholder: string;
    ideaRequiredHint: string;
    startRequiresEngine: string;
    modeBeginnerHint: string;
    modeVibecoderHint: string;
    modeIntermediateHint: string;
    modeAdvancedHint: string;
    detailsShow: string;
    detailsHide: string;
    detailsHint: string;
    aiBadge: string;
    aiBadgeHint: string;
    aiAnalyzeTitle: string;
    aiAnalyzeHint: string;
    aiAnalyze: string;
    aiAnalyzeAgain: string;
    aiAnalyzing: string;
    aiChangedFields: string;
    importUnderstandTitle: string;
    importUnderstandHint: string;
    importUnderstandFolder: string;
    importReading: string;
    importUnderstandList: string;
    importListTitle: string;
    importUnderstoodTitle: string;
    importFilesRead: string;
    importPlanSummary: string;
    importKeyFiles: string;
    importCreateContinue: string;
    importReRead: string;
  };
  apiSettings: {
    title: string;
    subtitle: string;
    gemini: string;
    openai: string;
    anthropic: string;
    configured: string;
    notConfigured: string;
    envNotice: string;
    fromApp: string;
    fromEnv: string;
    activeProvider: string;
    noProvider: string;
    keyPlaceholder: string;
    keyPlaceholderReplace: string;
    /** Read out with the provider's name, so four identical fields are not four identical fields. */
    keyLabel: string;
    saveKey: string;
    saving: string;
    savedKey: string;
    testKey: string;
    testing: string;
    testFailed: string;
    testOk: string;
    removeKey: string;
    removedKey: string;
    show: string;
    hide: string;
    getKey: string;
    localOnly: string;
    prefixWarning: string;
    reasonAuth: string;
    reasonQuota: string;
    reasonModel: string;
    reasonNetwork: string;
    reasonEmptyResponse: string;
    reasonMissing: string;
    reasonHttp: string;
    saveEmpty: string;
    saveInvalid: string;
    saveFailed: string;
    accessDenied: string;
    unknownProvider: string;
    loadFailed: string;
    retry: string;
  };
  /**
   * The line that appears in the sidebar when a newer build of the app is published.
   *
   * It has to say three different things — a release exists, it is being fetched, it is here — with
   * the same few words, so each state names itself instead of reusing "обновление" alone.
   */
  update: {
    available: string;
    willDownload: string;
    download: string;
    downloading: string;
    ready: string;
    readyHint: string;
    restart: string;
    failed: string;
    retry: string;
  };
}

export const translations: Record<Language, Translations> = {
  ru: {
    common: {
      brandTitle: 'Easy Project Compiler',
      brandSubtitle: 'Рабочая область ИИ-агентов',
      newProject: 'Новый проект',
      createProject: 'Создать проект',
      save: 'Сохранить',
      saved: 'Сохранено',
      cancel: 'Отмена',
      delete: 'Удалить',
      close: 'Закрыть',
      copy: 'Копировать',
      copied: 'Скопировано',
      copyFailed: 'Не удалось — выделите текст вручную',
      export: 'Экспорт',
      apply: 'Применить',
      applied: 'Применено',
      edit: 'Редактировать',
      back: 'Назад',
      next: 'Далее',
      run: 'Запустить',
      running: 'Запуск...',
      loading: 'Загрузка...',
      error: 'Ошибка',
      success: 'Успешно',
      warning: 'Внимание',
      noProjectSelected: 'Проект не выбран',
      noProjectSubtext: 'Создайте проект или выберите существующий',
      projectsCount: 'Проектов',
      // A label, not a number: the real version is fetched from the running build and sits to the right.
      version: 'Версия',
      workspace: 'Рабочая область',
      groupStart: 'Начало',
      groupLoop: 'Цикл с ИИ',
      groupProject: 'Проект',
      targetAgent: 'Агент:',
      mode: 'Режим:',
      language: 'Язык:',
      status: 'Статус',
      errorBoundaryTitle: 'Этот раздел не смог отрисоваться',
      errorBoundaryHint: 'Ошибка осталась внутри блока — остальное приложение работает. Нажмите кнопку, чтобы попробовать снова.',
      errorBoundaryRetry: 'Перерисовать',
      aiWorkingTitle: 'ИИ обрабатывает запрос',
      aiTaskIdea: 'Разбираю идею проекта',
      aiTaskQuestions: 'Подбираю уточняющие вопросы',
      aiTaskProject: 'Собираю проект из идеи',
      aiTaskMap: 'Читаю файлы проекта и сверяю, что уже реализовано',
      aiTaskPlan: 'Адаптирую план задач',
      aiTaskCompile: 'Компилирую промпт',
      aiTaskReview: 'Анализирую ответ агента',
      aiTaskDiagnose: 'Разбираю ошибку',
      aiTaskEdit: 'Пишу код в файлы проекта',
      aiWorkingHint: 'Модель обычно отвечает за 30–60 секунд — окно можно не закрывать.',
      aiWorkingSlowHint: 'Модель всё ещё думает. Если ответа не будет примерно 2,5 минуты, приложение ответит локальным движком.',
      aiWorkingDone: 'Готово',
      aiWorkingFailed: 'Не получилось — подробности в ошибке',
      aiSecondsShort: 'с'
    },
    tabs: {
      dashboard: 'Обзор проекта',
      compiler: 'Компилятор промптов',
      review: 'Проверка ответа',
      preview: 'Песочница и код',
      coach: 'Тренер ошибок',
      plan: 'План и задачи',
      map: 'Карта проекта',
      brief: 'Бриф и архитектура',
      apiSettings: 'Настройки API'
    },
    journey: {
      stepWord: 'Шаг',
      folder: 'Папка',
      task: 'Задача',
      prompt: 'Промпт',
      check: 'Проверка'
    },
    technicalLevels: {
      beginner: 'Новичок',
      vibecoder: 'Вайб-кодер',
      intermediate: 'Средний',
      advanced: 'Продвинутый'
    },
    mode: {
      interfaceLabel: 'Интерфейс',
      interfaceGuided: 'Пошаговый помощник',
      interfaceFull: 'Полный экран',
      interfaceGuidedHint:
        'Четыре шага: папка → задача → промпт → проверка ответа. Технические разделы скрыты за одной кнопкой.',
      interfaceFullHint:
        'Все разделы на виду: компилятор, разбор ответа, тренер ошибок, карта и план. Вернуться к четырём шагам можно там же, в шапке.',
      autonomyLabel: 'Автономия ИИ',
      autonomyLevels: {
        beginner: 'Объясняет по шагам',
        vibecoder: 'Объясняет коротко',
        intermediate: 'Показывает детали',
        advanced: 'Только суть'
      },
      autonomyHints: {
        beginner:
          'ИИ делает всю работу сам и объясняет каждый шаг простыми словами. В терминале выполнять ничего не нужно.',
        vibecoder: 'ИИ делает основную работу сам и объясняет коротко, без жаргона.',
        intermediate: 'ИИ предлагает решение с коротким обоснованием; подробно — про архитектуру, файлы и тесты.',
        advanced: 'ИИ работает полностью сам и не пересказывает очевидное: изменения, риски, границы и тесты.'
      },
    },
    simple: {
      navLabel: 'Пошаговый помощник',
      title: 'Простой режим: шаг за шагом',
      subtitle: 'Четыре шага: папка с файлами, задача, промпт для ИИ, проверка ответа.',
      showAllPanels: 'Показать все разделы',
      hideExtraPanels: 'Скрыть лишние разделы',
      back: 'Назад',
      next: 'Дальше',
      folderTitle: 'Где лежат файлы вашего проекта?',
      folderHelp:
        'Приложение работает только внутри этой папки: читает её файлы и пишет новый код только в неё.',
      folderConnected: 'Папка подключена:',
      noFolderHint:
        'Папка не подключена. Папку выбирают при создании проекта — здесь показано, с какой папкой он работает.',
      createProjectWithFolder: 'Создать проект с папкой',
      refreshFiles: 'Обновить список файлов',
      savedFolderHint: 'В проекте сохранена папка:',
      connectSavedFolder: 'Подключить её',
      filesCountLabel: 'Файлов в папке:',
      taskTitle: 'Что нужно сделать?',
      taskHelp: 'Выберите задачу из плана или напишите её своими словами.',
      otherTask: 'Или напишите своими словами',
      otherTaskPlaceholder: 'Например: добавить кнопку «Сохранить» на главный экран',
      compileButton: 'Собрать промпт',
      promptTitle: 'Промпт для ИИ готов',
      promptHelp: 'Скопируйте промпт и вставьте его в ИИ-агента. Потом вернитесь сюда с его ответом.',
      agentLabel: 'Кому дать задание:',
      copyPrompt: 'Скопировать промпт',
      promptCopied: 'Промпт скопирован',
      readyButton: 'Я вставил — дальше',
      answerTitle: 'Вставьте ответ ИИ',
      answerHelp: 'Вставьте сюда весь ответ агента. Мы проверим, всё ли сделано, и запишем код в файлы.',
      answerPlaceholder: 'Вставьте ответ агента...',
      checkButton: 'Проверить ответ',
      checking: 'Проверяем...',
      verdictReady: 'Всё сделано',
      verdictPartial: 'Сделано частично',
      verdictFailed: 'Пока не получилось',
      filesDetected: 'Нашли код для файлов:',
      writeFiles: 'Записать код в файлы проекта',
      writtenFiles: 'Записано файлов:',
      undoWrite: 'Отменить запись',
      undone: 'Изменения отменены',
      markDone: 'Отметить задачу выполненной',
      missingTitle: 'Что ещё нужно сделать:',
      nextActionTitle: 'Что дальше:',
      continuationTitle: 'Промпт для следующей попытки',
      copyContinuation: 'Скопировать промпт продолжения',
      continuationCopied: 'Промпт продолжения скопирован',
      attemptLabel: 'Попытка',
      restartPrompt: 'Собрать промпт заново',
      errorHelpTitle: 'Что-то не работает?',
      errorHelpPlaceholder: 'Вставьте текст ошибки',
      explainError: 'Объяснить простыми словами',
      explaining: 'Разбираем ошибку...',
      simpleExplanation: 'Простыми словами:',
      repairStepsTitle: 'Что сделать:',
      copyFix: 'Скопировать исправление',
      noProject: 'Сначала создайте проект',
      noProjectHelp: 'Опишите идею — приложение само предложит план и файлы.',
      createProject: 'Создать проект'
    },
    contextModes: {
      minimal: 'Минимальный',
      balanced: 'Сбалансированный',
      full: 'Полный',
      minimalDesc: 'Только явно указанные файлы',
      balancedDesc: 'Файлы задачи и прямые зависимости',
      fullDesc: 'Все файлы текущего модуля'
    },
    taskStatuses: {
      ready: 'Готово',
      in_progress: 'В работе',
      partial: 'Частично',
      review: 'На проверке',
      completed: 'Завершено',
      blocked: 'Заблокировано'
    },
    navbar: {
      toggleMenu: 'Открыть меню'
    },
    dashboard: {
      welcomeTitle: 'Создание приложений с ИИ-агентами',
      welcomeSubtitle: 'Архитектор проектов и компилятор промптов',
      emptySubtitle: 'Преобразование описаний проектов в структурированные контекстные промпты для Cursor, Claude Code, Windsurf и Copilot.',
      presetTemplatesTitle: 'Готовые шаблоны архитектуры',
      presetTemplatesSubtitle: 'Выберите стек для мгновенной генерации проекта',
      selectTemplate: 'Выбрать',
      featuresTitle: 'Контроль разработки и предотвращение ошибок',
      feature1Title: 'Точный контекст',
      feature1Desc: 'Автоматическая привязка проверенных файлов, ограничений проекта и критериев приемки.',
      feature2Title: 'Анализ сессии',
      feature2Desc: 'Проверка вывода агента по критериям до сохранения в репозиторий.',
      feature3Title: 'Тренер ошибок',
      feature3Desc: 'Разбор ошибок компиляции и рантайма с готовыми инструкциями для исправления.',
      feature4Title: 'Правила агентов',
      feature4Desc: 'Генерация правил AGENTS.md, .cursorrules и CLAUDE.md для фиксации архитектуры.',
      mvpCompletion: 'Готовность MVP',
      tasksFinished: 'задач завершено из',
      nextAction: 'Рекомендуемое действие:',
      compilePromptNow: 'Скомпилировать промпт',
      metricsCompleted: 'Завершенные задачи',
      metricsCompletedSub: 'Приняты без замечаний',
      metricsInProgress: 'В работе / На проверке',
      metricsInProgressSub: 'Активные задачи агента',
      metricsBlocked: 'Ожидают решения',
      metricsBlockedSub: 'Требуется устранение блокировок',
      metricsErrors: 'Зафиксированные ошибки',
      metricsErrorsSub: 'Диагностировано тренером',
      phasesTitle: 'Этапы архитектуры MVP',
      viewKanban: 'Открыть Канбан',
      deliverable: 'Результат:'
    },
    compiler: {
      goToReview: 'Перейти к анализу кода',
      reviewPastedCode: 'Проверить вставленный код',
      panel1Title: 'Что нужно сделать',
      taskPlaceholder: 'Например: добавить механику голода с уменьшением здоровья при нулевом значении...',
      chooseTaskFromPlan: 'Или выберите задачу из плана:',
      panel2Title: 'Что увидит агент',
      verifiedFileIndex: 'Индекс файлов проекта',
      autoChosen: 'Настройки выбраны за вас — менять их не обязательно.',
      customizeContext: 'Настроить вручную',
      hideContextSetup: 'Скрыть настройки',
      recompilePrompt: 'Скомпилировать промпт',
      startCompile: 'Начать',
      startHint: 'Проверьте задачу и файлы слева, затем нажмите «Начать» — промпт соберётся один раз, без фоновых перезапусков.',
      outdatedNotice: 'Настройки изменились — нажмите «Начать» снова, чтобы обновить промпт.',
      emptyTaskNotice: 'Опишите задачу, которую должен выполнить ИИ-агент.',
      compilingPrompt: 'Компиляция...',
      rulesCheckTitle: 'Правила проекта в этом промпте',
      rulesCheckSubtext:
        'Промпт собирается с оглядкой на настоящую папку: строки правил, которые ей больше не соответствуют, агент получает как предупреждение, а не как указание.',
      rulesCheckClean: 'Правила описывают папку: расхождений нет, агент получил их как есть.',
      rulesCheckNoFolder: 'Папка не подключена — ссылки на файлы и команды в правилах не сверялись, и промпт об этом говорит.',
      rulesCheckCheckedAt: 'Сверено при сборке промпта',
      compiledOutputTitle: 'Скомпилированный промпт',
      safetyGuard: 'Контроль правил архитектуры',
      compilingNotice: 'Сборка контекста и проверка правил...',
      panel4Title: 'Запустить в агенте и проверить',
      panel4Subtext: 'Скопируйте промпт в агента, затем вставьте полученный код или git diff ниже.',
      simulatedResultPlaceholder: 'Вставьте код или ответ, полученный от агента...'
    },
    review: {
      selectTaskToReview: 'Задача для проверки:',
      pasteAgentOutputLabel: 'Вывод агента или git diff:',
      pasteAgentPlaceholder: 'Вставьте сгенерированный код, ответ агента или git diff...',
      runReviewButton: 'Запустить анализ сессии',
      reviewing: 'Анализ...',
      filesDetectedTitle: 'Обнаруженные файлы кода',
      applyFilesButton: 'Применить файлы к проекту',
      filesApplied: 'Файлы успешно сохранены в проект',
      verdictTitle: 'Вердикт проверки',
      criteriaTitle: 'Критерии приемки',
      testRequirementsTitle: 'Требования к тестированию',
      continuationPromptTitle: 'Промпт продолжения задачи',
      copyContinuation: 'Копировать промпт продолжения',
      openInCompiler: 'Открыть в компиляторе',
      openPreview: 'Открыть песочницу',
      markCompleted: 'Отметить завершенной',
      markCompletedAndNext: 'Завершить и перейти к следующей задаче',
      attemptHistoryTitle: 'История попыток',
      attempt: 'Попытка',
      measuredProgress: 'Прогресс после проверки',
      showPrompt: 'Показать промпт',
      hidePrompt: 'Скрыть промпт',
      copyPrompt: 'Копировать промпт',
      initialPromptTitle: 'Первый промпт',
      initialPromptHint:
        'Первая попытка начинается в компиляторе: там в промпт попадают файлы проекта и правила. Ниже — короткая версия, если компилятор пропущен.',
      verdictPass: 'Принято',
      verdictPartial: 'Частично выполнено',
      verdictFail: 'Требуются исправления'
    },
    coach: {
      errorInputLabel: 'Текст ошибки или стектрейс:',
      errorInputPlaceholder: 'Вставьте текст ошибки, лог терминала или стектрейс...',
      explanationLevelLabel: 'Глубина объяснения:',
      levelVerySimple: 'Простое',
      levelClear: 'Понятное',
      levelTechnical: 'Техническое',
      diagnoseButton: 'Диагностировать ошибку',
      diagnosing: 'Диагностика...',
      presetsLabel: 'Примеры распространенных ошибок:',
      rootCauseTitle: 'Первопричина сбоя',
      mentalModelTitle: 'Архитектурный контекст',
      suggestedFixTitle: 'Рекомендуемое исправление',
      applyFixButton: 'Применить исправление к коду',
      sendFixToCompilerButton: 'Отправить исправление в компилятор'
    },
    preview: {
      runCode: 'Пересобрать и запустить',
      resetCode: 'Сбросить',
      fullscreen: 'На весь экран',
      sendToCoach: 'Передать ошибку в тренер',
      sourceCode: 'Исходный код',
      copyCode: 'Копировать код',
      emptyCodeNotice: 'Файлы кода проекта еще не загружены.',
      modeProject: 'Проект из папки',
      modeSnippet: 'Свой код',
      entryLabel: 'Что запускаем',
      entryHint: 'Точка входа найдена в папке проекта. Можно выбрать другую.',
      kindStatic: 'Готовая страница',
      kindBundle: 'Сборка скрипта',
      building: 'Собираю проект…',
      builtIn: 'Собрано за',
      buildFailed: 'Собрать не удалось — вот что мешает:',
      diagnosticsTitle: 'Ошибки сборки',
      explainWithAi: 'Объяснить и починить с ИИ',
      compositionTitle: 'Из чего состоит сборка',
      compositionHint:
        'Числа — из отчёта самого сборщика: каждый байт приписан файлу, который его положил. Тяжёлая строка вверху — это и есть причина веса.',
      compositionTruncated: 'Показаны не все части: остальные вместе весят меньше последней строки.',
      compositionExternals: 'Отдельно, не внутри сборки (берётся из интернета):',
      compositionPackage: 'пакет',
      compositionFile: 'ваш файл',
      warningsTitle: 'Замечания сборки',
      noFolder: 'Папка проекта не подключена',
      noFolderHint: 'Подключите папку на экране «Файлы проекта» — и песочница соберёт и запустит ваш проект целиком.',
      snippetHint: 'Вставьте файл целиком: HTML, JS или TSX — песочница его скомпилирует и запустит.',
      consoleTitle: 'Логи консоли',
      consoleEmpty: 'Консоль пуста. Запустите проект, чтобы увидеть вывод.',
      clear: 'Очистить',
      jsErrorTitle: 'Ошибка выполнения JS'
    },
    plan: {
      allPhases: 'Все этапы',
      phase: 'Этап',
      addTaskButton: 'Добавить задачу',
      adaptPlanButton: 'Адаптировать план с ИИ',
      compilePrompt: 'Компилировать промпт',
      tasksCount: 'задач',
      addTaskModalTitle: 'Новая задача',
      taskTitleLabel: 'Название задачи',
      taskGoalLabel: 'Цель задачи',
      createTaskButton: 'Создать задачу',
      adaptModalTitle: 'Адаптация плана проекта',
      adaptModalPlaceholder: 'Опишите изменения или новые требования к архитектуре...',
      adaptSubmitButton: 'Перестроить план',
      canvasTitle: 'Холст проекта',
      viewCanvas: 'Холст',
      viewKanban: 'Канбан',
      arrange: 'Разложить по дорожкам',
      arrangeHint: 'Возвращает все карточки в дорожки по статусу. Ручная расстановка будет потеряна.',
      zoomIn: 'Приблизить',
      zoomOut: 'Отдалить',
      resetZoom: 'Сбросить масштаб',
      fitView: 'Показать весь план',
      minimapTitle: 'Обзор холста',
      minimapHint: 'Нажмите на обзор, чтобы перейти к этому месту.',
      laneReady: 'Готово к работе',
      laneActive: 'В работе и на проверке',
      laneBlocked: 'Заблокировано',
      laneDone: 'Завершено',
      phaseOf: 'Этап',
      emptyLane: 'Пусто',
      linksShow: 'Связи',
      linksLegendTitle: 'Что означают линии',
      linkReady: 'можно начинать',
      linkWaiting: 'ждёт зависимость',
      linkBlocked: 'начато раньше зависимости',
      linkDone: 'оба готовы',
      waitsBadge: 'ждёт',
      linksMissing: 'В зависимостях указаны имена, которых нет в плане:',
      laneMenuRename: 'Переименовать дорожку',
      laneMenuColor: 'Цвет дорожки',
      laneMenuReset: 'Вернуть как было',
      laneRenamePlaceholder: 'Название дорожки',
      laneHandle: 'Тянуть, чтобы сдвинуть зону',
      laneResize: 'Потянуть, чтобы растянуть зону',
      cardMenuRename: 'Переименовать задачу',
      cardRenamePlaceholder: 'Название задачи',
      colorSlate: 'Серый',
      colorIndigo: 'Синий',
      colorPurple: 'Фиолетовый',
      colorEmerald: 'Зелёный',
      colorAmber: 'Янтарный',
      colorRose: 'Красный',
      colorCyan: 'Голубой'
    },
    map: {
      projectFilesTitle: 'Файлы проекта',
      rulesFilesTitle: 'Файлы конфигурации правил',
      copyRulesButton: 'Копировать правила',
      rulesWriteButton: 'Записать в папку',
      rulesNoFolder: 'Папка проекта не подключена — правила можно только скопировать. Подключите папку на экране файлов.',
      rulesConfirmTitle: 'Записать правила в папку',
      rulesCreate: 'создать',
      rulesReplace: 'заменить',
      rulesReplaceNote: 'Перед заменой сохраняется копия, поэтому вся запись отменяется одной кнопкой.',
      rulesWriteConfirm: 'Записать файлы',
      rulesWriting: 'Записываю…',
      rulesWriteFailed: 'Не удалось записать файлы правил.',
      rulesWritten: 'Записано',
      rulesStatusCreated: 'создан',
      rulesStatusUpdated: 'обновлён',
      rulesStatusSkipped: 'пропущен',
      rulesFormatted: 'И причесал форматтером:',
      rulesUndo: 'Отменить запись',
      rulesUndoing: 'Возвращаю…',
      rulesUndone: 'Файлы возвращены как были.',
      rulesUndoFailed: 'Не удалось отменить запись.',
      rulesDone: 'Готово',
      rulesAuditTitle: 'Правила не устарели?',
      rulesAuditSubtext:
        'Правила сверяются с самой папкой: повторы, ссылки на файлы и команды, которых там больше нет. Сверка идёт сама после каждой записи в папку и по кнопке. Это чтение файлов, без запроса к ИИ.',
      rulesLastCheck: 'Последняя сверка',
      rulesLastCheckNever: 'С папкой ещё не сверяли: запишите файлы в папку или нажмите «Проверить снова».',
      rulesStaleAfterWrite: 'Правила разошлись с папкой — проблем:',
      rulesStaleAfterWriteHint: 'Откройте «Карту проекта», чтобы посмотреть и починить безопасное.',
      rulesAuditRecheck: 'Проверить снова',
      rulesAuditChecking: 'Сверяю…',
      rulesAuditClean: 'Расхождений нет: правила описывают эту папку.',
      rulesAuditProblems: 'проблем',
      rulesAuditNotes: 'заметок',
      rulesAuditProblemTag: 'Проблема',
      rulesAuditNoteTag: 'Заметка',
      rulesAuditNoFolder:
        'Папка не подключена — сверить не с чем. Проверены только то, что видно в самих правилах: повторы и противоречия.',
      rulesAuditNoPackageJson: 'В папке нет package.json — такой команды здесь не существует.',
      rulesAuditFix: 'Починить безопасное',
      rulesAuditFixHint:
        'Удаляются повторы и строки со ссылками на то, чего в папке нет. Противоречия не трогаю: какая половина верна — решаете вы.',
      rulesAuditFixed: 'Починено:',
      rulesAuditRemovedDuplicates: 'повторов убрано',
      rulesAuditRemovedReferences: 'мёртвых ссылок убрано',
      rulesAuditAddedFrontmatter: 'frontmatter добавлен',
      rulesAuditSaved: 'Исправленные правила сохранены в проекте.',
      rulesAuditFailed: 'Не удалось сверить правила с папкой.',
      rulesAuditLine: 'строка',
      rulesAuditAlso: 'и ещё',
      rulesAuditKindDuplicateLine: 'Строка повторяется в этом же файле',
      rulesAuditKindDuplicateAcrossFiles: 'То же правило есть в другом файле правил',
      rulesAuditKindContradiction: 'Противоречие: одна строка запрещает то, что разрешает другая',
      rulesAuditKindMissingFile: 'Файла нет в папке',
      rulesAuditKindMissingCommand: 'Команды нет в package.json',
      rulesAuditKindMissingFrontmatter: 'Cursor не станет читать: нет frontmatter',
      rulesAuditKindInactiveFrontmatter: 'Правило не применяется само по себе',
      rulesAuditKindEmptyDocument: 'В файле нет ни одного указания',
      filesCount: 'файлов',
      fileMetadataTitle: 'Метаданные файла',
      symbolsTitle: 'Обнаруженные символы / классы:',
      rulesTitle: 'Файл правил для агентов',
      factsTitle: 'Что уже реализовано в файлах',
      factsSubtext: 'Разбор реального кода: объявления, строки, состояние каждого файла. Без запроса к ИИ.',
      statusImplemented: 'реализовано',
      statusPartial: 'частично',
      statusStub: 'заготовка',
      statusEmpty: 'пусто',
      mainEntryLabel: 'Точка входа',
      scriptsWithCode: 'Скриптов с кодом',
      testsPresent: 'тесты есть',
      testsMissing: 'тестов нет',
      analyzedFilesLabel: 'Прочитано файлов',
      describeButton: 'ИИ: разобрать, что уже реализовано',
      describingButton: 'ИИ читает файлы…',
      describeFailed: 'Не удалось разобрать файлы проекта.',
      insightsTitle: 'ИИ: что уже реализовано',
      insightsEngine: 'Проанализировал',
      insightsNextSteps: 'Что делать дальше',
      fileInsightTitle: 'ИИ об этом файле',
      fileInsightEmpty: 'В этом файле ещё нет реализованного кода.',
      importsTitle: 'Импорты',
      codeLinesLabel: 'строк кода'
    },
    brief: {
      overviewTitle: 'Обзор проекта',
      mvpScopeTitle: 'Границы MVP',
      nonGoalsTitle: 'Исключено из MVP',
      constraintsTitle: 'Технические ограничения',
      architectureTitle: 'Архитектурные модули',
      dataFlowTitle: 'Поток данных',
      coreProblem: 'Решаемая проблема',
      coreValue: 'Ключевая ценность',
      mvpFeaturesTitle: 'Ключевые фичи MVP',
      techStack: 'Технологический стек',
      folderStructure: 'Структура папок',
      dataFlow: 'Поток данных и архитектура состояния',
      successCriteria: 'Критерии готовности MVP'
    },
    savedDrawer: {
      title: 'Сохраненные проекты',
      subtitle: 'Список сохраненных проектов',
      emptyNotice: 'Сохраненных проектов нет.',
      currentBadge: 'Активный',
      openProject: 'Открыть'
    },
    drawer: {
      title: 'Сохраненные проекты',
      subtitle: 'Список сохраненных проектов',
      emptyTitle: 'Сохраненных проектов пока нет',
      emptyNotice: 'Создайте новый проект или выберите шаблон.',
      currentBadge: 'Активный',
      openProject: 'Открыть проект',
      deleteHint: 'Удалить проект из списка',
      deleteConfirmTitle: 'Удалить проект?',
      deleteConfirmNotice: 'Проект исчезнет из списка приложения. Файлы на диске останутся на месте.'
    },
    setup: {
      modalTitle: 'Создание нового проекта',
      tabIdea: 'Из описания идеи',
      tabImport: 'Импорт структуры',
      projectNameLabel: 'Название проекта',
      projectNamePlaceholder: 'Например: Tower Defense Arcade',
      ideaLabel: 'Описание идеи и механик',
      ideaPlaceholder: 'Опишите ключевые механики, геймплей или функционал приложения...',
      platformLabel: 'Целевая платформа',
      stackLabel: 'Стек или движок',
      agentLabel: 'Целевой AI-ассистент',
      techLevelLabel: 'Технический уровень',
      autoSelectToggle: 'Автоподбор стека с ИИ',
      createButton: 'Сгенерировать архитектуру MVP',
      analyzing: 'Анализ идеи...',
      presetStacksTitle: 'Популярные стеки:',
      step1Title: 'Шаг 1: Идея и стек',
      step2Title: 'Шаг 2: Уточняющие вопросы',
      questionsTitle: 'Вопросы по архитектуре',
      backButton: 'Назад к идее',
      confirmCreateButton: 'Создать проект',
      importNotice: 'Импорт структуры проекта из готового репозитория или JSON-карты.',
      folderLabel: 'Папка с файлами проекта',
      folderHelp:
        'Куда агент будет писать код: приложение прочитает файлы этой папки и будет менять только их.',
      folderChoose: 'Выбрать папку…',
      folderPlaceholder: 'Путь к папке (не обязательно)',
      folderConnect: 'Подключить',
      folderConnected: 'Папка подключена',
      folderNotConnectedHint: 'Папка ещё не подключена — нажмите «Подключить»',
      folderFiles: 'Файлов',
      folderChange: 'Сменить папку',
      folderKeepConnected: 'Оставить эту папку',
      engineLabel: 'Движок или стек игры',
      enginePlaceholder: '— Выберите движок или стек —',
      ideaRequiredHint: 'Опишите идею, чтобы ИИ смог её проанализировать.',
      startRequiresEngine:
        'Чтобы начать анализ, выберите движок или стек (или подберите его с ИИ).',
      modeBeginnerHint:
        'Пошаговый помощник: четыре шага — папка, задача, промпт, проверка ответа. Технические разделы скрыты.',
      modeVibecoderHint: 'Полный экран, но настройки выбираются за вас.',
      modeIntermediateHint: 'Полный экран: настройки контекста и файлов на виду.',
      modeAdvancedHint: 'Полный экран без подсказок: всё под рукой.',
      detailsShow: 'Показать детали и настройки ИИ',
      detailsHide: 'Скрыть детали и настройки ИИ',
      detailsHint:
        'Платформа, ИИ-агент, архитектурный паттерн, глубина MVP и гарантии качества.',
      aiBadge: 'предложено ИИ',
      aiBadgeHint:
        'Это значение предложено или изменено ИИ. Измените его вручную — пометка снимется.',
      aiAnalyzeTitle: 'Анализ идеи и подбор стека ИИ',
      aiAnalyzeHint:
        'ИИ предложит движок, паттерн и платформу под ваше описание. Всё, что он заполнит или изменит, будет помечено «предложено ИИ».',
      aiAnalyze: 'Подобрать с ИИ',
      aiAnalyzeAgain: 'Пересобрать с ИИ',
      aiAnalyzing: 'Анализ идеи...',
      aiChangedFields: 'ИИ изменил:',
      importUnderstandTitle: 'Как ИИ поймёт ваш проект',
      importUnderstandHint:
        'Подключите папку — ИИ прочитает README, манифесты и ключевые файлы и поймёт, что это за проект. Можно и просто вставить список файлов.',
      importUnderstandFolder: 'Изучить папку и понять проект',
      importReading: 'ИИ читает файлы проекта...',
      importUnderstandList: 'Понять проект по списку файлов',
      importListTitle: 'Или вставьте структуру папок / список файлов GitHub:',
      importUnderstoodTitle: 'ИИ понял проект',
      importFilesRead: 'Прочитано файлов',
      importPlanSummary: 'План: этапов / задач',
      importKeyFiles: 'Ключевые файлы',
      importCreateContinue: 'Создать проект и продолжить',
      importReRead: 'Прочитать заново'
    },
    apiSettings: {
      title: 'Настройки API провайдеров',
      subtitle: 'Вставьте свой ключ — он сразу начнёт использоваться, перезапуск не нужен.',
      gemini: 'Google Gemini',
      openai: 'OpenAI',
      anthropic: 'Anthropic Claude',
      configured: 'Настроено',
      notConfigured: 'Не настроено',
      envNotice: 'Ключи можно задать и через переменные окружения (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, NVIDIA_API_KEY) — они используются, пока в настройках не сохранён свой.',
      fromApp: 'Подключён (из настроек)',
      fromEnv: 'Подключён (переменная окружения)',
      activeProvider: 'Активный провайдер',
      noProvider: 'ключей нет — работает локальный движок',
      keyPlaceholder: 'Вставьте ключ API',
      keyPlaceholderReplace: 'Вставьте новый ключ, чтобы заменить текущий',
      keyLabel: 'Ключ API',
      saveKey: 'Сохранить',
      saving: 'Сохраняю...',
      savedKey: 'Ключ сохранён и уже активен',
      testKey: 'Проверить',
      testing: 'Проверяю...',
      testFailed: 'Не удалось выполнить проверку',
      testOk: 'Соединение работает',
      removeKey: 'Удалить',
      removedKey: 'Ключ удалён',
      show: 'Показать',
      hide: 'Скрыть',
      getKey: 'Получить ключ',
      localOnly: 'Ключи сохраняются только на этом компьютере (файл data/api-keys.json, права только для владельца) и отправляются исключительно самому провайдеру. В интерфейсе ключ показывается замаскированным.',
      prefixWarning: 'ключ не похож на ключ этого провайдера — проверьте, что скопировали нужный',
      reasonAuth: 'Провайдер отклонил этот ключ',
      reasonQuota: 'Ключ принят, но закончился лимит или квота',
      reasonModel: 'Ключ принят, но нет доступа ни к одной модели',
      reasonNetwork: 'Нет соединения с провайдером — проверьте интернет',
      reasonEmptyResponse: 'Провайдер вернул пустой ответ',
      reasonMissing: 'Ключ не задан',
      reasonHttp: 'Провайдер отклонил запрос',
      saveEmpty: 'Введите ключ',
      saveInvalid: 'Ключ выглядит некорректно: минимум 20 символов, без пробелов',
      saveFailed: 'Не удалось сохранить ключ',
      accessDenied: 'Ключи можно менять только с компьютера, на котором запущено приложение (localhost)',
      unknownProvider: 'Неизвестный провайдер',
      loadFailed: 'Не удалось загрузить состояние ключей',
      retry: 'Повторить'
    },
    update: {
      available: 'Вышла версия',
      willDownload: 'Если не нажать «Скачать», начнётся фоновая загрузка — и обновится при следующем запуске.',
      download: 'Скачать',
      downloading: 'Загружаю обновление',
      ready: 'Обновление готово:',
      readyHint: 'Встанет само при следующем запуске. Можно перезапустить сейчас.',
      restart: 'Перезапустить и обновить',
      failed: 'Не удалось проверить обновления',
      retry: 'Повторить'
    }
  },
  en: {
    common: {
      brandTitle: 'Easy Project Compiler',
      brandSubtitle: 'AI Agent Workspace',
      newProject: 'New Project',
      createProject: 'Create Project',
      save: 'Save',
      saved: 'Saved',
      cancel: 'Cancel',
      delete: 'Delete',
      close: 'Close',
      copy: 'Copy',
      copied: 'Copied',
      copyFailed: 'Could not copy — select the text by hand',
      export: 'Export',
      apply: 'Apply',
      applied: 'Applied',
      edit: 'Edit',
      back: 'Back',
      next: 'Next',
      run: 'Run',
      running: 'Running...',
      loading: 'Loading...',
      error: 'Error',
      success: 'Success',
      warning: 'Warning',
      noProjectSelected: 'No Project Selected',
      noProjectSubtext: 'Create a new project or select a saved project',
      projectsCount: 'Projects',
      version: 'Version',
      workspace: 'Workspace',
      groupStart: 'Start',
      groupLoop: 'AI loop',
      groupProject: 'Project',
      targetAgent: 'Agent:',
      mode: 'Mode:',
      language: 'Language:',
      status: 'Status',
      errorBoundaryTitle: 'This section failed to render',
      errorBoundaryHint: 'The error stayed inside this block — the rest of the app keeps working. Press the button to try again.',
      errorBoundaryRetry: 'Try again',
      aiWorkingTitle: 'AI is processing the request',
      aiTaskIdea: 'Analyzing the project idea',
      aiTaskQuestions: 'Preparing clarifying questions',
      aiTaskProject: 'Building the project from the idea',
      aiTaskMap: 'Reading the project files to see what is already implemented',
      aiTaskPlan: 'Adapting the task plan',
      aiTaskCompile: 'Compiling the prompt',
      aiTaskReview: 'Reviewing the agent reply',
      aiTaskDiagnose: 'Diagnosing the error',
      aiTaskEdit: 'Writing code into your project files',
      aiWorkingHint: 'The model usually answers in 30–60 seconds — you can leave this window open.',
      aiWorkingSlowHint: 'The model is still thinking. If it does not answer in about 2.5 minutes, the app answers with its local engine.',
      aiWorkingDone: 'Done',
      aiWorkingFailed: 'Failed — see the error message',
      aiSecondsShort: 's'
    },
    tabs: {
      dashboard: 'Project overview',
      compiler: 'Prompt Compiler',
      review: 'Answer review',
      preview: 'Code & Game Preview',
      coach: 'Visual Error Coach',
      plan: 'Plan & Tasks',
      map: 'Project Map',
      brief: 'Brief & Architecture',
      apiSettings: 'API Settings'
    },
    journey: {
      stepWord: 'Step',
      folder: 'Folder',
      task: 'Task',
      prompt: 'Prompt',
      check: 'Check'
    },
    technicalLevels: {
      beginner: 'Beginner / Non-coder',
      vibecoder: 'Vibe-coder',
      intermediate: 'Intermediate',
      advanced: 'Advanced'
    },
    mode: {
      interfaceLabel: 'Interface',
      interfaceGuided: 'Step-by-step helper',
      interfaceFull: 'Full workspace',
      interfaceGuidedHint:
        'Four steps: folder → task → prompt → checking the answer. Technical sections stay one click away.',
      interfaceFullHint:
        'Every section on screen: compiler, review, error coach, map and plan. The four steps are one click away, in this same bar.',
      autonomyLabel: 'AI autonomy',
      autonomyLevels: {
        beginner: 'Explains step by step',
        vibecoder: 'Explains briefly',
        intermediate: 'Shows the details',
        advanced: 'Essentials only'
      },
      autonomyHints: {
        beginner: 'The AI does the whole job itself and explains every step in plain words. Nothing to run in a terminal.',
        vibecoder: 'The AI does the main work itself and explains briefly, without jargon.',
        intermediate: 'The AI proposes the solution with a short justification; the detail goes to architecture, files and tests.',
        advanced: 'The AI works fully on its own and never restates the obvious: changes, risks, boundaries and tests.'
      },
    },
    simple: {
      navLabel: 'Step-by-step helper',
      title: 'Simple mode: step by step',
      subtitle: 'Four steps: project folder, task, AI prompt, checking the answer.',
      showAllPanels: 'Show all sections',
      hideExtraPanels: 'Hide extra sections',
      back: 'Back',
      next: 'Next',
      folderTitle: 'Where are your project files?',
      folderHelp:
        'The app works only inside this folder: it reads its files and writes new code only into it.',
      folderConnected: 'Folder connected:',
      noFolderHint:
        'No folder is connected. The folder is chosen while the project is created — this screen shows which one it works in.',
      createProjectWithFolder: 'Create a project with a folder',
      refreshFiles: 'Refresh the file list',
      savedFolderHint: 'The project remembers the folder:',
      connectSavedFolder: 'Connect it',
      filesCountLabel: 'Files in the folder:',
      taskTitle: 'What should be done?',
      taskHelp: 'Pick a task from the plan or describe it in your own words.',
      otherTask: 'Or describe it in your own words',
      otherTaskPlaceholder: 'For example: add a Save button to the main screen',
      compileButton: 'Build the prompt',
      promptTitle: 'The AI prompt is ready',
      promptHelp: 'Copy the prompt into your AI agent, then come back here with its answer.',
      agentLabel: 'Who does the task:',
      copyPrompt: 'Copy prompt',
      promptCopied: 'Prompt copied',
      readyButton: 'I pasted it — next',
      answerTitle: 'Paste the AI answer',
      answerHelp: 'Paste the whole agent answer here. We check what is done and write the code into your files.',
      answerPlaceholder: 'Paste the agent answer...',
      checkButton: 'Check the answer',
      checking: 'Checking...',
      verdictReady: 'All done',
      verdictPartial: 'Partially done',
      verdictFailed: 'Not done yet',
      filesDetected: 'Found code for files:',
      writeFiles: 'Write the code into the project files',
      writtenFiles: 'Files written:',
      undoWrite: 'Undo the write',
      undone: 'Changes undone',
      markDone: 'Mark the task as done',
      missingTitle: 'What is still missing:',
      nextActionTitle: 'What to do next:',
      continuationTitle: 'Prompt for the next attempt',
      copyContinuation: 'Copy the follow-up prompt',
      continuationCopied: 'Follow-up prompt copied',
      attemptLabel: 'Attempt',
      restartPrompt: 'Build the prompt again',
      errorHelpTitle: 'Something is broken?',
      errorHelpPlaceholder: 'Paste the error text',
      explainError: 'Explain in plain words',
      explaining: 'Working out the error...',
      simpleExplanation: 'In plain words:',
      repairStepsTitle: 'What to do:',
      copyFix: 'Copy the fix',
      noProject: 'Create a project first',
      noProjectHelp: 'Describe your idea — the app proposes a plan and files for you.',
      createProject: 'Create a project'
    },
    contextModes: {
      minimal: 'Minimal',
      balanced: 'Balanced',
      full: 'Full',
      minimalDesc: 'Includes only directly referenced files',
      balancedDesc: 'Includes task files plus immediate dependencies',
      fullDesc: 'Includes all files in the feature module'
    },
    taskStatuses: {
      ready: 'Ready',
      in_progress: 'In Progress',
      partial: 'Partial',
      review: 'Review',
      completed: 'Completed',
      blocked: 'Blocked'
    },
    navbar: {
      toggleMenu: 'Toggle Sidebar Menu'
    },
    dashboard: {
      welcomeTitle: 'Build Full-Stack Apps with AI Coding Agents',
      welcomeSubtitle: 'AI Project Architect & Prompt Compiler',
      emptySubtitle: 'Turn plain language game and app ideas into context-aware, structured MVP prompt suites for Cursor, Claude Code, Windsurf, and Copilot.',
      presetTemplatesTitle: 'Stack Preset Templates',
      presetTemplatesSubtitle: 'Select a template stack to launch the AI project compiler instantly.',
      selectTemplate: 'Select',
      featuresTitle: 'How Easy Project Compiler Prevents AI Agent Bugs',
      feature1Title: 'Precision Prompting',
      feature1Desc: 'Automatically attaches verified @file references, project constraints, and test criteria.',
      feature2Title: 'Session Review',
      feature2Desc: 'Paste agent diffs or output to verify acceptance criteria before committing changes.',
      feature3Title: 'Visual Error Coach',
      feature3Desc: 'Transforms compiler or runtime errors into beginner-friendly root cause chains.',
      feature4Title: 'AGENTS.md Rules',
      feature4Desc: 'Generates engine-specific rules files (Unity, Godot, Phaser, React) to keep agents on track.',
      mvpCompletion: 'MVP Completion',
      tasksFinished: 'tasks completed of',
      nextAction: 'Next Recommended Action:',
      compilePromptNow: 'Compile Prompt Now',
      metricsCompleted: 'Completed Tasks',
      metricsCompletedSub: 'Accepted without issues',
      metricsInProgress: 'In-Progress / Review',
      metricsInProgressSub: 'Active agent tasks',
      metricsBlocked: 'Blocked / Waiting',
      metricsBlockedSub: 'Requires dependency resolution',
      metricsErrors: 'Recent Errors',
      metricsErrorsSub: 'Diagnosed via Error Coach',
      phasesTitle: 'MVP Architecture Phases',
      viewKanban: 'View Full Kanban',
      deliverable: 'Deliverable:'
    },
    compiler: {
      goToReview: 'Go to the answer review',
      reviewPastedCode: 'Review Pasted Code',
      panel1Title: 'What to build',
      taskPlaceholder: 'e.g. Add hunger mechanic so player loses health when hunger reaches zero...',
      chooseTaskFromPlan: 'Or choose active task from plan:',
      panel2Title: 'What the agent sees',
      verifiedFileIndex: 'Verified File Index',
      autoChosen: 'Settings were chosen for you — no need to touch them.',
      customizeContext: 'Set up manually',
      hideContextSetup: 'Hide the settings',
      recompilePrompt: 'Re-Compile Prompt',
      startCompile: 'Start',
      startHint: 'Check the task and files on the left, then press Start — the prompt is compiled once, with no background restarts.',
      outdatedNotice: 'Settings changed — press Start again to refresh the prompt.',
      emptyTaskNotice: 'Describe the task the AI agent has to do.',
      compilingPrompt: 'Compiling Context...',
      rulesCheckTitle: 'The project rules inside this prompt',
      rulesCheckSubtext:
        'The prompt is built with the real folder in mind: lines of the rules that no longer match it reach the agent as a warning, not as an instruction.',
      rulesCheckClean: 'The rules describe the folder: nothing disagrees, and the agent got them as they are.',
      rulesCheckNoFolder: 'No folder is connected — file references and commands in the rules were not checked, and the prompt says so.',
      rulesCheckCheckedAt: 'Checked when the prompt was compiled',
      compiledOutputTitle: 'Agent-ready prompt',
      safetyGuard: 'Architecture & Rule Safety Guard',
      compilingNotice: 'Compiling context and rule checks...',
      panel4Title: 'Run it in the agent, then check',
      panel4Subtext: 'Copy the prompt into the agent, then paste the result or git diff below to review.',
      simulatedResultPlaceholder: 'Paste the code modifications, response, or git diff returned by agent...'
    },
    review: {
      selectTaskToReview: 'Task to evaluate:',
      pasteAgentOutputLabel: 'Agent output or git diff:',
      pasteAgentPlaceholder: 'Paste the code output, response, or git diff...',
      runReviewButton: 'Run Session Review',
      reviewing: 'Reviewing...',
      filesDetectedTitle: 'Extracted Source Files',
      applyFilesButton: 'Apply to Project Map',
      filesApplied: 'Files saved to Project Map',
      verdictTitle: 'Review Verdict',
      criteriaTitle: 'Acceptance Criteria',
      testRequirementsTitle: 'Test Requirements',
      continuationPromptTitle: 'Continuation Prompt',
      copyContinuation: 'Copy Continuation Prompt',
      openInCompiler: 'Open in Prompt Compiler',
      openPreview: 'Open Preview',
      markCompleted: 'Mark Completed',
      markCompletedAndNext: 'Mark Completed & Proceed to Next Task',
      attemptHistoryTitle: 'Attempt History',
      attempt: 'Attempt',
      measuredProgress: 'Progress after this review',
      showPrompt: 'Show the prompt',
      hidePrompt: 'Hide the prompt',
      copyPrompt: 'Copy the prompt',
      initialPromptTitle: 'The first prompt',
      initialPromptHint:
        'The first attempt starts in the compiler: the project files and rules go into that prompt. Below is a short version, for when the compiler was skipped.',
      verdictPass: 'Passed',
      verdictPartial: 'Partial',
      verdictFail: 'Needs Work'
    },
    coach: {
      errorInputLabel: 'Error message or stack trace:',
      errorInputPlaceholder: 'Paste the error message, terminal log, or stack trace...',
      explanationLevelLabel: 'Explanation Depth:',
      levelVerySimple: 'Simple',
      levelClear: 'Clear',
      levelTechnical: 'Technical',
      diagnoseButton: 'Diagnose Error',
      diagnosing: 'Diagnosing...',
      presetsLabel: 'Preset example errors:',
      rootCauseTitle: 'Root Cause Breakdown',
      mentalModelTitle: 'Architectural Context',
      suggestedFixTitle: 'Recommended Fix',
      applyFixButton: 'Apply Fix to Code',
      sendFixToCompilerButton: 'Send Fix to Compiler'
    },
    preview: {
      runCode: 'Rebuild & run',
      resetCode: 'Reset',
      fullscreen: 'Fullscreen',
      sendToCoach: 'Send Error to Coach',
      sourceCode: 'Source Code',
      copyCode: 'Copy Code',
      emptyCodeNotice: 'No project code files loaded yet.',
      modeProject: 'Project folder',
      modeSnippet: 'My own code',
      entryLabel: 'What to run',
      entryHint: 'The entry point was found in your project folder. Pick another one if you like.',
      kindStatic: 'Ready-made page',
      kindBundle: 'Script bundle',
      building: 'Building the project…',
      builtIn: 'Built in',
      buildFailed: 'The build failed — this is what is in the way:',
      diagnosticsTitle: 'Build errors',
      explainWithAi: 'Explain and fix with AI',
      compositionTitle: 'What the bundle is made of',
      compositionHint:
        'The numbers come from the bundler’s own report: every byte is attributed to the file that put it there. The heavy line at the top is the reason for the weight.',
      compositionTruncated: 'Not every part is shown: all the ones left off weigh less than the last line.',
      compositionExternals: 'Separately, not inside the bundle (fetched from the internet):',
      compositionPackage: 'package',
      compositionFile: 'your file',
      warningsTitle: 'Build notes',
      noFolder: 'No project folder is connected',
      noFolderHint: 'Connect a folder on the Project Files screen, and the sandbox will build and run the whole project.',
      snippetHint: 'Paste a whole file: HTML, JS or TSX — the sandbox compiles and runs it.',
      consoleTitle: 'Console output',
      consoleEmpty: 'Console is empty. Run the project to see its output.',
      clear: 'Clear',
      jsErrorTitle: 'JS execution error'
    },
    plan: {
      allPhases: 'All Phases',
      phase: 'Phase',
      addTaskButton: 'Add Task',
      adaptPlanButton: 'Adapt Plan with AI',
      compilePrompt: 'Compile Prompt',
      tasksCount: 'tasks',
      addTaskModalTitle: 'New Task',
      taskTitleLabel: 'Task Title',
      taskGoalLabel: 'Task Goal',
      createTaskButton: 'Create Task',
      adaptModalTitle: 'Adapt Project Plan',
      adaptModalPlaceholder: 'Describe the scope change or new architecture requirements...',
      adaptSubmitButton: 'Re-align Plan',
      canvasTitle: 'Project canvas',
      viewCanvas: 'Canvas',
      viewKanban: 'Kanban',
      arrange: 'Arrange into lanes',
      arrangeHint: 'Puts every card back into its status lane. Manual placement is lost.',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      resetZoom: 'Reset zoom',
      fitView: 'Fit the whole plan',
      minimapTitle: 'Board overview',
      minimapHint: 'Click the overview to jump to that spot.',
      laneReady: 'Ready',
      laneActive: 'In progress & review',
      laneBlocked: 'Blocked',
      laneDone: 'Done',
      phaseOf: 'Phase',
      emptyLane: 'Empty',
      linksShow: 'Links',
      linksLegendTitle: 'What the lines mean',
      linkReady: 'ready to start',
      linkWaiting: 'waiting on a task',
      linkBlocked: 'started before its dependency',
      linkDone: 'both done',
      waitsBadge: 'waits',
      linksMissing: 'Dependencies point at names that are not in the plan:',
      laneMenuRename: 'Rename this lane',
      laneMenuColor: 'Lane colour',
      laneMenuReset: 'Put it back the way it was',
      laneRenamePlaceholder: 'Lane name',
      laneHandle: 'Drag to move the zone',
      laneResize: 'Drag to stretch the zone',
      cardMenuRename: 'Rename this task',
      cardRenamePlaceholder: 'Task name',
      colorSlate: 'Grey',
      colorIndigo: 'Indigo',
      colorPurple: 'Purple',
      colorEmerald: 'Green',
      colorAmber: 'Amber',
      colorRose: 'Red',
      colorCyan: 'Cyan'
    },
    map: {
      projectFilesTitle: 'Project Files',
      rulesFilesTitle: 'Rules Files',
      copyRulesButton: 'Copy Rules',
      rulesWriteButton: 'Write to the folder',
      rulesNoFolder: 'No project folder is connected — the rules can only be copied. Connect one on the files screen.',
      rulesConfirmTitle: 'Write the rules into the folder',
      rulesCreate: 'create',
      rulesReplace: 'replace',
      rulesReplaceNote: 'A copy is saved before anything is replaced, so the write comes back with one button.',
      rulesWriteConfirm: 'Write the files',
      rulesWriting: 'Writing…',
      rulesWriteFailed: 'The rule files could not be written.',
      rulesWritten: 'Written',
      rulesStatusCreated: 'created',
      rulesStatusUpdated: 'updated',
      rulesStatusSkipped: 'skipped',
      rulesFormatted: 'Tidied up by the formatter:',
      rulesUndo: 'Undo this write',
      rulesUndoing: 'Rolling back…',
      rulesUndone: 'The files are back as they were.',
      rulesUndoFailed: 'The write could not be undone.',
      rulesDone: 'Done',
      rulesAuditTitle: 'Are the rules still true?',
      rulesAuditSubtext:
        'The rules are compared against the folder itself: repeats, and references to files and commands that are no longer there. The check runs by itself after every write into the folder, and on the button. This reads files; it asks no AI.',
      rulesLastCheck: 'Last check',
      rulesLastCheckNever: 'The folder has not been compared with the rules yet: write files into it, or press "Check again".',
      rulesStaleAfterWrite: 'The rules no longer match the folder — problems:',
      rulesStaleAfterWriteHint: 'Open Project Map to look at them and fix what is safe to fix.',
      rulesAuditRecheck: 'Check again',
      rulesAuditChecking: 'Comparing…',
      rulesAuditClean: 'Nothing disagrees: the rules describe this folder.',
      rulesAuditProblems: 'problems',
      rulesAuditNotes: 'notes',
      rulesAuditProblemTag: 'Problem',
      rulesAuditNoteTag: 'Note',
      rulesAuditNoFolder:
        'No folder is connected, so there is nothing to compare against. Only what the rules themselves show was checked: repeats and contradictions.',
      rulesAuditNoPackageJson: 'This folder has no package.json — the command does not exist here.',
      rulesAuditFix: 'Fix the safe ones',
      rulesAuditFixHint:
        'Repeats and lines pointing at what the folder no longer has are dropped. Contradictions are left alone: which half is right is your call.',
      rulesAuditFixed: 'Fixed:',
      rulesAuditRemovedDuplicates: 'repeats removed',
      rulesAuditRemovedReferences: 'dead references removed',
      rulesAuditAddedFrontmatter: 'frontmatter added',
      rulesAuditSaved: 'The corrected rules are saved on the project.',
      rulesAuditFailed: 'The rules could not be compared with the folder.',
      rulesAuditLine: 'line',
      rulesAuditAlso: 'also',
      rulesAuditKindDuplicateLine: 'The line repeats inside this file',
      rulesAuditKindDuplicateAcrossFiles: 'The same rule is in another rules file',
      rulesAuditKindContradiction: 'Contradiction: one line forbids what another allows',
      rulesAuditKindMissingFile: 'The file is not in the folder',
      rulesAuditKindMissingCommand: 'The script is not declared in package.json',
      rulesAuditKindMissingFrontmatter: 'Cursor would not read this: no frontmatter',
      rulesAuditKindInactiveFrontmatter: 'The rule can never apply by itself',
      rulesAuditKindEmptyDocument: 'The file holds no instruction at all',
      filesCount: 'files',
      fileMetadataTitle: 'File Metadata',
      symbolsTitle: 'Detected Symbols / Classes:',
      rulesTitle: 'Agent Rules Configuration File',
      factsTitle: 'What the files already implement',
      factsSubtext: 'Read from the real code: declarations, lines, and how finished each file is. No AI request.',
      statusImplemented: 'implemented',
      statusPartial: 'partial',
      statusStub: 'stub',
      statusEmpty: 'empty',
      mainEntryLabel: 'Entry point',
      scriptsWithCode: 'Scripts with code',
      testsPresent: 'tests present',
      testsMissing: 'no tests',
      analyzedFilesLabel: 'Files read',
      describeButton: 'AI: read what is already implemented',
      describingButton: 'AI is reading the files…',
      describeFailed: 'Could not read the project files.',
      insightsTitle: 'AI: what is already implemented',
      insightsEngine: 'Analysed by',
      insightsNextSteps: 'What to do next',
      fileInsightTitle: 'AI on this file',
      fileInsightEmpty: 'This file has no implemented code yet.',
      importsTitle: 'Imports',
      codeLinesLabel: 'lines of code'
    },
    brief: {
      overviewTitle: 'Project Overview',
      mvpScopeTitle: 'MVP Scope',
      nonGoalsTitle: 'Non-Goals',
      constraintsTitle: 'Technical Constraints',
      architectureTitle: 'Architecture Modules',
      dataFlowTitle: 'Data Flow',
      coreProblem: 'Core Problem Solved',
      coreValue: 'Core Value Proposition',
      mvpFeaturesTitle: 'MVP Core Features',
      techStack: 'Technology Stack',
      folderStructure: 'Folder Structure Blueprint',
      dataFlow: 'Data Flow & State Architecture',
      successCriteria: 'Success Criteria for MVP Completion'
    },
    savedDrawer: {
      title: 'Saved Projects',
      subtitle: 'List of saved projects',
      emptyNotice: 'No saved projects found.',
      currentBadge: 'Active',
      openProject: 'Open'
    },
    drawer: {
      title: 'Saved Projects',
      subtitle: 'Manage and switch between projects',
      emptyTitle: 'No saved projects yet',
      emptyNotice: 'Create a new project from an idea or pick a preset template stack.',
      currentBadge: 'Active',
      openProject: 'Open & Switch Project',
      deleteHint: 'Delete this project from the list',
      deleteConfirmTitle: 'Delete this project?',
      deleteConfirmNotice: 'The project disappears from the app. Files on disk are left untouched.'
    },
    setup: {
      modalTitle: 'Create New Project',
      tabIdea: 'From Idea Prompt',
      tabImport: 'Import Structure',
      projectNameLabel: 'Project Name',
      projectNamePlaceholder: 'e.g. Tower Defense Arcade',
      ideaLabel: 'Game or App Idea',
      ideaPlaceholder: 'Describe the core mechanics, gameplay loop, or application features...',
      platformLabel: 'Target Platform',
      stackLabel: 'Engine or Framework',
      agentLabel: 'Target AI Agent',
      techLevelLabel: 'Technical Level',
      autoSelectToggle: 'AI Smart Auto-Select',
      createButton: 'Generate MVP Architecture',
      analyzing: 'Analyzing Idea...',
      presetStacksTitle: 'Popular Stack Presets:',
      step1Title: 'Step 1: Idea & Stack',
      step2Title: 'Step 2: Clarification Questions',
      questionsTitle: 'Architecture Questions',
      backButton: 'Back to Idea',
      confirmCreateButton: 'Create Project',
      importNotice: 'Import existing project structure from repository or JSON map.',
      folderLabel: 'Project files folder',
      folderHelp:
        'Where the agent will write code: the app reads the files in this folder and changes only them.',
      folderChoose: 'Choose folder…',
      folderPlaceholder: 'Folder path (optional)',
      folderConnect: 'Connect',
      folderConnected: 'Folder connected',
      folderNotConnectedHint: 'The folder is not connected yet — press “Connect”',
      folderFiles: 'Files',
      folderChange: 'Change folder',
      folderKeepConnected: 'Keep this folder',
      engineLabel: 'Game engine or stack',
      enginePlaceholder: '— Choose an engine or stack —',
      ideaRequiredHint: 'Describe the idea so the AI has something to analyse.',
      startRequiresEngine:
        'Choose an engine or stack (or let the AI pick one) before the analysis can start.',
      modeBeginnerHint:
        'Step-by-step helper: four steps — folder, task, prompt, checking the answer. Technical sections stay hidden.',
      modeVibecoderHint: 'Full workspace, but the settings are chosen for you.',
      modeIntermediateHint: 'Full workspace with the context and file settings on screen.',
      modeAdvancedHint: 'Full workspace without hand-holding: everything at hand.',
      detailsShow: 'Show details and AI settings',
      detailsHide: 'Hide details and AI settings',
      detailsHint: 'Platform, AI agent, architectural pattern, MVP depth and quality guarantees.',
      aiBadge: 'AI suggested',
      aiBadgeHint: 'This value was suggested or changed by AI. Edit it yourself and the mark clears.',
      aiAnalyzeTitle: 'Idea analysis & AI stack pick',
      aiAnalyzeHint:
        'AI proposes the engine, pattern and platform for your description. Everything it fills in or changes is marked “AI suggested”.',
      aiAnalyze: 'Pick with AI',
      aiAnalyzeAgain: 'Re-run AI pick',
      aiAnalyzing: 'Analyzing the idea...',
      aiChangedFields: 'AI changed:',
      importUnderstandTitle: 'How the AI will understand your project',
      importUnderstandHint:
        'Connect the folder — the AI reads the README, manifests and key files and works out what this project is. Pasting a file list works too.',
      importUnderstandFolder: 'Read the folder and understand the project',
      importReading: 'The AI is reading the project files...',
      importUnderstandList: 'Understand the project from the file list',
      importListTitle: 'Or paste a folder tree / GitHub file list:',
      importUnderstoodTitle: 'The AI understood the project',
      importFilesRead: 'Files read',
      importPlanSummary: 'Plan: phases / tasks',
      importKeyFiles: 'Key files',
      importCreateContinue: 'Create the project and continue',
      importReRead: 'Read again'
    },
    apiSettings: {
      title: 'API Provider Settings',
      subtitle: 'Paste your key — it becomes active immediately, no restart required.',
      gemini: 'Google Gemini',
      openai: 'OpenAI',
      anthropic: 'Anthropic Claude',
      configured: 'Configured',
      notConfigured: 'Not Configured',
      envNotice: 'You can also provide keys through environment variables (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, NVIDIA_API_KEY) — they are used until a key is saved here.',
      fromApp: 'Connected (saved here)',
      fromEnv: 'Connected (environment variable)',
      activeProvider: 'Active provider',
      noProvider: 'no keys — the local engine is used',
      keyPlaceholder: 'Paste your API key',
      keyPlaceholderReplace: 'Paste a new key to replace the current one',
      keyLabel: 'API key',
      saveKey: 'Save',
      saving: 'Saving...',
      savedKey: 'Key saved and already active',
      testKey: 'Test',
      testing: 'Testing...',
      testFailed: 'The connection test could not run',
      testOk: 'Connection works',
      removeKey: 'Remove',
      removedKey: 'Key removed',
      show: 'Show',
      hide: 'Hide',
      getKey: 'Get a key',
      localOnly: 'Keys are stored only on this computer (data/api-keys.json, owner-only permissions) and are sent to the provider itself. The UI always shows them masked.',
      prefixWarning: 'this key does not look like a key for this provider — please double-check the copy',
      reasonAuth: 'The provider rejected this key',
      reasonQuota: 'Key accepted, but the quota or rate limit is exhausted',
      reasonModel: 'Key accepted, but no model is available for this account',
      reasonNetwork: 'Could not reach the provider — check your connection',
      reasonEmptyResponse: 'The provider returned an empty response',
      reasonMissing: 'No key configured',
      reasonHttp: 'The provider rejected the request',
      saveEmpty: 'Enter a key',
      saveInvalid: 'This key looks invalid: at least 20 characters with no spaces',
      saveFailed: 'The key could not be saved',
      accessDenied: 'Keys can only be changed from the computer that runs the app (localhost)',
      unknownProvider: 'Unknown provider',
      loadFailed: 'Could not load the key status',
      retry: 'Retry'
    },
    update: {
      available: 'Version available',
      willDownload: 'If you do not press Download, it is fetched in the background and applied at the next start.',
      download: 'Download',
      downloading: 'Downloading update',
      ready: 'Update ready:',
      readyHint: 'It is applied at the next start. You can restart now instead.',
      restart: 'Restart and update',
      failed: 'Could not check for updates',
      retry: 'Retry'
    }
  }
};
