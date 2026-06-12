import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BLOCKED_SITES,
  blockingActive,
  buildRules,
  matchesHosts,
  parseBlockList,
} from '../core/block.js';
import { DEFAULT_SETTINGS, WORK_PHASES } from '../core/timer.js';

describe('parseBlockList', () => {
  it('normalizes the ways people paste sites', () => {
    assert.deepEqual(
      parseBlockList('https://www.YouTube.com/watch?v=x\nreddit.com/r/all\n x.com:443 '),
      ['youtube.com', 'reddit.com', 'x.com']
    );
  });

  it('takes commas as separators too', () => {
    assert.deepEqual(parseBlockList('youtube.com, reddit.com'), ['youtube.com', 'reddit.com']);
  });

  it('drops blanks, comments, single labels, and garbage', () => {
    assert.deepEqual(
      parseBlockList('\n# work stuff\nlocalhost\nnot a host\n-bad.com\nok.example\n'),
      ['ok.example']
    );
  });

  it('dedupes hosts that normalize to the same name', () => {
    assert.deepEqual(parseBlockList('www.x.com\nhttps://x.com\nx.com.'), ['x.com']);
  });

  it('keeps subdomain entries distinct from their parent', () => {
    assert.deepEqual(parseBlockList('news.ycombinator.com'), ['news.ycombinator.com']);
  });

  it('caps the list', () => {
    const text = Array.from({ length: 150 }, (_, i) => `site${i}.com`).join('\n');
    assert.equal(parseBlockList(text).length, MAX_BLOCKED_SITES);
  });

  it('handles empty and missing input', () => {
    assert.deepEqual(parseBlockList(''), []);
    assert.deepEqual(parseBlockList(null), []);
    assert.deepEqual(parseBlockList(undefined), []);
  });
});

describe('buildRules', () => {
  it('one redirect rule per host, main frame only, host carried along', () => {
    const rules = buildRules(['youtube.com', 'x.com'], 'chrome-extension://abc/blocked.html');
    assert.equal(rules.length, 2);
    assert.deepEqual(
      rules.map((r) => r.id),
      [1, 2]
    );
    assert.deepEqual(rules[0].condition, {
      requestDomains: ['youtube.com'],
      resourceTypes: ['main_frame'],
    });
    assert.equal(
      rules[0].action.redirect.url,
      'chrome-extension://abc/blocked.html?from=youtube.com'
    );
  });

  it('builds nothing from nothing', () => {
    assert.deepEqual(buildRules([], 'chrome-extension://abc/blocked.html'), []);
  });
});

describe('matchesHosts', () => {
  const hosts = ['youtube.com', 'news.ycombinator.com'];

  it('matches the host and its subdomains — the requestDomains shape', () => {
    assert.equal(matchesHosts('https://youtube.com/feed', hosts), 'youtube.com');
    assert.equal(matchesHosts('https://m.youtube.com/', hosts), 'youtube.com');
    assert.equal(matchesHosts('https://news.ycombinator.com/item?id=1', hosts), 'news.ycombinator.com');
  });

  it('never matches lookalikes or parents of a subdomain entry', () => {
    assert.equal(matchesHosts('https://notyoutube.com/', hosts), null);
    assert.equal(matchesHosts('https://ycombinator.com/', hosts), null);
    assert.equal(matchesHosts('https://youtube.com.evil.example/', hosts), null);
  });

  it('only http(s) pages are blockable', () => {
    assert.equal(matchesHosts('chrome://settings', hosts), null);
    assert.equal(matchesHosts('file:///tmp/youtube.com', hosts), null);
    assert.equal(matchesHosts('not a url', hosts), null);
  });
});

describe('blockingActive', () => {
  const base = () => ({
    status: 'running',
    phase: 'focus',
    settings: { ...DEFAULT_SETTINGS, blockEnabled: true, blockList: 'youtube.com' },
  });

  it('on while focused work runs', () => {
    assert.equal(blockingActive(base(), WORK_PHASES), true);
    const timer = { ...base(), phase: 'timer' };
    assert.equal(blockingActive(timer, WORK_PHASES), true);
  });

  it('off when disabled, paused, on a break, or with an empty list', () => {
    assert.equal(blockingActive({ ...base(), status: 'paused' }, WORK_PHASES), false);
    assert.equal(blockingActive({ ...base(), status: 'idle' }, WORK_PHASES), false);
    assert.equal(blockingActive({ ...base(), phase: 'shortBreak' }, WORK_PHASES), false);
    const off = base();
    off.settings.blockEnabled = false;
    assert.equal(blockingActive(off, WORK_PHASES), false);
    const empty = base();
    empty.settings.blockList = '  \n# nothing\n';
    assert.equal(blockingActive(empty, WORK_PHASES), false);
  });
});
