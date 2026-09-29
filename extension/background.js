// Background Service Worker for Vetting Notepad
// Opens the notepad in its own dedicated, resizable standalone window (type: 'popup')
// Defaults to the right-most edge flush against the active browser window, enforces minimum width of 250px,
// and remembers position & dimensions once moved by the user.

let vettingWindowId = null;
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
    } catch (e) {
      vettingWindowId = null;
    }
  }

  // Check if any tab has panel.html open
  try {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('panel.html') });
    if (tabs.length > 0) {
      vettingWindowId = tabs[0].windowId;
      await chrome.windows.update(vettingWindowId, { focused: true });
      return;
    }
  } catch (e) {}

  // Retrieve current/active browser window to calculate reference bounds
  let currentWin = null;
  try {
    currentWin = await chrome.windows.getLastFocused({ populate: false });
  } catch (e) {
    try {
      currentWin = await chrome.windows.getCurrent();
    } catch (e2) {}
  }

  // Load remembered position & dimensions from local storage
  let savedBounds = null;
  try {
    const storageRes = await chrome.storage.local.get('vpad.windowBounds');
    savedBounds = storageRes && storageRes['vpad.windowBounds'];
  } catch (e) {}

  // Enforce strictly 250px minimum width
  let width = 250;
  let height = 750;

  if (savedBounds && typeof savedBounds === 'object') {
    if (typeof savedBounds.width === 'number') width = Math.max(250, savedBounds.width);
    if (typeof savedBounds.height === 'number') height = Math.max(400, savedBounds.height);
  } else if (currentWin && currentWin.height) {
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

  const enforceGeometry = async (winId) => {
    try {
      await chrome.windows.update(winId, { left, top, width, height });
    } catch (e) {}
  };

  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('panel.html'),
      type: 'popup',
      width,
      height,
      top,
      left,
      focused: true
    });
    vettingWindowId = win.id;

    // Post-creation repositioning to defeat Linux/Wayland/X11 window manager centering quirks
    await enforceGeometry(win.id);
    setTimeout(() => enforceGeometry(win.id), 60);
    setTimeout(() => enforceGeometry(win.id), 180);
  } catch (e) {
    // Fallback if popup type fails
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('panel.html'),
      width,
      height,
      focused: true
    });
    vettingWindowId = win.id;
    await enforceGeometry(win.id);
  }
});

// Continuously remember window position and strictly enforce minimum 250px width
chrome.windows.onBoundsChanged.addListener(async (win) => {
  if (win.id === vettingWindowId && win.state === 'normal') {
    if (isAdjustingBounds) return;

    // If window shrunk below 250px on resize or reposition, immediately force it back to 250px
    if (typeof win.width === 'number' && win.width < 250) {
      isAdjustingBounds = true;
      try {
        await chrome.windows.update(win.id, { width: 250 });
      } catch (e) {}
      setTimeout(() => { isAdjustingBounds = false; }, 100);
      return;
    }

    const bounds = {
      v: 2,
      left: win.left,
      top: win.top,
      width: Math.max(250, win.width),
      height: Math.max(400, win.height)
    };
    chrome.storage.local.set({ 'vpad.windowBounds': bounds });
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === vettingWindowId) {
    vettingWindowId = null;
  }
});
