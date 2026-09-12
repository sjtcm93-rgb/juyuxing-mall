'use strict';

/**
 * Retired refund HTTP endpoint.
 *
 * The original implementation accepted refund identifiers before authenticating the caller.
 * Keep this fail-closed stub deployable until the remote HTTP trigger has been removed.
 */
exports.main = async () => ({
  success: false,
  code: 'REFUND_ENDPOINT_RETIRED',
  statusCode: 410,
  error: '此退款入口已停用，请使用后台审批及小程序店主/财务退款核对入口'
});
