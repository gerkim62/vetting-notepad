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
    <div class="glow pulse"></div>
    <div class="bar main-bar">
      <span class="name"></span>
      <span class="time-badge"><span class="time"></span></span>
      <div class="snooze-wrap">
        <button type="button" class="snooze-toggle" title="Snooze options" aria-haspopup="true" aria-expanded="false">
          <span>Snooze</span>
          <svg class="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="snooze-menu" style="display:none;"></div>
      </div>
      <button class="x" title="Hide popup">×</button>
    </div>
    <div class="bar finish-bar" style="display:none;">
      <span class="finish-title">☕ Break Finished</span>
      <button type="button" class="btn-im-back">I'm Back</button>
    </div>`;

  const css = `
    .glow{position:fixed;inset:0;pointer-events:none;transition:box-shadow .4s ease}
    .glow.pulse{animation:p var(--d,2.4s) ease-in-out infinite;box-shadow:inset 0 0 70px 12px rgba(var(--c,30,191,138),.5)}
    .glow.static{animation:none;box-shadow:inset 0 0 calc(45px + 20px*var(--p,0)) calc(5px + 8px*var(--p,0)) rgba(var(--c,30,191,138),.42)}
    @keyframes p{
      0%,100%{box-shadow:inset 0 0 calc(50px + 30px*var(--p,0)) calc(6px + 10px*var(--p,0)) rgba(var(--c,30,191,138),calc(.3 + .25*var(--p,0)))}
      50%{box-shadow:inset 0 0 calc(110px + 90px*var(--p,0)) calc(26px + 30px*var(--p,0)) rgba(var(--c,30,191,138),calc(.7 + .3*var(--p,0)))}}
    @media (prefers-reduced-motion:reduce){.glow.pulse{animation:none}}

    .bar{position:fixed;top:8px;left:50%;transform:translateX(-50%);pointer-events:auto;
      display:flex;align-items:center;gap:8px;white-space:nowrap;padding:4px 6px 4px 12px;
      background:#1f2430;color:#f2f5f8;border-radius:999px;font:13px/1 system-ui,sans-serif;
      box-shadow:0 4px 16px rgba(0,0,0,.4),0 0 0 1px rgba(var(--c,30,191,138),.7);
      cursor:grab;user-select:none;touch-action:none;transition:box-shadow .2s ease}
    .bar:active{cursor:grabbing}
    .name{font-weight:700;font-size:12.5px;opacity:.92;letter-spacing:.2px}
    .time-badge{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;
      background:rgba(0,0,0,.35);box-shadow:inset 0 0 0 1px rgba(var(--c,30,191,138),.3)}
    .time{font-variant-numeric:tabular-nums;font-weight:800;font-size:16px;color:rgb(var(--c,30,191,138));letter-spacing:.6px}

    .snooze-wrap{position:relative;display:flex;align-items:center}
    .snooze-toggle{all:unset;cursor:pointer;display:flex;align-items:center;gap:4px;
      background:rgba(255,255,255,.08);padding:4px 8px;border-radius:999px;font-size:11.5px;
      color:#d1d7e0;transition:background .15s ease,color .15s ease}
    .snooze-toggle:hover{background:rgba(255,255,255,.15);color:#fff}
    .snooze-toggle.open{background:rgba(var(--c,30,191,138),.25);color:rgb(var(--c,30,191,138))}
    .chevron{transition:transform .2s ease}
    .snooze-toggle.open .chevron{transform:rotate(180deg)}

    .snooze-menu{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);
      background:#1c212b;border:1px solid rgba(var(--c,30,191,138),.6);border-radius:10px;
      padding:4px;display:flex;gap:4px;box-shadow:0 8px 24px rgba(0,0,0,.6);z-index:20}
    .snooze-menu button{all:unset;cursor:pointer;background:rgba(255,255,255,.08);padding:5px 9px;
      border-radius:7px;font-size:12px;font-weight:600;color:#f2f5f8;text-align:center}
    .snooze-menu button:hover{background:rgb(var(--c,30,191,138));color:#05281d}

    button.x{all:unset;cursor:pointer;background:rgba(255,255,255,.08);padding:2px 7px;
      border-radius:999px;font-size:14px;line-height:1;color:#a0abb8;margin-left:2px}
    button.x:hover{background:rgba(255,70,60,.25);color:#ff7060}

    /* Post-Break Completion State */
    .finish-bar{background:#1a2520;box-shadow:0 4px 18px rgba(0,0,0,.5),0 0 0 1.5px rgb(var(--c,30,191,138));padding:4px 6px 4px 14px}
    .finish-title{font-weight:700;font-size:13px;color:#f2f5f8;margin-right:4px}
    .btn-im-back{all:unset;cursor:pointer;background:rgb(var(--c,30,191,138));color:#042017;
      font-weight:800;font-size:12.5px;padding:5px 14px;border-radius:999px;
      box-shadow:0 2px 10px rgba(var(--c,30,191,138),.45);letter-spacing:.3px;
      animation:pulseBack 1.8s ease-in-out infinite}
    @keyframes pulseBack{
      0%,100%{transform:scale(1)}
      50%{transform:scale(1.05);box-shadow:0 3px 14px rgba(var(--c,30,191,138),.7)}}
    .btn-im-back:hover{filter:brightness(1.15)}`;

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const st = document.createElement('style');
    st.textContent = css;
    root.append(st);
  }

  const glowEl = root.querySelector('.glow');
  const mainBar = root.querySelector<HTMLElement>('.main-bar');
  const finishBar = root.querySelector<HTMLElement>('.finish-bar');
  const nameEl = root.querySelector('.name');
  if (nameEl) nameEl.textContent = name;
  const timeEl = root.querySelector('.time');
  const snoozeToggle = root.querySelector<HTMLButtonElement>('.snooze-toggle');
  const snoozeMenu = root.querySelector<HTMLElement>('.snooze-menu');
  const closeBtn = root.querySelector('.x');
  const btnImBack = root.querySelector<HTMLButtonElement>('.btn-im-back');

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
    const c = p < 0.6 ? mix(GREEN, AMBER, p / 0.6) : mix(AMBER, RED, (p - 0.6) / 0.4);
    host.style.setProperty('--p', p.toFixed(3));
    host.style.setProperty('--c', c.join(','));
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
    const elapsed = denom - left;
    setIntensity(1 - left / denom);

    // Item 2 Phasing: Pulse first 30s, static middle duration, pulse last 30s
    if (glowEl) {
      if (elapsed <= 30 || (left <= 30 && left > 0)) {
        glowEl.classList.add('pulse');
        glowEl.classList.remove('static');
      } else {
        glowEl.classList.remove('pulse');
        glowEl.classList.add('static');
      }
    }

    // Item 7: When timer completes, switch to "I'm Back" state
    if (left <= 0) {
      if (tick) clearInterval(tick);
      if (mainBar) mainBar.style.display = 'none';
      if (finishBar) finishBar.style.display = 'flex';
      if (glowEl) {
        glowEl.classList.add('pulse');
        glowEl.classList.remove('static');
      }
    }
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
    if (snoozeMenu) snoozeMenu.style.display = 'none';
    if (snoozeToggle) snoozeToggle.classList.remove('open');
    snoozedUntil = Date.now() + mins * 60000;
    wake = setTimeout(() => {
      snoozedUntil = null;
      end = Date.now() + remaining;
      host.style.display = '';
      tick = setInterval(render, 1000);
      render();
    }, mins * 60000);
  }

  // Populate snooze menu items
  snooze.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m + 'm';
    b.title = 'Snooze ' + m + ' minutes';
    b.onclick = (e) => {
      e.stopPropagation();
      doSnooze(m);
    };
    if (snoozeMenu) snoozeMenu.append(b);
  });

  // Toggle snooze dropdown menu on chevron click
  if (snoozeToggle && snoozeMenu) {
    snoozeToggle.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      const isOpen = snoozeMenu.style.display !== 'none';
      snoozeMenu.style.display = isOpen ? 'none' : 'flex';
      snoozeToggle.classList.toggle('open', !isOpen);
      snoozeToggle.setAttribute('aria-expanded', String(!isOpen));
    };
  }

  // Close snooze menu when clicking outside
  host.addEventListener('pointerdown', (e: PointerEvent) => {
    const target = e.target;
    if (target instanceof Node && snoozeMenu && snoozeMenu.style.display !== 'none' && !snoozeMenu.contains(target) && !snoozeToggle?.contains(target)) {
      snoozeMenu.style.display = 'none';
      snoozeToggle?.classList.remove('open');
      snoozeToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  if (btnImBack) {
    btnImBack.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      stop();
    };
  }

  if (closeBtn instanceof HTMLElement) {
    closeBtn.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      if (mainBar) mainBar.style.display = 'none';
    };
  }

  // Draggable strip behavior (support both main-bar and finish-bar)
  [mainBar, finishBar].forEach((barEl) => {
    if (!barEl) return;
    let drag: { dx: number; dy: number } | null = null;
    barEl.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('button')) return;
      const r = barEl.getBoundingClientRect();
      Object.assign(barEl.style, { left: r.left + 'px', top: r.top + 'px', transform: 'none' });
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      barEl.setPointerCapture(e.pointerId);
    });
    barEl.addEventListener('pointermove', (e: PointerEvent) => {
      if (!drag) return;
      barEl.style.left = Math.max(0, Math.min(innerWidth - barEl.offsetWidth, e.clientX - drag.dx)) + 'px';
      barEl.style.top = Math.max(0, Math.min(innerHeight - barEl.offsetHeight, e.clientY - drag.dy)) + 'px';
    });
    barEl.addEventListener('pointerup', () => {
      drag = null;
    });
  });

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
