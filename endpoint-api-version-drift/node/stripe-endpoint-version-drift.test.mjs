import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseUrl, normalise, verdict } from './stripe-endpoint-version-drift.mjs';

test('null and empty string are one version not two', () => {
  assert.equal(normalise(null), normalise(''));
  const [state] = verdict([
    { url: 'https://a.example/hook', api_version: null, status: 'enabled' },
    { url: 'https://b.example/hook', api_version: '', status: 'enabled' },
  ]);
  assert.equal(state, 'consistent');
});

test('a disabled endpoint never counts', () => {
  const [state] = verdict([
    { url: 'https://a.example/hook', api_version: '2025-09-30.clover', status: 'enabled' },
    { url: 'https://old.example/hook', api_version: '2019-12-03', status: 'disabled' },
  ]);
  assert.equal(state, 'consistent');
});

test('one pinned and one unpinned is drift', () => {
  const [state, detail] = verdict([
    { url: 'https://a.example/hook', api_version: '2025-09-30.clover', status: 'enabled' },
    { url: 'https://b.example/hook', api_version: null, status: 'enabled' },
  ]);
  assert.equal(state, 'drift');
  assert.match(detail, /account default/);
});

test('same url differing only by query is an unfinished migration', () => {
  const [state, detail] = verdict([
    { url: 'https://a.example/hook', api_version: '2024-09-30.acacia', status: 'enabled' },
    { url: 'https://a.example/hook?version=2025-09-30',
      api_version: '2025-09-30.clover', status: 'enabled' },
  ]);
  assert.equal(state, 'migration');
  assert.match(detail, /https:\/\/a\.example\/hook/);
  assert.equal(baseUrl('https://a.example/hook?version=x'), 'https://a.example/hook');
});

test('no enabled endpoints is not reported as consistent', () => {
  const [state] = verdict([
    { url: 'https://a.example/hook', api_version: null, status: 'disabled' },
  ]);
  assert.equal(state, 'none');
});
