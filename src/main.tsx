import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {LaunchSplash} from './components/LaunchSplash.tsx';
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
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <LaunchSplash />
  </StrictMode>,
);
