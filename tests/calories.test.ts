import { describe, expect, it } from 'vitest';
import {
  analyzeMealText,
  formatDailyCalorieSummary,
  formatMealLoggedCard,
  generateProgressBar,
  type DailyCalorieData,
  type MealLog,
} from '../src/calories.ts';

// tests/setup.ts removes DEEPSEEK_API_KEY, so analyzeMealText exercises the
// offline rule-based fallback path deterministically.

describe('analyzeMealText (offline rule-based fallback)', () => {
  it('detects eggs and rice and sums macros from items', async () => {
    const r = await analyzeMealText('I ate 2 eggs and a cup of rice');
    const names = r.items.map((i) => i.name);
    expect(names).toContain('Eggs');
    expect(names).toContain('White Rice');
    expect(r.total_calories).toBe(r.items.reduce((s, i) => s + i.calories, 0));
    expect(r.total_protein_g).toBe(r.items.reduce((s, i) => s + i.protein_g, 0));
    expect(r.confidence).toBe('estimated');
  });

  it('falls back to a single standard item when nothing is recognized', async () => {
    const r = await analyzeMealText('a bowl of exotic soup');
    expect(r.items).toHaveLength(1);
    expect(r.total_calories).toBeGreaterThan(0);
  });
});

describe('generateProgressBar', () => {
  it('renders exact half progress on a 12-char bar', () => {
    expect(generateProgressBar(925, 1850, 12)).toBe('[██████░░░░░░] 50%');
  });

  it('clamps above target to 100%', () => {
    expect(generateProgressBar(3000, 1850)).toContain('100%');
  });

  it('clamps negative values to 0%', () => {
    expect(generateProgressBar(-5, 1850)).toContain('0%');
  });
});

const daily: DailyCalorieData = {
  date: '2026-08-22',
  target_calories: 1850,
  total_calories: 480,
  total_protein_g: 30,
  total_carbs_g: 45,
  total_fat_g: 12,
  meals: [],
};

describe('summary cards', () => {
  it('daily summary shows target, remaining kcal and empty-meals note', () => {
    const out = formatDailyCalorieSummary(daily);
    expect(out).toContain('1850 kcal');
    expect(out).toContain('1370 kcal'); // 1850 - 480
    expect(out).toContain('No meals logged yet today');
    expect(out).toContain('(0)');
  });

  it('daily summary warns when over cap', () => {
    const over: DailyCalorieData = { ...daily, total_calories: 2000 };
    const out = formatDailyCalorieSummary(over);
    expect(out).toMatch(/Exceeded by 150 kcal/);
  });

  it('meal card renders meal total and daily remaining budget', () => {
    const meal: MealLog = {
      id: 'm1',
      timestamp: new Date().toISOString(),
      time_label: '12:00 PM',
      source: 'text',
      raw_input: 'eggs and toast',
      meal_name: 'Eggs & Toast',
      items: [
        { name: 'Eggs', portion: '2 piece(s)', calories: 150, protein_g: 12, carbs_g: 2, fat_g: 10 },
        { name: 'Bread / Toast', portion: '2 slices', calories: 160, protein_g: 6, carbs_g: 28, fat_g: 2 },
      ],
      total_calories: 310,
      total_protein_g: 18,
      total_carbs_g: 30,
      total_fat_g: 12,
      confidence: 'estimated',
      advice: 'Solid protein start.',
    };
    const out = formatMealLoggedCard(meal, daily);
    expect(out).toContain('Eggs & Toast');
    expect(out).toContain('310 kcal'); // this meal's total
    expect(out).toContain('1370'); // daily remaining: 1850 - 480
    expect(out).toContain('Solid protein start.');
  });
});
