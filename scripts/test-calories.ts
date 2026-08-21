/**
 * Test Calorie Counter & Nutrition Estimation Engine.
 */
import {
  analyzeMealText,
  formatMealLoggedCard,
  formatDailyCalorieSummary,
  generateProgressBar,
} from '../src/calories.ts';
import * as vault from '../src/vault.ts';

async function runTests() {
  console.log('--- 1. Testing Text Meal Parsing ---');
  const mealDesc = '2 scrambled eggs, 1 cup of white rice, and 150g grilled chicken breast';
  const analysis = await analyzeMealText(mealDesc);
  console.log('Meal Name:', analysis.meal_name);
  console.log('Total Calories:', analysis.total_calories, 'kcal');
  console.log('Macros: P:', analysis.total_protein_g, 'g, C:', analysis.total_carbs_g, 'g, F:', analysis.total_fat_g, 'g');
  console.log('Items Count:', analysis.items.length);
  analysis.items.forEach((it) => console.log(`  • ${it.name} (${it.portion}): ${it.calories} kcal`));

  console.log('\n--- 2. Testing Progress Bar ---');
  console.log('500 / 1850:', generateProgressBar(500, 1850));
  console.log('1400 / 1850:', generateProgressBar(1400, 1850));
  console.log('1850 / 1850:', generateProgressBar(1850, 1850));

  console.log('\n--- 3. Testing Vault Calorie Ledger Integration ---');
  const testChatId = 123456789;
  const result = await vault.addMealLog(testChatId, analysis, 'text', mealDesc);
  if (!result) throw new Error('Failed to log meal');

  console.log('Logged Meal ID:', result.meal.id);
  console.log('Daily Total Calories:', result.daily.total_calories, '/', result.daily.target_calories);

  console.log('\n--- 4. Formatted Meal Confirmation Card ---');
  const card = formatMealLoggedCard(result.meal, result.daily);
  console.log(card);

  console.log('\n--- 5. Formatted Daily Summary ---');
  const summary = formatDailyCalorieSummary(result.daily);
  console.log(summary);

  console.log('\n--- 6. Testing Meal Deletion ---');
  const afterDelete = await vault.deleteMealLog(result.meal.id);
  console.log('After delete total calories:', afterDelete?.total_calories);
  console.log('✓ Calorie tracker tests completed successfully');
}

runTests().catch((e) => {
  console.error('Calorie test failed:', e);
  process.exit(1);
});
