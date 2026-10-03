export interface VettingField {
  id: string;
  label: string;
  len?: number;
  info?: string;
  v360?: string;
  multiline?: boolean;
  maxLines?: number;
  group?: string;
  groupMin?: number;
}

export interface VettingType {
  id: string;
  name: string;
  copyTitle?: string;
  article?: string;
  minSecondary?: number;
  required: VettingField[];
  optional: VettingField[];
  comments?: string[];
  isCustom?: boolean;
}

export interface AppSettings {
  theme: string;
  autoClear: number;
}

export interface BreakSchedule {
  shiftStart?: string;
  shiftEnd?: string;
  break1?: string;
  lunch?: string;
  break2?: string;
  notifyDesktop?: boolean;
  notifySound?: boolean;
}

export interface BreakState {
  currentPhase: string;
  diffSec: number;
  diffFormatted: string;
  isPast: boolean;
  eventName: string;
  icon: string;
  nextTime: string;
  notifKey: string | null;
  targetTime: Date | null;
  isActive: boolean;
  tickerText: string;
}

export interface NoteItem {
  id: string;
  title: string;
  contentHtml: string;
  contentText: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShortcutGroup {
  category: string;
  items: Array<{
    keys: string[];
    desc: string;
  }>;
}

export interface ShortcutHandlers {
  toggleNotes?: () => void;
  toggleCallpad?: () => void;
  toggleBreaks?: () => void;
  toggleQuickSms?: () => void;
  toggleSettings?: () => void;
  togglePreview?: () => void;
  handleEscape?: () => void;
  copyVetting?: () => void;
  pasteVetting?: () => void;
  openTypeSearch?: () => void;
  showShortcuts?: () => void;
  passField?: () => void;
  failField?: () => void;
}

export interface ExportPayload {
  app: string;
  version: number;
  appVersion: string;
  exportedAt: string;
  types: VettingType[];
  settings: AppSettings;
  savedComments: string[];
  activeTypeId: string | null;
}
