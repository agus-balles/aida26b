// Main application file
// Code and comments in English
import { structure } from '@shared/ssot/structure';
import {
  Language,
  LocalizedText,
  ForeignKeyDef,
  ColumnDef,
  TableStructure,
  TableKey,
  TableRecordMap,
  RendererProps,
  RendererFunc,
  Response as ApiResponse,
} from '@shared/types/types';
import { getPkFields } from '@shared/utils/utils';
import { validateField } from '@shared/validation/validate';
import '../styles/style.css';

const API_BASE = '/api';
const PAGE_SIZE = 20;

type Role = 'admin' | 'editor' | 'reader';

type AuthUser = {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
};

type CompanyLink = {
  company_id: number;
  role: 'owner' | 'manager' | 'staff' | 'viewer';
};

type AvailabilityStatus =
  | 'available'
  | 'held'
  | 'confirmed'
  | 'unavailable'
  | 'compaction_blocked';

type AvailabilitySlot = {
  starts_at: string;
  ends_at: string;
  status: AvailabilityStatus;
  alternatives: number[];
  price_total: number;
  currency: string;
};

type AvailabilityCourt = {
  id: number;
  parent_court_id: number | null;
  root_court_id: number | null;
  name: string;
  format: string;
  layout_x: number;
  layout_y: number;
  layout_width: number;
  layout_height: number;
  slots: AvailabilitySlot[];
};

type AvailabilityResponse = {
  company: { id: number; name: string; city?: string; timezone?: string };
  courts: AvailabilityCourt[];
};

type Booking = {
  id: number;
  company_id?: number;
  company_name?: string;
  court_id: number;
  court_name: string;
  sport_id: number;
  starts_at: string;
  ends_at: string;
  status: 'held' | 'confirmed' | 'cancelled' | 'expired';
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  price_total: string | number;
  currency: string;
  hold_expires_at: string | null;
  created_at: string;
};

type BookingFilters = { companyId: string; status: string };

type PartitionLayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// -----------------------------------------------------------------------------
// Localization
// -----------------------------------------------------------------------------

const storedLanguage = localStorage.getItem('language');

function isLanguage(value: string | null): value is Language {
  return value === 'es' || value === 'en';
}

let currentLanguage: Language = isLanguage(storedLanguage) ? storedLanguage : 'es';

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(language: Language): void {
  currentLanguage = language;
  localStorage.setItem('language', language);
}

export function getLocalizedText(text?: LocalizedText | string): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text[currentLanguage] ?? text.es ?? text.en ?? '';
}

// -----------------------------------------------------------------------------
// DOM elements
// -----------------------------------------------------------------------------

const authSection = document.getElementById('auth-section') as HTMLElement;
const passwordSection = document.getElementById('password-section') as HTMLElement;
const appShell = document.getElementById('app-shell') as HTMLElement;

const loginForm = document.getElementById('login-form') as HTMLFormElement;
const loginError = document.getElementById('login-error') as HTMLElement;

const passwordForm = document.getElementById('password-form') as HTMLFormElement;
const passwordError = document.getElementById('password-error') as HTMLElement;
const publicBookingSection = document.getElementById('public-booking-section') as HTMLElement;

const currentUserEl = document.getElementById('current-user') as HTMLElement;
const changePasswordBtn = document.getElementById('change-password-btn') as HTMLButtonElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const homeBtn = document.getElementById('home-btn') as HTMLButtonElement;
const loginNavBtn = document.getElementById('login-nav-btn') as HTMLButtonElement;
const tourHelpBtn = document.getElementById('tour-help-btn') as HTMLButtonElement;
const statusMessage = document.getElementById('status-message') as HTMLElement;

const viewTitle = document.getElementById('view-title') as HTMLElement;
const addRecordBtn = document.getElementById('add-record-btn') as HTMLButtonElement;

const recordsSection =
  (document.getElementById('records-section') as HTMLElement | null) ??
  document.createElement('div');
const formContainer = document.getElementById('record-form') as HTMLElement;
const sharedTable = document.getElementById('records-table') as HTMLTableElement;
const navContainer = document.getElementById('table-nav') as HTMLElement;
const menuContainer = document.getElementById('menu-nav') as HTMLElement;

const availabilitySection = document.createElement('div');
availabilitySection.id = 'availability-section';
availabilitySection.className = 'section';
availabilitySection.style.display = 'none';

if (recordsSection.parentElement) {
  recordsSection.insertAdjacentElement('afterend', availabilitySection);
}

const permissionsSection = document.createElement('div');
permissionsSection.id = 'permissions-section';
permissionsSection.className = 'section';
permissionsSection.style.display = 'none';

if (availabilitySection.parentElement) {
  availabilitySection.insertAdjacentElement('afterend', permissionsSection);
}

const tableKeys = Object.keys(structure.tables) as TableKey[];
const menuKeys = Object.keys(structure.menu) as Array<keyof typeof structure.menu>;
const tableNavButtons = {} as Record<TableKey, HTMLButtonElement>;
let availabilityNavButton: HTMLButtonElement | null = null;
let permissionsNavButton: HTMLButtonElement | null = null;

// -----------------------------------------------------------------------------
// Auth/session state
// -----------------------------------------------------------------------------

let currentUser: AuthUser | null = null;
let currentCompanyLinks: CompanyLink[] = [];

function canWriteBusiness(): boolean {
  return currentUser?.role === 'admin' || currentCompanyLinks.some(
    (link) => link.role === 'owner' || link.role === 'manager' || link.role === 'staff'
  );
}

function canWriteTable(tableKey: TableKey, creating = false): boolean {
  if (currentUser?.role === 'admin') return true;
  if (!canWriteBusiness()) return false;
  if (tableKey === 'sports' || tableKey === 'court_partition_rules') return false;
  if (creating && tableKey === 'companies') return false;
  return true;
}

function setMessage(message = ''): void {
  statusMessage.textContent = message;
  statusMessage.hidden = !message;
}

// Default logged-out landing: only the public "Reservar cancha" widget.
function showPublicLanding(): void {
  currentUser = null;
  currentCompanyLinks = [];

  authSection.style.display = 'none';
  passwordSection.style.display = 'none';
  publicBookingSection.style.display = 'block';
  appShell.style.display = 'none';
  permissionsNavButton?.setAttribute('hidden', '');

  loginError.hidden = true;
  loginNavBtn.hidden = false;
  tourHelpBtn.hidden = true;
}

// Dedicated login view: only the login form, reached from the header button.
function showLogin(message = ''): void {
  currentUser = null;
  currentCompanyLinks = [];

  authSection.style.display = 'block';
  passwordSection.style.display = 'none';
  publicBookingSection.style.display = 'none';
  appShell.style.display = 'none';
  permissionsNavButton?.setAttribute('hidden', '');

  loginNavBtn.hidden = true;
  tourHelpBtn.hidden = true;

  loginError.textContent = message;
  loginError.hidden = !message;
}

function showPasswordChange(user: AuthUser, companyLinks: CompanyLink[]): void {
  currentUser = user;
  currentCompanyLinks = companyLinks;

  authSection.style.display = 'none';
  passwordSection.style.display = 'block';
  publicBookingSection.style.display = 'none';
  appShell.style.display = 'none';
  loginNavBtn.hidden = true;
  tourHelpBtn.hidden = true;

  passwordError.hidden = true;
}

function goHome(): void {
  hideAnyForm();

  if (passwordSection.style.display !== 'none') {
    showPublicLanding();
    return;
  }

  if (currentUser) {
    activeTableKey = tableKeys[0];
    showSection(activeTableKey);
    return;
  }

  showPublicLanding();
}

function showApp(user: AuthUser, companyLinks: CompanyLink[] = []): void {
  if (user.must_change_password) {
    showPasswordChange(user, companyLinks);
    return;
  }

  currentUser = user;
  currentCompanyLinks = companyLinks;

  authSection.style.display = 'none';
  passwordSection.style.display = 'none';
  publicBookingSection.style.display = 'none';
  appShell.style.display = 'block';
  loginNavBtn.hidden = true;
  tourHelpBtn.hidden = false;

  if (permissionsNavButton) {
    permissionsNavButton.hidden = user.role !== 'admin';
  }

  currentUserEl.textContent = `${user.username} (${user.role})`;

  showSection(activeTableKey, false);

  maybeStartOnboarding(user);
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<globalThis.Response> {
  const headers = options.body
    ? {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      }
    : options.headers;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  if (response.status === 401) {
    showLogin(getLocalizedText(structure.commonText.sessionExpired));
    throw new Error('Authentication required');
  }

  if (response.status === 403) {
    const data = await response
      .clone()
      .json()
      .catch(() => ({} as { error?: string }));

    const message =
      data.error === 'Password change required'
        ? getLocalizedText(structure.commonText.passwordChangeRequired)
        : getLocalizedText(structure.commonText.noPermission);

    setMessage(message);
    throw new Error(data.error || 'Forbidden');
  }

  return response;
}

// -----------------------------------------------------------------------------
// UI feedback
// -----------------------------------------------------------------------------

function showSuccessMessage(message: string): void {
  if (!message) return;

  const outputContainer = document.querySelector('.successOutputInfoContainer');
  const outputText = document.querySelector('.successOutputInfo') as HTMLDivElement | null;

  if (!outputContainer || !outputText) return;

  if (outputContainer.classList.contains('invisible')) {
    outputText.textContent = message;
    outputContainer.classList.remove('invisible');

    setTimeout(() => {
      outputText.textContent = '';
      outputContainer.classList.add('invisible');
    }, 1500);
  }
}

function showErrorMessage(message: string): void {
  const dialog = document.createElement('dialog');
  dialog.classList.add('dialogErrorMessage');

  const dialogTitle = document.createElement('h1');
  dialogTitle.textContent = getLocalizedText(structure.commonText.error);

  const dialogMessage = document.createElement('p');
  dialogMessage.textContent = message;

  const closeButton = document.createElement('button');
  closeButton.textContent = getLocalizedText(structure.commonText.accept);
  closeButton.addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });

  dialog.addEventListener('click', (event) => {
    const dialogRect = dialog.getBoundingClientRect();

    if (
      event.clientX < dialogRect.left ||
      event.clientX > dialogRect.right ||
      event.clientY < dialogRect.top ||
      event.clientY > dialogRect.bottom
    ) {
      dialog.close();
      dialog.remove();
    }
  });

  appendChildren(dialog, [dialogTitle, dialogMessage, closeButton]);
  document.querySelector('.container')?.appendChild(dialog);
  dialog.setAttribute('closedby', 'any');
  dialog.showModal();
}

function appendChildren(element: HTMLElement, children: HTMLElement[]): void {
  children.forEach((child) => element.appendChild(child));
}

async function errorMessage(response: globalThis.Response): Promise<string> {
  try {
    const body = await response.json();

    if (body && typeof body.message === 'string') return body.message;
    if (body && typeof body.error === 'string') return body.error;

    if (body && Array.isArray(body.errors)) {
      return body.errors.join('\n');
    }
  } catch {
    // Response body was not JSON.
  }

  return `Error ${response.status}`;
}

// -----------------------------------------------------------------------------
// API helpers
// -----------------------------------------------------------------------------

function getRowsFromApiResult(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;

  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { data?: unknown }).data)
  ) {
    return (result as { data: unknown[] }).data;
  }

  return [];
}

async function fetchRows(path: string): Promise<unknown[]> {
  const response = await apiFetch(path);

  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }

  const result = await response.json();
  return getRowsFromApiResult(result);
}

// -----------------------------------------------------------------------------
// Renderers
// -----------------------------------------------------------------------------

function toInputValue(column: ColumnDef, raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'object') return JSON.stringify(raw);
  if (column.input === 'date') return String(raw).slice(0, 10);
  return String(raw);
}

const renderers: Record<'input' | 'textarea' | 'select', RendererFunc> = {
  input<K extends TableKey>({
    id,
    fieldName,
    column,
    record,
    isEdit,
  }: RendererProps<K>) {
    const input = document.createElement('input');

    input.id = id;
    input.type = column.input ?? (column.type === 'number' ? 'number' : 'text');

    if (column.validator?.required) input.required = true;
    if (isEdit && column.readonlyOnEdit) input.readOnly = true;

    input.value = toInputValue(
      column,
      record?.[fieldName] ?? (!isEdit ? column.defaultValue : undefined)
    );

    return input;
  },

  textarea<K extends TableKey>({
    id,
    fieldName,
    column,
    record,
    isEdit,
  }: RendererProps<K>) {
    const textarea = document.createElement('textarea');

    textarea.id = id;

    if (column.validator?.required) textarea.required = true;

    textarea.value = String(record?.[fieldName] ?? (!isEdit ? column.defaultValue : ''));

    return textarea;
  },

  select<K extends TableKey>({
    id,
    fieldName,
    column,
    record,
    isEdit,
  }: RendererProps<K>) {
    const select = document.createElement('select');

    select.id = id;

    if (isEdit && column.readonlyOnEdit) select.disabled = true;
    if (column.validator?.required) select.required = true;

    const blankOption = document.createElement('option');
    blankOption.value = '';
    blankOption.textContent = '--';
    select.appendChild(blankOption);

    (column.options || []).forEach((option) => {
      const optionEl = document.createElement('option');

      optionEl.value = option.value;
      optionEl.textContent = getLocalizedText(option.label as LocalizedText | string);

      const selectedValue = record?.[fieldName] ?? (!isEdit ? column.defaultValue : '');

      if (String(selectedValue) === option.value) {
        optionEl.selected = true;
      }

      select.appendChild(optionEl);
    });

    return select;
  },
};

type RendererKey = keyof typeof renderers;

function getRenderer<K extends TableKey>(key: RendererKey) {
  return renderers[key] as (props: RendererProps<K>) => HTMLElement;
}

function mapInputToRenderer(input?: ColumnDef['input']): RendererKey {
  if (input === 'textarea') return 'textarea';
  if (input === 'select') return 'select';
  return 'input';
}

// -----------------------------------------------------------------------------
// Navigation and state
// -----------------------------------------------------------------------------

let activeTableKey: TableKey = tableKeys[0];
let activeCustomView: 'availability' | 'permissions' | null = null;

type FilterEntry = {
  negated: boolean;
  value?: string;
  min?: string;
  max?: string;
};

type TableState = {
  page: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  search?: string;
  filters: Record<string, FilterEntry[]>;
};

let currentState: TableState = {
  page: 1,
  filters: {},
};

function serializeFilterValue(fieldName: string, entry: FilterEntry): string | null {
  const column = (structure.tables[activeTableKey] as TableStructure).columns[fieldName];

  let value: string;

  if (column?.type === 'number') {
    value = `${entry.min ?? ''},${entry.max ?? ''}`;
    if (value === ',') return null;
  } else {
    value = entry.value ?? '';
    if (!value) return null;
  }

  return entry.negated ? `!${value}` : value;
}

function syncStateToUrl(): void {
  const params = new URLSearchParams();

  params.set('table', activeTableKey);
  params.set('page', String(currentState.page));

  if (currentState.sort) {
    params.set('sort', currentState.sort);
    params.set('dir', currentState.dir || 'asc');
  }

  if (currentState.search) {
    params.set('search', currentState.search);
  }

  for (const [fieldName, entries] of Object.entries(currentState.filters)) {
    for (const entry of entries) {
      const value = serializeFilterValue(fieldName, entry);

      if (value !== null) {
        params.append(`filter_${fieldName}`, value);
      }
    }
  }

  window.history.pushState({}, '', `?${params.toString()}`);
}

function syncUrlToState(): void {
  const params = new URLSearchParams(window.location.search);
  const table = params.get('table') as TableKey | null;

  if (table && structure.tables[table]) {
    activeTableKey = table;
  }

  currentState.page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  currentState.sort = params.get('sort') || undefined;
  currentState.dir = (params.get('dir') as 'asc' | 'desc' | null) || undefined;
  currentState.search = params.get('search') || undefined;
  currentState.filters = {};

  params.forEach((value, key) => {
    if (!key.startsWith('filter_')) return;

    const fieldName = key.slice(7);
    const column = (structure.tables[activeTableKey] as TableStructure).columns[fieldName];

    if (!column || !value) return;

    const negated = value.startsWith('!');
    const actualValue = negated ? value.slice(1) : value;
    const entry: FilterEntry = { negated };

    if (column.type === 'number') {
      const commaIdx = actualValue.indexOf(',');

      if (commaIdx >= 0) {
        entry.min = actualValue.slice(0, commaIdx);
        entry.max = actualValue.slice(commaIdx + 1);
      } else {
        entry.min = actualValue;
      }
    } else {
      entry.value = actualValue;
    }

    currentState.filters[fieldName] ??= [];
    currentState.filters[fieldName].push(entry);
  });
}

function setLocalizedElementText(id: string, text: LocalizedText | string): void {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = getLocalizedText(text);
  }
}

function applyStaticLanguageToUI(): void {
  document.documentElement.lang = currentLanguage;

  setLocalizedElementText('app-title', structure.commonText.appTitle);
  setLocalizedElementText('login-title', structure.commonText.login);
  setLocalizedElementText('login-username-label', structure.commonText.usernameLabel);
  setLocalizedElementText('login-password-label', structure.commonText.password);
  setLocalizedElementText('login-submit-btn', structure.commonText.login);
  setLocalizedElementText('password-title', structure.commonText.changePassword);
  setLocalizedElementText('current-password-label', structure.commonText.currentPassword);
  setLocalizedElementText('new-password-label', structure.commonText.newPassword);
  setLocalizedElementText('password-submit-btn', structure.commonText.update);
  setLocalizedElementText('change-password-btn', structure.commonText.changePassword);
  setLocalizedElementText('logout-btn', structure.commonText.logout);
  setLocalizedElementText('home-btn', structure.commonText.home);
  setLocalizedElementText('login-nav-btn', structure.commonText.signIn);
}

function updateNavButtonsText(): void {
  tableKeys.forEach((key) => {
    const config = structure.tables[key];
    const button = tableNavButtons[key];

    if (!button) return;

    button.textContent =
      getLocalizedText(config.title) || getLocalizedText(config.uiName) || key;
  });

  if (availabilityNavButton) {
    availabilityNavButton.textContent = getLocalizedText(structure.commonText.availability);
  }

  if (permissionsNavButton) {
    permissionsNavButton.textContent = getLocalizedText(structure.commonText.companyPermissions);
  }
}

function createTableNavButtons(): void {
  navContainer.innerHTML = '';

  for (const key of tableKeys) {
    const config = structure.tables[key];

    if ((config as TableStructure).showInNavigation === false) continue;

    const button = document.createElement('button');

    button.id = `${key}-btn`;
    button.textContent =
      getLocalizedText(config.title) || getLocalizedText(config.uiName) || key;

    button.addEventListener('click', () => showSection(key));

    navContainer.appendChild(button);
    tableNavButtons[key] = button;
  }

  availabilityNavButton = document.createElement('button');
  availabilityNavButton.id = 'availability-btn';
  availabilityNavButton.textContent = getLocalizedText(structure.commonText.availability);
  availabilityNavButton.addEventListener('click', () => showAvailabilityView());
  navContainer.appendChild(availabilityNavButton);

  permissionsNavButton = document.createElement('button');
  permissionsNavButton.id = 'permissions-btn';
  permissionsNavButton.textContent = getLocalizedText(structure.commonText.companyPermissions);
  permissionsNavButton.hidden = true;
  permissionsNavButton.addEventListener('click', () => showPermissionsView());
  navContainer.appendChild(permissionsNavButton);
}

function resetStateForTable(tableKey: TableKey): void {
  currentState = {
    page: 1,
    filters: {},
  };
}

function showSection(section: TableKey, pushState = true): void {
  activeCustomView = null;
  recordsSection.style.display = 'block';
  availabilitySection.style.display = 'none';
  permissionsSection.style.display = 'none';
  availabilityNavButton?.classList.remove('active');
  permissionsNavButton?.classList.remove('active');

  if (activeTableKey !== section && pushState) {
    resetStateForTable(section);
  }

  activeTableKey = section;
  setMessage();

  if (pushState) {
    syncStateToUrl();
  }

  Object.entries(tableNavButtons).forEach(([key, button]) => {
    button.classList.toggle('active', key === section);
  });

  const tableConfig = structure.tables[section];

  viewTitle.textContent = getLocalizedText(tableConfig.title);

  addRecordBtn.textContent =
    getLocalizedText(tableConfig.addButtonLabel) ||
    `${getLocalizedText(structure.commonText.add)} ${getLocalizedText(tableConfig.uiName)}`;

  addRecordBtn.style.display = canWriteTable(section, true) ? 'inline-block' : 'none';

  hideAnyForm();
  renderFilters(section);
  loadTableData(section);
}

window.addEventListener('popstate', () => {
  syncUrlToState();

  if (currentUser) {
    showSection(activeTableKey, false);
  }
});

// -----------------------------------------------------------------------------
// Menu
// -----------------------------------------------------------------------------

function renderAnyMenuOption(key: keyof typeof structure.menu): void {
  const config = structure.menu[key];

  if (!config.options) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'picker-wrapper';

  const label = document.createElement('label');
  label.htmlFor = config.id;
  label.textContent = getLocalizedText(config.title);

  const select = document.createElement('select');
  select.id = config.id;
  select.classList.add('picker');

  const initialValue =
    typeof config.initial === 'function' ? config.initial() : config.initial;

  config.options.forEach((option) => {
    const optionEl = document.createElement('option');

    optionEl.value = option.value;
    optionEl.textContent = getLocalizedText(option.label);

    if (option.value === initialValue) {
      optionEl.selected = true;
    }

    select.appendChild(optionEl);
  });

  select.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;

    (config.handler as (value: string) => void)(value);

    if (key === 'language' && isLanguage(value)) {
      setLanguage(value);
      applyLanguageToUI();
    }
  });

  wrapper.appendChild(label);
  wrapper.appendChild(select);
  menuContainer.appendChild(wrapper);
}

function showMenu(): void {
  menuContainer.innerHTML = '';
  menuKeys.forEach((key) => renderAnyMenuOption(key));
}

function applyLanguageToUI(): void {
  applyStaticLanguageToUI();
  updateNavButtonsText();
  showMenu();

  if (currentUser) {
    if (activeCustomView === 'availability') {
      showAvailabilityView();
    } else if (activeCustomView === 'permissions') {
      showPermissionsView();
    } else {
      showSection(activeTableKey, false);
    }
  }
}

window.addEventListener('languagechange', (event) => {
  const language = (event as CustomEvent<{ language?: string }>).detail?.language;

  if (isLanguage(language ?? null)) {
    setLanguage(language as Language);
    applyLanguageToUI();
  }
});

// -----------------------------------------------------------------------------
// Table rendering
// -----------------------------------------------------------------------------

const filterContainer = document.createElement('div');
filterContainer.className = 'filter-container';
filterContainer.style.display = 'flex';
filterContainer.style.gap = '10px';
filterContainer.style.flexWrap = 'wrap';
filterContainer.style.marginBottom = '15px';
sharedTable.parentNode?.insertBefore(filterContainer, sharedTable);

const paginationContainer = document.createElement('div');
paginationContainer.className = 'pagination-container';
paginationContainer.style.marginTop = '15px';
paginationContainer.style.display = 'flex';
paginationContainer.style.gap = '10px';
paginationContainer.style.alignItems = 'center';
sharedTable.parentNode?.insertBefore(paginationContainer, sharedTable.nextSibling);

function parsePartitionLayout(value: unknown): PartitionLayoutRect[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;

    if (!Array.isArray(parsed)) return [];

    return parsed.filter((rect): rect is PartitionLayoutRect =>
      typeof rect?.x === 'number' &&
      typeof rect?.y === 'number' &&
      typeof rect?.width === 'number' &&
      typeof rect?.height === 'number'
    );
  } catch {
    return [];
  }
}

function describePartitionLayout(value: unknown): string {
  const matchingOption = structure.tables.court_partition_rules.columns.layout_json.options?.find(
    (option) => option.value === value
  );

  if (matchingOption) return getLocalizedText(matchingOption.label);

  const count = parsePartitionLayout(value).length;

  return count > 0
    ? `${count} ${getLocalizedText(structure.commonText.childCourts)}`
    : getLocalizedText(structure.commonText.layoutUnavailable);
}

function formatDisplayValue(value: unknown): string {
  if (value === true || value === 'true') return getLocalizedText(structure.commonText.yes);
  if (value === false || value === 'false') return getLocalizedText(structure.commonText.no);
  return String(value ?? '');
}

function isAffirmative(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function renderCourtsTable(
  records: TableRecordMap['courts'][],
  foreignKeyLabels: Map<string, Map<string, string>>
): void {
  const thead = sharedTable.querySelector('thead')!;
  const tbody = sharedTable.querySelector('tbody')!;
  const showActions = canWriteTable('courts');
  const childrenByParent = new Map<string, TableRecordMap['courts'][]>();
  const recordsById = new Map<string, TableRecordMap['courts']>();

  records.forEach((record) => {
    recordsById.set(String(record.id), record);
    if (record.parent_court_id != null) {
      const parentKey = String(record.parent_court_id);
      childrenByParent.set(parentKey, [...(childrenByParent.get(parentKey) ?? []), record]);
    }
  });

  thead.innerHTML = '';
  tbody.innerHTML = '';

  const headerRow = document.createElement('tr');
  [
    structure.commonText.court,
    structure.commonText.company,
    structure.commonText.sport,
    structure.commonText.format,
    structure.commonText.state,
    structure.commonText.subcourts,
  ].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = getLocalizedText(label);
    headerRow.appendChild(th);
  });
  if (showActions) {
    const th = document.createElement('th');
    th.textContent = getLocalizedText(structure.commonText.actions);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  const expanded = new Set<string>();
  const rowByCourtId = new Map<string, HTMLTableRowElement>();
  const rootRecords = records.filter((record) => record.parent_court_id == null);

  // A court row is visible only when every ancestor in its chain is expanded,
  // so collapsing one node hides just its own subtree (not the whole root).
  const isCourtVisible = (record: TableRecordMap['courts']): boolean => {
    let parentId: number | null = record.parent_court_id;
    while (parentId != null) {
      if (!expanded.has(String(parentId))) return false;
      parentId = recordsById.get(String(parentId))?.parent_court_id ?? null;
    }
    return true;
  };

  const refreshCourtVisibility = () => {
    records.forEach((record) => {
      const row = rowByCourtId.get(String(record.id));
      if (row) row.hidden = !isCourtVisible(record);
    });
  };

  const appendCourt = (record: TableRecordMap['courts'], depth: number) => {
    const children = childrenByParent.get(String(record.id)) ?? [];
    const row = document.createElement('tr');
    row.dataset.courtId = String(record.id);
    if (depth > 0) row.hidden = true;
    rowByCourtId.set(String(record.id), row);

    const courtCell = document.createElement('td');
    courtCell.className = 'court-name-cell';
    courtCell.style.paddingInlineStart = `${16 + depth * 26}px`;
    if (children.length > 0) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'court-tree-toggle';
      toggle.textContent = '▸';
      toggle.setAttribute(
        'aria-label',
        `${getLocalizedText(structure.commonText.showChildCourtsOf)} ${String(record.name)}`
      );
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const id = String(record.id);
        const willExpand = !expanded.has(id);
        if (willExpand) expanded.add(id);
        else expanded.delete(id);
        toggle.textContent = willExpand ? '▾' : '▸';
        toggle.setAttribute('aria-expanded', String(willExpand));
        refreshCourtVisibility();
      });
      courtCell.appendChild(toggle);
    }
    const name = document.createElement('span');
    name.textContent = String(record.name);
    courtCell.appendChild(name);
    row.appendChild(courtCell);

    const companyCell = document.createElement('td');
    companyCell.textContent = foreignKeyLabels.get('company_id')?.get(String(record.company_id)) ?? '';
    row.appendChild(companyCell);

    const sportCell = document.createElement('td');
    sportCell.textContent = foreignKeyLabels.get('sport_id')?.get(String(record.sport_id)) ?? '';
    row.appendChild(sportCell);

    const formatCell = document.createElement('td');
    formatCell.textContent = getCourtFormatLabel(String(record.format));
    row.appendChild(formatCell);

    const stateCell = document.createElement('td');
    const parent = record.parent_court_id == null
      ? getLocalizedText(structure.commonText.mainCourt)
      : `${getLocalizedText(structure.commonText.childCourtOf)} ${String(recordsById.get(String(record.parent_court_id))?.name ?? getLocalizedText(structure.commonText.mainCourt))}`;
    const partition = isAffirmative(record.is_partitionable)
      ? getLocalizedText(structure.commonText.partitionable)
      : getLocalizedText(structure.commonText.notPartitionable);
    const activeState = isAffirmative(record.is_active)
      ? getLocalizedText(structure.commonText.active)
      : getLocalizedText(structure.commonText.inactive);
    stateCell.textContent = `${parent}. ${partition}. ${activeState}.`;
    row.appendChild(stateCell);

    const childrenCell = document.createElement('td');
    childrenCell.textContent = children.length === 0
      ? getLocalizedText(structure.commonText.noChildCourts)
      : `${children.length} ${getLocalizedText(children.length === 1 ? structure.commonText.childCourt : structure.commonText.childCourts)}`;
    row.appendChild(childrenCell);

    if (showActions) {
      const actionsCell = document.createElement('td');
      actionsCell.className = 'actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit-btn';
      edit.textContent = getLocalizedText(structure.commonText.edit);
      edit.addEventListener('click', () => window.editRecord('courts', String(record.id)));
      actionsCell.appendChild(edit);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-btn';
      remove.textContent = getLocalizedText(structure.commonText.delete);
      remove.addEventListener('click', () => window.deleteRecord('courts', String(record.id)));
      actionsCell.appendChild(remove);
      row.appendChild(actionsCell);
    }

    tbody.appendChild(row);
    children.forEach((child) => appendCourt(child, depth + 1));
  };

  rootRecords.forEach((record) => appendCourt(record, 0));
}

function canEditTable(tableStructure: TableStructure): boolean {
  const pkFields = Array.isArray(tableStructure.pk)
    ? tableStructure.pk
    : [tableStructure.pk];

  return Object.entries(tableStructure.columns).some(
    ([fieldName, column]) => column.editable !== false && !pkFields.includes(fieldName)
  );
}

async function fetchAllRows(
  tableName: string,
  query = new URLSearchParams()
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  for (let page = 1; ; page++) {
    const pageQuery = new URLSearchParams(query);
    pageQuery.set('page', String(page));
    const pageRows = await fetchRows(`/${tableName}?${pageQuery.toString()}`) as Record<string, unknown>[];
    rows.push(...pageRows);

    if (pageRows.length < PAGE_SIZE) return rows;
  }
}

async function loadForeignKeyLabels<K extends TableKey>(
  tableKey: K,
  records: TableRecordMap[K][]
): Promise<Map<string, Map<string, string>>> {
  const labelsByField = new Map<string, Map<string, string>>();
  const columns = Object.entries(structure.tables[tableKey].columns);

  await Promise.all(
    columns.map(async ([fieldName, column]) => {
      const foreignKey = column.foreignKey;

      if (!foreignKey || records.length === 0) return;

      try {
        const labels = new Map<string, string>();
        const rows = await fetchAllRows(foreignKey.table);

        rows.forEach((row) => {
          const value = row[foreignKey.valueField];

          if (value != null) {
            labels.set(String(value), getForeignKeyLabel(row, foreignKey));
          }
        });

        labelsByField.set(fieldName, labels);
      } catch (error) {
        console.error(`Error loading labels for ${fieldName}:`, error);
      }
    })
  );

  return labelsByField;
}

function renderAnyTable<K extends TableKey>(
  tableKey: K,
  records: TableRecordMap[K][],
  foreignKeyLabels: Map<string, Map<string, string>>
): void {
  if (tableKey === 'courts') {
    renderCourtsTable(records as TableRecordMap['courts'][], foreignKeyLabels);
    return;
  }

  const thead = sharedTable.querySelector('thead')!;
  const tbody = sharedTable.querySelector('tbody')!;
  const tableStructure = structure.tables[tableKey];
  const showActions = canWriteTable(tableKey);
  const showEditAction = canEditTable(tableStructure);

  thead.innerHTML = '';
  tbody.innerHTML = '';

  const headerRow = document.createElement('tr');

  const visibleColumns = Object.entries(tableStructure.columns).filter(
    ([, column]) => column.visible !== false
  );

  visibleColumns.forEach(([fieldName, column]) => {
    const th = document.createElement('th');

    th.textContent = getLocalizedText(column.label as LocalizedText | string) || fieldName;
    th.className = 'sortable';
    th.title = getLocalizedText(structure.commonText.clickToSort);

    if (currentState.sort === fieldName) {
      th.classList.add(currentState.dir === 'desc' ? 'sorted-desc' : 'sorted-asc');
    }

    th.addEventListener('click', () => {
      if (currentState.sort === fieldName) {
        currentState.dir = currentState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentState.sort = fieldName;
        currentState.dir = 'asc';
      }

      currentState.page = 1;
      syncStateToUrl();
      loadTableData(tableKey);
    });

    headerRow.appendChild(th);
  });

  if (showActions) {
    const actionsHeader = document.createElement('th');
    actionsHeader.textContent = getLocalizedText(structure.commonText.actions);
    headerRow.appendChild(actionsHeader);
  }

  thead.appendChild(headerRow);

  records.forEach((record) => {
    const pkFields = Array.isArray(tableStructure.pk)
      ? tableStructure.pk
      : [tableStructure.pk];

    const row = document.createElement('tr');
    const columnNames = visibleColumns.map(([fieldName]) => fieldName) as Array<
      keyof TableRecordMap[K] & string
    >;

    columnNames.forEach((name) => {
      const td = document.createElement('td');
      const value = record[name];
      const label = foreignKeyLabels.get(name)?.get(String(value));
      const column = (tableStructure.columns as Record<string, ColumnDef>)[name];
      const optionLabel = column?.options?.find(
        (option) => option.value === String(value)
      )?.label;

      if (tableKey === 'court_partition_rules' && (name === 'source_format' || name === 'target_format')) {
        td.textContent = getCourtFormatLabel(String(value ?? ''));
      } else if (tableKey === 'court_partition_rules' && name === 'layout_json') {
        td.textContent = describePartitionLayout(value);
      } else {
        td.textContent = label ?? (getLocalizedText(optionLabel) || formatDisplayValue(value));
      }
      row.appendChild(td);
    });

    if (showActions) {
      const actionsTd = document.createElement('td');
      actionsTd.className = 'actions';

      const pkValues = pkFields.map((field) =>
        String(record[field as keyof TableRecordMap[K]] ?? '')
      );

      if (showEditAction) {
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.textContent = getLocalizedText(structure.commonText.edit);
        editBtn.dataset.pk = JSON.stringify(pkValues);
        editBtn.addEventListener('click', (event) => {
          const values = JSON.parse(
            (event.currentTarget as HTMLElement).dataset.pk || '[]'
          );
          window.editRecord(tableKey, ...values);
        });

        actionsTd.appendChild(editBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = getLocalizedText(structure.commonText.delete);
      deleteBtn.dataset.pk = JSON.stringify(pkValues);
      deleteBtn.addEventListener('click', (event) => {
        const values = JSON.parse(
          (event.currentTarget as HTMLElement).dataset.pk || '[]'
        );
        window.deleteRecord(tableKey, ...values);
      });

      actionsTd.appendChild(deleteBtn);
      row.appendChild(actionsTd);
    }

    tbody.appendChild(row);
  });
}

async function loadTableData<K extends TableKey>(tableKey: K): Promise<void> {
  try {
    const params = new URLSearchParams();

    params.set('page', String(currentState.page));

    if (currentState.sort) {
      params.set('sort', currentState.sort);
      params.set('dir', currentState.dir || 'asc');
    }

    if (currentState.search) {
      params.set('search', currentState.search);
    }

    for (const [fieldName, entries] of Object.entries(currentState.filters)) {
      for (const entry of entries) {
        const value = serializeFilterValue(fieldName, entry);

        if (value !== null) {
          params.append(`filter_${fieldName}`, value);
        }
      }
    }

    if (tableKey === 'courts') {
      const data = await fetchAllRows(tableKey, params) as TableRecordMap[K][];
      const foreignKeyLabels = await loadForeignKeyLabels(tableKey, data);
      renderAnyTable(tableKey, data, foreignKeyLabels);
      paginationContainer.innerHTML = '';
      return;
    }

    const response = await apiFetch(`/${tableKey}?${params.toString()}`);

    if (!response.ok) {
      return showErrorMessage(await errorMessage(response));
    }

    const result = await response.json();
    const data = (result.data ?? getRowsFromApiResult(result)) as TableRecordMap[K][];
    const total = Number(result.total ?? data.length);
    const foreignKeyLabels = await loadForeignKeyLabels(tableKey, data);

    renderAnyTable(tableKey, data, foreignKeyLabels);
    renderPagination(total);

    if (result.message) {
      showSuccessMessage(result.message);
    }
  } catch (error) {
    const message = (error as Error).message;

    if (message !== 'Authentication required' && message !== 'Forbidden') {
      setMessage(getLocalizedText(structure.commonText.errorLoadingData));
      console.error(`Error loading ${tableKey}:`, error);
    }
  }
}

function renderPagination(total: number): void {
  paginationContainer.innerHTML = '';

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const info = document.createElement('span');
  info.textContent = `${getLocalizedText(structure.commonText.pageInfo)} ${currentState.page} ${getLocalizedText(structure.commonText.pageOf)} ${totalPages} (${getLocalizedText(structure.commonText.total)}: ${total})`;
  paginationContainer.appendChild(info);

  const prevBtn = document.createElement('button');
  prevBtn.textContent = getLocalizedText(structure.commonText.previous);
  prevBtn.disabled = currentState.page <= 1;
  prevBtn.addEventListener('click', () => {
    if (currentState.page > 1) {
      currentState.page--;
      syncStateToUrl();
      loadTableData(activeTableKey);
    }
  });
  paginationContainer.appendChild(prevBtn);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = getLocalizedText(structure.commonText.next);
  nextBtn.disabled = currentState.page >= totalPages;
  nextBtn.addEventListener('click', () => {
    if (currentState.page < totalPages) {
      currentState.page++;
      syncStateToUrl();
      loadTableData(activeTableKey);
    }
  });
  paginationContainer.appendChild(nextBtn);
}

// -----------------------------------------------------------------------------
// Availability map
// -----------------------------------------------------------------------------

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSlotTime(iso: string): string {
  return new Intl.DateTimeFormat(currentLanguage, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function fillSelect(
  select: HTMLSelectElement,
  rows: unknown[],
  valueField: string,
  labelField: string
): void {
  select.innerHTML = '';

  rows.forEach((row) => {
    const record = row as Record<string, unknown>;
    const option = document.createElement('option');
    const value = String(record[valueField] ?? '');

    option.value = value;
    option.textContent = String(record[labelField] ?? '');
    select.appendChild(option);
  });
}

async function loadAvailabilityOptions(
  companySelect: HTMLSelectElement,
  sportSelect: HTMLSelectElement,
  durationSelect: HTMLSelectElement
): Promise<void> {
  sportSelect.innerHTML = '';
  durationSelect.innerHTML = '';

  if (!companySelect.value) return;

  const companyId = encodeURIComponent(companySelect.value);
  const [sports, timeBlocks] = await Promise.all([
    fetchRows(`/public/companies/${companyId}/sports`),
    fetchRows(`/public/companies/${companyId}/time-blocks`),
  ]);

  fillSelect(sportSelect, sports, 'id', 'name');

  timeBlocks.forEach((row) => {
    const record = row as Record<string, unknown>;
    const minutes = String(record.duration_minutes ?? '');

    if (!minutes) return;

    const option = document.createElement('option');
    option.value = minutes;
    option.textContent = `${minutes} min`;
    durationSelect.appendChild(option);
  });
}

function showAvailabilityView(): void {
  activeCustomView = 'availability';
  recordsSection.style.display = 'none';
  availabilitySection.style.display = 'block';
  permissionsSection.style.display = 'none';
  hideAnyForm();
  setMessage();

  Object.values(tableNavButtons).forEach((button) => button.classList.remove('active'));
  availabilityNavButton?.classList.add('active');
  permissionsNavButton?.classList.remove('active');

  void renderAvailabilityControls(availabilitySection, canWriteBusiness());
}

async function renderAvailabilityControls(
  container: HTMLElement,
  operatorCanConfirm: boolean
): Promise<void> {
  container.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = getLocalizedText(
    operatorCanConfirm ? structure.commonText.availability : structure.commonText.publicBooking
  );
  container.appendChild(title);

  const form = document.createElement('form');
  form.className = 'availability-controls';

  const companySelect = document.createElement('select');
  const sportSelect = document.createElement('select');
  const dateInput = document.createElement('input');
  const durationSelect = document.createElement('select');
  const submitBtn = document.createElement('button');

  dateInput.type = 'date';
  dateInput.value = todayIsoDate();
  submitBtn.type = 'submit';
  submitBtn.textContent = getLocalizedText(structure.commonText.availability);

  appendAvailabilityControl(form, structure.commonText.company, companySelect);
  appendAvailabilityControl(form, structure.commonText.sport, sportSelect);
  appendAvailabilityControl(form, structure.commonText.date, dateInput);
  appendAvailabilityControl(form, structure.commonText.duration, durationSelect);
  form.appendChild(submitBtn);

  const output = document.createElement('div');
  output.className = 'availability-output';

  container.appendChild(form);
  container.appendChild(output);

  const bookingsPanel = operatorCanConfirm ? document.createElement('div') : null;
  if (bookingsPanel) {
    bookingsPanel.className = 'operator-bookings';
    container.appendChild(bookingsPanel);
  }

  const reloadMap = (): Promise<void> =>
    loadAvailability(
      companySelect,
      sportSelect,
      dateInput,
      durationSelect,
      output,
      operatorCanConfirm
    );

  const bookingFilters: BookingFilters = { companyId: '', status: '' };
  const reloadBookings = async (): Promise<void> => {
    if (bookingsPanel) {
      await renderOperatorBookings(bookingsPanel, reloadMap, bookingFilters);
    }
  };

  try {
    const companies = await fetchRows('/public/companies');

    fillSelect(companySelect, companies, 'id', 'name');

    // A company operator (non-admin) defaults to their own company, so the map
    // and bookings panel load their data instead of an arbitrary first company
    // they may not be allowed to manage.
    if (operatorCanConfirm && currentUser?.role !== 'admin' && currentCompanyLinks.length > 0) {
      const ownCompanyId = String(currentCompanyLinks[0].company_id);
      if (Array.from(companySelect.options).some((option) => option.value === ownCompanyId)) {
        companySelect.value = ownCompanyId;
      }
    }

    await loadAvailabilityOptions(companySelect, sportSelect, durationSelect);

    companySelect.addEventListener('change', async () => {
      await loadAvailabilityOptions(companySelect, sportSelect, durationSelect);
      await reloadBookings();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await loadAvailability(
        companySelect,
        sportSelect,
        dateInput,
        durationSelect,
        output,
        operatorCanConfirm
      );
      await reloadBookings();
    });

    if (companySelect.value && sportSelect.value && durationSelect.value) {
      await loadAvailability(
        companySelect,
        sportSelect,
        dateInput,
        durationSelect,
        output,
        operatorCanConfirm
      );
    }

    await reloadBookings();
  } catch (error) {
    output.textContent = getLocalizedText(structure.commonText.errorLoadingData);
    console.error('Error loading availability controls:', error);
  }
}

function bookingStatusLabel(status: string): string {
  switch (status) {
    case 'held': return getLocalizedText(structure.commonText.bookingStatusHeld);
    case 'confirmed': return getLocalizedText(structure.commonText.bookingStatusConfirmed);
    case 'cancelled': return getLocalizedText(structure.commonText.bookingStatusCancelled);
    case 'expired': return getLocalizedText(structure.commonText.bookingStatusExpired);
    default: return status;
  }
}

async function renderOperatorBookings(
  panel: HTMLElement,
  refreshMap: () => Promise<void>,
  filters: BookingFilters
): Promise<void> {
  panel.innerHTML = '';
  const isAdmin = currentUser?.role === 'admin';

  const rerender = () => { void renderOperatorBookings(panel, refreshMap, filters); };

  const header = document.createElement('div');
  header.className = 'operator-bookings-header';

  const heading = document.createElement('h3');
  heading.textContent = getLocalizedText(structure.commonText.bookingsTitle);
  header.appendChild(heading);

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'operator-bookings-refresh';
  refreshBtn.textContent = getLocalizedText(structure.commonText.refreshBookings);
  refreshBtn.addEventListener('click', rerender);
  header.appendChild(refreshBtn);

  panel.appendChild(header);

  const filterControl = (labelText: string, control: HTMLSelectElement): HTMLElement => {
    const wrapper = document.createElement('label');
    wrapper.className = 'booking-filter';
    const span = document.createElement('span');
    span.textContent = labelText;
    wrapper.appendChild(span);
    wrapper.appendChild(control);
    return wrapper;
  };

  const filterBar = document.createElement('div');
  filterBar.className = 'operator-bookings-filters';

  // Admin can scope to a company; operators are already scoped server-side.
  if (isAdmin) {
    const companySelect = document.createElement('select');
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = getLocalizedText(structure.commonText.allCompanies);
    companySelect.appendChild(allOption);
    try {
      const companies = await fetchRows('/public/companies') as Array<Record<string, unknown>>;
      companies.forEach((company) => {
        const option = document.createElement('option');
        option.value = String(company.id);
        option.textContent = String(company.name);
        companySelect.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading company filter:', error);
    }
    companySelect.value = filters.companyId;
    companySelect.addEventListener('change', () => {
      filters.companyId = companySelect.value;
      rerender();
    });
    filterBar.appendChild(filterControl(getLocalizedText(structure.commonText.company), companySelect));
  }

  const statusSelect = document.createElement('select');
  ([
    ['', structure.commonText.statusActive],
    ['held', structure.commonText.bookingStatusHeld],
    ['confirmed', structure.commonText.bookingStatusConfirmed],
    ['cancelled', structure.commonText.bookingStatusCancelled],
    ['all', structure.commonText.statusAll],
  ] as Array<[string, LocalizedText]>).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = getLocalizedText(label);
    statusSelect.appendChild(option);
  });
  statusSelect.value = filters.status;
  statusSelect.addEventListener('change', () => {
    filters.status = statusSelect.value;
    rerender();
  });
  filterBar.appendChild(filterControl(getLocalizedText(structure.commonText.status), statusSelect));

  panel.appendChild(filterBar);

  let bookings: Booking[] = [];
  try {
    const params = new URLSearchParams();
    if (filters.companyId) params.set('company_id', filters.companyId);
    if (filters.status) params.set('status', filters.status);
    const response = await apiFetch(`/bookings?${params.toString()}`);

    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }

    const result = (await response.json()) as { data?: Booking[] };
    bookings = result.data ?? [];
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'operator-bookings-empty';
    message.textContent = getLocalizedText(structure.commonText.errorLoadingData);
    panel.appendChild(message);
    console.error('Error loading bookings:', error);
    return;
  }

  if (bookings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'operator-bookings-empty';
    empty.textContent = getLocalizedText(structure.commonText.noBookings);
    panel.appendChild(empty);
    return;
  }

  const reload = async (): Promise<void> => {
    await refreshMap();
    await renderOperatorBookings(panel, refreshMap, filters);
  };

  const surface = document.createElement('div');
  surface.className = 'operator-bookings-table';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  ([
    ...(isAdmin ? [structure.commonText.company] : []),
    structure.commonText.court,
    structure.commonText.schedule,
    structure.commonText.customer,
    structure.commonText.status,
    structure.commonText.price,
    structure.commonText.actions,
  ] as LocalizedText[]).forEach((label) => {
    const th = document.createElement('th');
    th.textContent = getLocalizedText(label);
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  bookings.forEach((booking) => {
    const row = document.createElement('tr');
    const cells: HTMLTableCellElement[] = [];

    if (isAdmin) {
      const companyCell = document.createElement('td');
      companyCell.textContent = booking.company_name ?? '';
      cells.push(companyCell);
    }

    const courtCell = document.createElement('td');
    courtCell.textContent = booking.court_name;
    cells.push(courtCell);

    const scheduleCell = document.createElement('td');
    scheduleCell.textContent = `${formatSlotTime(booking.starts_at)} - ${formatSlotTime(booking.ends_at)}`;
    cells.push(scheduleCell);

    const customerCell = document.createElement('td');
    customerCell.textContent = booking.customer_name;
    cells.push(customerCell);

    const statusCell = document.createElement('td');
    statusCell.textContent = bookingStatusLabel(booking.status);
    cells.push(statusCell);

    const priceCell = document.createElement('td');
    priceCell.textContent = `${booking.price_total} ${booking.currency}`;
    cells.push(priceCell);

    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'actions';

    if (booking.status === 'held') {
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'confirm-btn';
      confirmBtn.textContent = getLocalizedText(structure.commonText.confirm);
      confirmBtn.addEventListener('click', async () => {
        const response = await apiFetch(`/bookings/${booking.id}/confirm`, { method: 'POST' });
        if (!response.ok) return showErrorMessage(await errorMessage(response));
        setMessage(getLocalizedText(structure.commonText.bookingConfirmed));
        await reload();
      });
      actions.appendChild(confirmBtn);
    }

    if (booking.status === 'held' || booking.status === 'confirmed') {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'cancel-btn';
      cancelBtn.textContent = getLocalizedText(structure.commonText.cancel);
      cancelBtn.addEventListener('click', async () => {
        const response = await apiFetch(`/bookings/${booking.id}/cancel`, { method: 'POST' });
        if (!response.ok) return showErrorMessage(await errorMessage(response));
        await reload();
      });
      actions.appendChild(cancelBtn);
    }

    actionsCell.appendChild(actions);
    cells.push(actionsCell);

    appendChildren(row, cells);
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  surface.appendChild(table);
  panel.appendChild(surface);
}

function appendAvailabilityControl(
  form: HTMLFormElement,
  labelText: LocalizedText,
  input: HTMLInputElement | HTMLSelectElement,
  required = true
): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-group';

  const label = document.createElement('label');
  label.textContent = getLocalizedText(labelText);
  wrapper.appendChild(label);

  input.required = required;
  wrapper.appendChild(input);
  form.appendChild(wrapper);
}

async function loadAvailability(
  companySelect: HTMLSelectElement,
  sportSelect: HTMLSelectElement,
  dateInput: HTMLInputElement,
  durationSelect: HTMLSelectElement,
  output: HTMLElement,
  operatorCanConfirm: boolean
): Promise<void> {
  if (!companySelect.value || !sportSelect.value || !dateInput.value || !durationSelect.value) {
    return;
  }

  const params = new URLSearchParams({
    date: dateInput.value,
    sport_id: sportSelect.value,
    duration_minutes: durationSelect.value,
  });

  const response = await apiFetch(
    `/companies/${encodeURIComponent(companySelect.value)}/availability?${params.toString()}`
  );

  if (!response.ok) {
    output.textContent = await errorMessage(response);
    return;
  }

  const data = (await response.json()) as AvailabilityResponse;
  renderAvailabilityMap(
    data,
    Number(sportSelect.value),
    Number(durationSelect.value),
    output,
    () => loadAvailability(
      companySelect,
      sportSelect,
      dateInput,
      durationSelect,
      output,
      operatorCanConfirm
    ),
    operatorCanConfirm
  );
}

function aggregateCourtStatus(slots: AvailabilitySlot[]): AvailabilityStatus {
  if (slots.some((slot) => slot.status === 'available')) return 'available';
  if (slots.some((slot) => slot.status === 'compaction_blocked')) return 'compaction_blocked';
  if (slots.some((slot) => slot.status === 'held')) return 'held';
  if (slots.some((slot) => slot.status === 'confirmed')) return 'confirmed';
  return 'unavailable';
}

function renderAvailabilityMap(
  data: AvailabilityResponse,
  sportId: number,
  durationMinutes: number,
  output: HTMLElement,
  refresh: () => Promise<void>,
  operatorCanConfirm: boolean
): void {
  output.innerHTML = '';

  const map = document.createElement('div');
  map.className = 'availability-map';

  const slotsPanel = document.createElement('div');
  slotsPanel.className = 'availability-slots';

  const bookingPanel = document.createElement('div');
  bookingPanel.className = 'availability-booking';

  // Size/format selector: each format level (11, 8, 5…) is shown on its own so
  // subcourts are visible and reservable instead of overlapping the big court.
  const formats = [...new Set(data.courts.map((court) => court.format))];
  let formatFilter = data.courts.find((court) => court.parent_court_id == null)?.format
    ?? formats[0] ?? '';

  if (formats.length > 1) {
    const sizeBar = document.createElement('div');
    sizeBar.className = 'availability-size';

    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = getLocalizedText(structure.commonText.courtSize);
    sizeBar.appendChild(sizeLabel);

    const sizeSelect = document.createElement('select');
    formats.forEach((format) => {
      const option = document.createElement('option');
      option.value = format;
      option.textContent = getCourtFormatLabel(format);
      sizeSelect.appendChild(option);
    });
    sizeSelect.value = formatFilter;
    sizeSelect.addEventListener('change', () => {
      formatFilter = sizeSelect.value;
      selectedCourtId = data.courts.find((court) => court.format === formatFilter)?.id ?? null;
      selectedSlotStart = null;
      draw();
    });
    sizeBar.appendChild(sizeSelect);
    output.appendChild(sizeBar);
  }

  output.appendChild(map);
  output.appendChild(slotsPanel);
  output.appendChild(bookingPanel);

  let selectedCourtId: number | null = data.courts.find((court) => court.format === formatFilter)?.id
    ?? data.courts[0]?.id ?? null;
  let selectedSlotStart: string | null = null;

  const draw = () => {
    map.innerHTML = '';
    slotsPanel.innerHTML = '';
    bookingPanel.innerHTML = '';

    const visibleCourts = data.courts.filter((court) => court.format === formatFilter);

    visibleCourts.forEach((court) => {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'court-tile';
      button.dataset.status = aggregateCourtStatus(court.slots);
      button.classList.toggle('selected', court.id === selectedCourtId);
      button.style.left = `${Number(court.layout_x) * 100}%`;
      button.style.top = `${Number(court.layout_y) * 100}%`;
      button.style.width = `${Number(court.layout_width) * 100}%`;
      button.style.height = `${Number(court.layout_height) * 100}%`;
      button.textContent = court.name;
      button.addEventListener('click', () => {
        selectedCourtId = court.id;
        selectedSlotStart = null;
        draw();
      });

      map.appendChild(button);
    });

    const selected = visibleCourts.find((court) => court.id === selectedCourtId)
      ?? visibleCourts[0];
    if (!selected) return;

    const heading = document.createElement('h3');
    heading.textContent = selected.name;
    slotsPanel.appendChild(heading);

    selected.slots.forEach((slot) => {
      const button = document.createElement('button');
      const price = slot.price_total ? ` · ${slot.currency} ${slot.price_total}` : '';

      button.type = 'button';
      button.className = 'slot-btn';
      button.dataset.status = slot.status;
      button.classList.toggle('selected', slot.starts_at === selectedSlotStart);
      button.textContent = `${formatSlotTime(slot.starts_at)}${price}`;
      // Operators can also open occupied slots to manage the reservation.
      const occupied = slot.status === 'held' || slot.status === 'confirmed';
      button.disabled = slot.status === 'available'
        ? false
        : !(operatorCanConfirm && occupied);
      button.addEventListener('click', () => {
        selectedSlotStart = slot.starts_at;
        slotsPanel.querySelectorAll('.slot-btn.selected').forEach((other) => other.classList.remove('selected'));
        button.classList.add('selected');
        if (slot.status === 'available') {
          renderBookingForm(
            data.company.id,
            selected,
            sportId,
            durationMinutes,
            slot,
            bookingPanel,
            refresh,
            operatorCanConfirm
          );
        } else if (operatorCanConfirm && occupied) {
          void renderSlotReservation(data, selected, slot, bookingPanel, refresh);
        }
      });

      slotsPanel.appendChild(button);

      if (slot.status === 'compaction_blocked' && slot.alternatives.length > 0) {
        const suggestions = document.createElement('div');
        suggestions.className = 'slot-alternatives';

        const suggestionsLabel = document.createElement('span');
        suggestionsLabel.className = 'slot-alternatives-label';
        suggestionsLabel.textContent = `${getLocalizedText(structure.commonText.suggestedCourts)}:`;
        suggestions.appendChild(suggestionsLabel);

        slot.alternatives.forEach((alternativeId) => {
          const alternativeCourt = data.courts.find((candidate) => candidate.id === alternativeId);

          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'alt-court-chip';
          chip.textContent = alternativeCourt?.name ?? String(alternativeId);
          chip.addEventListener('click', () => {
            selectedCourtId = alternativeId;
            draw();
            map.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });

          suggestions.appendChild(chip);
        });

        slotsPanel.appendChild(suggestions);
      }
    });
  };

  draw();
}

// Operator view shown when an occupied slot is clicked: the reservation(s)
// affecting that court/time, with confirm/cancel.
async function renderSlotReservation(
  data: AvailabilityResponse,
  court: AvailabilityCourt,
  slot: AvailabilitySlot,
  panel: HTMLElement,
  refresh: () => Promise<void>
): Promise<void> {
  panel.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'slot-reservation';
  const title = document.createElement('h3');
  title.textContent = `${court.name} · ${formatSlotTime(slot.starts_at)}`;
  card.appendChild(title);
  panel.appendChild(card);

  const courtById = new Map(data.courts.map((candidate) => [candidate.id, candidate]));
  const rootOf = (id: number): number => {
    const candidate = courtById.get(id);
    return candidate ? (candidate.root_court_id ?? candidate.id) : id;
  };
  const selectedRoot = court.root_court_id ?? court.id;

  let bookings: Booking[] = [];
  try {
    const response = await apiFetch(`/bookings?company_id=${encodeURIComponent(String(data.company.id))}`);
    if (!response.ok) throw new Error(await errorMessage(response));
    const all = ((await response.json()) as { data?: Booking[] }).data ?? [];
    bookings = all.filter(
      (booking) => booking.starts_at === slot.starts_at && rootOf(Number(booking.court_id)) === selectedRoot
    );
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'operator-bookings-empty';
    message.textContent = getLocalizedText(structure.commonText.errorLoadingData);
    card.appendChild(message);
    console.error('Error loading slot reservation:', error);
    return;
  }

  if (bookings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'operator-bookings-empty';
    empty.textContent = getLocalizedText(structure.commonText.noBookings);
    card.appendChild(empty);
    return;
  }

  bookings.forEach((booking) => {
    const item = document.createElement('div');
    item.className = 'slot-reservation-item';

    const info = document.createElement('p');
    info.className = 'slot-reservation-info';
    const courtName = courtById.get(Number(booking.court_id))?.name ?? booking.court_name ?? '';
    info.textContent = `${booking.customer_name} · ${courtName} · ${bookingStatusLabel(booking.status)}`;
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';

    if (booking.status === 'held') {
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'confirm-btn';
      confirmBtn.textContent = getLocalizedText(structure.commonText.confirm);
      confirmBtn.addEventListener('click', async () => {
        const result = await apiFetch(`/bookings/${booking.id}/confirm`, { method: 'POST' });
        if (!result.ok) return showErrorMessage(await errorMessage(result));
        setMessage(getLocalizedText(structure.commonText.bookingConfirmed));
        await refresh();
      });
      actions.appendChild(confirmBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'cancel-btn';
    cancelBtn.textContent = getLocalizedText(structure.commonText.cancel);
    cancelBtn.addEventListener('click', async () => {
      const result = await apiFetch(`/bookings/${booking.id}/cancel`, { method: 'POST' });
      if (!result.ok) return showErrorMessage(await errorMessage(result));
      await refresh();
    });
    actions.appendChild(cancelBtn);

    item.appendChild(actions);
    card.appendChild(item);
  });
}

function renderBookingForm(
  companyId: number,
  court: AvailabilityCourt,
  sportId: number,
  durationMinutes: number,
  slot: AvailabilitySlot,
  panel: HTMLElement,
  refresh: () => Promise<void>,
  operatorCanConfirm: boolean
): void {
  panel.innerHTML = '';

  const form = document.createElement('form');
  form.className = 'booking-form';

  const title = document.createElement('h3');
  title.textContent = `${court.name} · ${formatSlotTime(slot.starts_at)}`;
  form.appendChild(title);

  const nameInput = document.createElement('input');
  const emailInput = document.createElement('input');
  const phoneInput = document.createElement('input');

  nameInput.required = true;
  emailInput.type = 'email';

  appendAvailabilityControl(form, structure.commonText.customerName, nameInput);
  appendAvailabilityControl(form, structure.commonText.customerEmail, emailInput, false);
  appendAvailabilityControl(form, structure.commonText.customerPhone, phoneInput, false);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = getLocalizedText(structure.commonText.reserve);
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const response = await apiFetch('/bookings/hold', {
        method: 'POST',
        body: JSON.stringify({
          company_id: companyId,
          court_id: court.id,
          sport_id: sportId,
          starts_at: slot.starts_at,
          duration_minutes: durationMinutes,
          customer_name: nameInput.value,
          customer_email: emailInput.value,
          customer_phone: phoneInput.value,
        }),
      });

      if (!response.ok) {
        panel.textContent = await errorMessage(response);
        return;
      }

      const data = (await response.json()) as { booking: { id: number } };

      if (!operatorCanConfirm) {
        panel.innerHTML = '';
        const message = document.createElement('p');
        message.className = 'booking-held-message';
        message.textContent = getLocalizedText(structure.commonText.holdPendingOperator);
        panel.appendChild(message);
        await refresh();
        return;
      }

      setMessage(getLocalizedText(structure.commonText.bookingHeld));

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.textContent = getLocalizedText(structure.commonText.confirm);
      confirmBtn.addEventListener('click', async () => {
        const confirmResponse = await apiFetch(`/bookings/${data.booking.id}/confirm`, {
          method: 'POST',
        });

        if (!confirmResponse.ok) {
          return showErrorMessage(await errorMessage(confirmResponse));
        }

        setMessage(getLocalizedText(structure.commonText.bookingConfirmed));
        await refresh();
      });

      panel.innerHTML = '';
      panel.appendChild(confirmBtn);
    } catch (error) {
      panel.textContent = getLocalizedText(structure.commonText.errorSaving);
      console.error('Error holding booking:', error);
    }
  });

  panel.appendChild(form);
}

function showPermissionsView(): void {
  if (currentUser?.role !== 'admin') {
    setMessage(getLocalizedText(structure.commonText.noPermission));
    return;
  }

  activeCustomView = 'permissions';
  recordsSection.style.display = 'none';
  availabilitySection.style.display = 'none';
  permissionsSection.style.display = 'block';
  hideAnyForm();
  setMessage();

  Object.values(tableNavButtons).forEach((button) => button.classList.remove('active'));
  availabilityNavButton?.classList.remove('active');
  permissionsNavButton?.classList.add('active');

  renderPermissionsView();
}

async function renderPermissionsView(): Promise<void> {
  permissionsSection.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = getLocalizedText(structure.commonText.companyPermissions);
  permissionsSection.appendChild(title);

  const createUserForm = document.createElement('form');
  createUserForm.className = 'admin-user-form';

  const createUserTitle = document.createElement('h3');
  createUserTitle.textContent = getLocalizedText(structure.commonText.createUser);
  createUserForm.appendChild(createUserTitle);

  const usernameInput = document.createElement('input');
  usernameInput.name = 'username';
  usernameInput.autocomplete = 'username';
  usernameInput.minLength = 3;
  usernameInput.maxLength = 80;
  usernameInput.pattern = '[A-Za-z0-9._-]{3,80}';

  const emailInput = document.createElement('input');
  emailInput.name = 'email';
  emailInput.type = 'email';
  emailInput.autocomplete = 'email';
  emailInput.maxLength = 255;

  const passwordInput = document.createElement('input');
  passwordInput.name = 'password';
  passwordInput.type = 'password';
  passwordInput.autocomplete = 'new-password';
  passwordInput.minLength = 12;

  const userRoleSelect = document.createElement('select');
  userRoleSelect.name = 'role';
  [
    { value: 'reader', label: structure.commonText.roleReader },
    { value: 'editor', label: structure.commonText.roleEditor },
  ].forEach((role) => {
    const option = document.createElement('option');
    option.value = role.value;
    option.textContent = getLocalizedText(role.label);
    userRoleSelect.appendChild(option);
  });

  appendAvailabilityControl(createUserForm, structure.commonText.usernameLabel, usernameInput);
  appendAvailabilityControl(createUserForm, structure.commonText.emailLabel, emailInput);
  appendAvailabilityControl(createUserForm, structure.commonText.password, passwordInput);
  appendAvailabilityControl(createUserForm, structure.commonText.userRole, userRoleSelect);

  const createUserButton = document.createElement('button');
  createUserButton.type = 'submit';
  createUserButton.textContent = getLocalizedText(structure.commonText.createUser);
  createUserForm.appendChild(createUserButton);

  const createUserFeedback = document.createElement('p');
  createUserFeedback.className = 'admin-user-feedback';
  createUserFeedback.hidden = true;
  createUserForm.appendChild(createUserFeedback);

  createUserForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const response = await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: usernameInput.value,
          email: emailInput.value,
          password: passwordInput.value,
          role: userRoleSelect.value,
        }),
      });

      if (!response.ok) {
        createUserFeedback.textContent = await errorMessage(response);
        createUserFeedback.dataset.status = 'error';
        createUserFeedback.hidden = false;
        return;
      }

      const createdUser = await response.json() as AuthUser;
      createUserForm.reset();
      createUserFeedback.textContent = getLocalizedText(structure.commonText.userCreated);
      createUserFeedback.dataset.status = 'success';
      createUserFeedback.hidden = false;

      const option = document.createElement('option');
      option.value = String(createdUser.id);
      option.textContent = createdUser.username;
      userSelect.appendChild(option);
      userSelect.value = option.value;
      await loadLinks();
    } catch (error) {
      const message = (error as Error).message;

      if (message === 'Authentication required' || message === 'Forbidden') return;

      createUserFeedback.textContent = getLocalizedText(structure.commonText.errorSaving);
      createUserFeedback.dataset.status = 'error';
      createUserFeedback.hidden = false;
      console.error('Error creating user:', error);
    }
  });

  const form = document.createElement('form');
  form.className = 'company-permissions-form';

  const userSelect = document.createElement('select');
  const companySelect = document.createElement('select');
  const roleSelect = document.createElement('select');

  const roles: Array<{ value: CompanyLink['role']; label: LocalizedText }> = [
    { value: 'owner', label: structure.commonText.owner },
    { value: 'manager', label: structure.commonText.manager },
    { value: 'staff', label: structure.commonText.staff },
    { value: 'viewer', label: structure.commonText.viewer },
  ];

  roles.forEach((role) => {
    const option = document.createElement('option');
    option.value = role.value;
    option.textContent = getLocalizedText(role.label);
    roleSelect.appendChild(option);
  });

  appendAvailabilityControl(form, structure.commonText.user, userSelect);
  appendAvailabilityControl(form, structure.commonText.company, companySelect);
  appendAvailabilityControl(form, structure.commonText.companyRole, roleSelect);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = getLocalizedText(structure.commonText.savePermission);
  form.appendChild(submitBtn);

  const linksOutput = document.createElement('div');
  linksOutput.className = 'company-permissions-output';

  permissionsSection.appendChild(createUserForm);
  permissionsSection.appendChild(form);
  permissionsSection.appendChild(linksOutput);

  const loadLinks = async () => {
    linksOutput.innerHTML = '';

    if (!userSelect.value) return;

    const response = await apiFetch(
      `/admin/users/${encodeURIComponent(userSelect.value)}/companies`
    );

    if (!response.ok) {
      linksOutput.textContent = await errorMessage(response);
      return;
    }

    const result = await response.json() as { data: Array<Record<string, unknown>> };
    const table = document.createElement('table');
    const header = document.createElement('thead');
    const headerRow = document.createElement('tr');

    [structure.commonText.company, structure.commonText.companyRole, structure.commonText.actions]
      .forEach((label) => {
        const th = document.createElement('th');
        th.textContent = getLocalizedText(label);
        headerRow.appendChild(th);
      });

    header.appendChild(headerRow);
    table.appendChild(header);

    const body = document.createElement('tbody');
    result.data.forEach((link) => {
      const row = document.createElement('tr');
      const companyCell = document.createElement('td');
      const roleCell = document.createElement('td');
      const actionsCell = document.createElement('td');
      const removeBtn = document.createElement('button');

      companyCell.textContent = String(link.company_name ?? '');
      roleCell.textContent = getLocalizedText(
        structure.commonText[String(link.role) as keyof typeof structure.commonText] ?? String(link.role)
      );
      removeBtn.type = 'button';
      removeBtn.className = 'delete-btn';
      removeBtn.textContent = getLocalizedText(structure.commonText.removePermission);
      removeBtn.addEventListener('click', async () => {
        const response = await apiFetch(
          `/admin/users/${encodeURIComponent(userSelect.value)}/companies/${encodeURIComponent(String(link.company_id))}`,
          { method: 'DELETE' }
        );

        if (!response.ok) {
          setMessage(await errorMessage(response));
          return;
        }

        setMessage(getLocalizedText(structure.commonText.permissionRemoved));
        await loadLinks();
      });

      actionsCell.appendChild(removeBtn);
      row.append(companyCell, roleCell, actionsCell);
      body.appendChild(row);
    });

    table.appendChild(body);
    linksOutput.appendChild(table);
  };

  try {
    const [users, companies] = await Promise.all([
      fetchRows('/admin/users'),
      fetchAllRows('companies'),
    ]);

    fillSelect(userSelect, users, 'id', 'username');
    fillSelect(companySelect, companies, 'id', 'name');

    userSelect.addEventListener('change', () => {
      loadLinks().catch((error) => {
        linksOutput.textContent = getLocalizedText(structure.commonText.errorLoadingData);
        console.error('Error loading user company links:', error);
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const response = await apiFetch(
        `/admin/users/${encodeURIComponent(userSelect.value)}/companies`,
        {
          method: 'POST',
          body: JSON.stringify({
            company_id: Number(companySelect.value),
            role: roleSelect.value,
          }),
        }
      );

      if (!response.ok) {
        setMessage(await errorMessage(response));
        return;
      }

      setMessage(getLocalizedText(structure.commonText.permissionSaved));
      await loadLinks();
    });

    await loadLinks();
  } catch (error) {
    linksOutput.textContent = getLocalizedText(structure.commonText.errorLoadingData);
    console.error('Error loading permissions view:', error);
  }
}

// -----------------------------------------------------------------------------
// Filters
// -----------------------------------------------------------------------------

function getFilterType(column: ColumnDef): 'string' | 'number' | 'enum' {
  if (column.type === 'number') return 'number';
  if (column.input === 'select' && column.options) return 'enum';
  return 'string';
}

function createFilterControl(
  entry: FilterEntry,
  column: ColumnDef,
  onChange: () => void
): HTMLElement {
  if (column.type === 'number') {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '4px';

    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.placeholder = 'Min';
    minInput.value = entry.min ?? '';
    minInput.style.width = '80px';
    minInput.addEventListener('change', () => {
      entry.min = minInput.value;
      onChange();
    });

    const separator = document.createElement('span');
    separator.textContent = '—';

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.placeholder = 'Max';
    maxInput.value = entry.max ?? '';
    maxInput.style.width = '80px';
    maxInput.addEventListener('change', () => {
      entry.max = maxInput.value;
      onChange();
    });

    container.appendChild(minInput);
    container.appendChild(separator);
    container.appendChild(maxInput);

    return container;
  }

  if (column.input === 'select' && column.options) {
    const select = document.createElement('select');

    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '--';
    select.appendChild(blank);

    for (const option of column.options) {
      const optionEl = document.createElement('option');

      optionEl.value = option.value;
      optionEl.textContent = getLocalizedText(option.label as LocalizedText | string);

      if (entry.value === option.value) {
        optionEl.selected = true;
      }

      select.appendChild(optionEl);
    }

    select.addEventListener('change', () => {
      entry.value = select.value || undefined;
      onChange();
    });

    return select;
  }

  const input = document.createElement('input');

  input.type = 'text';
  input.placeholder = getLocalizedText(structure.commonText.filterPlaceholder);
  input.value = entry.value ?? '';
  input.style.width = '150px';

  input.addEventListener('change', () => {
    entry.value = input.value || undefined;
    onChange();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    entry.value = input.value || undefined;
    onChange();
  });

  return input;
}

function renderFilters<K extends TableKey>(tableKey: K): void {
  filterContainer.innerHTML = '';

  const searchHints: Partial<Record<TableKey, LocalizedText>> = {
    courts: structure.commonText.searchHintCourts,
    companies: structure.commonText.searchHintCompanies,
    court_partition_rules: structure.commonText.searchHintPartitionRules,
    court_prices: structure.commonText.searchHintPrices,
    company_time_blocks: structure.commonText.searchHintTimeBlocks,
  };
  const searchGroup = document.createElement('div');
  searchGroup.className = 'context-search';
  const searchLabel = document.createElement('label');
  searchLabel.htmlFor = 'context-search-input';
  searchLabel.textContent = getLocalizedText(structure.commonText.search);
  const searchInput = document.createElement('input');
  searchInput.id = 'context-search-input';
  searchInput.type = 'search';
  searchInput.placeholder = getLocalizedText(
    searchHints[tableKey] ?? structure.commonText.search
  );
  searchInput.value = currentState.search ?? '';
  let searchTimer: number | undefined;
  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      currentState.search = searchInput.value.trim() || undefined;
      currentState.page = 1;
      syncStateToUrl();
      loadTableData(tableKey);
    }, 250);
  });
  searchGroup.append(searchLabel, searchInput);
  filterContainer.appendChild(searchGroup);

  const tableStructure = structure.tables[tableKey];
  const allColumns = Object.entries(tableStructure.columns);

  const addBar = document.createElement('div');
  addBar.style.marginBottom = '10px';
  addBar.style.display = 'flex';
  addBar.style.gap = '8px';
  addBar.style.alignItems = 'center';

  const addBtn = document.createElement('button');
  addBtn.textContent = `+ ${getLocalizedText(structure.commonText.addFilter)}`;
  addBtn.className = 'add-btn';
  addBtn.style.marginBottom = '0';

  const addDropdown = document.createElement('select');
  addDropdown.style.display = 'none';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = `-- ${getLocalizedText(structure.commonText.selectColumn)} --`;
  addDropdown.appendChild(placeholder);

  allColumns.forEach(([fieldName, column]) => {
    const option = document.createElement('option');

    option.value = fieldName;
    option.textContent =
      getLocalizedText(column.label as LocalizedText | string) || fieldName;

    addDropdown.appendChild(option);
  });

  addBtn.addEventListener('click', () => {
    addDropdown.style.display =
      addDropdown.style.display === 'none' ? 'inline-block' : 'none';
  });

  addDropdown.addEventListener('change', () => {
    const fieldName = addDropdown.value;

    addDropdown.value = '';
    addDropdown.style.display = 'none';

    if (!fieldName) return;

    const column = (tableStructure.columns as Record<string, ColumnDef>)[fieldName];

    if (!column) return;

    const entry: FilterEntry =
      column.type === 'number'
        ? { negated: false, min: '', max: '' }
        : { negated: false, value: '' };

    currentState.filters[fieldName] ??= [];
    currentState.filters[fieldName].push(entry);
    currentState.page = 1;

    syncStateToUrl();
    renderFilters(tableKey);
    loadTableData(tableKey);
  });

  addBar.appendChild(addBtn);
  addBar.appendChild(addDropdown);
  filterContainer.appendChild(addBar);

  for (const [fieldName, entries] of Object.entries(currentState.filters)) {
    entries.forEach((entry, idx) => {
      const column = (tableStructure.columns as Record<string, ColumnDef>)[fieldName];

      if (!column) return;

      const row = document.createElement('div');
      row.className = 'filter-row';

      if (entry.negated) {
        row.classList.add('negated');
      }

      const columnDropdown = document.createElement('select');
      columnDropdown.className = 'filter-col-select';

      allColumns.forEach(([candidateFieldName, candidateColumn]) => {
        const option = document.createElement('option');

        option.value = candidateFieldName;
        option.textContent =
          getLocalizedText(candidateColumn.label as LocalizedText | string) ||
          candidateFieldName;

        if (candidateFieldName === fieldName) {
          option.selected = true;
        }

        columnDropdown.appendChild(option);
      });

      columnDropdown.addEventListener('change', () => {
        const newField = columnDropdown.value;

        if (newField === fieldName) return;

        const newColumn = (tableStructure.columns as Record<string, ColumnDef>)[newField];

        if (!newColumn) return;

        const oldType = getFilterType(column);
        const newType = getFilterType(newColumn);

        if (oldType !== newType) {
          entry.value = undefined;
          entry.min = undefined;
          entry.max = undefined;
        }

        if (newColumn.type === 'number') {
          if (entry.value) {
            entry.min = entry.value;
            entry.value = undefined;
          }
        } else if (entry.min !== undefined) {
          entry.value = entry.min;
          entry.min = undefined;
          entry.max = undefined;
        }

        currentState.filters[newField] ??= [];
        currentState.filters[newField].push(entry);
        currentState.filters[fieldName].splice(idx, 1);

        if (currentState.filters[fieldName].length === 0) {
          delete currentState.filters[fieldName];
        }

        currentState.page = 1;

        syncStateToUrl();
        renderFilters(tableKey);
        loadTableData(tableKey);
      });

      const onChange = () => {
        currentState.page = 1;
        syncStateToUrl();
        loadTableData(tableKey);
      };

      const negBtn = document.createElement('button');
      negBtn.textContent = 'NOT';
      negBtn.className = 'negate-btn';
      negBtn.title = 'Toggle negation';

      if (entry.negated) {
        negBtn.classList.add('active');
      }

      negBtn.addEventListener('click', () => {
        entry.negated = !entry.negated;
        currentState.page = 1;

        syncStateToUrl();
        renderFilters(tableKey);
        loadTableData(tableKey);
      });

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕';
      removeBtn.className = 'remove-filter-btn';
      removeBtn.title = 'Remove filter';
      removeBtn.addEventListener('click', () => {
        currentState.filters[fieldName].splice(idx, 1);

        if (currentState.filters[fieldName].length === 0) {
          delete currentState.filters[fieldName];
        }

        currentState.page = 1;

        syncStateToUrl();
        renderFilters(tableKey);
        loadTableData(tableKey);
      });

      row.appendChild(columnDropdown);
      row.appendChild(createFilterControl(entry, column, onChange));
      row.appendChild(negBtn);
      row.appendChild(removeBtn);
      filterContainer.appendChild(row);
    });
  }
}

// -----------------------------------------------------------------------------
// Form logic
// -----------------------------------------------------------------------------

addRecordBtn.addEventListener('click', () => showAnyForm(activeTableKey));

// Close the modal form when clicking the backdrop or pressing Escape.
formContainer.addEventListener('click', (event) => {
  if (event.target === formContainer) hideAnyForm();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && formContainer.style.display !== 'none') hideAnyForm();
});

function getFieldElementId(tableKey: TableKey, fieldName: string): string {
  return `${tableKey}-${fieldName}`;
}

function coerceFieldValue(column: ColumnDef, rawValue: string): unknown {
  if (column.type === 'number') {
    return rawValue === '' ? null : Number(rawValue);
  }

  return rawValue;
}

function getFieldErrorMessage(error: string | undefined): string | undefined {
  if (!error) return undefined;

  const spanish = currentLanguage === 'es';

  if (error.includes(' is required')) {
    return spanish ? 'Completá este campo.' : 'Complete this field.';
  }

  if (error.includes('must be one of')) {
    return spanish ? 'Seleccioná una opción válida.' : 'Select a valid option.';
  }

  if (error.includes('must be a number')) {
    return spanish ? 'Ingresá un número válido.' : 'Enter a valid number.';
  }

  if (error.includes('must be an integer')) {
    return spanish ? 'Ingresá un número entero.' : 'Enter a whole number.';
  }

  if (error.includes('must be a valid date')) {
    return spanish ? 'Elegí una fecha válida.' : 'Choose a valid date.';
  }

  if (error.includes('must be >=') || error.includes('must be <=')) {
    return spanish ? 'Ingresá un valor dentro del rango permitido.' : 'Enter a value within the allowed range.';
  }

  return spanish ? 'Revisá el valor ingresado.' : 'Check the entered value.';
}

function showFieldValidation(
  tableKey: TableKey,
  fieldName: string,
  column: ColumnDef
): string | undefined {
  const id = getFieldElementId(tableKey, fieldName);
  const element = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;

  const errorEl = document.getElementById(`${id}-error`);
  const message = getFieldErrorMessage(validateField(
    tableKey,
    fieldName,
    coerceFieldValue(column, element?.value ?? '')
  ));

  if (errorEl) {
    errorEl.textContent = message ?? '';
  }

  element?.classList.toggle('invalid', !!message);

  return message;
}

function validateForm<K extends TableKey>(tableKey: K): boolean {
  return Object.entries(structure.tables[tableKey].columns)
    .filter(([, column]) => column.editable !== false)
    .map(([fieldName, column]) => showFieldValidation(tableKey, fieldName, column))
    .every((message) => !message);
}

async function renderFormField<K extends TableKey>(
  tableKey: K,
  fieldName: keyof TableRecordMap[K] & string,
  column: ColumnDef,
  record?: Partial<TableRecordMap[K]>,
  isEdit = false
): Promise<HTMLElement> {
  const id = getFieldElementId(tableKey, fieldName);
  const wrapper = document.createElement('div');

  wrapper.className = 'form-group';

  const labelEl = document.createElement('label');
  labelEl.htmlFor = id;
  labelEl.textContent =
    getLocalizedText(column.label as LocalizedText | string) || fieldName;

  wrapper.appendChild(labelEl);

  const dynamicOptions = await loadDefaultOptions(column);
  const renderColumn = dynamicOptions ? { ...column, options: dynamicOptions } : column;

  const rendererKey = mapInputToRenderer(column.input);
  const renderer = getRenderer<K>(rendererKey);
  const inputEl = renderer({ id, fieldName, column: renderColumn, record, isEdit });

  wrapper.appendChild(inputEl);

  if (
    column.foreignKey?.table === 'companies' &&
    inputEl instanceof HTMLSelectElement
  ) {
    setupCompanySelector(
      wrapper,
      inputEl,
      column.foreignKey,
      record?.[fieldName]
    );
  }

  const errorEl = document.createElement('small');
  errorEl.className = 'field-error';
  errorEl.id = `${id}-error`;
  wrapper.appendChild(errorEl);

  inputEl.addEventListener('blur', () => {
    showFieldValidation(tableKey, fieldName, column);
  });

  inputEl.addEventListener('input', () => {
    if (errorEl.textContent) {
      showFieldValidation(tableKey, fieldName, column);
    }
  });

  return wrapper;
}

function getForeignKeyLabel(row: Record<string, unknown>, foreignKey: ForeignKeyDef): string {
  const labelField = foreignKey.labelField;

  if (row[labelField] != null) {
    return String(row[labelField]);
  }

  // Supports simple SQL-like labels such as:
  // first_name || ' ' || last_name
  if (labelField.includes('||')) {
    return labelField
      .split('||')
      .map((part) => part.trim())
      .map((part) => {
        const quoted = part.match(/^['"](.*)['"]$/);
        if (quoted) return quoted[1];

        return String(row[part] ?? '');
      })
      .join('');
  }

  return String(row[foreignKey.valueField] ?? '');
}

const defaultOptionsCache = new Map<ColumnDef, ColumnDef['options']>();

async function loadDefaultOptions(column: ColumnDef): Promise<ColumnDef['options']> {
  const foreignKey = column.foreignKey;

  if (!foreignKey || foreignKey.dependsOn) return undefined;

  const cached = defaultOptionsCache.get(column);
  if (cached) return cached;

  const rows = await fetchAllRows(foreignKey.table);

  const options = rows.map((row) => {
    const record = row as Record<string, unknown>;
    const value = String(record[foreignKey.valueField] ?? '');

    return {
      value,
      label: getForeignKeyLabel(record, foreignKey),
    };
  }) as any;

  defaultOptionsCache.set(column, options);

  return options;
}

function fillForeignKeySelect(
  select: HTMLSelectElement,
  rows: unknown[],
  foreignKey: ForeignKeyDef,
  selectedValue: unknown
): void {
  resetSelectOptions(select, '--');

  rows.forEach((row) => {
    const record = row as Record<string, unknown>;
    const option = document.createElement('option');
    option.value = String(record[foreignKey.valueField] ?? '');
    option.textContent = getForeignKeyLabel(record, foreignKey);
    select.appendChild(option);
  });

  if (selectedValue != null) select.value = String(selectedValue);
}

function setupCompanySelector(
  wrapper: HTMLElement,
  select: HTMLSelectElement,
  foreignKey: ForeignKeyDef,
  selectedValue: unknown
): void {
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'company-select-search';
  search.placeholder = getLocalizedText(structure.commonText.searchCompany);
  search.setAttribute('aria-label', getLocalizedText(structure.commonText.searchCompany));
  select.insertAdjacentElement('beforebegin', search);

  let timer: number | undefined;
  const load = async () => {
    const query = new URLSearchParams({ page: '1' });
    if (search.value.trim()) query.set('search', search.value.trim());
    const rows = await fetchRows(`/companies?${query.toString()}`);
    fillForeignKeySelect(select, rows, foreignKey, select.value || selectedValue);
  };

  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      load().catch((error) => console.error('Error searching companies:', error));
    }, 250);
  });

  wrapper.classList.add('company-select-group');

  if (selectedValue != null && !select.value) {
    apiFetch(`/companies?id=${encodeURIComponent(String(selectedValue))}`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((result: ApiResponse | null) => {
        const company = result?.data as Record<string, unknown> | undefined;
        if (!company) return;
        const option = document.createElement('option');
        option.value = String(company[foreignKey.valueField] ?? '');
        option.textContent = getForeignKeyLabel(company, foreignKey);
        option.selected = true;
        select.appendChild(option);
      })
      .catch((error) => console.error('Error loading selected company:', error));
  }
}

function resetSelectOptions(select: HTMLSelectElement, placeholder: string): void {
  select.innerHTML = '';

  const option = document.createElement('option');
  option.value = '';
  option.textContent = placeholder;
  select.appendChild(option);
}

const courtFormatOptions =
  structure.tables.courts.columns.format.options ?? [];
const courtFormatOptionByValue = new Map(
  courtFormatOptions.map((option) => [option.value, option])
);
const courtFormatsBySport =
  structure.courtFormatsBySport as Record<string, string[]>;

function setupCourtFormatOptions(record?: Partial<TableRecordMap['courts']>): void {
  const sportSelect = document.getElementById('courts-sport_id') as HTMLSelectElement | null;
  const formatSelect = document.getElementById('courts-format') as HTMLSelectElement | null;

  if (!sportSelect || !formatSelect) return;

  const update = () => {
    const slug = sportSelect.selectedOptions[0]?.dataset.slug ?? '';
    const formats = courtFormatsBySport[slug] ?? [];
    const selectedFormat = String(record?.format ?? formatSelect.value ?? '');

    resetSelectOptions(
      formatSelect,
      formats.length > 0 ? '--' : getLocalizedText(structure.commonText.selectSportFirst)
    );

    formats.forEach((format) => {
      const formatOption = courtFormatOptionByValue.get(format);
      if (!formatOption) return;

      const option = document.createElement('option');
      option.value = formatOption.value;
      option.textContent = getLocalizedText(formatOption.label);
      formatSelect.appendChild(option);
    });

    if (formats.includes(selectedFormat)) {
      formatSelect.value = selectedFormat;
    }

    formatSelect.dispatchEvent(new Event('change'));
  };

  update();
  sportSelect.addEventListener('change', update);
}

function getCourtFormatLabel(format: string): string {
  const formatOption = courtFormatOptionByValue.get(format);
  return formatOption ? getLocalizedText(formatOption.label) : format;
}

function setupPartitionRuleLayout(record?: Partial<TableRecordMap['court_partition_rules']>): void {
  const layoutSelect = document.getElementById('court_partition_rules-layout_json') as HTMLSelectElement | null;
  const childCountInput = document.getElementById('court_partition_rules-child_count') as HTMLInputElement | null;

  if (!layoutSelect || !childCountInput) return;

  const selectedLayout = record?.layout_json ?? layoutSelect.value;
  const selectedRects = parsePartitionLayout(selectedLayout);

  if (selectedRects.length > 0 && !layoutSelect.value) {
    const template = structure.tables.court_partition_rules.columns.layout_json.options?.find(
      (option) => parsePartitionLayout(option.value).length === selectedRects.length
    );

    if (template) layoutSelect.value = template.value;
  }

  const preview = document.createElement('div');
  preview.className = 'partition-layout-preview';
  preview.setAttribute('aria-label', getLocalizedText(structure.commonText.partitionPreview));
  layoutSelect.closest('.form-group')?.appendChild(preview);

  const update = () => {
    const rectangles = parsePartitionLayout(layoutSelect.value);
    childCountInput.value = rectangles.length > 0 ? String(rectangles.length) : '';
    childCountInput.readOnly = true;

    preview.innerHTML = '';
    rectangles.forEach((rect, index) => {
      const cell = document.createElement('span');
      cell.className = 'partition-layout-cell';
      cell.textContent = String(index + 1);
      cell.style.left = `${rect.x * 100}%`;
      cell.style.top = `${rect.y * 100}%`;
      cell.style.width = `${rect.width * 100}%`;
      cell.style.height = `${rect.height * 100}%`;
      preview.appendChild(cell);
    });
  };

  layoutSelect.addEventListener('change', update);
  update();
}

function setupCourtPartitionRuleOptions(
  record?: Partial<TableRecordMap['courts']>,
  isEdit = false
): void {
  const formatSelect = document.getElementById('courts-format') as HTMLSelectElement | null;
  const partitionableSelect = document.getElementById('courts-is_partitionable') as HTMLSelectElement | null;

  if (!formatSelect || !partitionableSelect) return;

  const field = document.createElement('div');
  field.className = 'form-group';
  field.id = 'courts-partition-rule-group';

  const label = document.createElement('label');
  label.htmlFor = 'courts-partition_rule_id';
  label.textContent = getLocalizedText(structure.commonText.partitionRule);
  field.appendChild(label);

  const ruleSelect = document.createElement('select');
  ruleSelect.id = 'courts-partition_rule_id';
  field.appendChild(ruleSelect);

  const error = document.createElement('small');
  error.className = 'field-error';
  error.id = 'courts-partition_rule_id-error';
  field.appendChild(error);

  const savedPartitionable = isAffirmative(record?.is_partitionable);
  let applyButton: HTMLButtonElement | null = null;

  if (isEdit) {
    const help = document.createElement('small');
    help.className = 'field-hint';
    help.textContent = getLocalizedText(structure.commonText.partitionEditReadyHint);
    field.appendChild(help);

    applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.className = 'edit-btn';
    applyButton.textContent = getLocalizedText(structure.commonText.applyPartitionRule);
    field.appendChild(applyButton);
  }

  formatSelect.closest('.form-group')?.insertAdjacentElement('afterend', field);

  let loadVersion = 0;
  const update = async () => {
    const version = ++loadVersion;
    const format = formatSelect.value;
    const isPartitionable = partitionableSelect.value === 'true';

    field.hidden = !isPartitionable;
    ruleSelect.required = !isEdit && isPartitionable;
    ruleSelect.classList.remove('invalid');
    error.textContent = '';

    if (!isPartitionable) {
      resetSelectOptions(ruleSelect, getLocalizedText(structure.commonText.notApplicable));
      return;
    }

    if (!format) {
      resetSelectOptions(ruleSelect, getLocalizedText(structure.commonText.selectFormatFirst));
      ruleSelect.disabled = true;
      return;
    }

    ruleSelect.disabled = false;
    resetSelectOptions(ruleSelect, getLocalizedText(structure.commonText.loadingPartitionRules));

    try {
      const rules = (await fetchRows(
        `/court_partition_rules?page=1&filter_source_format=${encodeURIComponent(format)}`
      ) as Array<Record<string, unknown>>).filter(
        (rule) => rule.is_active !== false && rule.is_active !== 'false'
      );

      if (version !== loadVersion) return;

      if (rules.length === 0) {
        resetSelectOptions(ruleSelect, getLocalizedText(structure.commonText.noActivePartitionRules));
        ruleSelect.disabled = true;
        error.textContent = getLocalizedText(structure.commonText.noPartitionRuleAvailable);
        return;
      }

      resetSelectOptions(
        ruleSelect,
        rules.length === 1 ? '--' : getLocalizedText(structure.commonText.choosePartitionRule)
      );

      rules.forEach((rule) => {
        const option = document.createElement('option');
        option.value = String(rule.id);
        option.textContent = `${getCourtFormatLabel(String(rule.source_format))} → ${rule.child_count} × ${getCourtFormatLabel(String(rule.target_format))}`;
        ruleSelect.appendChild(option);
      });

      if (rules.length === 1) {
        ruleSelect.value = String(rules[0].id);
      }
    } catch (loadError) {
      if (version !== loadVersion) return;

      resetSelectOptions(ruleSelect, getLocalizedText(structure.commonText.partitionRulesLoadFailedShort));
      ruleSelect.disabled = true;
      error.textContent = getLocalizedText(structure.commonText.partitionRulesLoadFailed);
      console.error('Error loading partition rules:', loadError);
    }
  };

  formatSelect.addEventListener('change', () => update().catch(() => undefined));
  partitionableSelect.addEventListener('change', () => update().catch(() => undefined));

  applyButton?.addEventListener('click', async () => {
    if (!ruleSelect.value || !record?.id || !record.company_id) {
      error.textContent = getLocalizedText(structure.commonText.choosePartitionRuleToContinue);
      ruleSelect.classList.add('invalid');
      return;
    }

    // If the court was just marked partitionable (not yet saved), persist that
    // first so the partition endpoint accepts it — no extra save/refresh step.
    if (partitionableSelect.value === 'true' && !savedPartitionable) {
      const nameInput = document.getElementById('courts-name') as HTMLInputElement | null;
      const courtSportSelect = document.getElementById('courts-sport_id') as HTMLSelectElement | null;
      const putResponse = await apiFetch(`/courts?id=${encodeURIComponent(String(record.id))}`, {
        method: 'PUT',
        body: JSON.stringify({
          company_id: Number(record.company_id),
          name: nameInput?.value ?? String(record.name ?? ''),
          sport_id: Number(courtSportSelect?.value ?? record.sport_id),
          format: formatSelect.value || String(record.format ?? ''),
          is_partitionable: true,
        }),
      });

      if (!putResponse.ok) {
        error.textContent = await errorMessage(putResponse);
        return;
      }
    }

    const response = await apiFetch(
      `/companies/${encodeURIComponent(String(record.company_id))}/courts/${encodeURIComponent(String(record.id))}/partition`,
      {
        method: 'POST',
        body: JSON.stringify({ partition_rule_id: Number(ruleSelect.value) }),
      }
    );

    if (!response.ok) {
      error.textContent = await errorMessage(response);
      return;
    }

    hideAnyForm();
    showSuccessMessage(getLocalizedText(structure.commonText.partitionRuleApplied));
    loadTableData('courts');
  });

  update().catch(() => undefined);
}

async function setupCourtSportOptions(record?: Partial<TableRecordMap['courts']>): Promise<void> {
  const companySelect = document.getElementById('courts-company_id') as HTMLSelectElement | null;
  const sportSelect = document.getElementById('courts-sport_id') as HTMLSelectElement | null;

  if (!companySelect || !sportSelect) return;

  const update = async () => {
    const selectedSportId = String(record?.sport_id ?? sportSelect.value ?? '');

    if (!companySelect.value) {
      resetSelectOptions(sportSelect, getLocalizedText(structure.commonText.selectCompanyFirst));
      return;
    }

    const [companySports, sports] = await Promise.all([
      fetchRows(`/company_sports?page=1&filter_company_id=${encodeURIComponent(companySelect.value)}`),
      fetchRows('/sports?page=1'),
    ]);
    const allowedSportIds = new Set(
      companySports.map((row) => String((row as Record<string, unknown>).sport_id ?? ''))
    );
    const availableSports = sports.filter((row) =>
      allowedSportIds.has(String((row as Record<string, unknown>).id ?? ''))
    ) as Array<Record<string, unknown>>;

    resetSelectOptions(
      sportSelect,
      availableSports.length > 0
        ? '--'
        : getLocalizedText(structure.commonText.addCompanySportFirst)
    );

    availableSports.forEach((sport) => {
      const option = document.createElement('option');
      option.value = String(sport.id);
      option.textContent = String(sport.name);
      option.dataset.slug = String(sport.slug ?? '');
      sportSelect.appendChild(option);
    });

    if (allowedSportIds.has(selectedSportId)) {
      sportSelect.value = selectedSportId;
    }

    sportSelect.dispatchEvent(new Event('change'));
  };

  await update();
  companySelect.addEventListener('change', () => {
    update().catch((error) => {
      console.error('Error loading company sports:', error);
    });
  });
}

async function setupCourtPriceSportOptions(
  record?: Partial<TableRecordMap['court_prices']>
): Promise<void> {
  const courtSelect = document.getElementById('court_prices-court_id') as HTMLSelectElement | null;
  const sportSelect = document.getElementById('court_prices-sport_id') as HTMLSelectElement | null;

  if (!courtSelect || !sportSelect) return;

  const update = async () => {
    const courtId = courtSelect.value;
    resetSelectOptions(
      sportSelect,
      courtId
        ? getLocalizedText(structure.commonText.loadingCourtSport)
        : getLocalizedText(structure.commonText.selectCourtFirst)
    );

    if (!courtId) return;

    const response = await apiFetch(`/courts?id=${encodeURIComponent(courtId)}`);
    if (!response.ok) return;

    const courtResponse = await response.json() as ApiResponse;
    const court = courtResponse.data as Record<string, unknown> | undefined;
    const sportId = court?.sport_id;

    if (sportId == null) {
      resetSelectOptions(sportSelect, getLocalizedText(structure.commonText.courtNoSport));
      return;
    }

    const sports = await fetchRows('/sports?page=1');
    const sport = sports.find((row) => String((row as Record<string, unknown>).id) === String(sportId)) as Record<string, unknown> | undefined;

    if (!sport) {
      resetSelectOptions(sportSelect, getLocalizedText(structure.commonText.courtSportUnavailable));
      return;
    }

    resetSelectOptions(sportSelect, '--');
    const option = document.createElement('option');
    option.value = String(sport.id);
    option.textContent = String(sport.name);
    option.selected = true;
    sportSelect.appendChild(option);

    if (String(record?.sport_id ?? sport.id) === String(sport.id)) {
      sportSelect.value = String(sport.id);
    }
  };

  await update();
  courtSelect.addEventListener('change', () => {
    update().catch((error) => {
      console.error('Error loading court sport:', error);
    });
  });
}

function setupDependentSelects<K extends TableKey>(
  tableKey: K,
  record?: Partial<TableRecordMap[K]>
): void {
  const tableConfig = structure.tables[tableKey];

  for (const [fieldName, column] of Object.entries(tableConfig.columns)) {
    const foreignKey = column.foreignKey;

    if (!foreignKey?.dependsOn) continue;

    const childId = getFieldElementId(tableKey, fieldName);
    const parentId = getFieldElementId(tableKey, foreignKey.dependsOn.field);
    const childSelect = document.getElementById(childId) as HTMLSelectElement | null;
    const parentSelect = document.getElementById(parentId) as HTMLSelectElement | null;

    if (!childSelect || !parentSelect) continue;

    loadDependentOptions(
      parentSelect,
      childSelect,
      foreignKey,
      fieldName as keyof TableRecordMap[K],
      record
    );

    parentSelect.addEventListener('change', () => {
      loadDependentOptions(
        parentSelect,
        childSelect,
        foreignKey,
        fieldName as keyof TableRecordMap[K],
        record
      );
    });
  }
}

async function loadDependentOptions<K extends TableKey>(
  parentSelect: HTMLSelectElement,
  childSelect: HTMLSelectElement,
  foreignKey: ForeignKeyDef,
  fieldName: keyof TableRecordMap[K],
  record?: Partial<TableRecordMap[K]>
): Promise<void> {
  if (!foreignKey.dependsOn) return;

  const parentValue = parentSelect.value;

  childSelect.innerHTML = '';

  if (!parentValue) return;

  try {
    const rows = await fetchRows(
      `/${foreignKey.table}?filter_${foreignKey.dependsOn.foreignField}=${encodeURIComponent(parentValue)}`
    );

    rows.forEach((row) => {
      const recordRow = row as Record<string, unknown>;
      const value = String(recordRow[foreignKey.valueField] ?? '');

      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value} - ${getForeignKeyLabel(recordRow, foreignKey)}`;
      childSelect.appendChild(option);
    });

    const currentValue = record?.[fieldName];

    if (currentValue != null) {
      childSelect.value = String(currentValue);
    }
  } catch (error) {
    console.error('Error loading dependent options:', error);
  }
}

async function resolveDependingForeignKeys<K extends TableKey>(
  tableKey: K,
  record?: Partial<TableRecordMap[K]>
): Promise<void> {
  if (!record) return;

  const tableConfig = structure.tables[tableKey];

  for (const [fieldName, column] of Object.entries(tableConfig.columns)) {
    const foreignKey = column.foreignKey;

    if (!foreignKey?.dependsOn) continue;

    const childValue = (record as Record<string, unknown>)[fieldName];

    if (childValue == null) continue;

    try {
      const queryParams = new URLSearchParams([
        [foreignKey.valueField, String(childValue)],
      ]).toString();

      const response = await apiFetch(`/${foreignKey.table}?${queryParams}`);

      if (!response.ok) continue;

      const responseJson: ApiResponse = await response.json();
      const foreignRecord = responseJson.data as Record<string, unknown> | undefined;

      if (!foreignRecord) continue;

      (record as Record<string, unknown>)[foreignKey.dependsOn.field] =
        foreignRecord[foreignKey.dependsOn.foreignField];
    } catch (error) {
      console.error('Error resolving dependent foreign key:', error);
    }
  }
}

function collectFormData<K extends TableKey>(
  tableKey: K
): Partial<TableRecordMap[K]> {
  const tableConfig = structure.tables[tableKey];
  const payload: Partial<TableRecordMap[K]> = {};

  Object.entries(tableConfig.columns)
    .filter(([, column]) => column.editable !== false)
    .forEach(([fieldName, column]) => {
      const id = getFieldElementId(tableKey, fieldName);
      const element = document.getElementById(id) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null;

      payload[fieldName as keyof TableRecordMap[K]] = coerceFieldValue(
        column,
        element?.value ?? ''
      ) as TableRecordMap[K][keyof TableRecordMap[K]];
    });

  return payload;
}

export function getRecordPath(recordValues: string[]): string {
  return `/${recordValues.map((value) => encodeURIComponent(value)).join('/')}`;
}

export function hideAnyForm(): void {
  formContainer.style.display = 'none';
  formContainer.innerHTML = '';
}

async function renderCompanySportsManager(
  companyId?: number
): Promise<HTMLElement> {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'company-sports-manager';
  fieldset.id = 'company-sports-manager';
  const legend = document.createElement('legend');
  legend.textContent = getLocalizedText(structure.commonText.enabledSports);
  fieldset.appendChild(legend);

  const [sports, links] = await Promise.all([
    fetchAllRows('sports'),
    companyId
      ? fetchRows(`/company_sports?page=1&filter_company_id=${encodeURIComponent(String(companyId))}`)
      : Promise.resolve([]),
  ]);
  const selectedSportIds = new Set(
    links.map((link) => String((link as Record<string, unknown>).sport_id ?? ''))
  );

  sports.forEach((sport) => {
    const record = sport as Record<string, unknown>;
    const label = document.createElement('label');
    label.className = 'company-sport-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'company-sport';
    checkbox.value = String(record.id ?? '');
    checkbox.checked = selectedSportIds.has(checkbox.value);
    label.append(checkbox, document.createTextNode(String(record.name ?? '')));
    fieldset.appendChild(label);
  });

  return fieldset;
}

async function syncCompanySports(companyId: number): Promise<void> {
  const manager = document.getElementById('company-sports-manager');
  if (!manager) return;

  const selectedSportIds = new Set(
    Array.from(manager.querySelectorAll<HTMLInputElement>('input[name="company-sport"]:checked'))
      .map((input) => input.value)
  );
  const links = await fetchRows(
    `/company_sports?page=1&filter_company_id=${encodeURIComponent(String(companyId))}`
  );
  const existingSportIds = new Set(
    links.map((link) => String((link as Record<string, unknown>).sport_id ?? ''))
  );

  await Promise.all([
    ...[...selectedSportIds]
      .filter((sportId) => !existingSportIds.has(sportId))
      .map(async (sportId) => {
        const response = await apiFetch('/company_sports', {
          method: 'POST',
          body: JSON.stringify({ company_id: companyId, sport_id: Number(sportId) }),
        });
        if (!response.ok) throw new Error(await errorMessage(response));
      }),
    ...[...existingSportIds]
      .filter((sportId) => !selectedSportIds.has(sportId))
      .map(async (sportId) => {
        const params = new URLSearchParams({
          company_id: String(companyId),
          sport_id: sportId,
        });
        const response = await apiFetch(`/company_sports?${params.toString()}`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error(await errorMessage(response));
      }),
  ]);
}

async function showAnyForm<K extends TableKey>(
  tableKey: K,
  record?: Partial<TableRecordMap[K]>
): Promise<void> {
  if (!canWriteTable(tableKey, !record)) {
    setMessage(getLocalizedText(structure.commonText.noEditPermission));
    return;
  }

  const tableConfig = structure.tables[tableKey];
  const isEdit = !!record;
  const formId = `${tableKey}-form`;

  await resolveDependingForeignKeys(tableKey, record);

  const fields = await Promise.all(
    Object.entries(tableConfig.columns)
      .filter(([, column]) => column.editable !== false)
      .map(([fieldName, column]) =>
        renderFormField(
          tableKey,
          fieldName as keyof TableRecordMap[K] & string,
          column,
          record,
          isEdit
        )
      )
  );

  formContainer.innerHTML = '';

  const form = document.createElement('form');
  form.id = formId;

  const title = document.createElement('h3');
  title.textContent = `${
    isEdit
      ? getLocalizedText(structure.commonText.edit)
      : getLocalizedText(structure.commonText.add)
  } ${getLocalizedText(tableConfig.uiName)}`;
  form.appendChild(title);

  fields.forEach((field) => form.appendChild(field));

  if (tableKey === 'companies') {
    const companyRecord = record as Record<string, unknown> | undefined;
    form.appendChild(await renderCompanySportsManager(
      companyRecord?.id == null ? undefined : Number(companyRecord.id)
    ));
  }

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'form-actions';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = isEdit
    ? getLocalizedText(structure.commonText.update)
    : getLocalizedText(structure.commonText.add);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.textContent = getLocalizedText(structure.commonText.cancel);
  cancelBtn.addEventListener('click', hideAnyForm);

  actionsDiv.appendChild(submitBtn);
  actionsDiv.appendChild(cancelBtn);
  form.appendChild(actionsDiv);

  formContainer.appendChild(form);
  formContainer.style.display = 'flex';

  setupDependentSelects(tableKey, record);

  if (tableKey === 'courts') {
    await setupCourtSportOptions(record as Partial<TableRecordMap['courts']> | undefined);
    setupCourtFormatOptions(record as Partial<TableRecordMap['courts']> | undefined);

    setupCourtPartitionRuleOptions(
      record as Partial<TableRecordMap['courts']> | undefined,
      isEdit
    );
  }

  if (tableKey === 'court_prices') {
    await setupCourtPriceSportOptions(record as Partial<TableRecordMap['court_prices']> | undefined);
  }

  if (tableKey === 'court_partition_rules') {
    setupPartitionRuleLayout(record as Partial<TableRecordMap['court_partition_rules']> | undefined);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!validateForm(tableKey)) return;

    const payload = collectFormData(tableKey) as Record<string, unknown>;

    if (tableKey === 'courts' && !isEdit && payload.is_partitionable === 'true') {
      const ruleSelect = document.getElementById('courts-partition_rule_id') as HTMLSelectElement | null;
      const ruleError = document.getElementById('courts-partition_rule_id-error');

      if (!ruleSelect?.value) {
        ruleSelect?.classList.add('invalid');
        if (ruleError) ruleError.textContent = getLocalizedText(structure.commonText.choosePartitionRuleToContinue);
        return;
      }

      payload.partition_rule_id = Number(ruleSelect.value);
    }

    const pkAndTheirValues = getPkFields(tableKey).map((pkFieldName) => {
      const value =
        payload[pkFieldName] ??
        (record as Record<string, unknown> | undefined)?.[pkFieldName] ??
        '';

      return [pkFieldName, String(value)];
    });

    const queryParams = new URLSearchParams(pkAndTheirValues).toString();
    const savePath =
      tableKey === 'courts' && !isEdit
        ? `/companies/${encodeURIComponent(String(payload.company_id ?? ''))}/courts`
        : `/${tableKey}?${queryParams}`;

    try {
      const response = await apiFetch(savePath, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return showErrorMessage(await errorMessage(response));
      }

      const responseJson: ApiResponse = await response.json();

      if (!responseJson.success) {
        return showErrorMessage(responseJson.message ?? 'Error saving record');
      }

      if (tableKey === 'companies') {
        const companyRecord = record as Record<string, unknown> | undefined;
        const companyId = Number(
          (isEdit ? companyRecord?.id : (responseJson.data as Record<string, unknown> | undefined)?.id) ?? 0
        );
        if (companyId > 0) await syncCompanySports(companyId);
      }

      hideAnyForm();

      showSuccessMessage(responseJson.message ?? '');

      loadTableData(tableKey);
    } catch (error) {
      const message = (error as Error).message;

      if (message !== 'Authentication required' && message !== 'Forbidden') {
        setMessage(getLocalizedText(structure.commonText.errorSaving));
        console.error(
          `Error saving ${getLocalizedText(tableConfig.uiName).toLowerCase()}:`,
          error
        );
      }
    }
  });
}

// -----------------------------------------------------------------------------
// Global actions
// -----------------------------------------------------------------------------

declare global {
  interface Window {
    hideAnyForm: () => void;
    editRecord: <K extends TableKey>(
      tableKey: K,
      ...pkValues: string[]
    ) => Promise<void>;
    deleteRecord: <K extends TableKey>(
      tableKey: K,
      ...pkValues: string[]
    ) => Promise<void>;
  }
}

window.hideAnyForm = hideAnyForm;

window.editRecord = async <K extends TableKey>(
  tableKey: K,
  ...pkValues: string[]
) => {
  try {
    const queryParams = new URLSearchParams(
      getPkFields(tableKey).map((pkFieldName, index) => [
        pkFieldName,
        pkValues[index] ?? '',
      ])
    ).toString();

    const response = await apiFetch(`/${tableKey}?${queryParams}`);

    if (!response.ok) {
      return showErrorMessage(await errorMessage(response));
    }

    const responseAnswer: ApiResponse = await response.json();

    if (!responseAnswer.success) {
      return showErrorMessage(responseAnswer.message ?? 'Error loading record');
    }

    const record = responseAnswer.data as TableRecordMap[K];

    showAnyForm(tableKey, record);
  } catch (error) {
    const message = (error as Error).message;

    if (message !== 'Authentication required' && message !== 'Forbidden') {
      setMessage(getLocalizedText(structure.commonText.errorLoadingRecord));
      console.error(`Error loading ${tableKey} for edit:`, error);
    }
  }
};

window.deleteRecord = async <K extends TableKey>(
  tableKey: K,
  ...pkValues: string[]
) => {
  const tableConfig = structure.tables[tableKey];
  const entityName = getLocalizedText(tableConfig.uiName).toLowerCase();

  const confirmed = confirm(
    `${getLocalizedText(structure.commonText.deleteConfirm)} ${entityName}?`
  );

  if (!confirmed) return;

  try {
    const queryParams = new URLSearchParams(
      getPkFields(tableKey).map((pkFieldName, index) => [
        pkFieldName,
        pkValues[index] ?? '',
      ])
    ).toString();

    const response = await apiFetch(`/${tableKey}?${queryParams}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      return showErrorMessage(await errorMessage(response));
    }

    const responseAnswer: ApiResponse = await response.json();

    if (!responseAnswer.success) {
      return showErrorMessage(responseAnswer.message ?? 'Error deleting record');
    }

    showSuccessMessage(responseAnswer.message ?? '');
    loadTableData(tableKey);
  } catch (error) {
    const message = (error as Error).message;

    if (message !== 'Authentication required' && message !== 'Forbidden') {
      setMessage(getLocalizedText(structure.commonText.errorDeleting));
      console.error(`Error deleting ${tableKey}:`, error);
    }
  }
};

// -----------------------------------------------------------------------------
// Onboarding guided tour
// -----------------------------------------------------------------------------
//
// A dependency-free, skippable walkthrough shown the first time a company logs
// in. It spotlights each section of the platform (courts, prices, schedule,
// bookings, team & roles…) with an anchored popup. Completion is stored per
// user in localStorage, and the header "Guía" button reopens it on demand.

type TourStep = {
  title: LocalizedText;
  body: LocalizedText;
  // Resolved lazily so we can navigate/scroll before locating the anchor.
  target?: () => HTMLElement | null;
  // Runs before the step is shown (e.g. switch to the relevant section).
  before?: () => void | Promise<void>;
  // Include the step only when this returns true (permissions, visibility…).
  when?: () => boolean;
};

const ONBOARDING_STORAGE_PREFIX = 'court-booking.onboarding.v1.';

let tourEls: { blocker: HTMLElement; highlight: HTMLElement; popup: HTMLElement } | null = null;
let tourSteps: TourStep[] = [];
let tourIndex = 0;
let tourReturnSection: TableKey | null = null;
let tourResizeHandler: (() => void) | null = null;

function onboardingKey(user: AuthUser): string {
  return `${ONBOARDING_STORAGE_PREFIX}${user.id}`;
}

function hasCompletedOnboarding(user: AuthUser): boolean {
  try {
    return localStorage.getItem(onboardingKey(user)) === 'done';
  } catch {
    // If storage is unavailable, avoid nagging the user on every load.
    return true;
  }
}

function markOnboardingComplete(): void {
  if (!currentUser) return;
  try {
    localStorage.setItem(onboardingKey(currentUser), 'done');
  } catch {
    /* ignore storage errors */
  }
}

function isElementVisible(el: HTMLElement | null): el is HTMLElement {
  if (!el || el.hidden) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function buildTourSteps(): TourStep[] {
  const navButton = (key: TableKey) => () => tableNavButtons[key] ?? null;
  const navVisible = (key: TableKey) => () => isElementVisible(tableNavButtons[key]);

  const allSteps: TourStep[] = [
    {
      title: { es: '¡Te damos la bienvenida! 👋', en: 'Welcome aboard! 👋' },
      body: {
        es: 'En menos de un minuto te mostramos todo lo que podés hacer en tu panel. Podés omitir esta guía cuando quieras.',
        en: "In under a minute we'll walk you through everything you can do in your dashboard. You can skip this guide anytime.",
      },
    },
    {
      title: { es: 'Tu menú principal', en: 'Your main menu' },
      body: {
        es: 'Desde esta barra accedés a todas las secciones de la plataforma.',
        en: 'This bar gives you access to every section of the platform.',
      },
      target: () => document.getElementById('general-nav'),
      when: () => isElementVisible(document.getElementById('general-nav')),
    },
    {
      title: { es: 'Los datos de tu empresa', en: 'Your company details' },
      body: {
        es: 'En «Empresas» configurás el nombre, la dirección y la zona horaria de tu club.',
        en: 'Under "Companies" you set your club\'s name, address and time zone.',
      },
      target: navButton('companies'),
      when: navVisible('companies'),
    },
    {
      title: { es: 'Creá tus canchas', en: 'Set up your courts' },
      body: {
        es: 'En «Canchas» das de alta cada cancha, elegís su formato y definís su ubicación.',
        en: 'Under "Courts" you add each court and choose its format and layout.',
      },
      target: navButton('courts'),
      before: () => showSection('courts', false),
      when: navVisible('courts'),
    },
    {
      title: { es: 'Creá tu primera cancha', en: 'Create your first court' },
      body: {
        es: 'Hacé clic en «Agregar Cancha» para dar de alta tu primera cancha. Repetí el proceso para las demás.',
        en: 'Click "Add Court" to create your first court. Repeat for the rest.',
      },
      target: () => addRecordBtn,
      before: () => showSection('courts', false),
      when: () => canWriteTable('courts', true) && isElementVisible(addRecordBtn),
    },
    {
      title: { es: 'Definí tus precios', en: 'Set your prices' },
      body: {
        es: 'En «Precios» establecés cuánto cuesta cada franja horaria de tus canchas.',
        en: 'Under "Prices" you set the cost of each time slot for your courts.',
      },
      target: navButton('court_prices'),
      when: navVisible('court_prices'),
    },
    {
      title: { es: 'Configurá tus horarios', en: 'Configure your schedule' },
      body: {
        es: 'En «Bloques Horarios» definís los horarios de apertura y los cierres de tu club.',
        en: 'Under "Time Blocks" you define your club\'s opening hours and closures.',
      },
      target: navButton('company_time_blocks'),
      when: navVisible('company_time_blocks'),
    },
    {
      title: { es: 'Disponibilidad y reservas', en: 'Availability & bookings' },
      body: {
        es: 'En «Disponibilidad» ves el calendario en tiempo real y gestionás las reservas de tus clientes.',
        en: "Under \"Availability\" you see the live calendar and manage your customers' bookings.",
      },
      target: () => availabilityNavButton,
      when: () => isElementVisible(availabilityNavButton),
    },
    {
      title: { es: 'Tu equipo y sus roles', en: 'Your team and their roles' },
      body: {
        es: 'En «Permisos» creás los usuarios de tu equipo y les asignás un rol (owner, manager, staff o viewer).',
        en: 'Under "Permissions" you create your team members and assign each a role (owner, manager, staff or viewer).',
      },
      target: () => permissionsNavButton,
      when: () => isElementVisible(permissionsNavButton),
    },
    {
      title: { es: 'Idioma y tema', en: 'Language & theme' },
      body: {
        es: 'Desde aquí cambiás el idioma y alternás entre el tema claro y oscuro.',
        en: 'From here you can switch the language and toggle light/dark theme.',
      },
      target: () => menuContainer,
      when: () => isElementVisible(menuContainer),
    },
    {
      title: { es: '¡Listo para empezar! 🎉', en: "You're all set! 🎉" },
      body: {
        es: '¿Necesitás repasar? Volvé a abrir esta guía cuando quieras con el botón «Guía».',
        en: 'Need a refresher? Reopen this guide anytime with the "Guía" button.',
      },
      target: () => tourHelpBtn,
      when: () => isElementVisible(tourHelpBtn),
    },
  ];

  return allSteps.filter((step) => (step.when ? step.when() : true));
}

function ensureTourEls(): NonNullable<typeof tourEls> {
  if (tourEls) return tourEls;

  const blocker = document.createElement('div');
  blocker.className = 'tour-blocker';
  // Swallow clicks on the dimmed area so users can't misclick the app behind
  // the tour; they advance or leave via the popup buttons or Esc.
  blocker.addEventListener('click', (event) => event.stopPropagation());

  const highlight = document.createElement('div');
  highlight.className = 'tour-highlight';

  const popup = document.createElement('div');
  popup.className = 'tour-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');

  tourEls = { blocker, highlight, popup };
  return tourEls;
}

function positionTour(target: HTMLElement | null): void {
  if (!tourEls) return;
  const { blocker, highlight, popup } = tourEls;

  if (!target) {
    highlight.classList.add('tour-highlight--hidden');
    blocker.classList.add('tour-blocker--dim');
    popup.classList.add('tour-popup--centered');
    popup.style.top = '';
    popup.style.left = '';
    return;
  }

  blocker.classList.remove('tour-blocker--dim');
  highlight.classList.remove('tour-highlight--hidden');
  popup.classList.remove('tour-popup--centered');

  const rect = target.getBoundingClientRect();
  const pad = 6;
  highlight.style.top = `${rect.top - pad}px`;
  highlight.style.left = `${rect.left - pad}px`;
  highlight.style.width = `${rect.width + pad * 2}px`;
  highlight.style.height = `${rect.height + pad * 2}px`;

  const margin = 14;
  const pw = popup.offsetWidth || 320;
  const ph = popup.offsetHeight || 160;

  let top = rect.bottom + margin;
  if (top + ph > window.innerHeight - 10) {
    const above = rect.top - ph - margin;
    top = above >= 10 ? above : Math.max(10, window.innerHeight - ph - 10);
  }

  let left = rect.left + rect.width / 2 - pw / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));

  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}

async function renderTourStep(): Promise<void> {
  if (!tourEls) return;
  const step = tourSteps[tourIndex];
  if (!step) {
    endTour(true);
    return;
  }

  if (step.before) await step.before();
  await nextFrame();

  const target = step.target ? step.target() : null;
  if (target) {
    target.scrollIntoView({ block: 'center', inline: 'center' });
    await nextFrame();
  }

  const isSpanish = getLanguage() === 'es';
  const { popup } = tourEls;
  popup.innerHTML = '';

  const heading = document.createElement('h3');
  heading.className = 'tour-popup__title';
  heading.textContent = getLocalizedText(step.title);
  popup.appendChild(heading);

  const text = document.createElement('p');
  text.className = 'tour-popup__body';
  text.textContent = getLocalizedText(step.body);
  popup.appendChild(text);

  const footer = document.createElement('div');
  footer.className = 'tour-popup__footer';

  const progress = document.createElement('span');
  progress.className = 'tour-popup__progress';
  progress.textContent = isSpanish
    ? `Paso ${tourIndex + 1} de ${tourSteps.length}`
    : `Step ${tourIndex + 1} of ${tourSteps.length}`;
  footer.appendChild(progress);

  const actions = document.createElement('div');
  actions.className = 'tour-popup__actions';

  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'tour-popup__skip';
  skipBtn.textContent = isSpanish ? 'Omitir' : 'Skip';
  skipBtn.addEventListener('click', () => endTour(true));
  actions.appendChild(skipBtn);

  if (tourIndex > 0) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'tour-popup__back';
    backBtn.textContent = isSpanish ? 'Anterior' : 'Back';
    backBtn.addEventListener('click', () => {
      tourIndex -= 1;
      void renderTourStep();
    });
    actions.appendChild(backBtn);
  }

  const isLast = tourIndex === tourSteps.length - 1;
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'tour-popup__next';
  nextBtn.textContent = isLast
    ? (isSpanish ? 'Finalizar' : 'Finish')
    : (isSpanish ? 'Siguiente' : 'Next');
  nextBtn.addEventListener('click', () => {
    if (isLast) {
      endTour(true);
      return;
    }
    tourIndex += 1;
    void renderTourStep();
  });
  actions.appendChild(nextBtn);

  footer.appendChild(actions);
  popup.appendChild(footer);

  positionTour(target);
  nextBtn.focus();
}

function onTourKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    endTour(true);
  } else if (event.key === 'ArrowRight') {
    if (tourIndex < tourSteps.length - 1) {
      tourIndex += 1;
      void renderTourStep();
    } else {
      endTour(true);
    }
  } else if (event.key === 'ArrowLeft' && tourIndex > 0) {
    tourIndex -= 1;
    void renderTourStep();
  }
}

function startOnboardingTour(force = false): void {
  if (!currentUser) return;
  if (tourEls && document.body.contains(tourEls.blocker)) return; // already running
  if (!force && hasCompletedOnboarding(currentUser)) return;

  tourSteps = buildTourSteps();
  if (tourSteps.length === 0) return;

  tourIndex = 0;
  tourReturnSection = activeTableKey;

  const { blocker, highlight, popup } = ensureTourEls();
  document.body.appendChild(blocker);
  document.body.appendChild(highlight);
  document.body.appendChild(popup);

  tourResizeHandler = () => {
    const step = tourSteps[tourIndex];
    positionTour(step && step.target ? step.target() : null);
  };
  window.addEventListener('resize', tourResizeHandler);
  window.addEventListener('scroll', tourResizeHandler, true);
  document.addEventListener('keydown', onTourKeydown, true);

  void renderTourStep();
}

function endTour(markComplete: boolean): void {
  if (markComplete) markOnboardingComplete();

  if (tourResizeHandler) {
    window.removeEventListener('resize', tourResizeHandler);
    window.removeEventListener('scroll', tourResizeHandler, true);
    tourResizeHandler = null;
  }
  document.removeEventListener('keydown', onTourKeydown, true);

  if (tourEls) {
    tourEls.blocker.remove();
    tourEls.highlight.remove();
    tourEls.popup.remove();
  }

  // Return the user to wherever they were before the tour navigated around.
  if (tourReturnSection && currentUser) {
    showSection(tourReturnSection, false);
  }
  tourReturnSection = null;
}

function maybeStartOnboarding(user: AuthUser): void {
  if (hasCompletedOnboarding(user)) return;
  // Defer so the app shell and nav buttons have finished laying out.
  window.setTimeout(() => startOnboardingTour(false), 350);
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

const initialTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', initialTheme);

applyStaticLanguageToUI();

homeBtn.addEventListener('click', goHome);

loginNavBtn.addEventListener('click', () => showLogin());

tourHelpBtn.addEventListener('click', () => startOnboardingTour(true));

changePasswordBtn.addEventListener('click', () => {
  if (currentUser) showPasswordChange(currentUser, currentCompanyLinks);
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;

  const formData = new FormData(loginForm);

  const payload = {
    username: String(formData.get('username') ?? ''),
    password: String(formData.get('password') ?? ''),
  };

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      showLogin(getLocalizedText(structure.commonText.invalidCredentials));
      return;
    }

    const data = (await response.json()) as {
      user: AuthUser;
      company_links: CompanyLink[];
    };

    loginForm.reset();
    showApp(data.user, data.company_links);
  } catch (error) {
    showLogin(getLocalizedText(structure.commonText.loginError));
    console.error('Login error:', error);
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  passwordError.hidden = true;

  const formData = new FormData(passwordForm);

  const payload = {
    current_password: String(formData.get('current_password') ?? ''),
    new_password: String(formData.get('new_password') ?? ''),
  };

  try {
    const response = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      passwordError.textContent =
        getLocalizedText(structure.commonText.passwordChangeFailed);
      passwordError.hidden = false;
      return;
    }

    const data = (await response.json()) as {
      user: AuthUser;
      company_links: CompanyLink[];
    };

    passwordForm.reset();
    showApp(data.user, data.company_links);
  } catch (error) {
    passwordError.textContent =
      getLocalizedText(structure.commonText.passwordChangeError);
    passwordError.hidden = false;
    console.error('Password change error:', error);
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'same-origin',
  });

  showPublicLanding();
});

async function initialize(): Promise<void> {
  createTableNavButtons();
  syncUrlToState();
  applyLanguageToUI();
  void renderAvailabilityControls(publicBookingSection, false);

  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      credentials: 'same-origin',
    });

    if (!response.ok) {
      showPublicLanding();
      return;
    }

    const data = (await response.json()) as {
      user: AuthUser;
      company_links: CompanyLink[];
    };

    showApp(data.user, data.company_links);
  } catch (error) {
    showPublicLanding();
    console.error('Session check failed:', error);
  }
}

initialize();

export {};
