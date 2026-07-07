import { COMMON_PASSWORDS } from './common-passwords';

export function validatePassword(
  password: string,
  username: string,
): { valid: boolean; reason?: string } {
  if (password.length < 12) {
    return { valid: false, reason: 'Password must be at least 12 characters.' };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, reason: 'This password is too common — please choose another.' };
  }
  if (password.toLowerCase() === username.toLowerCase()) {
    return { valid: false, reason: "Password can't be the same as your username." };
  }
  return { valid: true };
}
