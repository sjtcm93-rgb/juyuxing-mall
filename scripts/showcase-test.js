'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
let component;
vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/components/goods-card/goods-card.js'), 'utf8'), {
  Component(value) { component = value; }
});
const events = [];
const context = {
  ...component.methods,
  data: { ...component.data, goods: { _id: 'showcase-test' } },
  setData(value) { Object.assign(this.data, value); },
  triggerEvent(name, detail) { events.push({ name, id: detail.goods._id }); }
};
for (const [price, expected] of [[1, '0.01'], [6900, '69'], [6950, '69.5']]) {
  component.observers['goods, displayImage'].call(context, { price, originalPrice: 7800 }, '');
  assert.strictEqual(context.data.widePriceYuan, expected);
}
context.onTap();
context.onAction();
assert.deepStrictEqual(events, [
  { name: 'click', id: 'showcase-test' },
  { name: 'action', id: 'showcase-test' }
]);
context.onArtworkError();
assert.strictEqual(context.data.artworkError, true);
const template = fs.readFileSync(path.join(root, 'miniprogram/components/goods-card/goods-card.wxml'), 'utf8');
assert(template.includes('referenceArt && !artworkError'));
assert(template.includes('catchtap="onAction"'));
assert(template.includes('{{widePriceYuan}}'));
console.log('Showcase: live prices, separate events and artwork fallback passed.');
