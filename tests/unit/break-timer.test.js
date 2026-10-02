import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BREAK_SCHEDULE,
  calculateBreakState,
  formatShortDuration,
  formatCountdown,
  formatBigCountdown
} from '../../extension/lib/break-timer.js';

describe('Break Timer & Notifier Engine', () => {
  it('initializes with zero default times so no ghost breaks fire', () => {
    expect(DEFAULT_BREAK_SCHEDULE.break1).toBe('');
    expect(DEFAULT_BREAK_SCHEDULE.lunch).toBe('');
    expect(DEFAULT_BREAK_SCHEDULE.break2).toBe('');
    expect(DEFAULT_BREAK_SCHEDULE.shiftEnd).toBe('');
  });

  it('reports unconfigured state when all break times are empty', () => {
    const now = new Date('2026-10-02T10:05:00');
    const state = calculateBreakState(DEFAULT_BREAK_SCHEDULE, now);
    expect(state.isConfigured).toBe(false);
    expect(state.tickerText).toBe('Set Break Notifier');
    expect(state.isActive).toBe(false);
  });

  it('displays "Next: X" before an upcoming break starts', () => {
    const schedule = {
      break1: '10:30',
      lunch: '13:00',
      break2: '16:00',
      shiftEnd: '18:00'
    };
    // 15 minutes before Break 1 (10:15)
    const now = new Date('2026-10-02T10:15:00');
    const state = calculateBreakState(schedule, now);

    expect(state.isConfigured).toBe(true);
    expect(state.isActive).toBe(false);
    expect(state.eventName).toBe('Next: Break 1');
    expect(state.tickerText).toBe('Next: 15m');
  });

  it('displays "Ends in: X" during an active ongoing break', () => {
    const schedule = {
      break1: '10:00', // 10 min break -> ends at 10:10
      lunch: '13:00',
      break2: '16:00',
      shiftEnd: '18:00'
    };
    // 2 minutes into Break 1 (10:02:00) -> 8 minutes (480s) remaining
    const now = new Date('2026-10-02T10:02:00');
    const state = calculateBreakState(schedule, now);

    expect(state.isConfigured).toBe(true);
    expect(state.isActive).toBe(true);
    expect(state.eventName).toBe('On Break 1');
    expect(state.tickerText).toContain('Ends in: 08m');
    expect(state.diffSec).toBe(480);
    expect(formatBigCountdown(state.diffSec)).toBe('00:08:00');
  });

  it('transitions to lunch after break 1 finishes', () => {
    const schedule = {
      break1: '10:00',
      lunch: '13:00',
      break2: '',
      shiftEnd: ''
    };
    // 10:15 (Break 1 ended at 10:10) -> Next is Lunch at 13:00
    const now = new Date('2026-10-02T10:15:00');
    const state = calculateBreakState(schedule, now);

    expect(state.isActive).toBe(false);
    expect(state.eventName).toBe('Next: Lunch');
    expect(state.tickerText).toBe('Next: 2h 45m');
  });

  it('formats durations accurately across seconds, minutes, and hours', () => {
    expect(formatShortDuration(45)).toBe('45s');
    expect(formatShortDuration(300)).toBe('5m');
    expect(formatShortDuration(8100)).toBe('2h 15m');
    expect(formatCountdown(492)).toBe('08m 12s');
  });
});
