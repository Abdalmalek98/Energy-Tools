import { describe, expect, it } from 'vitest';
import { wetBulbStull } from '../src/analysis/psychro';

describe('wet-bulb (Stull)', () => {
  it('reproduces the values in the KAIA LC2 workbook (CDD sheet / Hourly sheet AP column)', () => {
    expect(wetBulbStull(36, 31)).toBeCloseTo(23.159788494213384, 9);
    expect(wetBulbStull(36, 36)).toBeCloseTo(24.399856619023947, 9);
    expect(wetBulbStull(34, 38)).toBeCloseTo(23.265066912643185, 9);
    expect(wetBulbStull(20.437393, 64.760506)).toBeCloseTo(16.018344105339537, 8); // Tarshid weather, 1 Jan 00:00
  });
  it('is physically sensible: below dry-bulb, rises with humidity, ≈ dry-bulb at saturation', () => {
    expect(wetBulbStull(30, 40)).toBeLessThan(30);
    expect(wetBulbStull(30, 80)).toBeGreaterThan(wetBulbStull(30, 40));
    expect(wetBulbStull(30, 100)).toBeCloseTo(30, 0);
  });
});
