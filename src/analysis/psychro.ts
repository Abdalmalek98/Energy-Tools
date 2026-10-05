/**
 * Wet-bulb temperature (°C) from dry-bulb (°C) and relative humidity (%) – Stull (2011), valid for RH 5–99 %
 * and −20…50 °C at sea-level pressure (accuracy ≈ ±1 °C):
 *   Tw = T·atan(0.151977·(RH+8.313659)^½) + atan(T+RH) − atan(RH−1.676331) + 0.00391838·RH^1.5·atan(0.023101·RH) − 4.686035
 */
export function wetBulbStull(tC: number, rh: number): number {
  const r = Math.min(Math.max(rh, 1), 100);
  return (
    tC * Math.atan(0.151977 * Math.sqrt(r + 8.313659)) +
    Math.atan(tC + r) -
    Math.atan(r - 1.676331) +
    0.00391838 * Math.pow(r, 1.5) * Math.atan(0.023101 * r) -
    4.686035
  );
}
