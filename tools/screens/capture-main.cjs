/**
 * The camera: an Electron window that opens the app, walks every screen and writes one PNG per
 * screen into a folder.
 *
 * It exists because a DOM query cannot show what a screen looks like, and the review loop needs
 * pictures: layout that overlaps, a card that grew a border, a title that came back — all of that is
 * obvious in an image and invisible in a test assertion.
 *
 * Started by tools/screens/capture-screens.mjs (npm run shots); the orchestrator knows the URL, the
 * output folder and the contact sheet, this file only drives the window.
 *
 * Environment:
 *   EPC_SHOT_URL     where the app answers (default http://127.0.0.1:3000)
 *   EPC_SHOT_DIR     where the PNGs go (default build/screenshots)
 *   EPC_SHOT_WIDTH   window width in CSS pixels (default 1440)
 *   EPC_SHOT_HEIGHT  window height in CSS pixels (default 900)
 *   EPC_SHOT_AUDIT   1 → also write build/screenshots/audit/<screen>.txt: the order the tab key
 *                    really walks, the ring each focused element draws, what each control is called,
 *                    and the contrast of the small text
 *   EPC_SHOT_ONLY    comma-separated screen files (e.g. 06-preview) to shoot only those
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_URL = process.env.EPC_SHOT_URL || 'http://127.0.0.1:3000';
const OUT_DIR = process.env.EPC_SHOT_DIR || path.join(process.cwd(), 'build', 'screenshots');
const WIDTH = Number(process.env.EPC_SHOT_WIDTH) || 1440;
const HEIGHT = Number(process.env.EPC_SHOT_HEIGHT) || 900;

/** The app's own title bar is up and the launch splash is gone: the screens can be photographed. */
const APP_READY = `(() => {
  const titleBar = document.querySelector('[data-testid="app-title-bar"]');
  const splash = document.querySelector('[data-testid="launch-splash"]');
  return Boolean(titleBar) && !splash;
})()`;

/**
 * Every screen of the app, in the order the sidebar lists them, plus the two modals that are worth
 * a picture: the creation wizard and the API keys panel.
 */
const SCREENS = [
  { file: '01-wizard', hash: '#/', open: 'wizard', focus: 'Создание нового проекта' },
  { file: '02-dashboard', hash: '#/' },
  { file: '03-simple', hash: '#/simple' },
  { file: '04-compiler', hash: '#/compiler' },
  { file: '05-review', hash: '#/review' },
  { file: '06-preview', hash: '#/preview' },
  { file: '07-coach', hash: '#/coach' },
  { file: '08-plan', hash: '#/plan' },
  { file: '08b-studio', hash: '#/studio' },
  { file: '09-map', hash: '#/map' },
  { file: '10-files', hash: '#/files' },
  { file: '11-brief', hash: '#/brief' },
  { file: '12-api-keys', hash: '#/', open: 'apiKeys', focus: 'Настройки API' }
];

/**
 * The project the pictures are taken with: a small game with a plan, a folder and one open task, so
 * every screen has something to show instead of an empty state. It is written into the app's own
 * storage, which is why the window is reloaded right after (see `seed`).
 */
function demoProject() {
  return {
    id: 'screenshot-demo',
    name: 'Пивные шахматы',
    projectType: 'Phaser.js',
    engineOrFramework: 'Phaser.js 3 (Canvas)',
    language: 'TypeScript',
    selectedAgent: 'DeepSeek / Web Chat',
    technicalLevel: 'Advanced',
    interfaceMode: 'full',
    interfaceModeChosen: true,
    autonomyLevel: 'Intermediate',
    nextBestAction: 'Добавить перетаскивание фигур мышью',
    brief: {
      id: 'brief-1',
      projectName: 'Пивные шахматы',
      tagline: 'Классические шахматы в форме кружек пива',
      targetAudience: 'Любители настольных игр и пива',
      coreProblem: 'Шахматы выглядят скучно для новичков',
      coreValue: 'Знакомые правила в весёлой подаче',
      mvpFeatures: ['Доска 8×8', 'Ходы мышью', 'Проверка шаха'],
      futureFeatures: ['Онлайн-игра'],
      nonGoals: ['Рейтинговая система'],
      technicalConstraints: ['Только браузер'],
      successCriteria: ['Партия проходится без ошибок']
    },
    architecture: {
      technologyStack: ['Phaser.js', 'TypeScript'],
      folderStructure: ['src/scenes', 'src/entities'],
      coreEntities: ['Board', 'Piece', 'Move'],
      dataFlow: 'input -> scene -> board state -> render',
      testingStrategy: 'vitest для правил ходов',
      deploymentPlan: 'static hosting',
      securityRisks: []
    },
    projectMap: {
      projectName: 'Пивные шахматы',
      projectType: 'Phaser.js',
      engineOrFramework: 'Phaser.js 3 (Canvas)',
      language: 'TypeScript',
      rulesFiles: ['AGENTS.md'],
      files: [
        { path: 'src/main.ts', type: 'code', description: 'Точка входа' },
        { path: 'src/scenes/BoardScene.ts', type: 'code', description: 'Сцена доски' },
        { path: 'src/entities/Piece.ts', type: 'code', description: 'Фигуры-кружки' }
      ]
    },
    phases: [
      {
        id: 'phase_0',
        phaseNumber: 0,
        title: 'Основа',
        purpose: 'Каркас проекта',
        deliverable: 'Рабочая доска',
        tasks: [
          {
            id: 'task_0_0',
            phaseId: 'phase_0',
            title: 'Нарисовать доску 8×8 кружками',
            goal: 'Доска собирается из плиток-кружек',
            status: 'ready',
            relevantFiles: ['src/scenes/BoardScene.ts'],
            acceptanceCriteria: [
              { id: 'ac_0_0_0', description: 'Доска видна целиком', passed: false }
            ],
            testRequirements: [],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: [],
            progressPercent: 0
          },
          {
            id: 'task_0_1',
            phaseId: 'phase_0',
            title: 'Расстановка фигур перед партией',
            goal: 'Все фигуры стоят на стартовых клетках',
            status: 'backlog',
            relevantFiles: ['src/entities/Piece.ts'],
            acceptanceCriteria: [],
            testRequirements: [],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: [],
            progressPercent: 0
          }
        ]
      }
    ],
    recentErrors: [],
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function js(win, expression) {
  return win.webContents.executeJavaScript(expression, true);
}

/** Waits for a condition inside the page, and says so plainly when it never becomes true. */
async function waitUntil(win, expression, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await js(win, expression)) return true;
    } catch {
      /* the page may be between loads; ask again */
    }
    await wait(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * A picture of the window.
 *
 * An offscreen window draws without ever being shown, which is what keeps this command from
 * flicking a window over whatever the person is doing. Some systems answer an offscreen capture with
 * an empty image, so the first one is checked and a visible window is used instead when that
 * happens.
 */
/**
 * A picture of the window, plus a small copy of it for the contact sheet.
 *
 * The sheet is opened in the preview panel, which serves the HTML file and nothing beside it: a
 * relative <img src="01-wizard.png"> in that panel is a 404 and the page looks blank. So the sheet
 * carries its own pictures, and they are thumbnails — twelve full-size PNGs inlined would be a
 * multi-megabyte page for pictures shown at a third of the size.
 */
async function capture(win, file) {
  const image = await win.webContents.capturePage();
  if (image.isEmpty()) return false;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, file), image.toPNG());

  const thumbDir = path.join(OUT_DIR, 'thumbs');
  fs.mkdirSync(thumbDir, { recursive: true });
  const width = Math.min(760, image.getSize().width);
  fs.writeFileSync(path.join(thumbDir, file.replace(/\.png$/, '.jpg')), image.resize({ width }).toJPEG(72));
  return true;
}

/**
 * The same picture in words.
 *
 * A PNG is for a person (and for an agent that can be shown images); this is for an agent that reads
 * text: the boxes of the active screen, their size, their background and border, and the first words
 * inside them. It answers the questions a check normally asks — did a title come back, did a control
 * row grow a frame, is the footer still borderless — without needing the picture to be looked at.
 *
 * Written next to the PNGs, as build/screenshots/digest/<screen>.txt.
 */
async function writeDigest(win, file, focusText) {
  const digest = await js(
    win,
    `(() => {
      const main = document.querySelector('main');
      if (!main) return null;
      const active = Array.from(main.querySelectorAll(':scope > div > div')).find(
        (el) => el.getAttribute('aria-hidden') !== 'true'
      );
      if (!active) return null;

      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const colour = (value) => (/rgba?\\(0, 0, 0, 0\\)/.test(value) ? '-' : value);
      const borders = (style) => {
        const sides = ['Top', 'Right', 'Bottom', 'Left'];
        const drawn = sides
          .filter((side) => style['border' + side + 'Style'] !== 'none' && parseFloat(style['border' + side + 'Width']) > 0)
          .map((side) => parseFloat(style['border' + side + 'Width']));
        if (drawn.length === 0) return '-';
        return Math.max(...drawn) + 'px ' + style.borderTopColor;
      };
      const describe = (el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const cls = String(el.className || '').replace(/\\s+/g, ' ').trim();
        return {
          tag: el.tagName.toLowerCase(),
          cls: cls.length > 70 ? cls.slice(0, 67) + '...' : cls,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          bg: colour(style.backgroundColor),
          border: borders(style),
          radius: style.borderTopLeftRadius,
          text: clean(el.innerText).slice(0, 64)
        };
      };

      const lines = [];
      const walk = (el, depth, pathLabel) => {
        const box = describe(el);
        if (box.w < 8 || box.h < 8) return;
        lines.push(
          '  '.repeat(depth) +
            pathLabel +
            ' ' + box.tag +
            (box.cls ? '.' + box.cls.replace(/ /g, '.') : '') +
            '  ' + box.w + '×' + box.h + ' @' + box.x + ',' + box.y +
            '  bg ' + box.bg +
            '  border ' + box.border +
            '  r ' + box.radius +
            (box.text ? '  «' + box.text + '»' : '')
        );
        if (depth >= 2) return;
        const children = Array.from(el.children).filter((child) => {
          const r = child.getBoundingClientRect();
          return r.width >= 8 && r.height >= 8;
        });
        children.slice(0, 8).forEach((child, index) => walk(child, depth + 1, pathLabel + '.' + (index + 1)));
      };

      walk(active, 0, '1');

      // A modal does not live inside the screen: it is drawn over the whole window, in its own
      // overlay. It is described separately, so the picture of the wizard says what the wizard is.
      const focus = ${JSON.stringify(focusText ?? '')};
      const modalLines = [];
      let overlayBox = null;
      if (focus) {
        // The deepest element carrying the words: the heading itself may hold an icon, so looking
        // for a childless element finds nothing. Ancestors come first in document order, so the
        // last match is the innermost one.
        const carrying = Array.from(document.querySelectorAll('*')).filter((el) =>
          (el.textContent || '').includes(focus)
        );
        const needle = carrying[carrying.length - 1];
        let node = needle;
        while (node && node !== document.body) {
          const cls = String(node.className || '');
          if (/fixed|z-\\[?\\d|absolute inset-0/.test(cls)) break;
          node = node.parentElement;
        }
        if (node && node !== document.body) overlayBox = node;
      }

      // Whether a dialog is open is asked independently of the expected heading: a screen that was
      // photographed with the wizard still on top would otherwise be described as a clean screen,
      // which is exactly how eleven contaminated frames looked like a good run.
      if (!overlayBox) {
        overlayBox = Array.from(document.querySelectorAll('body *')).find((el) => {
          const style = getComputedStyle(el);
          if (style.position !== 'fixed' || style.visibility === 'hidden' || style.display === 'none') return false;
          const r = el.getBoundingClientRect();
          return (
            r.width >= window.innerWidth * 0.9 &&
            r.height >= window.innerHeight * 0.9 &&
            el.querySelector('button')
          );
        });
      }

      if (overlayBox) {
        const inner = Array.from(overlayBox.children).filter((child) => {
          const r = child.getBoundingClientRect();
          return r.width >= 40 && r.height >= 40;
        });
        inner.slice(0, 3).forEach((child, index) => {
          const box = describe(child);
          modalLines.push(
            '  .' + (index + 1) + ' ' + box.tag +
              (box.cls ? '.' + box.cls.replace(/ /g, '.') : '') +
              '  ' + box.w + '×' + box.h + ' @' + box.x + ',' + box.y +
              '  bg ' + box.bg +
              '  border ' + box.border +
              '  r ' + box.radius +
              (box.text ? '  «' + box.text + '»' : '')
          );
        });
        overlayBox = describe(overlayBox);
      }

      const footer = document.querySelector('[data-testid="sidebar-footer"]');
      const footerLine = footer ? '  ' + JSON.stringify(describe(footer)) : 'n/a';
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        lines,
        modal: overlayBox,
        modalLines,
        footer: footerLine
      };
    })()`,
    true
  );

  if (!digest) return;
  const text = [
    `Экран: ${file.replace(/\.png$/, '')}`,
    `Ссылка: ${win.webContents.getURL()}`,
    `Окно: ${digest.viewport.width}×${digest.viewport.height}`,
    '',
    'Активный экран, блоки (глубина 2):',
    ...digest.lines,
    '',
    'Модальное окно поверх экрана:',
    digest.modal ? '  оверлей ' + digest.modal.w + '×' + digest.modal.h + ' @' + digest.modal.x + ',' + digest.modal.y : '  нет',
    ...digest.modalLines,
    '',
    'Нижняя панель слева:',
    digest.footer
  ].join('\n');
  const dir = path.join(OUT_DIR, 'digest');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${file.replace(/\.png$/, '')}.txt`), `${text}\n`);
}

/**
 * The screen, in full.
 *
 * The digest stops at two levels because it is a map of the page; a review needs the whole tree:
 * every box with its padding, its corner, its border, its background and the type of the words in it.
 * That is what tells a reviewer whether two cards use the same numbers, whether a caption repeats the
 * heading above it, or whether a row of controls has grown a frame it does not need.
 *
 * Written next to the digest as build/screenshots/outline/<screen>.txt.
 */
async function writeOutline(win, file, focusText) {
  const outline = await js(
    win,
    `(() => {
      const main = document.querySelector('main');
      if (!main) return null;
      const active = Array.from(main.querySelectorAll(':scope > div > div')).find(
        (el) => el.getAttribute('aria-hidden') !== 'true'
      );
      if (!active) return null;

      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const colour = (value) => (/rgba?\\(0, 0, 0, 0\\)/.test(value) ? '-' : value);
      const borders = (style) => {
        const sides = ['Top', 'Right', 'Bottom', 'Left'];
        const drawn = sides.filter(
          (side) => style['border' + side + 'Style'] !== 'none' && parseFloat(style['border' + side + 'Width']) > 0
        );
        if (drawn.length === 0) return '-';
        if (drawn.length === 4) return Math.max(...drawn.map((side) => parseFloat(style['border' + side + 'Width']))) + 'px';
        return drawn.map((side) => side[0].toLowerCase() + parseFloat(style['border' + side + 'Width'])).join('/');
      };
      const pad = (style) => {
        const v = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((p) =>
          Math.round(parseFloat(p) || 0)
        );
        return v[0] === v[1] && v[0] === v[2] && v[0] === v[3] ? String(v[0]) : v.join(',');
      };

      const lines = [];
      const walk = (el, depth) => {
        if (lines.length > 900) return;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        const style = getComputedStyle(el);
        const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')
          .replace(/\\s+/g, ' ')
          .trim();
        const text = clean(el.innerText);
        const bg = colour(style.backgroundColor);
        const border = borders(style);
        const hasChildren = el.children.length > 0;
        const worth = hasChildren || text || bg !== '-' || border !== '-';
        if (worth) {
          lines.push(
            '  '.repeat(depth) +
              el.tagName.toLowerCase() +
              (cls ? '.' + cls.replace(/ /g, '.') : '') +
              '  ' + Math.round(r.width) + '×' + Math.round(r.height) +
              ' @' + Math.round(r.x) + ',' + Math.round(r.y) +
              '  bg ' + bg +
              '  b ' + border +
              '  r ' + (parseFloat(style.borderTopLeftRadius) ? Math.round(parseFloat(style.borderTopLeftRadius)) : 0) +
              '  p ' + pad(style) +
              '  ' + Math.round(parseFloat(style.fontSize)) + 'px' +
              (parseInt(style.fontWeight, 10) >= 600 ? ' bold' : '') +
              (text ? '  «' + text.slice(0, 90) + '»' : '')
          );
        }
        if (depth >= 9) return;
        Array.from(el.children).forEach((child) => walk(child, worth ? depth + 1 : depth));
      };

      // The modal is not a child of <body>: the deepest element carrying its heading is found first,
      // then the ancestor that actually covers the window is the overlay.
      const focus = ${JSON.stringify(focusText ?? '')};
      let modalFocus = null;
      if (focus) {
        const carrying = Array.from(document.querySelectorAll('*')).filter((el) => (el.textContent || '').includes(focus));
        let node = carrying[carrying.length - 1];
        while (node && node !== document.body) {
          const cls = String(node.className || '');
          if (/fixed|absolute inset-0/.test(cls)) {
            modalFocus = node;
            break;
          }
          node = node.parentElement;
        }
      }
      walk(active, 0);
      let modalLines = [];
      if (modalFocus) {
        const before = lines.length;
        walk(modalFocus, 0);
        modalLines = lines.splice(before);
      }

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollHeight: document.documentElement.scrollHeight,
        lines,
        modalLines
      };
    })()`,
    true
  );

  if (!outline) return;
  const text = [
    `Экран: ${file.replace(/\.png$/, '')}`,
    `Ссылка: ${win.webContents.getURL()}`,
    `Окно: ${outline.viewport.width}×${outline.viewport.height}, документ ${outline.scrollHeight}px`,
    '',
    'Экран:',
    ...outline.lines,
    ...(outline.modalLines.length ? ['', 'Модальное окно:', ...outline.modalLines] : [])
  ].join('\n');
  const dir = path.join(OUT_DIR, 'outline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${file.replace(/\.png$/, '')}.txt`), `${text}\n`);
}

/**
 * The screen read the way a keyboard and a screen reader read it.
 *
 * Three questions a picture cannot answer, asked of every screen: what the tab key walks through and
 * in which order, whether the thing it lands on can be seen at all, and whether the small grey text
 * on a dark panel can be read. Each focusable element is focused for real — a rule that *looks* like
 * it draws a ring is not the same as a ring appearing — and the text is measured against the surface
 * behind it (WCAG AA: 4.5, or 3 for large text).
 *
 * Written next to the digest as build/screenshots/audit/<screen>.txt.
 */
async function writeAudit(win, file) {
  const audit = await js(
    win,
    `(() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      };
      /*
        The name the way a browser works it out, in the order the specification puts the sources:
        aria-labelledby, aria-label, the label that wraps the control, the label pointing at it by id,
        then title, placeholder and the text inside. The input's own value is deliberately not in the
        list: a box with value="on" has no name at all, and counting that would call every checkbox
        labelled.
      */
      const nameOf = (el) => {
        const answer = (text, source) => ({ text: clean(text), source });
        const labelled = el.getAttribute('aria-labelledby');
        if (labelled) {
          const text = clean(labelled.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '));
          if (text) return answer(text, 'aria-labelledby');
        }
        const aria = clean(el.getAttribute('aria-label'));
        if (aria) return answer(aria, 'aria-label');
        const wrapping = el.closest('label');
        if (wrapping) {
          const text = clean(wrapping.innerText);
          if (text) return answer(text, 'label');
        }
        if (el.id) {
          const owner = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          const text = owner ? clean(owner.innerText) : '';
          if (text) return answer(text, 'label[for]');
        }
        const title = clean(el.getAttribute('title'));
        if (title) return answer(title, 'title');
        /* A placeholder is read out as a last resort, and it disappears the moment there is something
           to read — which is why the report keeps this class apart from the rest. */
        const placeholder = clean(el.getAttribute('placeholder'));
        if (placeholder) return answer(placeholder, 'placeholder');
        const alt = clean(el.getAttribute('alt'));
        if (alt) return answer(alt, 'alt');
        return answer(el.innerText || '', 'text');
      };
      const tabbable = Array.from(
        document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => visible(el) && !el.disabled && el.getAttribute('aria-hidden') !== 'true');

      /*
        The order, as the page declares it. Whether the ring appears is a separate question, asked
        by pressing Tab for real. A programmatic focus() never matches :focus-visible, so asking the
        page right after el.focus() reports "no ring" even when the CSS draws one.
      */
      const entries = tabbable.map((el, index) => {
        const rect = el.getBoundingClientRect();
        const named = nameOf(el);
        return {
          index: index + 1,
          tag: el.tagName.toLowerCase(),
          cls: clean(el.className).slice(0, 40),
          name: named.text.slice(0, 60),
          nameSource: named.source,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        };
      });

      /*
        Text, measured against the first opaque surface behind it.

        Colours are read by painting a pixel and looking at it: this app's palette comes from
        Tailwind, whose computed values are oklch(), and a regex looking for rgb() found nothing at
        all — which read as "the contrast is perfect" on every screen.
      */
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const colourCache = new Map();
      const parse = (value) => {
        if (colourCache.has(value)) return colourCache.get(value);
        let out = null;
        try {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = value;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          out = { r, g, b, a: a / 255 };
        } catch {
          out = null;
        }
        colourCache.set(value, out);
        return out;
      };
      /** Laid out and drawn, whether or not it happens to be inside the current viewport. */
      const laidOut = (el) => {
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 2 && rect.height >= 2;
      };
      const luminance = ({ r, g, b }) => {
        const channel = (v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const surface = (el) => {
        let node = el;
        while (node && node !== document.documentElement) {
          const bg = parse(getComputedStyle(node).backgroundColor);
          if (bg && bg.a > 0.5) return bg;
          node = node.parentElement;
        }
        return { r: 2, g: 6, b: 23, a: 1 };
      };

      const contrast = [];
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (contrast.length > 400) break;
        if (!laidOut(el)) continue;
        /* A disabled control is exempt from the contrast rule (WCAG 1.4.3): it is inactive, and its
           grey is the signal that it is. */
        if (el.closest('[disabled], [aria-disabled="true"]')) continue;
        const own = Array.from(el.childNodes).some((node) => node.nodeType === 3 && node.textContent.trim().length > 1);
        if (!own) continue;
        const style = getComputedStyle(el);
        const fg = parse(style.color);
        if (!fg || fg.a < 0.5) continue;
        const bg = surface(el);
        const lightest = Math.max(luminance(fg), luminance(bg));
        const darkest = Math.min(luminance(fg), luminance(bg));
        const ratio = (lightest + 0.05) / (darkest + 0.05);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
        const required = large ? 3 : 4.5;
        if (ratio + 0.05 < required) {
          contrast.push({
            ratio: Number(ratio.toFixed(2)),
            size: Math.round(size),
            color: style.color,
            bg: 'rgb(' + [bg.r, bg.g, bg.b].join(', ') + ')',
            text: clean(el.innerText).slice(0, 60)
          });
        }
      }

      /* The walk needs the same answer as the list above, so it borrows these two functions. */
      window.__auditName = nameOf;

      const ratios = contrast.map((item) => item.ratio);
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        total: entries.length,
        entries,
        unnamed: entries.filter((entry) => entry.name.length === 0),
        contrast: contrast.sort((a, b) => a.ratio - b.ratio),
        worst: ratios.length ? Math.min(...ratios) : null
      };
    })()`,
    true
  );

  if (!audit) return;

  /*
    The ring, asked the honest way: press Tab and look at whatever holds focus afterwards. Chromium
    paints :focus-visible only for keyboard focus, so this is the single reading that can see the
    ring at all — and it walks the order the user really gets, not the one the DOM declares.
  */
  await js(win, `(() => {
    window.__auditEls = [];
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (document.body) document.body.focus();
    return true;
  })()`, true);
  const walk = [];
  const seen = new Set();
  /*
    The key is dispatched through the debugger, not through sendInputEvent: only a real key event
    flips Chromium's "the last input came from the keyboard" flag, and only that flag makes
    :focus-visible match. With a synthetic key the page moves focus exactly the same way — and then
    reports, on every single element, that nothing is drawn. The filter was ruling out the CSS.
  */
  let tab = null;
  try {
    win.webContents.debugger.attach('1.3');
    tab = async () => {
      const send = (type) =>
        win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type,
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9
        });
      await send('rawKeyDown');
      await send('keyUp');
    };
  } catch {
    /* A debugger already attached is not a reason to give up: the order still reads, only the ring does not. */
    tab = null;
  }
  for (let step = 0; tab && walk.length < 200; step += 1) {
    await tab();
    await wait(30);
    const hit = await js(
      win,
      `(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return null;
        if (!el.dataset.auditId) el.dataset.auditId = 'w' + (window.__auditSeq = (window.__auditSeq || 0) + 1);
        const s = getComputedStyle(el);
        const cls = typeof el.className === 'string' ? el.className : '';
        const named = window.__auditName ? window.__auditName(el) : { text: '', source: 'none' };
        const name = named.text.slice(0, 60);
        /* Held by reference: the walk scrolls the page as it goes, so positions have to be read
           afterwards, in one pass, or the order looks like it jumps when the page merely moved. */
        window.__auditEls.push(el);
        return {
          id: el.dataset.auditId,
          tag: el.tagName.toLowerCase(),
          cls: cls.trim().split(/\\s+/).slice(0, 2).join(' '),
          name,
          nameSource: named.source,
          focusVisible: el.matches(':focus-visible'),
          ring: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'
        };
      })()`,
      true
    );
    if (!hit) break;
    if (seen.has(hit.id)) break;
    seen.add(hit.id);
    walk.push({ ...hit, index: walk.length + 1 });
  }
  if (tab) {
    try {
      win.webContents.debugger.detach();
    } catch {
      /* nothing to detach */
    }
  }

  /*
    Where the element sits in the document, not where it happened to be on screen: the sum of the
    offsetParent chain ignores scrolling, so two readings taken at different moments are comparable.
  */
  const where = await js(
    win,
    `(() => (window.__auditEls || []).map((el) => {
      let x = 0, y = 0, node = el;
      while (node) {
        x += node.offsetLeft || 0;
        y += node.offsetTop || 0;
        node = node.offsetParent;
      }
      const rect = el.getBoundingClientRect();
      return { x: Math.round(x), y: Math.round(y), w: Math.round(rect.width), h: Math.round(rect.height) };
    }))()`,
    true
  );
  (where || []).forEach((box, index) => {
    if (walk[index]) Object.assign(walk[index], box);
  });

  const noRing = walk.filter((entry) => !entry.ring);
  /* Asked of the walk, not of the DOM: a control behind an open dialog is unreachable, not unlabelled. */
  const unnamed = walk.filter((entry) => entry.name.length === 0);
  const placeholderOnly = walk.filter((entry) => entry.nameSource === 'placeholder');
  /* A jump upwards by a card's height is a trap: the eye loses the place it had. */
  const jumps = [];
  for (let i = 1; i < walk.length; i += 1) {
    const previous = walk[i - 1];
    const current = walk[i];
    if (previous.y === undefined || current.y === undefined) continue;
    if (current.y < previous.y - 40 && current.x <= previous.x + 8) {
      jumps.push({ from: previous, to: current });
    }
  }
  const line = (entry) =>
    `  ${String(entry.index).padStart(3)} ${entry.tag}${entry.cls ? '.' + entry.cls.replace(/ /g, '.') : ''}  @` +
    `${entry.x},${entry.y} ${entry.w}×${entry.h}  «${entry.name}»`;
  const text = [
    `Экран: ${file.replace(/\.png$/, '')}`,
    `Ссылка: ${win.webContents.getURL()}`,
    `Фокусируемых элементов в DOM: ${audit.total}; Tab дошёл до: ${walk.length}`,
    `Самый слабый контраст: ${audit.worst === null ? 'все тексты прошли AA' : audit.worst}`,
    '',
    `Без имени (aria-label, label, title, текст): ${unnamed.length}`,
    ...unnamed.slice(0, 30).map(line),
    '',
    `Названы только placeholder-ом (исчезает при вводе): ${placeholderOnly.length}`,
    ...placeholderOnly.slice(0, 30).map(line),
    '',
    `Без видимого кольца фокуса: ${noRing.length}`,
    ...noRing.slice(0, 30).map(line),
    '',
    `Текст ниже AA: ${audit.contrast.length}`,
    ...audit.contrast.slice(0, 30).map(
      (item) => `  ${item.ratio} (нужно 4.5) ${item.size}px ${item.color} на ${item.bg}  «${item.text}»`
    ),
    '',
    `Обратные скачки в порядке обхода: ${jumps.length}`,
    ...jumps.slice(0, 15).map((jump) => `  №${jump.from.index} y=${jump.from.y} → №${jump.to.index} y=${jump.to.y}`),
    '',
    'Реальный порядок обхода (Tab):',
    ...walk.map(line)
  ].join('\n');
  const dir = path.join(OUT_DIR, 'audit');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${file.replace(/\.png$/, '')}.txt`), `${text}\n`);

  return {
    screen: file.replace(/\.png$/, ''),
    total: audit.total,
    walked: walk.length,
    unnamed: unnamed.length,
    placeholderOnly: placeholderOnly.length,
    noRing: noRing.length,
    contrast: audit.contrast.length,
    worst: audit.worst,
    jumps: jumps.length
  };
}

function createWindow(offscreen) {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: !offscreen,
    skipTaskbar: !offscreen,
    backgroundColor: '#020617',
    webPreferences: {
      offscreen,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  win.setMenuBarVisibility(false);
  return win;
}

/**
 * The wizard is opened by the sidebar's own "+" (title `Создать проект`): the dashed entry in the
 * projects list is a div, not a button, so a text search finds nothing to click.
 */
async function openWizard(win) {
  const clicked = await js(
    win,
    `(() => {
      const button = document.querySelector('button[title="Создать проект"]');
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!clicked) throw new Error('no button to open the creation wizard');
  await waitUntil(win, `Boolean(document.body.innerText.match(/Создание нового проекта/))`, 8000, 'the wizard');
}

async function openApiKeys(win) {
  const clicked = await js(
    win,
    `(() => {
      const button = document.querySelector('button[title="Настройки API-ключей"]');
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!clicked) throw new Error('no button to open the API keys panel');
  await waitUntil(
    win,
    `Boolean(document.body.innerText.includes('Настройки API'))`,
    8000,
    'the API keys panel'
  );
}

/**
 * Whether a modal is covering the window right now.
 *
 * The screenshots are taken with the wizard and the API panel closed, and a close that silently did
 * nothing would put the same dialog on eleven frames while every digest still described the screen
 * behind it. This asks the page directly, so the run can say which screen still had a dialog open.
 */
/**
 * The fixed element that covers the window and holds buttons — i.e. an open dialog.
 *
 * Read from computed styles, not from class names: the layout also uses `fixed` for the sidebar and
 * for floating controls, and a `fixed` class match picked one of those instead of the dialog, which
 * is how a close was reported as "no close button" while the wizard stayed on screen.
 */
const OVERLAYS = `(Array.from(document.querySelectorAll('body *')).filter((el) => {
  const style = getComputedStyle(el);
  if (style.position !== 'fixed' || style.visibility === 'hidden' || style.display === 'none') return false;
  const r = el.getBoundingClientRect();
  return (
    r.width >= window.innerWidth * 0.9 &&
    r.height >= window.innerHeight * 0.9 &&
    el.querySelector('button')
  );
}))`;
const MODAL_OPEN = `(${OVERLAYS}.length > 0)`;

/**
 * Closes the dialog that is open, and only counts it done once it is gone.
 *
 * The button is looked for inside the overlay, not in the document: the API keys panel's close is
 * labelled the same way as the wizard's, and a document-wide search could press the wrong one. The
 * wait is what turns "a click was sent" into "the dialog closed".
 */
async function closeModal(win) {
  if (!(await js(win, MODAL_OPEN))) return;
  const pressed = await js(
    win,
    `(() => {
      const overlay = ${OVERLAYS}[0];
      if (!overlay) return 'no overlay';
      const buttons = Array.from(overlay.querySelectorAll('button'));
      const target =
        buttons.find((el) => (el.getAttribute('aria-label') || '') === 'Закрыть') ||
        buttons.find((el) => /Закрыть/.test(el.textContent || '')) ||
        buttons.find((el) => (el.textContent || '').trim() === '✕');
      if (!target) return 'no close button';
      target.click();
      return 'clicked';
    })()`
  );
  if (pressed !== 'clicked') throw new Error(`the dialog could not be closed: ${pressed}`);
  await waitUntil(win, `!(${MODAL_OPEN})`, 4000, 'the dialog to close');
  await wait(250);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const report = { url: APP_URL, outDir: OUT_DIR, size: { width: WIDTH, height: HEIGHT }, shots: [], mode: 'offscreen' };
  let win;

  try {
    // The origin has to be open before its storage can be written, so the project is seeded into a
    // first (throwaway) load and the second one starts with it.
    win = createWindow(true);
    await win.loadURL(APP_URL);
    await waitUntil(win, APP_READY, 30000, 'the app to finish starting');
    await js(
      win,
      `(() => {
        localStorage.setItem('easy_project_compiler_projects', ${JSON.stringify(
          JSON.stringify([demoProject()])
        )});
        localStorage.setItem('easy_project_compiler_current_project', ${JSON.stringify(
          JSON.stringify(demoProject())
        )});
        localStorage.setItem('easy_project_compiler_lang', 'ru');
        return true;
      })()`
    );
    await win.webContents.reload();
    await waitUntil(win, APP_READY, 30000, 'the app to start with the demo project');

    const probe = await win.webContents.capturePage();
    if (probe.isEmpty()) {
      report.mode = 'visible';
      win.destroy();
      win = createWindow(false);
      await win.loadURL(APP_URL);
      await waitUntil(win, APP_READY, 30000, 'the app to start again');
    }

    /* EPC_SHOT_ONLY=03-simple,07-coach walks only those screens; the rest are left untouched. */
    const only = (process.env.EPC_SHOT_ONLY || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const screens = only.length ? SCREENS.filter((screen) => only.includes(screen.file)) : SCREENS;

    for (const screen of screens) {
      try {
        await js(win, `location.hash = ${JSON.stringify(screen.hash)}; true`);
        await wait(400);
        if (screen.open === 'wizard') await openWizard(win);
        if (screen.open === 'apiKeys') await openApiKeys(win);
        await wait(700);
        /*
         * EPC_SHOT_RIGHTCLICK=<selector> opens a context menu before the picture: a menu is a state,
         * not a screen, so it cannot be reached by a hash and has to be opened by the shot itself.
         */
        if (process.env.EPC_SHOT_RIGHTCLICK) {
          const selector = JSON.stringify(process.env.EPC_SHOT_RIGHTCLICK);
          await js(
            win,
            `(() => {
              const el = document.querySelector(${selector});
              if (!el) return false;
              const box = el.getBoundingClientRect();
              el.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, button: 2,
                clientX: Math.round(box.left + box.width / 2),
                clientY: Math.round(box.top + box.height / 2)
              }));
              return true;
            })()`
          );
          await wait(400);
        }
        const overlayOpen = await js(win, MODAL_OPEN);
        if (overlayOpen && !screen.open) {
          throw new Error('a dialog was still open over this screen');
        }
        const ok = await capture(win, `${screen.file}.png`);
        await writeDigest(win, `${screen.file}.png`, screen.focus);
        if (process.env.EPC_SHOT_OUTLINE === '1') await writeOutline(win, `${screen.file}.png`, screen.focus);
        if (process.env.EPC_SHOT_AUDIT === '1') {
          const summary = await writeAudit(win, `${screen.file}.png`);
          if (summary) report.audit = [...(report.audit || []), summary];
        }
        report.shots.push({ file: `${screen.file}.png`, hash: screen.hash, ok });
        /* Closed only after the picture: the wizard and the API panel are screens of their own. */
        if (screen.open) await closeModal(win);
      } catch (error) {
        // A screen that cannot be reached still gets a picture: the frame that failed is what says
        // why, and the rest of the run carries on instead of losing every other screen with it.
        const diagnostic = `${screen.file}.failed.png`;
        try {
          await capture(win, diagnostic);
        } catch {
          /* the window itself is gone; the report still names the screen and the error */
        }
        // The failed screen may already be in the list (a picture that was taken, then a dialog
        // that would not close): one entry per screen, and the entry says what went wrong.
        const entry = {
          file: `${screen.file}.png`,
          hash: screen.hash,
          ok: false,
          error: error.message,
          diagnostic
        };
        const already = report.shots.findIndex((shot) => shot.file === entry.file);
        if (already >= 0) report.shots[already] = entry;
        else report.shots.push(entry);
        await closeModal(win).catch(() => {});
      }
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(report, null, 2));
    console.log(`SCREENSHOTS_JSON ${JSON.stringify(report)}`);
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error('the screenshots could not be taken:', error);
    try {
      win?.destroy();
    } catch {
      /* the window is already gone */
    }
    app.exit(1);
  }
});
