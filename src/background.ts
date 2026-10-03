// Background Service Worker for Vetting Notepad
// Opens the notepad in its own dedicated, resizable standalone window (type: 'popup')
// Defaults to the right-most edge flush against the active browser window, enforces minimum width of 200px,
// and remembers position & dimensions once moved by the user.

import { logger } from './lib/logger.js';

interface SavedBounds {
  v?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

let vettingWindowId: number | null = null;
let isAdjustingBounds = false;

chrome.action.onClicked.addListener(async () => {
  // If window already open, check if it's still alive and bring to front
  if (vettingWindowId !== null) {
    try {
      const existing = await chrome.windows.get(vettingWindowId);
      if (existing) {
        await chrome.windows.update(vettingWindowId, { focused: true });
        return;
      }
    } catch (err) {
      logger.captureError('background', err, { action: 'checkExistingWindow', vettingWindowId });
      vettingWindowId = null;
    }
  }

  // Check if any tab has panel.html open
  try {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('src/panel.html') });
    const fallbackTabs = tabs.length === 0 ? await chrome.tabs.query({ url: chrome.runtime.getURL('panel.html') }) : tabs;
    const targetTab = fallbackTabs[0];
    if (targetTab && typeof targetTab.windowId === 'number') {
      vettingWindowId = targetTab.windowId;
      await chrome.windows.update(vettingWindowId, { focused: true });
      return;
    }
  } catch (err) {
    logger.captureError('background', err, { action: 'queryExistingPanelTabs' });
  }

  // Retrieve current/active browser window to calculate reference bounds
  let currentWin: chrome.windows.Window | null = null;
  try {
    currentWin = await chrome.windows.getLastFocused({ populate: false });
  } catch (err) {
    logger.warn('background', 'Failed to getLastFocused window, falling back to getCurrent', { err });
    try {
      currentWin = await chrome.windows.getCurrent();
    } catch (e) {
      logger.captureError('background', e, { action: 'getCurrentWindow' });
    }
  }

  // Load remembered position & dimensions from local storage
  let savedBounds: SavedBounds | null = null;
  try {
    const storageRes = await chrome.storage.local.get('vpad.windowBounds');
    const stored = storageRes['vpad.windowBounds'];
    if (stored && typeof stored === 'object') {
      savedBounds = stored;
    }
  } catch (err) {
    logger.captureError('background', err, { action: 'loadWindowBounds' });
  }

  // Enforce strictly 200px minimum width
  let width = 200;
  let height = 750;

  if (savedBounds) {
    if (typeof savedBounds.width === 'number') width = Math.max(200, savedBounds.width);
    if (typeof savedBounds.height === 'number') height = Math.max(400, savedBounds.height);
  } else if (currentWin && typeof currentWin.height === 'number') {
    height = Math.max(500, currentWin.height);
  }

  // Determine initial coordinates: Default to right-most edge of active browser window
  const curLeft = (currentWin && typeof currentWin.left === 'number') ? currentWin.left : 0;
  const curWidth = (currentWin && typeof currentWin.width === 'number') ? currentWin.width : 1280;
  const curTop = (currentWin && typeof currentWin.top === 'number') ? currentWin.top : 0;

  let left = Math.max(0, curLeft + curWidth - width);
  let top = Math.max(0, curTop);

  // If user previously moved the window (v2 bounds format), restore their chosen position
  if (savedBounds && savedBounds.v === 2) {
    if (typeof savedBounds.left === 'number') left = Math.max(0, savedBounds.left);
    if (typeof savedBounds.top === 'number') top = Math.max(0, savedBounds.top);
  }

  const enforceGeometry = async (winId: number) => {
    try {
      await chrome.windows.update(winId, { left, top, width, height });
    } catch (err) {
      logger.captureError('background', err, { action: 'enforceGeometry', winId });
    }
  };

  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('src/panel.html'),
      type: 'popup',
      width,
      height,
      top,
      left,
      focused: true
    });
    if (win && typeof win.id === 'number') {
      vettingWindowId = win.id;
      // Post-creation repositioning to defeat Linux/Wayland/X11 window manager centering quirks
      await enforceGeometry(win.id);
      setTimeout(() => { if (typeof win.id === 'number') void enforceGeometry(win.id); }, 60);
      setTimeout(() => { if (typeof win.id === 'number') void enforceGeometry(win.id); }, 180);
    }
  } catch (err) {
    logger.warn('background', 'Failed to create popup window, attempting fallback creation', { err });
    try {
      const win = await chrome.windows.create({
        url: chrome.runtime.getURL('src/panel.html'),
        width,
        height,
        focused: true
      });
      if (win && typeof win.id === 'number') {
        vettingWindowId = win.id;
        await enforceGeometry(win.id);
      }
    } catch (fallbackErr) {
      logger.captureError('background', fallbackErr, { action: 'createWindowFallback' });
    }
  }
});

// Continuously remember window position and strictly enforce minimum 200px width
chrome.windows.onBoundsChanged.addListener(async (win) => {
  if (typeof win.id === 'number' && win.id === vettingWindowId && win.state === 'normal') {
    if (isAdjustingBounds) return;

    // If window shrunk below 200px on resize or reposition, immediately force it back to 200px
    if (typeof win.width === 'number' && win.width < 200) {
      isAdjustingBounds = true;
      try {
        await chrome.windows.update(win.id, { width: 200 });
      } catch (err) {
        logger.captureError('background', err, { action: 'enforceMinWidth', winId: win.id });
      }
      setTimeout(() => { isAdjustingBounds = false; }, 100);
      return;
    }

    const bounds: SavedBounds = {
      v: 2,
      left: win.left,
      top: win.top,
      width: Math.max(200, win.width ?? 200),
      height: Math.max(400, win.height ?? 400)
    };
    await chrome.storage.local.set({ 'vpad.windowBounds': bounds });
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === vettingWindowId) {
    vettingWindowId = null;
  }
});
