'use strict';

const crypto = require('crypto');

const TICKET_TTL_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function randomUrlSafe(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function createTicketValues(now = new Date()) {
  const publicId = randomUrlSafe(12);
  const pollSecret = randomUrlSafe(24);
  return {
    publicId,
    pollSecret,
    pollSecretHash: hashValue(pollSecret),
    expiresAt: new Date(now.getTime() + TICKET_TTL_MS)
  };
}

function parseScene(scene) {
  const decoded = decodeURIComponent(String(scene || '').trim());
  const params = decoded.split('&').reduce((result, part) => {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index)] = part.slice(index + 1);
    return result;
  }, {});
  return /^[A-Za-z0-9_-]{12,32}$/.test(params.q || '') ? params.q : '';
}

function ticketState(ticket, now = new Date()) {
  if (!ticket) return 'missing';
  const expiresAt = ticket.expiresAt && new Date(ticket.expiresAt);
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= now) return 'expired';
  if (ticket.status === 'pending' || ticket.status === 'confirmed' || ticket.status === 'consumed') {
    return ticket.status;
  }
  return 'invalid';
}

function customUserId(accountId) {
  return 'admin:' + hashValue(accountId).slice(0, 24);
}

function publicAccount(account) {
  return {
    username: account.username,
    displayName: account.displayName || account.username,
    role: account.role
  };
}

module.exports = {
  TICKET_TTL_MS,
  SESSION_TTL_MS,
  createTicketValues,
  customUserId,
  hashValue,
  parseScene,
  publicAccount,
  ticketState
};
