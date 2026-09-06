'use strict';

const https = require('https');

const STABLE_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/stable_token';
const WXACODE_URL = 'https://api.weixin.qq.com/wxa/getwxacodeunlimit';

let tokenCache = null;

function request(options) {
  const payload = Buffer.from(JSON.stringify(options.body || {}));
  return new Promise((resolve, reject) => {
    const req = https.request(options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      },
      timeout: 10000
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        contentType: String(res.headers['content-type'] || ''),
        body: Buffer.concat(chunks)
      }));
    });
    req.on('timeout', () => req.destroy(new Error('WECHAT_OPENAPI_TIMEOUT')));
    req.on('error', reject);
    req.end(payload);
  });
}

function parseJsonResponse(response, fallbackCode) {
  let data;
  try {
    data = JSON.parse(response.body.toString('utf8'));
  } catch (err) {
    throw new Error(fallbackCode);
  }
  if (response.statusCode < 200 || response.statusCode >= 300 || data.errcode) {
    throw new Error(`${fallbackCode}:${data.errcode || response.statusCode}:${data.errmsg || 'unknown'}`);
  }
  return data;
}

async function getStableAccessToken(options) {
  const now = Date.now();
  if (tokenCache && tokenCache.appId === options.appId && tokenCache.expiresAt > now) {
    return tokenCache.accessToken;
  }
  const doRequest = options.request || request;
  const response = await doRequest({
    url: STABLE_TOKEN_URL,
    body: {
      grant_type: 'client_credential',
      appid: options.appId,
      secret: options.appSecret,
      force_refresh: false
    }
  });
  const data = parseJsonResponse(response, 'WECHAT_STABLE_TOKEN_FAILED');
  if (!data.access_token) throw new Error('WECHAT_STABLE_TOKEN_MISSING');
  const expiresIn = Math.max(300, Number(data.expires_in) || 7200);
  tokenCache = {
    appId: options.appId,
    accessToken: data.access_token,
    expiresAt: now + Math.max(60, expiresIn - 300) * 1000
  };
  return data.access_token;
}

async function getUnlimitedWxacode(options) {
  const doRequest = options.request || request;
  const accessToken = await getStableAccessToken({
    appId: options.appId,
    appSecret: options.appSecret,
    request: doRequest
  });
  const response = await doRequest({
    url: `${WXACODE_URL}?access_token=${encodeURIComponent(accessToken)}`,
    body: {
      scene: options.scene,
      page: options.page,
      check_path: options.checkPath === true,
      env_version: options.envVersion || 'release',
      width: options.width || 430
    }
  });
  if (response.statusCode >= 200 && response.statusCode < 300 &&
      !response.contentType.includes('application/json')) {
    return response.body;
  }
  parseJsonResponse(response, 'WECHAT_WXACODE_FAILED');
  throw new Error('WECHAT_WXACODE_EMPTY');
}

function resetTokenCache() {
  tokenCache = null;
}

module.exports = {
  getStableAccessToken,
  getUnlimitedWxacode,
  resetTokenCache
};
