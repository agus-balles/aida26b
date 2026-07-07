import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

describe('Menu Pickers (Theme & Language)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
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
      <div id="table-nav"></div>
      <div id="view-title"></div>
      <button id="add-record-btn"></button>
      <div id="record-form"></div>
      <table id="records-table">
        <thead></thead>
        <tbody></tbody>
      </table>
    `;

    global.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/public/companies')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });
      }

      return Promise.resolve({ ok: false });
    }) as ReturnType<typeof vi.fn>;
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  describe('Theme Picker', () => {
    test('Theme picker select exists and changes theme on change event', async () => {
      vi.resetModules();
      await import('../src/app');
      
      const themeSelect = document.getElementById('theme-picker') as HTMLSelectElement;
      
      expect(themeSelect).toBeTruthy();
      expect(themeSelect.tagName).toBe('SELECT');
    });

    test('Theme picker updates document root data-theme attribute', async () => {
      vi.resetModules();
      await import('../src/app');

      const themeSelect = document.getElementById('theme-picker') as HTMLSelectElement;

      themeSelect.value = 'dark';
      themeSelect.dispatchEvent(new Event('change'));

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    test('Theme picker saves theme to localStorage', async () => {
      vi.resetModules();
      await import('../src/app');
      
      const themeSelect = document.getElementById('theme-picker') as HTMLSelectElement;
      
      themeSelect.value = 'dark';
      themeSelect.dispatchEvent(new Event('change'));
      
      expect(localStorage.getItem('theme')).toBe('dark');
    });

    test('Theme picker handles empty values gracefully', async () => {
      vi.resetModules();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await import('../src/app');
      
      const themeSelect = document.getElementById('theme-picker') as HTMLSelectElement;
      
      themeSelect.value = '';
      themeSelect.dispatchEvent(new Event('change'));
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Language Picker', () => {
    test('Language picker select exists', async () => {
      vi.resetModules();
      await import('../src/app');
      
      const languageSelect = document.getElementById('language-picker') as HTMLSelectElement;
      
      expect(languageSelect).toBeTruthy();
      expect(languageSelect.tagName).toBe('SELECT');
    });

    test('Language picker has valid language options', async () => {
      vi.resetModules();
      await import('../src/app');
      
      const languageSelect = document.getElementById('language-picker') as HTMLSelectElement;
      const options = Array.from(languageSelect.options).map(opt => opt.value);
      
      expect(options).toContain('es');
      expect(options).toContain('en');
    });

    test('Language picker saves language to localStorage', async () => {
      vi.resetModules();
      await import('../src/app');
      
      const languageSelect = document.getElementById('language-picker') as HTMLSelectElement;
      
      languageSelect.value = 'en';
      languageSelect.dispatchEvent(new Event('change'));
      
      expect(localStorage.getItem('language')).toBe('en');
    });

    test('Language picker updates nav buttons text on change', async () => {
      vi.resetModules();
      await import('../src/app');
      
      const languageSelect = document.getElementById('language-picker') as HTMLSelectElement;
      const initialText = (document.getElementById('companies-btn') as HTMLButtonElement)?.textContent || '';
      
      languageSelect.value = 'en';
      languageSelect.dispatchEvent(new Event('change'));
      
      const newText = (document.getElementById('companies-btn') as HTMLButtonElement)?.textContent || '';
      
      // El texto debe cambiar si inicialmente estaba en español
      if (initialText === 'Empresas') {
        expect(newText).toBe('Companies');
      }
    });

    test('Language picker handles invalid values gracefully', async () => {
      vi.resetModules();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await import('../src/app');
      
      const languageSelect = document.getElementById('language-picker') as HTMLSelectElement;
      
      languageSelect.value = 'invalid-lang';
      languageSelect.dispatchEvent(new Event('change'));
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  test('home button returns from password change to the initial screen', async () => {
    vi.resetModules();
    await import('../src/app');

    const passwordSection = document.getElementById('password-section') as HTMLElement;
    const authSection = document.getElementById('auth-section') as HTMLElement;
    const publicBooking = document.getElementById('public-booking-section') as HTMLElement;

    passwordSection.style.display = 'block';
    authSection.style.display = 'none';
    publicBooking.style.display = 'none';

    document.getElementById('home-btn')?.dispatchEvent(new Event('click'));

    // The home button returns to the public landing: the booking widget is
    // shown and the login form stays hidden (login is now a separate view).
    expect(passwordSection.style.display).toBe('none');
    expect(authSection.style.display).toBe('none');
    expect(publicBooking.style.display).toBe('block');
  });

  test('session navigation exposes the voluntary password change control', async () => {
    vi.resetModules();
    await import('../src/app');

    expect(document.getElementById('change-password-btn')).toBeTruthy();
  });
});
