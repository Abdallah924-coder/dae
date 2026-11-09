'use strict';

const AMOUNT_DECIMALS = 8;
const PRICE_DECIMALS = 12;
const RATE_DECIMALS = 8;
const MAX_DECIMAL_LENGTH = 100;
const pow10 = (exponent) => 10n ** BigInt(exponent);

function decimalToScaled(value, decimals, rounding = 'down') {
  const input = String(value ?? '').trim();
  if (!input || input.length > MAX_DECIMAL_LENGTH) throw new TypeError('Montant décimal invalide');
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(input);
  if (!match) throw new TypeError('Montant décimal invalide');
  const [, whole, fraction = '', exponentText = '0'] = match;
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
    throw new TypeError('Montant décimal invalide');
  }
  const digits = BigInt(`${whole}${fraction}`);
  const shift = decimals - fraction.length + exponent;
  if (shift >= 0) return digits * pow10(shift);
  const divisorPower = -shift;
  const divisor = pow10(divisorPower);
  const quotient = digits / divisor;
  const remainder = digits % divisor;
  if (remainder > 0n && rounding === 'exact') {
    throw new TypeError(`Maximum ${decimals} décimales autorisées`);
  }
  return rounding === 'up' && remainder > 0n ? quotient + 1n : quotient;
}

function formatScaled(value, decimals) {
  const digits = value.toString().padStart(decimals + 1, '0');
  if (!decimals) return digits;
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function calculateOrderQuote({ mode, amount, unitPriceUsd, rate }) {
  if (!['buy', 'sell'].includes(mode)) throw new TypeError('Mode invalide');
  const inputAtomic = decimalToScaled(amount, AMOUNT_DECIMALS, 'exact');
  const priceAtomic = decimalToScaled(unitPriceUsd, PRICE_DECIMALS, 'down');
  const rateAtomic = decimalToScaled(rate, RATE_DECIMALS, 'down');
  if (inputAtomic <= 0n || priceAtomic <= 0n || rateAtomic <= 0n) {
    throw new TypeError('Montant, cours ou taux invalide');
  }

  const priceScale = pow10(PRICE_DECIMALS);
  const quoteScale = pow10(AMOUNT_DECIMALS + RATE_DECIMALS);
  const amountUsdtAtomic = mode === 'buy'
    ? inputAtomic
    : (inputAtomic * priceAtomic) / priceScale;
  const amountCryptoAtomic = mode === 'buy'
    ? (inputAtomic * priceScale) / priceAtomic
    : inputAtomic;
  const grossXafAtomic = amountUsdtAtomic * rateAtomic;
  const amountXafBigInt = mode === 'buy'
    ? (grossXafAtomic + quoteScale - 1n) / quoteScale
    : grossXafAtomic / quoteScale;
  if (amountUsdtAtomic <= 0n || amountCryptoAtomic <= 0n) {
    throw new TypeError('Le montant est trop faible pour être pris en charge');
  }
  if (amountCryptoAtomic.toString().length > 34 || amountUsdtAtomic.toString().length > 34) {
    throw new RangeError('Montant hors plage');
  }
  const amountXaf = Number(amountXafBigInt);
  if (!Number.isSafeInteger(amountXaf)) throw new RangeError('Montant FCFA hors plage');
  return {
    amountUsdt: formatScaled(amountUsdtAtomic, AMOUNT_DECIMALS),
    amountCrypto: formatScaled(amountCryptoAtomic, AMOUNT_DECIMALS),
    amountUsdtAtomic: amountUsdtAtomic.toString(),
    amountCryptoAtomic: amountCryptoAtomic.toString(),
    amountXaf,
    unitPriceUsd: formatScaled(priceAtomic, PRICE_DECIMALS),
    rate: formatScaled(rateAtomic, RATE_DECIMALS),
  };
}

module.exports = { AMOUNT_DECIMALS, decimalToScaled, formatScaled, calculateOrderQuote };
