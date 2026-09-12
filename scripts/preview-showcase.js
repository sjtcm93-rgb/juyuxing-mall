'use strict';

// Local visual review using the production WXML, styles and price formatter.
// No CloudBase calls and no orders/payments are created by this preview.
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const component = path.join(mini, 'components/goods-card');
let definition;
vm.runInNewContext(fs.readFileSync(path.join(component, 'goods-card.js'), 'utf8'), {
  Component(value) { definition = value; }
});
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function render(price, original) {
  const context = { ...definition.data, ...Object.fromEntries(Object.entries(definition.properties).map(([key, prop]) => [key, prop.value])), ...definition.methods };
  context.goods = { _id: 'local-preview', name: '小紫瓶', subtitle: '皮肤舒缓退热凝胶', price, originalPrice: original, specs: [{ name: '13.5g' }] };
  context.setData = data => Object.assign(context, data);
  definition.observers['goods, displayImage'].call(context, context.goods, '');
  Object.assign(context, { wide: true, referenceArt: true, dynamic: true, showBadge: true, badgeText: '纯草本配方更安心', detailText: '用于全年龄段皮肤不适的舒缓' });
  let markup = fs.readFileSync(path.join(component, 'goods-card.wxml'), 'utf8').split('<view wx:elif=')[0];
  markup = markup.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => escapeHtml(Function(...Object.keys(context), 'return (' + expression + ');')(...Object.values(context))))
    .replace(/wx:if=/g, 'data-visible=')
    .replace(/<view\b/g, '<div').replace(/<\/view>/g, '</div>')
    .replace(/<text\b/g, '<span').replace(/<\/text>/g, '</span>')
    .replace(/<image\b/g, '<img').replace(/<\/image>/g, '');
  const css = (fs.readFileSync(path.join(mini, 'style/tokens.wxss'), 'utf8').replace(/\bpage\s*\{/g, ':root {') + '\n' + fs.readFileSync(path.join(component, 'showcase.wxss'), 'utf8'))
    .replace(/(-?[\d.]+)rpx/g, 'calc($1 * var(--rpx))');
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>商品卡片 · 本地样式核对</title><style>' + css + '\n:root{--rpx:calc(100vw / 750)}body{margin:0;background:var(--color-showcase-bg)}main{padding:32px calc(38 * var(--rpx))}h1{position:relative;z-index:4;margin:0 0 calc(-52 * var(--rpx));height:calc(52 * var(--rpx));font:700 calc(42 * var(--rpx))/1.2 sans-serif;color:var(--color-showcase-title);pointer-events:none}h1 small{font-size:calc(24 * var(--rpx));font-weight:400;letter-spacing:2px;color:var(--color-showcase-muted)}[data-visible="false"]{display:none}#notice{font:14px sans-serif;padding:16px}img{display:block}.gc-art-buy{cursor:pointer}</style><main><h1>热卖单品 <small>PRODUCTS</small></h1>' + markup + '</main><p id="notice">本地视觉预览；可用 ?price=1&amp;original=6900 检查实际测试价格。</p><script>document.querySelectorAll("[data-visible=false]").forEach(el=>el.remove());document.querySelector(".gc-art-buy").onclick=e=>{e.stopPropagation();document.querySelector("#notice").textContent="购买事件：local-preview"};document.querySelector(".gc-art").onclick=()=>document.querySelector("#notice").textContent="详情事件：local-preview";</script></html>';
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(render(Number(url.searchParams.get('price') || 6900), Number(url.searchParams.get('original') || 7800)));
    return;
  }
  const filename = path.resolve(mini, '.' + decodeURIComponent(url.pathname));
  if (!filename.startsWith(mini + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', filename.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
  fs.createReadStream(filename).pipe(res);
});
server.listen(8791, '127.0.0.1', () => console.log('Local showcase review: http://127.0.0.1:8791'));
