import React, { useCallback, useEffect, useState } from 'react';

import logo from '../assets/epc-logo.webp';

/**
 * What the app shows while it comes up: the mark, the name, and a line that finishes.
 *
 * A launch screen is the one screen with nothing to be careful about and everything to say: this is
 * the app, this is what it is called, and it is coming up right now. Ours is deliberately short —
 * under three seconds, and a press or a click ends it early — because a splash that outstays the
 * thing it is covering is the reason people dislike splash screens.
 *
 * The animation itself is CSS (see the launch section in index.css): it has to run before React has
 * decided what the app is showing, and a keyframe keeps it smooth even while the main thread is busy
 * booting the workspace. What lives here is the timeline — when the overlay is asked to leave, and
 * when it is taken out of the document so the app underneath is the only thing on screen.
 *
 * The name is set in the app's own type (the system stack — the desktop build is not allowed to fetch
 * a font from the internet, and a splash that needs the network is a splash that shows nothing on a
 * machine that is offline) with the board's own palette on it: indigo through white to cyan, the same
 * three colours the dependency lines are drawn in.
 */

/** When the overlay starts fading out, in milliseconds. Must match the delays in index.css. */
const LEAVE_AT_MS = 2300;
/** How long that fade takes. Also the `.launch-leaving` duration in index.css. */
const FADE_MS = 450;
/**
 * With less movement asked for, the pieces are simply there — and there is no reason to hold the
 * screen for two and a half seconds to show a picture that is not going anywhere.
 */
const RELEAVE_AT_MS = 700;

type Phase = 'playing' | 'leaving' | 'gone';

export interface LaunchSplashProps {
  /** Shortens the whole timeline, so a test does not have to wait out an animation to see it end. */
  leaveAtMs?: number;
  fadeMs?: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const LaunchSplash: React.FC<LaunchSplashProps> = ({ leaveAtMs, fadeMs }) => {
  const [phase, setPhase] = useState<Phase>('playing');
  const fade = fadeMs ?? FADE_MS;

  // Read once, on mount: the machine's setting does not change while the app is starting.
  const leave = leaveAtMs ?? (prefersReducedMotion() ? RELEAVE_AT_MS : LEAVE_AT_MS);

  const skip = useCallback(() => {
    setPhase((current) => (current === 'playing' ? 'leaving' : current));
  }, []);

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setTimeout(skip, leave);
    return () => window.clearTimeout(timer);
  }, [phase, leave, skip]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setPhase('gone'), fade);
    return () => window.clearTimeout(timer);
  }, [phase, fade]);

  // A press, a click or any key ends it early: the user asked for the app, not for the animation.
  useEffect(() => {
    if (phase !== 'playing') return;
    const onInterrupt = () => skip();
    window.addEventListener('pointerdown', onInterrupt);
    window.addEventListener('keydown', onInterrupt);
    window.addEventListener('wheel', onInterrupt, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onInterrupt);
      window.removeEventListener('keydown', onInterrupt);
      window.removeEventListener('wheel', onInterrupt);
    };
  }, [phase, skip]);

  if (phase === 'gone') return null;

  return (
    <div
      data-testid="launch-splash"
      data-phase={phase}
      role="status"
      aria-label="Easy Project Compiler is starting"
      onPointerDown={skip}
      className={`fixed inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden bg-slate-950 ${
        phase === 'leaving' ? 'launch-leaving' : ''
      }`}
    >
      {/* The board's own background, brought forward: a dot grid the plan will be drawn on. */}
      <div
        aria-hidden="true"
        className="launch-glow pointer-events-none absolute inset-0 opacity-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 42%, rgba(79,70,229,0.28), rgba(2,6,23,0) 62%), radial-gradient(circle, rgba(148,163,184,0.30) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 26px 26px',
          backgroundPosition: 'center, center'
        }}
      />

      <div className="relative flex flex-col items-center gap-[clamp(10px,2.2vh,20px)] px-6">
        {/* The mark, lit from behind by a soft indigo glow that grows with it. */}
        <div className="relative">
          <div
            aria-hidden="true"
            className="launch-glow pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[130%] w-[150%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 blur-3xl"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.55), rgba(34,211,238,0.18) 55%, rgba(2,6,23,0) 72%)' }}
          />
          <img
            src={logo}
            alt=""
            draggable={false}
            data-testid="launch-logo"
            className="launch-mark block select-none"
            style={{ width: 'clamp(150px, 26vh, 244px)', height: 'auto', aspectRatio: '720 / 808' }}
          />
        </div>

        <h1
          data-testid="launch-name"
          className="launch-name m-0 bg-gradient-to-r from-indigo-200 via-white to-cyan-200 bg-clip-text text-center text-[clamp(17px,2.9vh,27px)] font-semibold leading-tight text-transparent"
          style={{ textShadow: '0 0 34px rgba(99,102,241,0.35)' }}
        >
          Easy Project Compiler
        </h1>

        <div
          aria-hidden="true"
          className="launch-rule h-px w-[clamp(150px,26vw,300px)] bg-gradient-to-r from-transparent via-indigo-400/70 to-transparent"
        />

        <p
          data-testid="launch-tagline"
          className="launch-line m-0 text-[clamp(9px,1.2vh,11px)] font-medium uppercase tracking-[0.42em] text-slate-400"
        >
          AI MVP Architect
        </p>
      </div>

      {/* The one line that says the wait is finite. */}
      <div
        aria-hidden="true"
        className="absolute bottom-[clamp(36px,7vh,64px)] h-[2px] w-[clamp(120px,18vw,190px)] overflow-hidden rounded-full bg-slate-800/80"
      >
        <div className="launch-bar h-full w-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-400 to-cyan-400" />
      </div>
    </div>
  );
};
