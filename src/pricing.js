function resolvePrice(basePrice, slabs, quantity) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be greater than zero');
  let price = Number(basePrice);
  let applied = null;
  for (const slab of [...(slabs || [])].sort((a, b) => Number(a.min_qty) - Number(b.min_qty))) {
    if (qty >= Number(slab.min_qty)) {
      price = Number(slab.price);
      applied = slab;
    }
  }
  return { price, applied };
}
module.exports = { resolvePrice };
