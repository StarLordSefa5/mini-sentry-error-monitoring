export function formatPrice(cents) {
  return (cents / 100).toFixed(2);
}

export function cartTotal(cart) {
  const count = cart.items.length;
  // Bug: the API stopped sending `summary` for empty carts.
  const total = cart.summary.total;
  return `${count} items, ${formatPrice(total)} EUR`;
}
