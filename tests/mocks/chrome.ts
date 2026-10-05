import { vi } from 'vitest';

// Mock Chrome Extension APIs and Navigator APIs for Vitest / JSDOM
const storageMemory: Record<string, any> = {};

(globalThis as any).chrome = {
  storage: {
    local: {
      get: (keys?: any, callback?: any) => {
        let result: Record<string, any> = {};
        if (typeof keys === 'string') {
          result[keys] = storageMemory[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach((k: string) => { result[k] = storageMemory[k]; });
        } else if (keys && typeof keys === 'object') {
          Object.keys(keys).forEach((k: string) => {
            result[k] = storageMemory[k] !== undefined ? storageMemory[k] : keys[k];
          });
        } else {
          result = { ...storageMemory };
        }
        if (typeof callback === 'function') callback(result);
        return Promise.resolve(result);
      },
      set: (items: Record<string, any>, callback?: any) => {
        Object.assign(storageMemory, items);
        if (typeof callback === 'function') callback();
        return Promise.resolve();
      },
      remove: (keys: string | string[], callback?: any) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k: string) => delete storageMemory[k]);
        if (typeof callback === 'function') callback();
        return Promise.resolve();
      },
      clear: (callback?: any) => {
        Object.keys(storageMemory).forEach((k: string) => delete storageMemory[k]);
        if (typeof callback === 'function') callback();
        return Promise.resolve();
      }
    }
  },
  windows: {
    getCurrent: (cb: any) => cb({ id: 1, width: 200, height: 600 }),
    update: vi.fn()
  },
  downloads: {
    download: vi.fn().mockResolvedValue(123)
  },
  runtime: {
    getManifest: vi.fn(() => ({ version: '3.0.0' })),
    getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    lastError: null
  }
};

let clipboardText = '';
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn((txt: string) => {
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
  (navigator.clipboard as any).writeText = vi.fn((txt: string) => {
    clipboardText = txt;
    return Promise.resolve();
  });
  (navigator.clipboard as any).readText = vi.fn(() => Promise.resolve(clipboardText));
}
