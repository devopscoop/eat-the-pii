# eat-the-pii

Find phone numbers, emails, handles, and other personal info in user-written text, in the browser or Node, so people
don't accidentally dox themselves in a post.

It's a guard against mistakes, not against someone determined to get around it. It doesn't find names. Use it in
both places: in the browser to warn people as they type, and on the server to enforce the rule.

## What it finds

| Type | Examples | Default |
|---|---|---|
| `email` | `jane@gmail.com`, `jane [at] gmail (dot) com`, `jane at gmail dot com`, `jane-at-gmail-dot-com`, `jane_at_gmail.com`, `jane.at.gmail.com` | block |
| `link` | `instagram.com/jane`, `t.me/jane`, `wa.me/16195550123`, and other social, messaging, and payment profiles | block |
| `handle` | `@jane_doe`, `IG: janedoe`, `my snap is jane.doe99` | block |
| `card` | 13 to 19 digits that pass the Luhn check | block |
| `iban` | IBANs that pass the mod-97 check | block |
| `ssn` | US Social Security numbers, `123-45-6789` | block |
| `phone` | Any country's format, via [libphonenumber-js](https://www.npmjs.com/package/libphonenumber-js) | block |
| `address` | `1234 Elm St`, `500 N. Harbor Drive`, `Apt 5B` (English-style only) | warn |

Parts can be separated by anything that isn't a letter or digit: spaces, dashes, dots, underscores, and so on
(`me-at-gmail-dot-com`, `619_555_0123`, `123.45.6789`, `1234-elm-st`). Before matching, it normalizes the text,
so these get caught too: full-width and other scripts' digits (`６１９`),
English number words (`six one nine`), and letters standing in for digits (`6l9-555-O123`).

## Use

```js
import { checkPii } from '@devopscoop/eat-the-pii';

const { ok, findings } = checkPii('Text me at 619-555-0123', { defaultCountry: 'US' });
// ok: false
// findings: [{ type: 'phone', severity: 'block', match: '619-555-0123', start: 11, end: 23 }]
```

- `findPii(text, options)` returns findings sorted by position. `start` and `end` index the original text, so you
  can highlight the match in a form.
- `checkPii(text, options)` returns `{ ok, findings }`. `ok` is false if any finding has severity `block`.
- Options:
  - `defaultCountry`: a two-letter country code, or a list of them, for phone numbers written without a country
    code. The default is `'US'`. Passing the country where a post takes place helps with local formats.
  - `severity`: overrides by type, for example `{ address: 'block', handle: 'warn', iban: 'off' }`.

Findings carry types, not messages, so each app writes its own wording.

## In the browser, with no build step

The library is plain ES modules. Copy `src/` and the `libphonenumber-js` package into your static files, then map
the one bare import:

```html
<script type="importmap">
  { "imports": { "libphonenumber-js/min": "/vendor/libphonenumber-js/min/index.js" } }
</script>
<script type="module">
  import { checkPii } from '/vendor/eat-the-pii/index.js';
</script>
```

## Limits

- No names. Reliable name detection needs an ML model, such as Microsoft Presidio.
- Number words and address patterns are English only.
- A plain `my insta is janedoe` isn't caught, because `tiktok is fun` looks the same. `IG: janedoe`,
  `@janedoe`, and `my insta is jane.doe99` are caught.
- A bare `@word` is treated as a handle, except times like `@5pm`, so `I'll be @home` is a false alarm.
- Spelled-out emails can use any separator (spaces, dashes, dots, underscores, or anything else that isn't a letter
  or digit) around `at` and `dot`. A plain `at`, without `@` or brackets, only counts with a common top-level domain
  such as `com`. With no `dot` at all (`jane-at-gmail-com`), the text also can't contain spaces. Text with no
  separators (`janeatgmaildotcom`) isn't caught.
- A street address with no spaces (`1234-elm-st`) needs a name word before the street type, so `a 2-lane road`
  passes. Card numbers can't be grouped with commas, so big plain numbers like `1,234,567,890,123` pass.

## Development

```sh
npm test
```

Add a case to `test/index.test.js` for every false alarm or miss you find: `CATCH` for text that must be caught,
and `PASS` for text that must not be.

## License

MIT. See [LICENSE](LICENSE).
