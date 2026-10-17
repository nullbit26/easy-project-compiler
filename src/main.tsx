import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {LaunchSplash} from './components/LaunchSplash.tsx';
import {isSelfTestRun} from './utils/selfTest.ts';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = String(event.reason || '');
    if (reason.includes('WebSocket') || reason.includes('vite') || reason.includes('HMR')) {
      event.preventDefault();
    }
  });
}

/*
 * The app and its launch screen are rendered together, and the launch screen draws over the app for
 * as long as it plays. Two mounts rather than one is the point: the workspace can take a moment to
 * restore the project it was last working on, and a splash rendered *inside* App would be waiting for
 * exactly that work to finish before it could cover it.
 *
 * The one exception is a run that is checking itself: an animation covering the window is not
 * something a check about the window can measure, and it must not be taken out of the document by
 * hand either — the overlay belongs to React, and a page that removes React's own node comes apart
 * when React hides it a moment later. The shell says who started this run; the curtain is left out.
 */
const checkingItself = isSelfTestRun();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {!checkingItself && <LaunchSplash />}
  </StrictMode>,
);
