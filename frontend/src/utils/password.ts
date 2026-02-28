const PASSWORD_SYMBOLS = /[!@#$%^&*()_+\-=[\]{}|;:'",.<>?/~`]/;

/** Password must be at least 8 chars, one uppercase, one symbol. Returns error message or null if valid. */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!PASSWORD_SYMBOLS.test(password)) return "Password must contain at least one symbol (e.g. !@#$%^&*)";
  return null;
}

export const PASSWORD_HINT = "Min 8 chars, 1 uppercase, 1 symbol (e.g. !@#$%^&*)";

export const PASSWORD_REQUIREMENTS = [
  "At least 8 characters",
  "At least one uppercase letter (A–Z)",
  "At least one symbol (e.g. !@#$%^&*)",
] as const;

export type PasswordStrength = "weak" | "fair" | "good" | "strong";

/** Returns password strength based on length and character variety. */
export function getPasswordStrength(password: string): PasswordStrength | null {
  if (!password) return null;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = PASSWORD_SYMBOLS.test(password);
  const len = password.length;

  let score = 0;
  if (len >= 8) score += 1;
  if (len >= 12) score += 1;
  if (len >= 16) score += 1;
  if (hasUpper) score += 1;
  if (hasLower) score += 1;
  if (hasDigit) score += 1;
  if (hasSymbol) score += 1;

  if (score <= 2 || (len < 8) || (!hasUpper && !hasSymbol)) return "weak";
  if (score <= 4) return "fair";
  if (score <= 6) return "good";
  return "strong";
}
