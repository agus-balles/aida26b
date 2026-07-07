// Identity helpers for customer (end-user) accounts. Reuses the crypto
// primitives in auth.ts (scrypt hashing, session tokens); only the cookie name,
// session lifetime and input validation differ from staff accounts.
import { parseCookies } from './auth';

export const CUSTOMER_SESSION_COOKIE = 'aida_customer';
export const CUSTOMER_SESSION_DAYS = 30;

export type Customer = {
  id: number;
  email: string;
  name: string;
  phone: string | null;
};

// Customer passwords are entered twice on sign-up (confirmation), so the policy
// is lighter than staff: at least 8 characters, capped to a sane length.
export function isValidCustomerPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 200;
}

export function readCustomerEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255 ? email : null;
}

export function readCustomerName(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.length >= 2 && name.length <= 160 ? name : null;
}

export function readCustomerPhone(value: unknown): string | null {
  const phone = typeof value === 'string' ? value.trim() : '';
  if (!phone) return null;
  return phone.length <= 80 ? phone : null;
}

export function publicCustomer(row: Record<string, unknown>): Customer {
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name),
    phone: row.phone === null || row.phone === undefined ? null : String(row.phone),
  };
}

function buildCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${CUSTOMER_SESSION_COOKIE}=${value}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function customerSessionCookie(token: string, secure: boolean): string {
  return buildCookie(encodeURIComponent(token), CUSTOMER_SESSION_DAYS * 24 * 60 * 60, secure);
}

export function clearCustomerSessionCookie(secure: boolean): string {
  return buildCookie('', 0, secure);
}

export function getCustomerSessionToken(cookieHeader?: string): string | undefined {
  return parseCookies(cookieHeader)[CUSTOMER_SESSION_COOKIE];
}
