/**
 * Vetting Notepad - Active Browser Tab Break Screensaver & Overlay
 * Renders an isolated, non-blocking glassmorphic ambient overlay on the user's active page.
 * Features:
 * - Isolated Shadow DOM to prevent any CSS bleed
 * - Non-blocking (pointer-events: none on backdrop, click-through to host web page)
 * - Esc key / Dismiss button for instant emergency dismissal
 * - Turn Off / On switch directly on the overlay
 * - Pre-break heads-up pill mode and active break screensaver card mode
 */

interface BreakStateMessage {
  type: 'VPAD_BREAK_STATE';
  isConfigured: boolean;
  currentPhase: string;
  isActive: boolean;
  isPreBreak: boolean;
  preBreakMinutes: number;
  eventName: string;
  eventTag: string;
  icon: string;
  tickerText: string;
  bigCountdown: string;
  statusSub: string;
  diffSec: number;
  showPageOverlay?: boolean;
}

let hostEl: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let dismissedPhase: string | null = null;
let currentMessage: BreakStateMessage | null = null;

function ensureHost(): ShadowRoot {
  if (shadowRoot && hostEl) return shadowRoot;

  hostEl = document.getElementById('vpad-break-overlay-host');
  if (!hostEl) {
    hostEl = document.createElement('div');
    hostEl.id = 'vpad-break-overlay-host';
    hostEl.style.position = 'fixed';
    hostEl.style.top = '0';
    hostEl.style.left = '0';
    hostEl.style.width = '100vw';
    hostEl.style.height = '100vh';
    hostEl.style.pointerEvents = 'none';
    hostEl.style.zIndex = '2147483647'; // maximum z-index
    document.documentElement.appendChild(hostEl);
  }

  shadowRoot = hostEl.shadowRoot || hostEl.attachShadow({ mode: 'open' });
  return shadowRoot;
}

function removeOverlay() {
  if (hostEl) {
    hostEl.remove();
    hostEl = null;
    shadowRoot = null;
  }
}

function renderOverlay(state: BreakStateMessage) {
  if (state.showPageOverlay === false) {
    removeOverlay();
    return;
  }

  // If user dismissed this specific phase, do not show until phase transitions
  if (dismissedPhase && dismissedPhase === state.currentPhase) {
    removeOverlay();
    return;
  } else if (dismissedPhase && dismissedPhase !== state.currentPhase) {
    // Phase changed (e.g. from pre-break to in_break), reset dismissed state
    dismissedPhase = null;
  }

  if (!state.isActive && !state.isPreBreak) {
    removeOverlay();
    return;
  }

  const root = ensureHost();

  const isPre = state.isPreBreak && !state.isActive;

  root.innerHTML = `
    <style>
      :host {
        all: initial;
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .vpad-card {
        pointer-events: auto;
        position: fixed;
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.2);
        color: #f8fafc;
        animation: vpadSlide 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 2147483647;
      }

      /* Mode 1: Pre-break heads up pill */
      .vpad-pill {
        top: 20px;
        right: 24px;
        border-radius: 9999px;
        padding: 8px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        border-left: 3px solid #f59e0b;
      }
      .vpad-pill-text {
        font-size: 13px;
        font-weight: 500;
        color: #f1f5f9;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .vpad-pill-text strong {
        color: #fde68a;
      }

      /* Mode 2: Active break screensaver card */
      .vpad-screensaver {
        top: 32px;
        right: 32px;
        width: 320px;
        border-radius: 16px;
        padding: 20px 22px;
        border-left: 4px solid #10b981;
      }
      .vpad-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .vpad-title-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .vpad-icon {
        font-size: 24px;
      }
      .vpad-title {
        font-size: 15px;
        font-weight: 700;
        color: #ffffff;
        letter-spacing: -0.01em;
      }
      .vpad-badge {
        font-size: 10.5px;
        font-weight: 600;
        text-transform: uppercase;
        background: rgba(16, 185, 129, 0.2);
        color: #34d399;
        padding: 2px 7px;
        border-radius: 6px;
      }
      .vpad-countdown {
        font-size: 32px;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #10b981;
        margin-bottom: 4px;
        font-variant-numeric: tabular-nums;
      }
      .vpad-sub {
        font-size: 12px;
        color: #94a3b8;
        margin-bottom: 14px;
      }
      .vpad-wellness {
        font-size: 11px;
        color: #cbd5e1;
        background: rgba(255, 255, 255, 0.05);
        padding: 8px 10px;
        border-radius: 8px;
        margin-bottom: 16px;
        line-height: 1.4;
      }
      .vpad-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .vpad-btn {
        appearance: none;
        border: none;
        cursor: pointer;
        padding: 7px 12px;
        font-size: 11.5px;
        font-weight: 600;
        border-radius: 8px;
        transition: all 0.15s ease;
      }
      .vpad-btn-primary {
        background: #10b981;
        color: #ffffff;
        flex: 1;
      }
      .vpad-btn-primary:hover {
        background: #059669;
      }
      .vpad-btn-subtle {
        background: rgba(255, 255, 255, 0.08);
        color: #94a3b8;
      }
      .vpad-btn-subtle:hover {
        background: rgba(255, 255, 255, 0.14);
        color: #f1f5f9;
      }
      .vpad-close {
        cursor: pointer;
        background: transparent;
        border: none;
        color: #64748b;
        font-size: 16px;
        padding: 2px 6px;
        border-radius: 4px;
        transition: color 0.15s ease;
      }
      .vpad-close:hover {
        color: #f1f5f9;
        background: rgba(255, 255, 255, 0.1);
      }

      @keyframes vpadSlide {
        from {
          opacity: 0;
          transform: translateY(-8px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    </style>

    ${isPre ? `
      <div class="vpad-card vpad-pill" id="vpadPill">
        <div class="vpad-pill-text">
          <span>⏳</span>
          <span><strong>${escapeText(state.eventName)}</strong> in ${Math.ceil(state.diffSec / 60)}m &bull; Wrap up your call</span>
        </div>
        <button class="vpad-close" id="vpadDismissBtn" title="Dismiss (Esc)">&times;</button>
      </div>
    ` : `
      <div class="vpad-card vpad-screensaver" id="vpadScreensaver">
        <div class="vpad-header">
          <div class="vpad-title-wrap">
            <span class="vpad-icon">${escapeText(state.icon || '☕')}</span>
            <div>
              <div class="vpad-title">${escapeText(state.eventName)}</div>
              <div class="vpad-badge">${escapeText(state.eventTag || 'Active')}</div>
            </div>
          </div>
          <button class="vpad-close" id="vpadDismissBtn" title="Dismiss (Esc)">&times;</button>
        </div>
        <div class="vpad-countdown">${escapeText(state.bigCountdown)}</div>
        <div class="vpad-sub">${escapeText(state.statusSub)}</div>
        <div class="vpad-wellness">💧 Time to step away from the screen, stretch, and hydrate.</div>
        <div class="vpad-actions">
          <button class="vpad-btn vpad-btn-primary" id="vpadTakeCallBtn">Take Call / Dismiss</button>
          <button class="vpad-btn vpad-btn-subtle" id="vpadTurnOffBtn">Turn Off on Page</button>
        </div>
      </div>
    `}
  `;

  // Attach event listeners
  const dismissBtn = root.getElementById('vpadDismissBtn');
  if (dismissBtn) {
    dismissBtn.onclick = () => {
      dismissedPhase = state.currentPhase;
      removeOverlay();
    };
  }

  const takeCallBtn = root.getElementById('vpadTakeCallBtn');
  if (takeCallBtn) {
    takeCallBtn.onclick = () => {
      dismissedPhase = state.currentPhase;
      removeOverlay();
    };
  }

  const turnOffBtn = root.getElementById('vpadTurnOffBtn');
  if (turnOffBtn) {
    turnOffBtn.onclick = () => {
      dismissedPhase = state.currentPhase;
      removeOverlay();
      try {
        chrome.storage.local.get(['vpad.break_schedule', 'vpad.breakSchedule'], (res) => {
          const sched = res['vpad.break_schedule'] || res['vpad.breakSchedule'] || {};
          sched.showPageOverlay = false;
          chrome.storage.local.set({
            'vpad.break_schedule': sched,
            'vpad.breakSchedule': sched
          });
        });
      } catch {
        // ignore
      }
    };
  }
}

function escapeText(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isBreakStateMessage(msg: unknown): msg is BreakStateMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  return 'type' in msg && msg.type === 'VPAD_BREAK_STATE';
}

// Global Esc key listener to dismiss overlay cleanly
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && hostEl) {
    if (currentMessage) {
      dismissedPhase = currentMessage.currentPhase;
    }
    removeOverlay();
  }
});

// Runtime message listener from background worker / panel
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isBreakStateMessage(message)) {
    currentMessage = message;
    renderOverlay(currentMessage);
    sendResponse({ ok: true });
  }
});

// Initial storage check
try {
  chrome.storage.local.get(['vpad.break_schedule', 'vpad.breakSchedule', 'vpad.lastBreakState'], (res) => {
    const sched = res['vpad.break_schedule'] || res['vpad.breakSchedule'];
    const state = res['vpad.lastBreakState'];
    if (sched && sched.showPageOverlay === false) {
      return;
    }
    if (state && typeof state === 'object') {
      const candidate = {
        type: 'VPAD_BREAK_STATE',
        ...state,
        showPageOverlay: sched ? sched.showPageOverlay !== false : true
      };
      if (isBreakStateMessage(candidate)) {
        currentMessage = candidate;
        renderOverlay(candidate);
      }
    }
  });
} catch {
  // context not ready yet
}
