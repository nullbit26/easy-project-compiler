/// <reference types="vite/client" />

/*
 * Importing a file the bundler handles instead of a module — the launch logo, in this case — needs
 * the bundler's own declarations. Without this, `import logo from './assets/x.webp'` is a type error
 * even though it builds, so the picture ends up loaded by an untyped `require`-style dance or, worse,
 * by a path string that stops working the moment it is not served from the project root.
 */
