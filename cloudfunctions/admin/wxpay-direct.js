'use strict';

/**
 * wxpay-direct.js — 微信支付 APIv2 直连模块（绕过 CloudBase access_token）
 *
 * 使用商户自己的 APIv2 密钥 + 商户 API 证书直接调用微信支付退款/查询接口。
 * 不依赖 cloud.cloudPay 云调用上下文，任何调用路径（Web SDK / HTTP 触发器）均可使用。
 *
 * 依赖：Node.js 内置 https / crypto，无第三方包。
 */

const https = require('https');
const crypto = require('crypto');

// ===== XML 工具 =====

function buildXml(params) {
  let xml = '<xml>';
  for (const key of Object.keys(params)) {
    const value = String(params[key]);
    xml += '<' + key + '><![CDATA[' + value + ']]></' + key + '>';
  }
  xml += '</xml>';
  return xml;
}

function parseWxXml(xmlStr) {
  const result = {};
  if (typeof xmlStr !== 'string' || !xmlStr) return result;
  const re = /<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let m;
  while ((m = re.exec(xmlStr))) {
    if (m[1] === 'xml') continue;
    result[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return result;
}

// ===== 签名（HMAC-SHA256）=====

function wxSignHmacSha256(params, key) {
  const keys = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== '' && k !== 'sign')
    .sort();
  const stringA = keys.map(k => k + '=' + params[k]).join('&');
  const stringSignTemp = stringA + '&key=' + key;
  return crypto.createHmac('sha256', key).update(stringSignTemp, 'utf8').digest('hex').toUpperCase();
}

// ===== HTTPS 请求 =====

function httpsPostXml(url, xmlBody, pfxBuffer, passphrase) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(xmlBody)
      },
      timeout: 15000
    };
    // 双向证书（仅退款等安全接口需要）
    if (pfxBuffer) {
      options.pfx = pfxBuffer;
      options.passphrase = passphrase || '';
    }
    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(parseWxXml(data));
        } catch (e) {
          reject(new Error('微信支付响应解析失败: ' + String(data).slice(0, 300)));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('微信支付接口请求超时（15秒）'));
    });
    req.on('error', (e) => reject(e));
    req.write(xmlBody);
    req.end();
  });
}

// ===== 读取 pay_config 中的直连凭证 =====

async function loadPayApiConfig(db) {
  try {
    const res = await db.collection('pay_config').doc('default').get();
    const cfg = (res && res.data) || {};
    const apiV2Key = String(cfg.apiV2Key || '').trim();
    const apiCertP12 = String(cfg.apiCertP12 || '').trim();
    if (!apiV2Key || !apiCertP12) return null;
    return {
      apiV2Key,
      apiCertP12,
      apiCertPassword: String(cfg.apiCertPassword || cfg.subMchId || '').trim(),
      subMchId: String(cfg.subMchId || '').trim()
    };
  } catch (e) {
    return null;
  }
}

// ===== 直连退款 =====

/**
 * 直连微信支付退款 API（api.mch.weixin.qq.com/secapi/pay/refund）
 * 优先按直连商户模式传参（appid + mch_id）；若商户是子商户（服务商模式），
 * 可传 subAppId / subMchId 走子商户参数。
 *
 * @returns {object} 微信原始响应（解析后的对象）
 */
async function directRefund(opts) {
  const {
    appId, mchId, apiV2Key,
    pfxBuffer, passphrase,
    outTradeNo, outRefundNo, totalFee, refundFee,
    subAppId, subMchId
  } = opts;

  const params = {
    appid: appId,
    mch_id: mchId,
    nonce_str: crypto.randomBytes(16).toString('hex'),
    sign_type: 'HMAC-SHA256',
    out_trade_no: outTradeNo,
    out_refund_no: outRefundNo,
    total_fee: String(Math.round(Number(totalFee) || 0)),
    refund_fee: String(Math.round(Number(refundFee) || 0))
  };
  // 服务商模式：传子商户参数
  if (subMchId) {
    params.sub_mch_id = subMchId;
    if (subAppId) params.sub_appid = subAppId;
  }
  params.sign = wxSignHmacSha256(params, apiV2Key);

  const xml = buildXml(params);
  return await httpsPostXml('https://api.mch.weixin.qq.com/secapi/pay/refund', xml, pfxBuffer, passphrase);
}

// ===== 直连退款查询（不需要证书）=====

async function directQueryRefund(opts) {
  const {
    appId, mchId, apiV2Key,
    outRefundNo,
    subAppId, subMchId
  } = opts;

  const params = {
    appid: appId,
    mch_id: mchId,
    nonce_str: crypto.randomBytes(16).toString('hex'),
    sign_type: 'HMAC-SHA256',
    out_refund_no: outRefundNo
  };
  if (subMchId) {
    params.sub_mch_id = subMchId;
    if (subAppId) params.sub_appid = subAppId;
  }
  params.sign = wxSignHmacSha256(params, apiV2Key);

  const xml = buildXml(params);
  return await httpsPostXml('https://api.mch.weixin.qq.com/pay/refundquery', xml, null, null);
}

// ===== 直连订单查询（不需要证书，用于诊断交易是否在直连商户名下）=====

async function directOrderQuery(opts) {
  const {
    appId, mchId, apiV2Key,
    outTradeNo
  } = opts;

  const params = {
    appid: appId,
    mch_id: mchId,
    nonce_str: crypto.randomBytes(16).toString('hex'),
    sign_type: 'HMAC-SHA256',
    out_trade_no: outTradeNo
  };
  params.sign = wxSignHmacSha256(params, apiV2Key);

  const xml = buildXml(params);
  return await httpsPostXml('https://api.mch.weixin.qq.com/pay/orderquery', xml, null, null);
}

// ===== 校验微信退款响应 =====

function isRefundSuccess(wxResp) {
  return wxResp && wxResp.return_code === 'SUCCESS' && wxResp.result_code === 'SUCCESS';
}

module.exports = {
  buildXml,
  parseWxXml,
  wxSignHmacSha256,
  loadPayApiConfig,
  directRefund,
  directQueryRefund,
  directOrderQuery,
  isRefundSuccess
};
