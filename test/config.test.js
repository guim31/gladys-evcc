import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, normalizeUrl } from '../src/config.js';

test('an address typed without scheme nor port gets http and 7070', () => {
  assert.equal(normalizeUrl('192.0.2.20'), 'http://192.0.2.20:7070');
  assert.equal(normalizeUrl(' evcc.local:8080 '), 'http://evcc.local:8080');
  assert.equal(normalizeUrl('https://example.org/evcc/'), 'https://example.org/evcc');
  assert.equal(normalizeUrl('http://192.0.2.20'), 'http://192.0.2.20');
});

test('unusable addresses are refused, credentials included', () => {
  for (const raw of ['', '   ', 'ftp://192.0.2.20', 'http://user:pass@192.0.2.20', 'http://', 42]) {
    assert.equal(normalizeUrl(raw), null, String(raw));
  }
});

test('the configuration is normalized', () => {
  assert.deepEqual(normalizeConfig({}), {
    url: null,
    invalidUrl: false,
    password: '',
    language: DEFAULT_CONFIG.language,
  });
  const config = normalizeConfig({ url: 'bad url', password: 'x', language: 'de' });
  assert.equal(config.invalidUrl, true);
  assert.equal(config.language, 'de');
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});
