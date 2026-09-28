const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePrice } = require('../src/pricing');

test('uses base price below slab', () => {
  assert.equal(resolvePrice(100, [{ min_qty: 10, price: 90 }], 9).price, 100);
});

test('uses highest eligible slab', () => {
  const result = resolvePrice(100, [{ min_qty: 10, price: 90 }, { min_qty: 25, price: 80 }], 30);
  assert.equal(result.price, 80);
  assert.equal(result.applied.min_qty, 25);
});

test('rejects invalid quantity', () => {
  assert.throws(() => resolvePrice(100, [], 0));
});
