import crypto from 'node:crypto';

const PLATFORMS = new Set(['meta', 'google', 'tiktok', 'linkedin', 'reddit']);
const KINDS = new Set(['email', 'phone']);
const PLACEHOLDERS = new Set(['null', 'undefined', '[object object]', 'n/a', 'na', 'none']);
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/;
const WHITESPACE_OR_CONTROLS = /[\s\x00-\x1f\x7f-\x9f]/;

function assertPlatformKind(platform, kind) {
  // Keep potentially private input out of errors.
  if (!PLATFORMS.has(platform)) throw new TypeError('unsupported platform');
  if (!KINDS.has(kind)) throw new TypeError('unsupported kind');
}

function placeholder(value) {
  return PLACEHOLDERS.has(value.toLowerCase());
}

function structurallyValidEmail(value) {
  const pieces = value.split('@');
  return pieces.length === 2 && pieces[0].length > 0 && pieces[1].includes('.')
    && pieces[1].split('.').every(Boolean) && !WHITESPACE_OR_CONTROLS.test(value);
}

function normalizeEmail(platform, raw) {
  let value = (platform === 'google' || platform === 'linkedin'
    ? raw.replace(/\s+/g, '') : raw.trim()).toLowerCase();
  // Validate before removing aliases: an extra @ inside a suffix is still malformed.
  if (!structurallyValidEmail(value)) return null;
  const [local, domain] = value.split('@');
  if (platform === 'reddit' || (platform === 'google' && ['gmail.com', 'googlemail.com'].includes(domain))) {
    value = `${local.split('+')[0].replaceAll('.', '')}@${domain}`;
  }
  return structurallyValidEmail(value) ? value : null;
}

function normalizePhone(platform, raw) {
  if (platform === 'linkedin' || CONTROLS.test(raw)) return null;
  // Supported extensions: terminal ext, ext., or x (case-insensitive), then digits.
  let value = raw.replace(/\s*(?:ext\.?|x)\s*[0-9]+\s*$/i, '');
  value = value.replace(/[\s().-]/g, '');
  if (!/^\+[1-9][0-9]{7,14}$/.test(value)) return null;
  return platform === 'meta' ? value.slice(1) : value;
}

export function normalizePlatformIdentity(platform, kind, value) {
  assertPlatformKind(platform, kind);
  if (typeof value !== 'string' || !value.trim() || placeholder(value.trim())) return null;
  return kind === 'email' ? normalizeEmail(platform, value) : normalizePhone(platform, value);
}

export function hashPlatformIdentity(platform, kind, value) {
  const normalized = normalizePlatformIdentity(platform, kind, value);
  return normalized === null ? null : crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function validClickSegments(value) {
  return value.length > 0 && !WHITESPACE_OR_CONTROLS.test(value)
    && !placeholder(value.split('.')[0]) && value.split('.').every((segment) => segment.length > 0);
}

function validExistingFbc(value) {
  if (typeof value !== 'string' || WHITESPACE_OR_CONTROLS.test(value)) {
    throw new TypeError('existing_fbc must be a valid cookie string');
  }
  const match = /^fb\.([0-9]+)\.([0-9]+)\.(.+)$/.exec(value);
  if (!match || !validClickSegments(match[3])) throw new TypeError('existing_fbc has invalid format');
  const subdomain = Number(match[1]);
  const epoch = Number(match[2]);
  if (!Number.isSafeInteger(subdomain) || subdomain < 0 || !Number.isSafeInteger(epoch) || epoch <= 0) {
    throw new TypeError('existing_fbc has invalid timestamp');
  }
  return value;
}

function captureEpoch(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw new TypeError('observed_at must be an ISO-8601 timestamp with offset');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText = '0', offsetMinuteText = '0'] = match;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    [yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
    || hour > 23 || minute > 59 || second > 59 || offsetMinute > 59
    || offsetHour > 14 || (offsetHour === 14 && offsetMinute !== 0)) {
    throw new TypeError('observed_at has invalid calendar or offset components');
  }
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || epoch <= 0) throw new TypeError('observed_at must be a valid positive timestamp');
  return epoch;
}

export function buildMetaFbc({ fbclid, observed_at, existing_fbc } = {}) {
  if (existing_fbc !== undefined && existing_fbc !== null) return validExistingFbc(existing_fbc);
  if (typeof fbclid !== 'string') return null;
  const click = fbclid.trim();
  if (!validClickSegments(click)) return null;
  return `fb.1.${captureEpoch(observed_at)}.${click}`;
}

export const SUPPORTED_PLATFORMS = [...PLATFORMS];
