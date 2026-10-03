import { describe, it, expect, beforeEach } from 'vitest';
import { Logger } from '../../src/lib/logger.js';

describe('Centralized Logger', () => {
  let log: Logger;

  beforeEach(() => {
    log = new Logger(5); // Small buffer for testing rollover
  });

  it('records log entries with timestamp and level', () => {
    log.info('storage', 'Loaded settings');
    log.warn('parser', 'Missing optional field');
    
    const logs = log.getLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].level).toBe('info');
    expect(logs[0].context).toBe('storage');
    expect(logs[0].message).toBe('Loaded settings');
    expect(logs[0].timestamp).toBeDefined();

    expect(logs[1].level).toBe('warn');
  });

  it('filters errors via getErrors()', () => {
    log.info('app', 'Startup');
    log.error('network', 'Failed fetch');
    log.debug('calc', 'Computing');

    const errors = log.getErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('Failed fetch');
  });

  it('captures caught Error instances with stack traces', () => {
    try {
      throw new TypeError('Cannot read properties of null');
    } catch (err) {
      log.captureError('dom', err, { component: 'select' });
    }

    const errors = log.getErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('TypeError: Cannot read properties of null');
    expect(errors[0].stack).toBeDefined();
    expect(errors[0].meta).toEqual({ component: 'select' });
  });

  it('handles non-Error objects and strings gracefully in captureError', () => {
    log.captureError('api', 'String failure message');
    log.captureError('storage', { code: 404, status: 'NOT_FOUND' });

    const errors = log.getErrors();
    expect(errors.length).toBe(2);
    expect(errors[0].message).toBe('String failure message');
    expect(errors[1].message).toContain('NOT_FOUND');
  });

  it('enforces ring buffer limit by rolling over older entries', () => {
    for (let i = 1; i <= 7; i++) {
      log.info('loop', `Entry ${i}`);
    }

    const logs = log.getLogs();
    expect(logs.length).toBe(5);
    expect(logs[0].message).toBe('Entry 3');
    expect(logs[4].message).toBe('Entry 7');
  });

  it('clears log buffer on demand', () => {
    log.info('app', 'First');
    expect(log.getLogs().length).toBe(1);
    log.clear();
    expect(log.getLogs().length).toBe(0);
  });

  it('intercepts console.error calls and captures them in error buffer', () => {
    try {
      log.interceptConsole();
      console.error('Failed to initialize Lucide icons:', new Error('Icon not found'));

      const errors = log.getErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].level).toBe('error');
      expect(errors[0].message).toContain('Failed to initialize Lucide icons:');
      expect(errors[0].message).toContain('Error: Icon not found');
      expect(errors[0].stack).toBeDefined();
    } finally {
      log.restoreConsole();
    }
  });

  it('extracts bracketed tag context from intercepted console messages', () => {
    try {
      log.interceptConsole();
      console.warn('[storage] Failed to load key: custom_types');

      const logs = log.getLogs();
      const warnEntry = logs.find(l => l.level === 'warn');
      expect(warnEntry).toBeDefined();
      expect(warnEntry?.context).toBe('storage');
      expect(warnEntry?.message).toBe('Failed to load key: custom_types');
    } finally {
      log.restoreConsole();
    }
  });
});
