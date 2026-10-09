export type VettingFieldRole = 'identifier' | 'primary' | 'secondary' | 'action' | 'policy';

export interface VettingField {
  id: string;
  label: string;
  len?: number;
  info?: string;
  v360?: string;
  mpesaTxn?: string;
  article?: string;
  defaultValue?: string;
  omitDefault?: boolean;
  excludeFromCount?: boolean;
  multiline?: boolean;
  maxLines?: number;
  group?: string;
  groupMin?: number;
  violationAdvice?: string;
  itemType?: 'input' | 'policy' | 'action';
  role?: VettingFieldRole;
  isVetting?: boolean;
  compactChip?: boolean;
  attachTo?: string;
  groupLabel?: string;
  templateVar?: string;
  actionText?: string;
  negationText?: string;
}

export interface VettingOutcome {
  id: string;
  label: string;
  line1Text: string;
  isDefault?: boolean;
}

export interface VettingDiyAction {
  id: string;
  label: string;
  adviceText: string;
  smsId?: string;
  varMap?: Record<string, string>;
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
  diyActions?: VettingDiyAction[];
  outcomes?: VettingOutcome[];
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
  text: string;
  html: string;
  updatedAt: number;
}

export interface ShortcutItem {
  keys: string[];
  desc: string;
  action?: string;
}

export interface ShortcutGroup {
  category: string;
  items: ShortcutItem[];
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
  findOrSearch?: () => boolean | void;
  showShortcuts?: () => void;
  passField?: () => void;
  failField?: () => void;
}

export interface QuickSmsTemplate {
  id: string;
  title: string;
  text: string;
  unpinnedVars?: string[];
  version?: number;
}

export interface QuickInteractionTemplate {
  id: string;
  title: string;
  text: string;
  unpinnedVars?: string[];
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
  quickSmsTemplates?: QuickSmsTemplate[];
  quickInteractionTemplates?: QuickInteractionTemplate[];
}
