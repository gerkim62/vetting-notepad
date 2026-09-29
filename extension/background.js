// Background Service Worker for Vetting Notepad
// Opens the notepad in its own dedicated, resizable window (type: 'popup')
// Defaults to left-most position (left: 0, top: 0, width: 250) and remembers position & dimensions
let vettingWindowId = null;

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

  // Load remembered position & dimensions from local storage
  let savedBounds = null;
  try {
    const storageRes = await chrome.storage.local.get('vpad.windowBounds');
    savedBounds = storageRes && storageRes['vpad.windowBounds'];
  } catch (e) {}

  // Determine initial coordinates (default: left-most edge at 0, top 0, width 250px)
  let left = 0;
  let top = 0;
  let width = 250;
  let height = 750;

  if (savedBounds && typeof savedBounds === 'object') {
    if (typeof savedBounds.left === 'number') left = Math.max(0, savedBounds.left);
    if (typeof savedBounds.top === 'number') top = Math.max(0, savedBounds.top);
    if (typeof savedBounds.width === 'number') width = Math.max(250, savedBounds.width);
    if (typeof savedBounds.height === 'number') height = Math.max(400, savedBounds.height);
  } else {
    // If no saved bounds, match current window height if available
    try {
      const currentWin = await chrome.windows.getCurrent();
      if (currentWin && currentWin.height) {
        height = Math.max(500, currentWin.height);
        if (typeof currentWin.top === 'number') top = currentWin.top;
      }
    } catch (e) {}
  }

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
  } catch (e) {
    // Fallback if popup type fails
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('panel.html'),
      width,
      height,
      focused: true
    });
    vettingWindowId = win.id;
  }
});

// Continuously remember window position and dimensions as user moves or resizes
chrome.windows.onBoundsChanged.addListener((win) => {
  if (win.id === vettingWindowId && win.state === 'normal') {
    const bounds = {
      left: win.left,
      top: win.top,
      width: Math.max(250, win.width),
      height: win.height
    };
    chrome.storage.local.set({ 'vpad.windowBounds': bounds });
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === vettingWindowId) {
    vettingWindowId = null;
  }
});
