/**
 * Vetting Notepad - Centralized Debug & Error Logger
 * Provides in-memory ring-buffer logging, console interception,
 * global uncaught error capture, and structured diagnostic export.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  stack?: string;
  meta?: Record<string, unknown>;
}

export class Logger {
  private buffer: LogEntry[] = [];
  private maxEntries: number;
  private initialized = false;

  // Stored original console methods to prevent recursion and allow restoration
  private origError: typeof console.error = console.error.bind(console);
  private origWarn: typeof console.warn = console.warn.bind(console);
  private origInfo: typeof console.info = console.info.bind(console);
  private origLog: typeof console.log = console.log.bind(console);

  private isInternalLogging = false;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  /**
   * Initializes global error listeners and console interception.
   */
  public initGlobalHandlers(): void {
    if (this.initialized) return;
    this.initialized = true;

    // 1. Intercept console.error and console.warn so that no caught errors escape logging
    this.interceptConsole();

    // 2. Global uncaught exception and promise rejection handlers
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        const errObj = event.error;
        const stack = errObj instanceof Error ? errObj.stack : undefined;
        this.addEntry('error', 'uncaught-exception', event.message || 'Unknown uncaught exception', {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        }, stack);
      });

      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        let message = 'Unhandled promise rejection';
        let stack: string | undefined;

        if (reason instanceof Error) {
          message = `${reason.name}: ${reason.message}`;
          stack = reason.stack;
        } else if (typeof reason === 'string') {
          message = reason;
        } else if (typeof reason === 'object' && reason !== null) {
          try {
            message = JSON.stringify(reason);
          } catch {
            message = Object.prototype.toString.call(reason);
          }
        }

        this.addEntry('error', 'unhandled-rejection', message, undefined, stack);
      });
    } else if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
      self.addEventListener('error', (event: Event) => {
        const message = 'message' in event && typeof event.message === 'string' ? event.message : 'Unknown service worker exception';
        this.addEntry('error', 'service-worker-error', message);
      });

      self.addEventListener('unhandledrejection', (event: Event) => {
        const reason = 'reason' in event ? event.reason : undefined;
        let message = 'Unhandled service worker rejection';
        let stack: string | undefined;

        if (reason instanceof Error) {
          message = `${reason.name}: ${reason.message}`;
          stack = reason.stack;
        } else if (typeof reason === 'string') {
          message = reason;
        }

        this.addEntry('error', 'service-worker-unhandled-rejection', message, undefined, stack);
      });
    }
  }

  /**
   * Intercepts console.error and console.warn while delegating to original implementations.
   */
  public interceptConsole(): void {
    const self = this;

    console.error = function (...args: unknown[]) {
      self.origError(...args);
      if (self.isInternalLogging) return;
      self.captureConsoleArgs('error', args);
    };

    console.warn = function (...args: unknown[]) {
      self.origWarn(...args);
      if (self.isInternalLogging) return;
      self.captureConsoleArgs('warn', args);
    };
  }

  /**
   * Restores original console methods (primarily used in tests).
   */
  public restoreConsole(): void {
    console.error = this.origError;
    console.warn = this.origWarn;
    console.info = this.origInfo;
    console.log = this.origLog;
    this.initialized = false;
  }

  private captureConsoleArgs(level: LogLevel, args: unknown[]): void {
    if (args.length === 0) return;

    let context = 'console';
    let stack: string | undefined;
    const formattedParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg instanceof Error) {
        if (!stack) stack = arg.stack;
        formattedParts.push(`${arg.name}: ${arg.message}`);
      } else if (typeof arg === 'string') {
        formattedParts.push(arg);
      } else if (typeof arg === 'object' && arg !== null) {
        try {
          formattedParts.push(JSON.stringify(arg));
        } catch {
          formattedParts.push(Object.prototype.toString.call(arg));
        }
      } else {
        formattedParts.push(String(arg));
      }
    }

    let message = formattedParts.join(' ');

    // Extract leading tag e.g. "[storage] Connection failed"
    const tagMatch = message.match(/^\[([a-zA-Z0-9_\-]+)\]\s*(.*)$/);
    if (tagMatch) {
      context = tagMatch[1] ?? 'console';
      message = tagMatch[2] ?? message;
    }

    this.addEntry(level, context, message, undefined, stack, true);
  }

  private addEntry(
    level: LogLevel,
    context: string,
    message: string,
    meta?: Record<string, unknown>,
    stack?: string,
    skipConsoleOutput = false
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
      ...(stack ? { stack } : {}),
      ...(meta ? { meta } : {})
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }

    if (skipConsoleOutput) return;

    // Output to original console methods with internal logging flag to prevent loops
    this.isInternalLogging = true;
    try {
      if (level === 'error') {
        this.origError(`[${context}] ${message}`, meta ?? '', stack ?? '');
      } else if (level === 'warn') {
        this.origWarn(`[${context}] ${message}`, meta ?? '');
      } else if (level === 'info') {
        this.origInfo(`[${context}] ${message}`, meta ?? '');
      } else {
        this.origLog(`[${context}] ${message}`, meta ?? '');
      }
    } finally {
      this.isInternalLogging = false;
    }
  }

  public debug(context: string, message: string, meta?: Record<string, unknown>): void {
    this.addEntry('debug', context, message, meta);
  }

  public info(context: string, message: string, meta?: Record<string, unknown>): void {
    this.addEntry('info', context, message, meta);
  }

  public warn(context: string, message: string, meta?: Record<string, unknown>): void {
    this.addEntry('warn', context, message, meta);
  }

  public error(context: string, message: string, meta?: Record<string, unknown>, stack?: string): void {
    this.addEntry('error', context, message, meta, stack);
  }

  /**
   * Safe helper to capture caught errors without throwing.
   */
  public captureError(context: string, err: unknown, meta?: Record<string, unknown>): void {
    let message = 'Unknown error';
    let stack: string | undefined;

    if (err instanceof Error) {
      message = `${err.name}: ${err.message}`;
      stack = err.stack;
    } else if (typeof err === 'string') {
      message = err;
    } else if (typeof err === 'object' && err !== null) {
      try {
        message = JSON.stringify(err);
      } catch {
        message = Object.prototype.toString.call(err);
      }
    }

    this.addEntry('error', context, message, meta, stack);
  }

  public getLogs(): LogEntry[] {
    return [...this.buffer];
  }

  public getErrors(): LogEntry[] {
    return this.buffer.filter((e) => e.level === 'error');
  }

  public clear(): void {
    this.buffer = [];
  }
}

export const logger = new Logger(200);
logger.initGlobalHandlers();
