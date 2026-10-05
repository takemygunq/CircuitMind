import { create } from 'zustand';
import { demoProjects } from '@/core/fixtures';
import { EMPTY_INVENTORY, type Inventory } from '@/core/inventory';
import { getBoard } from '@/core/library';
import type { BoardDef, Point, Project } from '@/core/schema';
import type { GpioMode } from '@/core/sim';
import type { FunctionGroup } from '@/diagram/colors';
import type { Locale } from '@/i18n';
import type { CatalogueLink } from '@/server/catalogue';
import type { SavedMeta } from '@/server/projects/store';

export type TabId = 'new' | 'parts' | 'diagram' | 'overview' | 'pinout' | 'code' | 'schematic';

/** «Пространства» (левая панель): главная, мои запасы, каталог деталей. Остальные вкладки относятся к проекту. */
export const SPACES: readonly TabId[] = ['new', 'parts'];
export const PROJECT_TABS: readonly TabId[] = [
  'diagram',
  'overview',
  'pinout',
  'schematic',
  'code',
];
export type Selection =
  | { kind: 'part'; id: string }
  | { kind: 'wire'; index: number }
  | { kind: 'pin'; pinId: string }
  | null;
export type Theme = 'light' | 'dark';

/** Сообщение чата проекта (хранится только на время сессии). */
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
}

export const GENERATED_ID = 'generated';
export const OWNED_STORAGE_KEY = 'cm-owned';
export const INVENTORY_STORAGE_KEY = 'cm-inventory';
export const CODE_STORAGE_KEY = 'cm-code';
export const codeKey = (projectId: string, language: string) => `${projectId}:${language}`;

interface WorkspaceState {
  locale: Locale;
  theme: Theme;
  tab: TabId;
  /** Последняя открытая вкладка проекта — к ней возвращает кнопка «Проект». */
  projectTab: TabId;
  /** Открыт экран «Модели ИИ» вместо вкладок проекта. */
  settingsOpen: boolean;
  /** Запущена симуляция на диаграмме. */
  simOn: boolean;
  /** Чаты проектов: ключ — id проекта (или id сохранённого). */
  chats: Record<string, ChatMessage[]>;
  projectId: string;
  project: Project;
  /** Проект, созданный ИИ в Режиме 1 (id "generated"). */
  generated: Project | null;
  /** id сохранённого на сервере проекта, который сейчас открыт (для перезаписи). */
  savedId: string | null;
  /** Состояние автосохранения текущего проекта. */
  saveState: 'idle' | 'saving' | 'saved' | 'failed';
  /** Список сохранённых проектов сервера. */
  saved: SavedMeta[];
  /** Связи деталей и плат библиотеки с каталогом: ключ "board:<id>" / "component:<id>". */
  catalogueLinks: Record<string, CatalogueLink>;
  /** Деталь каталога, которую нужно открыть на вкладке «Детали». */
  catalogueOpen: string | null;
  /** Запасы пользователя (Режим 2). Сохраняются в localStorage. */
  inventory: Inventory;
  /** Отметки «есть у меня» по проектам: projectId → ключи строк BOM. Сохраняются в localStorage. */
  owned: Record<string, string[]>;
  /** Изменённые пользователем входы расчётов: "projectId:calcId" → входы. */
  calcInputs: Record<string, Record<string, number>>;
  /** Код прошивок, написанный или сгенерированный пользователем: "projectId:language" → файл. Хранится в localStorage. */
  codeFiles: Record<string, string>;
  /** Последняя успешная сборка по ключу "projectId:language": исходник и Intel HEX (для эмулятора). Не сохраняется. */
  builds: Record<string, { code: string; hex: string }>;
  /** Ручные состояния симуляции поверх значений по умолчанию. */
  simGpio: Record<string, GpioMode>;
  /** Скважность ШИМ-пинов (задаёт эмулятор). */
  simDuty: Record<string, number>;
  simPressed: Record<string, boolean>;
  simPots: Record<string, number>;
  /** Позиции деталей, изменённые перетаскиванием (мм). */
  overrides: Record<string, Point>;
  /** Платы, загруженные с сервера (сгенерированные ИИ). */
  boards: Record<string, BoardDef>;
  selection: Selection;
  hoverNet: number | null;
  groupFilter: FunctionGroup[];

  setLocale: (l: Locale) => void;
  setTheme: (t: Theme) => void;
  setTab: (t: TabId) => void;
  setSettingsOpen: (open: boolean) => void;
  setSimOn: (on: boolean) => void;
  addChat: (key: string, msg: Omit<ChatMessage, 'id'>) => void;
  /** Запрос из общего чата к вкладке «Код» (изменить или объяснить код). */
  codeAsk: { n: number; text: string; explain: boolean } | null;
  setCodeAsk: (a: { text: string; explain: boolean } | null) => void;
  /** Идёт запрос к ИИ во вкладке «Код» — чат показывает индикатор. */
  codeBusy: boolean;
  setCodeBusy: (busy: boolean) => void;
  setProject: (id: string) => void;
  /** Загружает проект ИИ в рабочую область; open — сразу перейти на «Обзор». */
  setGenerated: (p: Project, open?: boolean, savedId?: string | null) => void;
  setSaved: (list: SavedMeta[]) => void;
  setSavedId: (id: string | null) => void;
  setSaveState: (s: WorkspaceState['saveState']) => void;
  setCatalogueLinks: (links: Record<string, CatalogueLink>) => void;
  /** Открывает страницу детали каталога (вкладка «Детали»). */
  openCatalogue: (id: string | null) => void;
  moveItem: (instanceId: string, p: Point) => void;
  select: (s: Selection) => void;
  setHoverNet: (n: number | null) => void;
  toggleGroup: (g: FunctionGroup) => void;
  clearFilter: () => void;
  cacheBoard: (b: BoardDef) => void;
  setOwned: (projectId: string, keys: string[]) => void;
  loadOwned: (all: Record<string, string[]>) => void;
  setInventory: (inv: Inventory) => void;
  loadInventory: (inv: Inventory) => void;
  setCalcInputs: (key: string, inputs: Record<string, number> | null) => void;
  setSimGpio: (pin: string, mode: GpioMode) => void;
  /** Эмулятор прошивки пишет состояние пинов целиком (режимы и скважность). */
  applyEmulator: (gpio: Record<string, GpioMode>, duty: Record<string, number>) => void;
  setSimPressed: (id: string, pressed: boolean) => void;
  setSimPot: (id: string, pos: number) => void;
  resetSim: () => void;
  setCode: (key: string, code: string) => void;
  setBuild: (key: string, build: { code: string; hex: string } | null) => void;
  loadCode: (all: Record<string, string>) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  locale: 'ru',
  theme: 'dark',
  tab: 'new',
  projectTab: 'diagram',
  settingsOpen: false,
  simOn: false,
  chats: {},
  codeAsk: null,
  codeBusy: false,
  projectId: demoProjects[0].id,
  project: demoProjects[0].project,
  generated: null,
  savedId: null,
  saved: [],
  saveState: 'idle',
  catalogueLinks: {},
  catalogueOpen: null,
  inventory: EMPTY_INVENTORY,
  owned: {},
  calcInputs: {},
  simGpio: {},
  simDuty: {},
  simPressed: {},
  simPots: {},
  codeFiles: {},
  builds: {},
  overrides: {},
  boards: {},
  selection: null,
  hoverNet: null,
  groupFilter: [],

  setLocale: (locale) => set({ locale }),
  setTheme: (theme) => set({ theme }),
  setTab: (tab) =>
    set((s) => ({
      tab,
      projectTab: PROJECT_TABS.includes(tab) ? tab : s.projectTab,
      settingsOpen: false,
      selection: null,
      hoverNet: null,
    })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSimOn: (simOn) => set({ simOn }),
  setCodeAsk: (a) => set((s) => ({ codeAsk: a ? { ...a, n: (s.codeAsk?.n ?? 0) + 1 } : null })),
  setCodeBusy: (codeBusy) => set({ codeBusy }),
  addChat: (key, msg) =>
    set((s) => ({
      chats: {
        ...s.chats,
        [key]: [...(s.chats[key] ?? []), { ...msg, id: (s.chats[key]?.length ?? 0) + 1 }],
      },
    })),
  setProject: (id) =>
    set((s) => {
      const project =
        id === GENERATED_ID ? s.generated : demoProjects.find((d) => d.id === id)?.project;
      return project
        ? {
            projectId: id,
            savedId: id === GENERATED_ID ? s.savedId : null,
            project,
            overrides: {},
            calcInputs: {},
            simGpio: {},
            simDuty: {},
            simPressed: {},
            simPots: {},
            selection: null,
            hoverNet: null,
            groupFilter: [],
          }
        : {};
    }),
  setSaved: (saved) => set({ saved }),
  setSavedId: (savedId) => set({ savedId }),
  setSaveState: (saveState) => set({ saveState }),
  setCatalogueLinks: (catalogueLinks) => set({ catalogueLinks }),
  openCatalogue: (id) =>
    set({ catalogueOpen: id, tab: 'parts', settingsOpen: false, selection: null, hoverNet: null }),
  setGenerated: (project, open = true, savedId = null) =>
    set((s) => ({
      generated: project,
      savedId,
      projectId: GENERATED_ID,
      project,
      overrides: {},
      calcInputs: {},
      simGpio: {},
      simDuty: {},
      simPressed: {},
      simPots: {},
      selection: null,
      hoverNet: null,
      groupFilter: [],
      tab: open ? 'overview' : s.tab,
    })),
  moveItem: (instanceId, p) => set((s) => ({ overrides: { ...s.overrides, [instanceId]: p } })),
  select: (selection) => set({ selection }),
  setHoverNet: (hoverNet) => set({ hoverNet }),
  toggleGroup: (g) =>
    set((s) => ({
      groupFilter: s.groupFilter.includes(g)
        ? s.groupFilter.filter((x) => x !== g)
        : [...s.groupFilter, g],
    })),
  clearFilter: () => set({ groupFilter: [] }),
  cacheBoard: (b) => set((s) => ({ boards: { ...s.boards, [b.id]: b } })),
  setOwned: (projectId, keys) =>
    set((s) => {
      const owned = { ...s.owned, [projectId]: keys };
      try {
        localStorage.setItem(OWNED_STORAGE_KEY, JSON.stringify(owned));
      } catch {
        /* localStorage недоступен — отметки живут до перезагрузки */
      }
      return { owned };
    }),
  setInventory: (inventory) => {
    set({ inventory });
    try {
      localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(inventory));
    } catch {
      /* localStorage недоступен — запасы живут до перезагрузки */
    }
  },
  loadInventory: (inventory) => set({ inventory }),
  loadOwned: (all) => set((s) => ({ owned: { ...all, ...s.owned } })),
  applyEmulator: (gpio, duty) =>
    set((s) => ({ simGpio: { ...s.simGpio, ...gpio }, simDuty: duty })),
  setSimGpio: (pin, mode) => set((s) => ({ simGpio: { ...s.simGpio, [pin]: mode } })),
  setSimPressed: (id, pressed) => set((s) => ({ simPressed: { ...s.simPressed, [id]: pressed } })),
  setSimPot: (id, pos) => set((s) => ({ simPots: { ...s.simPots, [id]: pos } })),
  resetSim: () => set({ simGpio: {}, simDuty: {}, simPressed: {}, simPots: {} }),
  setCode: (key, code) =>
    set((s) => {
      const codeFiles = { ...s.codeFiles, [key]: code };
      try {
        localStorage.setItem(CODE_STORAGE_KEY, JSON.stringify(codeFiles));
      } catch {
        /* localStorage недоступен или переполнен — код живёт до перезагрузки */
      }
      return { codeFiles };
    }),
  setBuild: (key, build) =>
    set((s) => {
      const builds = { ...s.builds };
      if (build) builds[key] = build;
      else delete builds[key];
      return { builds };
    }),
  loadCode: (all) => set((s) => ({ codeFiles: { ...all, ...s.codeFiles } })),
  setCalcInputs: (key, inputs) =>
    set((s) => {
      const next = { ...s.calcInputs };
      if (inputs) next[key] = inputs;
      else delete next[key];
      return { calcInputs: next };
    }),
}));

/** Плата проекта: встроенная — сразу, сгенерированная — из кэша (грузится хуком useBoard). */
export function selectBoard(s: Pick<WorkspaceState, 'project' | 'boards'>): BoardDef | undefined {
  return getBoard(s.project.boardId) ?? s.boards[s.project.boardId];
}
