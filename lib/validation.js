function positiveInt(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return Number.isInteger(value) && value > 0 && value <= 2_147_483_647 ? value : null;
}

module.exports = { positiveInt };
