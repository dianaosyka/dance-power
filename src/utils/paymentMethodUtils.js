export const PAYMENT_METHODS = [
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
];

export function normalizePaymentMethod(paymentMethod) {
  return paymentMethod === 'cash' ? 'cash' : 'card';
}

export function getPaymentMethodLabel(paymentMethod) {
  const normalizedMethod = normalizePaymentMethod(paymentMethod);
  return PAYMENT_METHODS.find(method => method.value === normalizedMethod)?.label || 'Card';
}
