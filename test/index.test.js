import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPii, checkPii, normalize } from '../src/index.js';

// [text, type, match]: the text must produce a finding of that type covering exactly `match`.
const CATCH = [
  ['email me at jane.doe@gmail.com', 'email', 'jane.doe@gmail.com'],
  ['jane.doe @ gmail . com', 'email', 'jane.doe @ gmail . com'],
  ['jane [at] gmail (dot) com', 'email', 'jane [at] gmail (dot) com'],
  ['write to jane at gmail dot com', 'email', 'jane at gmail dot com'],
  ['ＪＡＮＥ＠ＧＭＡＩＬ．ＣＯＭ', 'email', 'ＪＡＮＥ＠ＧＭＡＩＬ．ＣＯＭ'],
  // Any separator around "at" and "dot": the way people sneak an email into a username.
  ['me-at-gmail-dot-com', 'email', 'me-at-gmail-dot-com'],
  ['me.at.gmail.dot.com', 'email', 'me.at.gmail.dot.com'],
  ['me_at_gmail_dot_com', 'email', 'me_at_gmail_dot_com'],
  ['me~at~gmail~dot~com', 'email', 'me~at~gmail~dot~com'],
  ['jane.doe-at-gmail-dot-com', 'email', 'jane.doe-at-gmail-dot-com'],
  ['jane at mail-server dot co dot uk', 'email', 'jane at mail-server dot co dot uk'],
  ['jane_[at]_gmail_(dot)_com', 'email', 'jane_[at]_gmail_(dot)_com'],
  ['jane-at-gmail.com', 'email', 'jane-at-gmail.com'],
  ['ME-AT-GMAIL-DOT-COM', 'email', 'ME-AT-GMAIL-DOT-COM'],
  // The separator standing in for the dot, with no spaces and a common top-level domain.
  ['me-at-gmail-com', 'email', 'me-at-gmail-com'],
  ['me_at_proton_me', 'email', 'me_at_proton_me'],
  ['me.at.gmail.com', 'email', 'me.at.gmail.com'],
  ['call 619-555-0123', 'phone', '619-555-0123'],
  ['(619) 555 0123 after 5', 'phone', '(619) 555 0123'],
  ['text 6195550123', 'phone', '6195550123'],
  ['6 1 9 5 5 5 0 1 2 3', 'phone', '6 1 9 5 5 5 0 1 2 3'],
  ['six one nine five five five zero one two three', 'phone', 'six one nine five five five zero one two three'],
  ['6l9-555-O123', 'phone', '6l9-555-O123'],
  ['６１９−５５５−０１２３', 'phone', '６１９−５５５−０１２３'],
  ['電話は+81 3-1234-5678です', 'phone', '+81 3-1234-5678'],
  ['me liga +55 11 91234-5678', 'phone', '+55 11 91234-5678'],
  ['ring +44 20 7946 0958', 'phone', '+44 20 7946 0958'],
  ['follow @jane_doe for updates', 'handle', '@jane_doe'],
  ['IG: janedoe', 'handle', 'IG: janedoe'],
  ['snapchat username = jane.doe', 'handle', 'snapchat username = jane.doe'],
  ['my insta is jane.doe99', 'handle', 'insta is jane.doe99'],
  ['venmo: @jane-doe', 'handle', 'venmo: @jane'],
  ['instagram.com/janedoe', 'link', 'instagram.com/janedoe'],
  ['https://t.me/janedoe now', 'link', 'https://t.me/janedoe'],
  ['wa.me/16195550123', 'link', 'wa.me/16195550123'],
  ['card 4111 1111 1111 1111 exp 12/29', 'card', '4111 1111 1111 1111'],
  ['4111-1111-1111-1111', 'card', '4111-1111-1111-1111'],
  ['IBAN DE89 3704 0044 0532 0130 00', 'iban', 'DE89 3704 0044 0532 0130 00'],
  ['ssn 123-45-6789', 'ssn', '123-45-6789'],
  ['I live at 1234 Elm St, come by', 'address', '1234 Elm St'],
  ['500 N. Harbor Drive', 'address', '500 N. Harbor Drive'],
  ['buzz Apt 5B', 'address', 'Apt 5B'],
  // Any separator between the parts of other types too.
  ['619_555_0123', 'phone', '619_555_0123'],
  ['619~555~0123', 'phone', '619~555~0123'],
  ['123.45.6789', 'ssn', '123.45.6789'],
  ['123_45_6789', 'ssn', '123_45_6789'],
  ['4111.1111.1111.1111', 'card', '4111.1111.1111.1111'],
  ['4111_1111_1111_1111', 'card', '4111_1111_1111_1111'],
  ['apt-5b', 'address', 'apt-5b'],
  ['my_unit_12', 'address', 'unit_12'],
  ['1234-elm-st', 'address', '1234-elm-st'],
  ['1234_elm_street', 'address', '1234_elm_street'],
  ['500.n.harbor.dr', 'address', '500.n.harbor.dr'],
];

// Text that must produce no findings at all.
const PASS = [
  '$25 a bowl', 'since 1972', '7:30-9pm', 'up to 22 people', 'AP Bio', 'Arena México', '2000 piece TV console',
  'Meet @5pm by the fountain', 'meet @ the park', 'Meet at Balboa Park', 'tiktok is fun', 'see you at 7',
  // Usernames and phrases that contain "at" or "dot" without being an email.
  'bob.atkins', 'cat-dotcom', 'jane-doe', 'pat_at_home', 'look-at-me', 'great_dot', 'at-dot-com', 'dot.matrix.fan',
  "I'm at home me and you", 'meet at the park. Me too', 'Meet at Balboa Park - me and Sam', 'at the beach, com on',
  // Hyphenated numbers that look a bit like addresses, and usernames with digits.
  'a 2-lane road', 'the 4-way stop', '3-court complex', 'route_66', 'agent.007', 'player_2024', 'sk8er-boi', 'paste1',
  'Prices: 1,234,567,890,123 views',
  '2026-11-17 19:30', '12/25/2026', 'Entry is $5 each', 'Mile 13.1', 'one or two people', 'Someone has to bring nine chairs',
  'I said yes to the sleepover. I did not say I would be there for it. Wine bar, two hours, phones face down.',
  // Bored's example posts.
  'About 2 cubic yards from the city yard. Need a truck and a second pair of hands with a wheelbarrow. Lemonade provided!',
  "If I stare at this little dude wordlessly trying to help me assemble a 2000 piece TV console for much longer I'm gonna go crazy. Wanna come help me out? Mocktails and snacks on me.",
  "You know the drill, it's 2036 and these jokers still messing everything up for everybody else. Come, stay, don't leave till minimum wage is sane - at least $200/hour.",
  "I've got 23 bottles and a gallon of milk on standby. Loser buys tacos.",
  'My 15-year-old wants my old Civic, and I never learned manual. Empty parking lot, lots of patience, no judgment.',
  "I'm 64 and I will destroy you. Paddles to borrow if you need one.",
  "Nickel ante. I've been playing since Eisenhower. Bring snacks and humility.",
  'Ho 78 anni e non perdo da tre estati. Chi ha il coraggio? Il vino lo porto io.',
  '¡Vamos a la Arena México el viernes! Máscaras opcionales, gritar es obligatorio. Después, tacos en la esquina.',
  '아침 7시 출발, 정상 찍고 내려와서 파전에 막걸리. 초보도 환영합니다!',
  'Jumamosi asubuhi tunapanda miti katika Msitu wa Karura. Leteni kofia na maji; chai iko kwangu.',
  'Join the crew for a casual "beer can" race. Looks like it\'ll be a good day for sailing!',
  'Eyepatches provided. Talking like a pirate the whole way is mandatory, arrr.',
  'Ride the ferry to Coronado dressed as pirates',
  'Half court, casual. All skill levels welcome.',
];

for (const [text, type, match] of CATCH) {
  test(`catches ${type}: ${text}`, () => {
    const f = findPii(text);
    assert.ok(f.some(x => x.type === type && x.match === match), JSON.stringify(f));
  });
}

for (const text of PASS) {
  test(`passes: ${text}`, () => assert.deepEqual(findPii(text), []));
}

test('findings point at the original text', () => {
  const text = 'call ６１９ ５５５ ０１２３ or jane@x.io';
  for (const f of findPii(text)) assert.equal(text.slice(f.start, f.end), f.match);
});

test('overlapping findings keep the higher-priority type', () => {
  const f = findPii('wa.me/16195550123');
  assert.deepEqual(f.map(x => x.type), ['link']);
});

test('checkPii: addresses only warn', () => {
  assert.equal(checkPii('1234 Elm St').ok, true);
  assert.equal(checkPii('619-555-0123').ok, false);
});

test('severity overrides', () => {
  assert.equal(checkPii('1234 Elm St', { severity: { address: 'block' } }).ok, false);
  assert.deepEqual(findPii('619-555-0123', { severity: { phone: 'off' } }), []);
});

test('defaultCountry: numbers without a country code', () => {
  assert.deepEqual(findPii('03-1234-5678'), []);
  assert.equal(findPii('03-1234-5678', { defaultCountry: 'JP' })[0]?.type, 'phone');
  assert.equal(findPii('03-1234-5678', { defaultCountry: ['US', 'JP'] })[0]?.type, 'phone');
});

test('long separator-heavy text stays fast', () => {
  for (const text of ['a-'.repeat(5000) + 'at', 'a-at-'.repeat(2000) + 'b', 'x.dot.'.repeat(2000), 'me at '.repeat(2000) + 'gmail']) {
    const t = performance.now();
    findPii(text);
    assert.ok(performance.now() - t < 500, `${text.slice(0, 12)}… took ${Math.round(performance.now() - t)} ms`);
  }
});

test('empty and non-string input', () => {
  assert.deepEqual(findPii(''), []);
  assert.deepEqual(findPii(null), []);
});

test('normalize maps back to the original', () => {
  const { text, map } = normalize('six ６');
  assert.equal(text, '6 6');
  assert.deepEqual(map, [0, 3, 4, 5]);
});
