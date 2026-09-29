// Background Service Worker for Vetting Notepad
// Opens the notepad in its own dedicated, resizable window (type: 'popup')
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

  // Position docked to the right edge of the user's active window
  let top = 50;
  let left = 100;
  let height = 750;

  try {
    const currentWin = await chrome.windows.getCurrent();
    if (currentWin && currentWin.height) {
      height = Math.max(500, currentWin.height);
      top = currentWin.top || 0;
      if (currentWin.left !== undefined && currentWin.width !== undefined) {
        left = Math.max(0, currentWin.left + currentWin.width - 320);
      }
    }
  } catch (e) {}

  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('panel.html'),
      type: 'popup',
      width: 300,
      height: height,
      top: top,
      left: left,
      focused: true
    });
    vettingWindowId = win.id;
  } catch (e) {
    // Fallback if popup type fails
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('panel.html'),
      width: 300,
      height: height,
      focused: true
    });
    vettingWindowId = win.id;
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === vettingWindowId) {
    vettingWindowId = null;
  }
});
