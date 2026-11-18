export type PiiType = 'email' | 'link' | 'handle' | 'card' | 'iban' | 'ssn' | 'phone' | 'address';
export type Severity = 'block' | 'warn';

export interface PiiFinding {
  type: PiiType;
  severity: Severity;
  /** The matched text, equal to text.slice(start, end). */
  match: string;
  start: number;
  end: number;
}

export interface PiiOptions {
  /** Two-letter country code(s) for phone numbers written without a country code. Default 'US'. */
  defaultCountry?: string | string[];
  /** Severity overrides by type; 'off' skips that type. */
  severity?: Partial<Record<PiiType, Severity | 'off'>>;
}

export const TYPES: readonly PiiType[];
export const DEFAULT_SEVERITY: Readonly<Record<PiiType, Severity>>;
export function findPii(text: string, options?: PiiOptions): PiiFinding[];
export function checkPii(text: string, options?: PiiOptions): { ok: boolean; findings: PiiFinding[] };
export function normalize(text: string): { text: string; map: number[] };
