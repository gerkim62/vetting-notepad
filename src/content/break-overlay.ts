/**
 * Vetting Notepad - Active Browser Tab Break Notifier Overlay
 * Runs directly in web page content script, autonomously tracking configured break times,
 * pre-break heads-up alert, active break countdown, draggable pill, and edge glow.
 */

import { calculateBreakState, ScheduleConfig } from '../lib/break-timer.js';

declare global {
  interface Window {
    __brk?: {
      stop: () => void;
    };
  }
}

export interface BreakNotifierOptions {
  name?: string;
  seconds?: number;
  totalSeconds?: number;
  snooze?: number[];
  onDismiss?: () => void;
}

export interface BreakMessagePayload {
  type: string;
  isPreview?: boolean;
  eventName?: string;
  diffSec?: number;
  showPageOverlay?: boolean;
}

let cachedSchedule: ScheduleConfig = {};
let currentOverlayPhase: string | null = null;
let dismissedPhase: string | null = null;
let snoozedUntil: number | null = null;

export function breakNotifier({
  name = '☕ Tea break',
  seconds = 300,
  totalSeconds = seconds,
  snooze = [2, 5, 10],
  onDismiss
}: BreakNotifierOptions = {}) {
  window.__brk?.stop();

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <div class="glow"></div>
    <div class="bar">
      <b class="name"></b><span class="time"></span>
      <i>|</i><span class="lbl">Snooze</span><span class="btns"></span>
      <button class="x" title="Close break">×</button>
    </div>`;

  const css = `
    .glow{position:fixed;inset:0;pointer-events:none;animation:p var(--d,2.4s) ease-in-out infinite;
      box-shadow:inset 0 0 70px 12px rgba(var(--c,30,191,138),.5)}
    @keyframes p{
      0%,100%{box-shadow:inset 0 0 calc(50px + 30px*var(--p,0)) calc(6px + 10px*var(--p,0)) rgba(var(--c,30,191,138),calc(.3 + .25*var(--p,0)))}
      50%{box-shadow:inset 0 0 calc(110px + 90px*var(--p,0)) calc(26px + 30px*var(--p,0)) rgba(var(--c,30,191,138),calc(.7 + .3*var(--p,0)))}}
    @media (prefers-reduced-motion:reduce){.glow{animation:none}}
    .bar{position:fixed;top:6px;left:50%;transform:translateX(-50%);pointer-events:auto;
      display:flex;align-items:center;gap:6px;white-space:nowrap;padding:3px 4px 3px 10px;
      background:#232938;color:#f2f5f8;border-radius:999px;font:13px/1 system-ui,sans-serif;
      opacity:.92;box-shadow:0 2px 10px rgba(0,0,0,.3),0 0 0 1px rgba(var(--c,30,191,138),.7)}
    .bar{cursor:grab;user-select:none;touch-action:none}
    .bar:active{cursor:grabbing}
    .bar:hover{opacity:1}
    .name{font-weight:700}
    .time{font-variant-numeric:tabular-nums;font-weight:700;color:rgb(var(--c,30,191,138))}
    i{font-style:normal;opacity:.35}
    .lbl{opacity:.7}
    .btns{display:flex;gap:3px}
    button{all:unset;cursor:pointer;background:rgba(255,255,255,.1);padding:4px 7px;border-radius:999px}
    .x{font-size:15px;padding:3px 7px;margin-left:2px}
    button:hover,button:focus-visible{background:rgb(var(--c,30,191,138));color:#05281d}`;

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const st = document.createElement('style');
    st.textContent = css;
    root.append(st);
  }

  const nameEl = root.querySelector('.name');
  if (nameEl) nameEl.textContent = name;
  const timeEl = root.querySelector('.time');
  const btnsEl = root.querySelector('.btns');
  const closeBtn = root.querySelector('.x');
  const bar = root.querySelector('.bar');

  let remaining = seconds * 1000;
  let end = Date.now() + remaining;
  let tick: ReturnType<typeof setInterval> | undefined;
  let wake: ReturnType<typeof setTimeout> | undefined;

  const fmt = (s: number) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const GREEN = [30, 191, 138];
  const AMBER = [255, 176, 32];
  const RED = [255, 70, 60];
  let lastStep = -1;

  function setIntensity(p: number) {
    p = Math.min(1, Math.max(0, p));
    // green -> amber (0-60%) -> red (60-100%)
    const c = p < 0.6 ? mix(GREEN, AMBER, p / 0.6) : mix(AMBER, RED, (p - 0.6) / 0.4);
    host.style.setProperty('--p', p.toFixed(3));
    host.style.setProperty('--c', c.join(','));
    // pulse faster in steps (avoids animation jumps every second)
    const step = Math.floor(p * 5);
    if (step !== lastStep) {
      lastStep = step;
      host.style.setProperty('--d', (2.4 - step * 0.35).toFixed(2) + 's');
    }
  }

  function render() {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    if (timeEl) timeEl.textContent = fmt(left);
    const denom = totalSeconds > 0 ? totalSeconds : seconds;
    setIntensity(1 - left / denom);
    if (left <= 0) stop();
  }

  function stop() {
    if (tick) clearInterval(tick);
    if (wake) clearTimeout(wake);
    host.remove();
    delete window.__brk;
    onDismiss?.();
  }

  function doSnooze(mins: number) {
    if (tick) clearInterval(tick);
    remaining = end - Date.now();
    host.style.display = 'none';
    snoozedUntil = Date.now() + mins * 60000;
    wake = setTimeout(() => {
      snoozedUntil = null;
      end = Date.now() + remaining;
      host.style.display = '';
      tick = setInterval(render, 1000);
      render();
    }, mins * 60000);
  }

  snooze.forEach((m) => {
    const b = document.createElement('button');
    b.textContent = m + 'm';
    b.title = 'Snooze ' + m + ' minutes';
    b.onclick = () => doSnooze(m);
    if (btnsEl) btnsEl.append(b);
  });

  if (closeBtn instanceof HTMLElement) {
    closeBtn.title = 'Hide popup';
    closeBtn.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      if (bar instanceof HTMLElement) {
        bar.style.display = 'none';
      }
    };
  }

  // drag the strip anywhere (ignore presses on buttons)
  if (bar instanceof HTMLElement) {
    let drag: { dx: number; dy: number } | null = null;
    bar.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('button')) return;
      const r = bar.getBoundingClientRect();
      Object.assign(bar.style, { left: r.left + 'px', top: r.top + 'px', transform: 'none' });
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', (e: PointerEvent) => {
      if (!drag) return;
      bar.style.left = Math.max(0, Math.min(innerWidth - bar.offsetWidth, e.clientX - drag.dx)) + 'px';
      bar.style.top = Math.max(0, Math.min(innerHeight - bar.offsetHeight, e.clientY - drag.dy)) + 'px';
    });
    bar.addEventListener('pointerup', () => {
      drag = null;
    });
  }

  document.documentElement.append(host);
  tick = setInterval(render, 1000);
  render();
  window.__brk = { stop };
  return 'Break started. Run __brk.stop() to remove it.';
}

function evaluateSchedule() {
  if (cachedSchedule.showPageOverlay === false) {
    if (window.__brk) {
      window.__brk.stop();
      currentOverlayPhase = null;
    }
    return;
  }

  if (snoozedUntil && Date.now() < snoozedUntil) {
    return;
  }

  const now = new Date();
  const state = calculateBreakState(cachedSchedule, now);

  // If phase changed away from dismissedPhase, reset it
  if (dismissedPhase && dismissedPhase !== state.currentPhase) {
    dismissedPhase = null;
  }

  // 1. In Break (Active)
  if (state.isActive) {
    if (dismissedPhase === state.currentPhase) {
      return;
    }
    if (currentOverlayPhase === state.currentPhase && window.__brk) {
      return;
    }

    currentOverlayPhase = state.currentPhase;
    const isLunch = state.currentPhase === 'in_lunch';
    const name = isLunch
      ? '🍽 Lunch break'
      : `${state.icon || '☕'} ${state.eventName || 'Tea break'}`;
    const totalSec = isLunch ? 2400 : 600;
    const remainingSec = Math.max(1, state.diffSec || totalSec);
    const snoozeOptions = isLunch ? [5, 10, 15] : [2, 5, 10];

    breakNotifier({
      name,
      seconds: remainingSec,
      totalSeconds: totalSec,
      snooze: snoozeOptions,
      onDismiss: () => {
        dismissedPhase = state.currentPhase;
        currentOverlayPhase = null;
      }
    });
    return;
  }

  // 2. Pre-Break (X mins to break)
  if (state.isPreBreak) {
    const prePhaseKey = state.currentPhase + '_pre';
    if (dismissedPhase === prePhaseKey) {
      return;
    }
    if (currentOverlayPhase === prePhaseKey && window.__brk) {
      return;
    }

    currentOverlayPhase = prePhaseKey;
    const totalSec = (state.preBreakMinutes || 2) * 60;
    const remainingSec = Math.max(1, state.diffSec || totalSec);
    const name = `⏳ Wrap up call (${state.eventName} in ${Math.ceil(remainingSec / 60)}m)`;

    breakNotifier({
      name,
      seconds: remainingSec,
      totalSeconds: totalSec,
      snooze: [1, 2],
      onDismiss: () => {
        dismissedPhase = prePhaseKey;
        currentOverlayPhase = null;
      }
    });
    return;
  }

  // 3. Neither active nor pre-break: stop any running break
  if (!state.isActive && !state.isPreBreak && currentOverlayPhase !== 'preview') {
    if (window.__brk) {
      window.__brk.stop();
      currentOverlayPhase = null;
    }
  }
}

// Global Esc key listener to dismiss break overlay
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && window.__brk) {
    window.__brk.stop();
    if (currentOverlayPhase) {
      dismissedPhase = currentOverlayPhase;
      currentOverlayPhase = null;
    }
  }
});

function isBreakMessage(msg: unknown): msg is BreakMessagePayload {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

function parseScheduleConfig(val: unknown): ScheduleConfig | null {
  if (typeof val === 'object' && val !== null) {
    return val;
  }
  return null;
}

// Runtime message listener for immediate preview or direct triggers
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isBreakMessage(message)) {
      if (message.type === 'VPAD_BREAK_STATE') {
        if (message.isPreview) {
          currentOverlayPhase = 'preview';
          breakNotifier({
            name: message.eventName || '☕ Tea break (Preview)',
            seconds: message.diffSec || 300,
            totalSeconds: 300,
            snooze: [2, 5, 10],
            onDismiss: () => {
              currentOverlayPhase = null;
            }
          });
          sendResponse({ ok: true });
          return;
        }
        // Force evaluate on message
        evaluateSchedule();
        sendResponse({ ok: true });
      }
    }
  });
}

// Storage change listener to keep content script schedule synchronized in real time
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const changedVal = changes['vpad.break_schedule']?.newValue ?? changes['vpad.breakSchedule']?.newValue;
      const newSched = parseScheduleConfig(changedVal);
      if (newSched) {
        cachedSchedule = newSched;
        evaluateSchedule();
      }
    }
  });
}

// Initial storage fetch and interval initialization
if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  try {
    chrome.storage.local.get(['vpad.break_schedule', 'vpad.breakSchedule'], (res) => {
      const storedVal = res['vpad.break_schedule'] ?? res['vpad.breakSchedule'];
      const sched = parseScheduleConfig(storedVal);
      if (sched) {
        cachedSchedule = sched;
      }
      evaluateSchedule();
      setInterval(evaluateSchedule, 1000);
    });
  } catch {
    // Context may not be ready
  }
}
