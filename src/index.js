// eat-the-pii: find personal info (phone numbers, emails, social handles, card and ID numbers, street addresses) in
// short, user-written text, so an app can stop people from accidentally doxxing themselves. It is a guard against
// mistakes, not against someone determined to get around it, and it doesn't find names.
//
// Every finding has a severity: 'block' (the app should refuse the text) or 'warn' (the app should ask the person to
// look again). Apps can change the severity of each type, or turn a type 'off'.
import { findPhoneNumbersInText } from 'libphonenumber-js/min';

export const TYPES = ['email', 'link', 'handle', 'card', 'iban', 'ssn', 'phone', 'address'];

export const DEFAULT_SEVERITY = Object.freeze({
  email: 'block', link: 'block', handle: 'block', card: 'block', iban: 'block', ssn: 'block', phone: 'block',
  address: 'warn',
});

// ---------- normalizing ----------
// Detectors run on a normalized copy of the text, so tricks like full-width digits, "six one nine", or "6l9" don't
// get past them. `map[i]` is the index in the original text of normalized character i, so findings point at the
// original text.

// Code points of the digit zero in scripts whose digits NFKC leaves alone.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810];
const NUMBER_WORDS = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

function replaceTracked(text, map, re, replace) {
  let out = '', outMap = [], last = 0;
  for (const m of text.matchAll(re)) {
    out += text.slice(last, m.index); outMap.push(...map.slice(last, m.index));
    const r = replace(m);
    out += r; outMap.push(...Array(r.length).fill(map[m.index]));
    last = m.index + m[0].length;
  }
  out += text.slice(last); outMap.push(...map.slice(last));
  return { text: out, map: outMap };
}

export function normalize(original) {
  let text = '', map = [];
  for (let i = 0; i < original.length;) {
    const cp = original.codePointAt(i), len = cp > 0xffff ? 2 : 1;
    const zero = DIGIT_ZEROS.find(z => cp >= z && cp <= z + 9);
    const out = zero !== undefined ? String(cp - zero) : String.fromCodePoint(cp).normalize('NFKC');
    text += out; map.push(...Array(out.length).fill(i));
    i += len;
  }
  map.push(original.length); // so an end index just past the last character maps too
  let r = { text, map };
  r = replaceTracked(r.text, r.map, /\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/gi, m => NUMBER_WORDS[m[0].toLowerCase()]);
  // Letters that stand in for digits, only between digits: "6l9-555-O123".
  r = replaceTracked(r.text, r.map, /(?<=\d[ .-]?)[oO](?=[ .-]?\d)/g, () => '0');
  r = replaceTracked(r.text, r.map, /(?<=\d[ .-]?)[lI|](?=[ .-]?\d)/g, () => '1');
  return r;
}

// ---------- detectors ----------
// Each one takes the normalized text and returns [start, end] ranges in it.

const ranges = (text, re, keep = () => true) => [...text.matchAll(re)].filter(keep).map(m => [m.index, m.index + m[0].length]);

// Email, including spelled-out forms with any separator around "at" and "dot": "jane at gmail dot com",
// "jane [at] gmail (dot) com", "jane-at-gmail-dot-com", "jane_at_gmail.com".
// A separator is any run of characters that aren't letters or digits: spaces, dots, dashes, underscores, brackets...
const SEP = String.raw`[^a-z0-9]+`;
// Domain labels can't be the word "dot" (nor have a "-dot" part), so "x-dot-y" splits only one way. Without that,
// the regex could try every split and take exponential time on long text.
const NOT_DOT = String.raw`(?!dot(?![a-z0-9]))`;
const LABEL = String.raw`${NOT_DOT}[a-z0-9]+(?:-${NOT_DOT}[a-z0-9]+)*`;
const DOT = String.raw`(?:\s*\.\s*|${SEP}dot${SEP})`;
const DOMAIN = String.raw`${LABEL}(?:${DOT}${LABEL})*${DOT}([a-z]{2,24})(?![\w@])`;
// Starts at the beginning of a word, so the regex doesn't retry from every character of a long one.
const LOCAL = String.raw`(?<![a-z0-9._%+-])[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?`;
const EMAIL = new RegExp(String.raw`${LOCAL}(?:\s*@\s*|${SEP}?[\[(]\s*at\s*[\])]${SEP}?)${DOMAIN}`, 'gi');
// A plain "at" ("meet at Balboa Park dot...") only counts with a real-looking top-level domain.
const EMAIL_PLAIN_AT = new RegExp(String.raw`${LOCAL}${SEP}at${SEP}${DOMAIN}`, 'gi');
// The separator standing in for the dot too ("jane-at-gmail-com"), only with no spaces anywhere and a real-looking
// top-level domain, so sentences like "I'm at home me and you" pass. Labels have no dashes here (a dash is always
// a separator), for the same reason labels can't be "dot".
const TIGHT = String.raw`[^\sa-z0-9]+`;
const BARE_DOT = String.raw`${TIGHT}(?:dot${TIGHT})?`;
const BARE_LABEL = String.raw`${NOT_DOT}[a-z0-9]+`;
const EMAIL_BARE = new RegExp(String.raw`${LOCAL}${TIGHT}at${TIGHT}${BARE_LABEL}(?:${BARE_DOT}${BARE_LABEL})*${BARE_DOT}([a-z]{2,24})(?![a-z0-9@])`, 'gi');
const COMMON_TLDS = new Set(['com', 'net', 'org', 'edu', 'gov', 'io', 'me', 'co', 'us', 'uk', 'ca', 'de', 'fr', 'info', 'app', 'dev', 'mail', 'email']);
const commonTld = (m) => COMMON_TLDS.has(m[1].toLowerCase());
const email = (text) => [...ranges(text, EMAIL), ...ranges(text, EMAIL_PLAIN_AT, commonTld), ...ranges(text, EMAIL_BARE, commonTld)];

// Links to social, messaging, and payment profiles.
const PROFILE_DOMAINS = ['instagram.com', 'instagr.am', 'tiktok.com', 'snapchat.com', 't.me', 'telegram.me', 'wa.me', 'whatsapp.com',
  'discord.gg', 'discord.com', 'facebook.com', 'fb.com', 'fb.me', 'm.me', 'x.com', 'twitter.com', 'threads.net', 'threads.com',
  'bsky.app', 'linktr.ee', 'linkedin.com', 'youtube.com', 'twitch.tv', 'reddit.com', 'venmo.com', 'cash.app', 'paypal.me',
  'onlyfans.com', 'kik.me', 'signal.me', 'line.me', 'snap.com'];
const LINK = new RegExp(String.raw`(?<![\w.-])(?:https?:\/\/)?(?:www\.|m\.)?(?:${PROFILE_DOMAINS.map(d => d.replace(/\./g, '\\.')).join('|')})\/[^\s]+`, 'gi');
const link = (text) => ranges(text, LINK);

// Handles: "@jane_doe", "IG: jane_doe", "my snap is jane.doe99".
const HANDLE = /(?<![\w.@/])@[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?/gi;
const NOT_A_HANDLE = /^@\d{1,2}(?::?\d{2})?(?:am|pm)?$/i; // "@5pm", "@7:30" (the colon stops the match, so "@7" too)
const PLATFORMS = String.raw`insta(?:gram)?|ig|snap(?:chat)?|tiktok|telegram|whats\s?app|discord|kik|venmo|cash\s?app|signal|wechat|threads|bluesky|bsky|twitter|facebook|fb`;
const PLATFORM_LABEL = new RegExp(String.raw`\b(?:${PLATFORMS})\b\s*(?:handle|username|user|id)?\s*[:=]\s*@?[a-z0-9_.]{2,30}`, 'gi');
// The "is" form needs a handle-looking token (a digit, underscore, or dot), so "tiktok is fun" passes.
const PLATFORM_IS = new RegExp(String.raw`\b(?:${PLATFORMS})\b\s*(?:handle|username|user|id)?\s+is\s+@?(?=[a-z0-9_.]*[0-9_.][a-z0-9_.]*\b)[a-z0-9_.]*[a-z0-9_]`, 'gi');
const handle = (text) => [
  ...ranges(text, HANDLE, m => !NOT_A_HANDLE.test(m[0])),
  ...ranges(text, PLATFORM_LABEL),
  ...ranges(text, PLATFORM_IS),
];

// Payment card numbers: 13 to 19 digits, optionally grouped with spaces or dashes, that pass the Luhn check.
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
// Any separator but commas, which group the digits of big plain numbers ("1,234,567,890,123 views").
const CARD = /(?<![\d-])\d(?:[^A-Za-z0-9,]?\d){12,18}(?![\d-])/g;
const card = (text) => ranges(text, CARD, m => { const d = m[0].replace(/\D/g, ''); return luhn(d) && !/^(\d)\1+$/.test(d); });

// IBANs: country code, check digits, and up to 30 letters and digits, that pass the mod-97 check.
function mod97(iban) {
  const s = (iban.slice(4) + iban.slice(0, 4)).toUpperCase().replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const c of s) r = (r * 10 + Number(c)) % 97;
  return r === 1;
}
const IBAN = /\b[a-z]{2}\d{2}(?: ?[a-z0-9]){11,30}\b/gi;
const iban = (text) => ranges(text, IBAN, m => mod97(m[0].replace(/ /g, '')));

// US Social Security numbers: 123-45-6789, 123 45 6789, 123.45.6789 (any separator, the same one twice), skipping
// numbers the SSA never issues.
const SSN = /(?<![\d-])(?!000|666|9\d\d)\d{3}([^A-Za-z0-9])(?!00)\d{2}\1(?!0000)\d{4}(?![\d-])/g;
const ssn = (text) => ranges(text, SSN);

// Phone numbers, in every country's format, via libphonenumber-js. Numbers written without a country code are read
// as each of `countries` in turn.
// libphonenumber-js only knows the usual punctuation, so other separators ("619_555_0123", "619~555~0123") become
// spaces first, one for one, so positions don't move.
const PHONE_OTHER_SEPARATORS = /[^\p{L}\p{N}\s+()\-.\/]/gu;
const phone = (text, { countries }) => {
  const spaced = text.replace(PHONE_OTHER_SEPARATORS, m => ' '.repeat(m.length));
  return countries.flatMap(defaultCountry =>
    findPhoneNumbersInText(spaced, { defaultCountry, v2: true }).map(f => [f.startsAt, f.endsAt]));
};

// Street addresses (English-style): "1234 Elm St", "500 N. Harbor Drive", "Apt 5B".
const STREET_TYPES = String.raw`st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|way|pl|place|ter|terrace|pkwy|parkway|cir|circle|hwy|highway`;
const STREET = new RegExp(String.raw`(?<![\d.,:$])\b\d{1,6}\s+(?:[nsew]\.?\s+)?(?:[a-z0-9'.-]+\s+){0,3}(?:${STREET_TYPES})\b\.?`, 'gi');
// The same with any separators and no spaces ("1234-elm-st", "500.n.harbor.dr"). It needs a name word before the
// street type, so "a 2-lane road" and "the 4-way stop" pass.
const STREET_TIGHT = new RegExp(String.raw`(?<![\w.,:$-])\d{1,6}[^\sa-z0-9]+(?:[nsew][^\sa-z0-9]+)?(?:[a-z0-9']+[^\sa-z0-9]+){1,3}(?:${STREET_TYPES})(?![a-z0-9])`, 'gi');
// Any separator, or none, between the word and the number: "Apt 5B", "apt-5b", "unit_12", "Suite #200".
const UNIT = /(?<![a-z0-9])(?:apt|apartment|unit|suite|ste)[^a-z0-9]*\d+[a-z]?(?![a-z0-9])/gi;
const address = (text) => [...ranges(text, STREET), ...ranges(text, STREET_TIGHT), ...ranges(text, UNIT)];

// In priority order: when two findings overlap, the earlier type wins.
const DETECTORS = { email, link, handle, card, iban, ssn, phone, address };

// ---------- API ----------

/**
 * Find personal info in `text`.
 * Options: `defaultCountry`, a two-letter country code (or a list of them) for phone numbers written without a
 * country code, 'US' by default; and `severity`, which overrides DEFAULT_SEVERITY by type ('block', 'warn', or 'off').
 * Returns findings sorted by position: { type, severity, match, start, end }, where `match` is
 * `text.slice(start, end)`.
 */
export function findPii(text, { defaultCountry = 'US', severity = {} } = {}) {
  if (typeof text !== 'string' || !text) return [];
  const sev = { ...DEFAULT_SEVERITY, ...severity };
  const countries = [defaultCountry].flat().filter(Boolean);
  const norm = normalize(text);
  const taken = [];
  const findings = [];
  for (const type of TYPES) {
    if (sev[type] === 'off') continue;
    for (const [s, e] of DETECTORS[type](norm.text, { countries }).sort((a, b) => a[0] - b[0])) {
      if (taken.some(([ts, te]) => s < te && e > ts)) continue;
      taken.push([s, e]);
      const start = norm.map[s], end = norm.map[e];
      findings.push({ type, severity: sev[type], match: text.slice(start, end), start, end });
    }
  }
  return findings.sort((a, b) => a.start - b.start);
}

/** Like findPii, plus `ok`: true unless a finding has severity 'block'. */
export function checkPii(text, options) {
  const findings = findPii(text, options);
  return { ok: !findings.some(f => f.severity === 'block'), findings };
}
