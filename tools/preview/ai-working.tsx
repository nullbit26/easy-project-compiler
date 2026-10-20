import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { AiActivityIndicator } from '../../src/components/AiActivityIndicator';
import { resetAiActivityForTests, trackAiRequest } from '../../src/services/aiActivity';

/**
 * The AI status card as the app shows it, with a request that never settles.
 *
 * A development page, not part of the app. The card is the real component and the activity is the
 * real store — the only fake thing is the request, which is held open so the working state can be
 * looked at for as long as needed. Nothing here is wired into the app.
 */

const Hold: React.FC = () => {
  useEffect(() => {
    resetAiActivityForTests();
    // Never resolves: this is the "model is thinking" state, held still for inspection.
    void trackAiRequest('compile', () => new Promise<never>(() => {}));
  }, []);

  return <AiActivityIndicator />;
};

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <div className="min-h-screen bg-slate-950" />
    <Hold />
  </LanguageProvider>
);
