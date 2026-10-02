// Mock Chrome Extension APIs and Navigator APIs for Vitest / JSDOM
const storageMemory = {};

global.chrome = {
  storage: {
    local: {
      get: (keys, callback) => {
        let result = {};
        if (typeof keys === 'string') {
          result[keys] = storageMemory[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach(k => { result[k] = storageMemory[k]; });
        } else if (keys && typeof keys === 'object') {
          Object.keys(keys).forEach(k => {
            result[k] = storageMemory[k] !== undefined ? storageMemory[k] : keys[k];
          });
        } else {
          result = { ...storageMemory };
        }
        if (typeof callback === 'function') callback(result);
        return Promise.resolve(result);
      },
      set: (items, callback) => {
        Object.assign(storageMemory, items);
        if (typeof callback === 'function') callback();
        return Promise.resolve();
      },
      remove: (keys, callback) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => delete storageMemory[k]);
        if (typeof callback === 'function') callback();
        return Promise.resolve();
      },
      clear: (callback) => {
        Object.keys(storageMemory).forEach(k => delete storageMemory[k]);
        if (typeof callback === 'function') callback();
        return Promise.resolve();
      }
    }
  },
  windows: {
    getCurrent: (cb) => cb({ id: 1, width: 200, height: 600 }),
    update: vi.fn()
  },
  downloads: {
    download: vi.fn().mockResolvedValue(123)
  }
};

let clipboardText = '';
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn((txt) => {
        clipboardText = txt;
        return Promise.resolve();
      }),
      readText: vi.fn(() => Promise.resolve(clipboardText)),
      write: vi.fn(() => Promise.resolve())
    },
    writable: true,
    configurable: true
  });
} else {
  navigator.clipboard.writeText = vi.fn((txt) => {
    clipboardText = txt;
    return Promise.resolve();
  });
  navigator.clipboard.readText = vi.fn(() => Promise.resolve(clipboardText));
}
