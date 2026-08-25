import {
  getPaymentMethodLabel,
  normalizePaymentMethod,
} from './paymentMethodUtils';

describe('payment method helpers', () => {
  it('treats old payments without a method as card payments', () => {
    expect(normalizePaymentMethod(undefined)).toBe('card');
    expect(getPaymentMethodLabel(undefined)).toBe('Card');
  });

  it('preserves cash payments', () => {
    expect(normalizePaymentMethod('cash')).toBe('cash');
    expect(getPaymentMethodLabel('cash')).toBe('Cash');
  });
});
