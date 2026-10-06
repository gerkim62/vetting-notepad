/**
 * Break Timer & Schedule Calculation Engine
 * Pure functions for deterministic testing and ultra-reliable countdowns.
 */

export interface ScheduleConfig {
  break1?: string;
  lunch?: string;
  break2?: string;
  shiftEnd?: string;
  notifyDesktop?: boolean;
  notifyToast?: boolean;
  preBreakMinutes?: number;
  showPageOverlay?: boolean;
}

export interface BreakCalculationResult {
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
  targetTime: Date | null;
  notifKey: string | null;
  b1Start?: Date | null;
  b1End?: Date | null;
  lunchStart?: Date | null;
  lunchEnd?: Date | null;
  b2Start?: Date | null;
  b2End?: Date | null;
  shiftEnd?: Date | null;
}

export const DEFAULT_BREAK_SCHEDULE: ScheduleConfig = {
  break1: '',    // 10 min break
  lunch: '',     // 40 min lunch
  break2: '',    // 10 min break
  shiftEnd: '',  // End of day
  notifyDesktop: false,
  notifyToast: true,
  preBreakMinutes: 2,
  showPageOverlay: true
};

export function parseTimeToDate(timeStr?: string | null, now: Date = new Date()): Date | null {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return null;
  const parts = timeStr.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
}

export function formatShortDuration(diffSec: number): string {
  if (diffSec <= 0) return '0s';
  if (diffSec < 60) return `${diffSec < 10 ? '0' : ''}${diffSec}s`;
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

export function formatCountdown(sec: number): string {
  if (sec <= 0) return '00:00';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins < 10 ? '0' : ''}${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  }
  return `${mins < 10 ? '0' : ''}${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
}

export function formatBigCountdown(sec: number): string {
  if (sec <= 0) return '00:00:00';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function calculateBreakState(schedule: ScheduleConfig = DEFAULT_BREAK_SCHEDULE, now: Date = new Date()): BreakCalculationResult {
  const b1Start = parseTimeToDate(schedule.break1, now);
  const b1End = b1Start ? new Date(b1Start.getTime() + 10 * 60 * 1000) : null;

  const lStart = parseTimeToDate(schedule.lunch, now);
  const lEnd = lStart ? new Date(lStart.getTime() + 40 * 60 * 1000) : null;

  const b2Start = parseTimeToDate(schedule.break2, now);
  const b2End = b2Start ? new Date(b2Start.getTime() + 10 * 60 * 1000) : null;

  const sEnd = parseTimeToDate(schedule.shiftEnd, now);

  const hasAnySchedule = Boolean(b1Start || lStart || b2Start || sEnd);
  if (!hasAnySchedule) {
    return {
      isConfigured: false,
      currentPhase: 'unconfigured',
      isActive: false,
      isPreBreak: false,
      preBreakMinutes: schedule.preBreakMinutes ?? 2,
      eventName: 'No Schedule Set',
      eventTag: 'Idle',
      icon: '☕',
      tickerText: 'Set Break Notifier',
      bigCountdown: '--:--:--',
      statusSub: 'Set your break times below to start timer',
      diffSec: 0,
      targetTime: null,
      notifKey: null
    };
  }

  let currentPhase = '';
  let targetTime: Date | null = null;
  let eventName = '';
  let eventTag = '';
  let icon = '☕';
  let isActive = false;
  let notifKey: string | null = null;

  // Check phases in chronological order
  if (b1Start && now < b1Start) {
    currentPhase = 'before_b1';
    targetTime = b1Start;
    eventName = 'Next: Break 1';
    eventTag = '10m';
    icon = '☕';
  } else if (b1Start && b1End && now >= b1Start && now < b1End) {
    currentPhase = 'in_b1';
    targetTime = b1End;
    eventName = 'On Break 1';
    eventTag = '10m';
    icon = '☕';
    isActive = true;
    notifKey = 'b1_start';
  } else if (lStart && now < lStart) {
    currentPhase = 'before_lunch';
    targetTime = lStart;
    eventName = 'Next: Lunch';
    eventTag = '40m';
    icon = '🍱';
  } else if (lStart && lEnd && now >= lStart && now < lEnd) {
    currentPhase = 'in_lunch';
    targetTime = lEnd;
    eventName = 'On Lunch';
    eventTag = '40m';
    icon = '🍱';
    isActive = true;
    notifKey = 'lunch_start';
  } else if (b2Start && now < b2Start) {
    currentPhase = 'before_b2';
    targetTime = b2Start;
    eventName = 'Next: Break 2';
    eventTag = '10m';
    icon = '☕';
  } else if (b2Start && b2End && now >= b2Start && now < b2End) {
    currentPhase = 'in_b2';
    targetTime = b2End;
    eventName = 'On Break 2';
    eventTag = '10m';
    icon = '☕';
    isActive = true;
    notifKey = 'b2_start';
  } else if (sEnd && now < sEnd) {
    currentPhase = 'before_shift_end';
    targetTime = sEnd;
    eventName = 'Next: Shift End';
    eventTag = 'End';
    icon = '🏁';
  } else {
    currentPhase = 'shift_done';
    targetTime = null;
    eventName = 'Shift Completed';
    eventTag = 'Done';
    icon = '🏁';
  }

  let diffSec = 0;
  let tickerText = '';
  let bigCountdown = '00:00:00';
  let statusSub = '';

  if (targetTime) {
    diffSec = Math.max(0, Math.floor((targetTime.getTime() - now.getTime()) / 1000));
    bigCountdown = formatBigCountdown(diffSec);

    if (isActive) {
      tickerText = `Ends in: ${formatCountdown(diffSec)}`;
      const timeStr = targetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusSub = `Active break ends at ${timeStr}`;
    } else {
      tickerText = `Next: ${formatShortDuration(diffSec)}`;
      const timeStr = targetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusSub = `Scheduled for ${timeStr}`;
    }
  } else {
    tickerText = 'Shift Done';
    bigCountdown = '00:00:00';
    statusSub = 'All scheduled breaks and shift ended';
  }

  let isPreBreak = false;
  const preBreakMins = schedule.preBreakMinutes ?? 2;
  if (!isActive && targetTime && preBreakMins > 0) {
    const preBreakSec = preBreakMins * 60;
    if (diffSec > 0 && diffSec <= preBreakSec && currentPhase.startsWith('before_')) {
      isPreBreak = true;
      notifKey = `${currentPhase}_prebreak_${preBreakMins}`;
    }
  }

  return {
    isConfigured: true,
    currentPhase,
    isActive,
    isPreBreak,
    preBreakMinutes: preBreakMins,
    eventName,
    eventTag,
    icon,
    tickerText,
    bigCountdown,
    statusSub,
    diffSec,
    targetTime,
    notifKey,
    b1Start,
    b1End,
    lunchStart: lStart,
    lunchEnd: lEnd,
    b2Start,
    b2End,
    shiftEnd: sEnd
  };
}

/**
 * Formats a clean human-readable schedule time range: e.g. "Starts 10:15 • Ends 10:25 (10m)".
 * If start is not set, returns placeholder: "Starts --:-- • Ends --:-- (10m)".
 */
export function formatTimeRange(start?: Date | null, end?: Date | null, durationLabel?: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const durSuffix = durationLabel ? ` (${durationLabel})` : '';
  if (!start) {
    return `Starts --:-- • Ends --:--${durSuffix}`;
  }
  const startStr = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  if (!end) {
    return `Starts ${startStr}${durSuffix}`;
  }
  const endStr = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `Starts ${startStr} • Ends ${endStr}${durSuffix}`;
}

/**
 * Formats shift end time: e.g. "Shift ends at 17:00" or "Shift ends at --:--".
 */
export function formatShiftEndTime(end?: Date | null): string {
  if (!end) return 'Shift ends at --:--';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Shift ends at ${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

/**
 * Formats ambient display text for breaks.
 * During active breaks, returns "Break 1 (09m 45s)", "Lunch (38m 20s)", "Break 2 (08m 15s)".
 */
export function formatActiveBreakDisplay(state: BreakCalculationResult): string {
  if (!state.isActive) {
    return state.tickerText ? `${state.eventName} (${state.tickerText})` : state.eventName;
  }
  const cleanEvent = state.eventName.replace(/^On\s+/i, '');
  if (state.diffSec <= 0) {
    return `${cleanEvent} Ended • I'm Back`;
  }
  return `${cleanEvent} (${formatCountdown(state.diffSec)})`;
}

