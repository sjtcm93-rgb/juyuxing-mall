#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  TICKET_TTL_MS,
  createTicketValues,
  customUserId,
  hashValue,
  parseScene,
  publicAccount,
  ticketState
} = require('../cloudfunctions/adminQrAuth/ticket-core');
const {
  getUnlimitedWxacode,
  resetTokenCache
} = require('../cloudfunctions/adminQrAuth/wxacode-client');

const now = new Date('2026-08-31T00:00:00.000Z');
const first = createTicketValues(now);
const second = createTicketValues(now);

assert.match(first.publicId, /^[A-Za-z0-9_-]{16}$/);
assert.notStrictEqual(first.publicId, second.publicId);
assert.notStrictEqual(first.pollSecret, second.pollSecret);
assert.strictEqual(first.pollSecretHash, hashValue(first.pollSecret));
assert.strictEqual(first.expiresAt.getTime(), now.getTime() + TICKET_TTL_MS);

assert.strictEqual(parseScene('q=' + first.publicId), first.publicId);
assert.strictEqual(parseScene(encodeURIComponent('q=' + first.publicId)), first.publicId);
assert.strictEqual(parseScene('q=../../invalid'), '');
assert.strictEqual(parseScene(''), '');

assert.strictEqual(ticketState(null, now), 'missing');
assert.strictEqual(ticketState({ status: 'pending', expiresAt: first.expiresAt }, now), 'pending');
assert.strictEqual(ticketState({ status: 'confirmed', expiresAt: first.expiresAt }, now), 'confirmed');
assert.strictEqual(ticketState({ status: 'consumed', expiresAt: first.expiresAt }, now), 'consumed');
assert.strictEqual(ticketState({ status: 'pending', expiresAt: now }, now), 'expired');
assert.strictEqual(ticketState({ status: 'unknown', expiresAt: first.expiresAt }, now), 'invalid');

assert.match(customUserId('account-123'), /^admin:[a-f0-9]{24}$/);
assert.deepStrictEqual(publicAccount({
  username: 'owner', displayName: '店主', role: 'owner', passwordHash: 'secret', wechatOpenId: 'openid'
}), { username: 'owner', displayName: '店主', role: 'owner' });

async function testWxacodeClient() {
  resetTokenCache();
  const calls = [];
  const request = async options => {
    calls.push(options);
    if (options.url.includes('stable_token')) {
      return {
        statusCode: 200,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ access_token: 'stable-token', expires_in: 7200 }))
      };
    }
    return {
      statusCode: 200,
      contentType: 'image/png',
      body: Buffer.from('fake-png')
    };
  };
  const image = await getUnlimitedWxacode({
    appId: 'wx-test',
    appSecret: 'secret',
    scene: 'q=1234567890abcdef',
    page: 'subpackages/admin-auth/confirm/confirm',
    checkPath: false,
    envVersion: 'trial',
    request
  });
  assert.strictEqual(image.toString(), 'fake-png');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].body.force_refresh, false);
  assert.strictEqual(calls[1].body.env_version, 'trial');
  assert.strictEqual(calls[1].body.check_path, false);
  assert.match(calls[1].url, /access_token=stable-token/);
}

testWxacodeClient()
  .then(() => console.log('✅ admin QR auth core: all assertions passed'))
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
