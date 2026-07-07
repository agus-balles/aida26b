import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const USER = {
  id: 42,
  username: 'club',
  email: null,
  role: 'editor',
  is_active: true,
  must_change_password: false,
};

const STORAGE_KEY = `court-booking.onboarding.v1.${USER.id}`;

function mountFixture(): void {
  document.body.innerHTML = `
    <header><div id="general-nav"><div id="table-nav"></div></div></header>
    <section id="auth-section"></section>
    <section id="public-booking-section"></section>
    <section id="password-section"></section>
    <form id="login-form"></form>
    <div id="login-error"></div>
    <form id="password-form"></form>
    <div id="password-error"></div>
    <div id="app-shell"></div>
    <span id="current-user"></span>
    <button id="login-nav-btn" hidden></button>
    <button id="tour-help-btn" hidden></button>
    <button id="home-btn"></button>
    <button id="change-password-btn"></button>
    <button id="logout-btn"></button>
    <div id="status-message"></div>
    <div id="menu-nav"></div>
    <div id="view-title"></div>
    <button id="add-record-btn"></button>
    <div id="record-form"></div>
    <table id="records-table"><thead></thead><tbody></tbody></table>
  `;
}

function mockAuthenticatedFetch(): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/auth/me')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ user: USER, company_links: [] }),
      });
    }
    // Any data/list endpoint: reply with an empty, well-formed payload.
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [], total: 0 }),
      clone() {
        return this;
      },
    });
  }) as ReturnType<typeof vi.fn>;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const flushFrames = async (count = 4): Promise<void> => {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }
};

describe('Onboarding guided tour', () => {
  beforeEach(() => {
    mountFixture();
    mockAuthenticatedFetch();
    vi.stubGlobal('alert', vi.fn());
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('appears on first login and is skippable, persisting completion', async () => {
    vi.resetModules();
    await import('../src/app');

    await tick(); // let /auth/me resolve -> showApp -> schedules the deferred start
    await wait(400); // fire the ~350ms deferred start
    await flushFrames(); // let the first step lay out

    const popup = document.querySelector('.tour-popup');
    expect(popup).toBeTruthy();
    expect(document.querySelector('.tour-blocker')).toBeTruthy();

    const skip = popup?.querySelector('.tour-popup__skip') as HTMLButtonElement;
    expect(skip).toBeTruthy();
    skip.click();

    expect(document.querySelector('.tour-popup')).toBeNull();
    expect(document.querySelector('.tour-blocker')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('done');
  });

  test('does not reshow once completed, but the "Guía" button reopens it', async () => {
    localStorage.setItem(STORAGE_KEY, 'done');

    vi.resetModules();
    await import('../src/app');

    await tick();
    await wait(400);
    await flushFrames();

    // Already completed: no auto tour.
    expect(document.querySelector('.tour-popup')).toBeNull();

    // The header "Guía" button forces it open again.
    const help = document.getElementById('tour-help-btn') as HTMLButtonElement;
    expect(help.hidden).toBe(false);
    help.click();
    await flushFrames();

    expect(document.querySelector('.tour-popup')).toBeTruthy();
  });
});
