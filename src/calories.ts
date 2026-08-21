/**
 * Calorie Counter & Nutrition Estimation Engine.
 *
 * Supports:
 * - Default 1850 kcal daily cap (user configurable)
 * - Multimodal food analysis from meal photos (Gemini Vision / multimodal API)
 * - Natural language text meal parsing (DeepSeek / Gemini / nutritional database fallback)
 * - Macro estimation: Calories, Protein, Carbs, Fat
 * - Visual progress bars and polite professional-casual butler responses ("sir")
 */
import { config, hasDeepSeek } from './config.ts';
import { chatCompletion } from './deepseek.ts';

export const DEFAULT_CALORIE_CAP = 1850;

export interface MealItem {
  name: string;
  portion: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface CalorieAnalysis {
  meal_name: string;
  items: MealItem[];
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  confidence: 'high' | 'medium' | 'estimated';
  advice?: string;
}

export interface MealLog extends CalorieAnalysis {
  id: string;
  timestamp: string;
  time_label: string;
  source: 'text' | 'photo';
  raw_input: string;
}

export interface DailyCalorieData {
  date: string; // YYYY-MM-DD
  target_calories: number;
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  meals: MealLog[];
}

const NUTRITION_SYSTEM_PROMPT = `
You are an expert Clinical Nutritionist and Dietary AI Assistant for Emman ("sir").
His daily target intake is capped at 1850 kcal.

Your task:
Analyze the described meal or food items. Estimate portions, total calories (kcal), and macronutrients (Protein, Carbs, Fat in grams).
Be realistic, accurate, and practical with standard Asian/Western food portions and cooking oils.

Return ONLY a strict JSON object with this exact structure:
{
  "meal_name": "Short 2-4 word meal title (e.g. Grilled Chicken with Rice & Eggs)",
  "items": [
    {
      "name": "Food item name",
      "portion": "e.g. 1 cup / 150g / 2 pieces",
      "calories": 200,
      "protein_g": 20,
      "carbs_g": 30,
      "fat_g": 5
    }
  ],
  "total_calories": 450,
  "total_protein_g": 35,
  "total_carbs_g": 40,
  "total_fat_g": 12,
  "confidence": "high" | "medium" | "estimated",
  "advice": "1 brief sentence with practical nutritional note or encouragement"
}
`;

/** Rule-based heuristic fallback if AI is offline */
function fallbackCalorieAnalysis(text: string): CalorieAnalysis {
  const lower = text.toLowerCase();
  const items: MealItem[] = [];

  // Common food heuristics
  if (lower.includes('egg') || lower.includes('eggs')) {
    const qty = lower.includes('2') ? 2 : lower.includes('3') ? 3 : 1;
    items.push({ name: 'Eggs', portion: `${qty} piece(s)`, calories: 75 * qty, protein_g: 6 * qty, carbs_g: 1 * qty, fat_g: 5 * qty });
  }
  if (lower.includes('rice')) {
    const qty = lower.includes('2') ? 2 : 1;
    items.push({ name: 'White Rice', portion: `${qty} cup(s)`, calories: 205 * qty, protein_g: 4 * qty, carbs_g: 45 * qty, fat_g: 0.5 * qty });
  }
  if (lower.includes('chicken') || lower.includes('breast')) {
    items.push({ name: 'Chicken Breast', portion: '150g cooked', calories: 220, protein_g: 38, carbs_g: 0, fat_g: 5 });
  }
  if (lower.includes('beef') || lower.includes('steak') || lower.includes('burger')) {
    items.push({ name: 'Beef / Burger patty', portion: '1 serving', calories: 320, protein_g: 26, carbs_g: 0, fat_g: 22 });
  }
  if (lower.includes('fish') || lower.includes('salmon') || lower.includes('tuna')) {
    items.push({ name: 'Fish / Seafood', portion: '1 fillet/can', calories: 190, protein_g: 28, carbs_g: 0, fat_g: 7 });
  }
  if (lower.includes('pizza')) {
    const qty = lower.includes('2') ? 2 : 1;
    items.push({ name: 'Pizza Slice', portion: `${qty} slice(s)`, calories: 280 * qty, protein_g: 12 * qty, carbs_g: 32 * qty, fat_g: 10 * qty });
  }
  if (lower.includes('coffee') || lower.includes('latte')) {
    items.push({ name: 'Coffee / Latte', portion: '1 cup', calories: 120, protein_g: 4, carbs_g: 10, fat_g: 4 });
  }
  if (lower.includes('bread') || lower.includes('toast')) {
    items.push({ name: 'Bread / Toast', portion: '2 slices', calories: 160, protein_g: 6, carbs_g: 28, fat_g: 2 });
  }

  if (items.length === 0) {
    items.push({
      name: text.slice(0, 40) || 'Standard Meal',
      portion: '1 standard serving',
      calories: 450,
      protein_g: 25,
      carbs_g: 45,
      fat_g: 15,
    });
  }

  const total_calories = items.reduce((sum, i) => sum + i.calories, 0);
  const total_protein_g = items.reduce((sum, i) => sum + i.protein_g, 0);
  const total_carbs_g = items.reduce((sum, i) => sum + i.carbs_g, 0);
  const total_fat_g = items.reduce((sum, i) => sum + i.fat_g, 0);

  return {
    meal_name: text.split('\n')[0].slice(0, 50) || 'Logged Meal',
    items,
    total_calories,
    total_protein_g,
    total_carbs_g,
    total_fat_g,
    confidence: 'estimated',
    advice: 'Estimated from standard nutritional database.',
  };
}

/** Analyze meal from text description */
export async function analyzeMealText(text: string): Promise<CalorieAnalysis> {
  if (!hasDeepSeek()) {
    return fallbackCalorieAnalysis(text);
  }

  try {
    const raw = await chatCompletion([
      { role: 'system', content: NUTRITION_SYSTEM_PROMPT.trim() },
      { role: 'user', content: `Please analyze this meal eaten by sir:\n\n"${text}"` },
    ]);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in nutrition response');
    const parsed = JSON.parse(jsonMatch[0]) as CalorieAnalysis;

    if (!parsed.items || parsed.items.length === 0) {
      throw new Error('No items parsed');
    }

    return {
      meal_name: parsed.meal_name || 'Meal',
      items: parsed.items,
      total_calories: Number(parsed.total_calories) || parsed.items.reduce((s, i) => s + (i.calories || 0), 0),
      total_protein_g: Number(parsed.total_protein_g) || parsed.items.reduce((s, i) => s + (i.protein_g || 0), 0),
      total_carbs_g: Number(parsed.total_carbs_g) || parsed.items.reduce((s, i) => s + (i.carbs_g || 0), 0),
      total_fat_g: Number(parsed.total_fat_g) || parsed.items.reduce((s, i) => s + (i.fat_g || 0), 0),
      confidence: parsed.confidence || 'medium',
      advice: parsed.advice || 'Nutritional breakdown computed.',
    };
  } catch (err) {
    console.warn('AI meal analysis failed, using fallback:', err);
    return fallbackCalorieAnalysis(text);
  }
}

/** Analyze meal from an image buffer using Gemini Vision REST API or Multimodal */
export async function analyzeMealPhoto(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg',
  caption?: string
): Promise<CalorieAnalysis> {
  const base64Data = imageBuffer.toString('base64');
  const geminiKey = process.env.GEMINI_API_KEY || '';

  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const userPrompt = caption
        ? `Please identify the food in this picture and analyze calories/macros. Caption from sir: "${caption}". Follow the JSON format strictly.`
        : `Please identify the food in this picture and analyze calories/macros for sir. Follow the JSON format strictly.`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: NUTRITION_SYSTEM_PROMPT },
                { text: userPrompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (response.ok) {
        const json = (await response.json()) as any;
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text) as CalorieAnalysis;
          return {
            meal_name: parsed.meal_name || 'Photo Meal',
            items: parsed.items || [],
            total_calories: Number(parsed.total_calories) || 0,
            total_protein_g: Number(parsed.total_protein_g) || 0,
            total_carbs_g: Number(parsed.total_carbs_g) || 0,
            total_fat_g: Number(parsed.total_fat_g) || 0,
            confidence: 'high',
            advice: parsed.advice || 'Estimated visually from meal photo.',
          };
        }
      }
    } catch (err) {
      console.warn('Gemini vision analysis failed:', err);
    }
  }

  // If caption is present or fallback
  if (caption && caption.trim()) {
    return analyzeMealText(caption);
  }

  return {
    meal_name: 'Meal Photo',
    items: [{ name: 'Plate of food (visual estimate)', portion: '1 standard meal', calories: 520, protein_g: 28, carbs_g: 50, fat_g: 18 }],
    total_calories: 520,
    total_protein_g: 28,
    total_carbs_g: 50,
    total_fat_g: 18,
    confidence: 'estimated',
    advice: 'Visual estimate. You can also specify food items in the caption for exact precision, sir.',
  };
}

/** Generate visual ASCII progress bar */
export function generateProgressBar(current: number, target: number, barLength = 12): string {
  const percent = Math.min(100, Math.max(0, (current / target) * 100));
  const filled = Math.round((percent / 100) * barLength);
  const empty = Math.max(0, barLength - filled);
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.round(percent)}%`;
}

/** Format polite butler Telegram meal logged confirmation */
export function formatMealLoggedCard(
  meal: MealLog,
  daily: DailyCalorieData
): string {
  const target = daily.target_calories || DEFAULT_CALORIE_CAP;
  const remaining = target - daily.total_calories;
  const progressBar = generateProgressBar(daily.total_calories, target, 10);
  const statusEmoji = remaining >= 0 ? '🟢' : '🔴';

  const itemsList = meal.items
    .map(
      (item) =>
        `• *${item.name}* (${item.portion}) — \`${item.calories} kcal\`\n  _(P: ${item.protein_g}g · C: ${item.carbs_g}g · F: ${item.fat_g}g)_`
    )
    .join('\n');

  return [
    `🍽 *Meal Logged, Sir.*`,
    `📌 *${meal.meal_name}* (${meal.time_label})`,
    '',
    `🧾 *Nutritional Breakdown:*`,
    itemsList,
    '',
    `📊 *Meal Total:* \`${meal.total_calories} kcal\` | *P:* \`${meal.total_protein_g}g\` | *C:* \`${meal.total_carbs_g}g\` | *F:* \`${meal.total_fat_g}g\``,
    '',
    `━━━━━━━━━━━━━━━━━━━━`,
    `🎯 *Today's Intake Status:*`,
    `${progressBar} \`${daily.total_calories} / ${target} kcal\``,
    remaining >= 0
      ? `${statusEmoji} *${remaining} kcal remaining* for today.`
      : `⚠️ *Over cap by ${Math.abs(remaining)} kcal* for today.`,
    `💪 *Daily Macros so far:* P: \`${daily.total_protein_g}g\` · C: \`${daily.total_carbs_g}g\` · F: \`${daily.total_fat_g}g\``,
    '',
    meal.advice ? `💡 _Note: ${meal.advice}_\n` : '',
    `_Logged to your private Obsidian calorie ledger, sir._`,
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}

/** Format daily summary status card */
export function formatDailyCalorieSummary(daily: DailyCalorieData): string {
  const target = daily.target_calories || DEFAULT_CALORIE_CAP;
  const remaining = target - daily.total_calories;
  const progressBar = generateProgressBar(daily.total_calories, target, 12);
  const statusEmoji = remaining >= 0 ? '🟢' : '🔴';

  const mealsList =
    daily.meals.length > 0
      ? daily.meals
          .map(
            (m, i) =>
              `${i + 1}. \`[${m.time_label}]\` *${m.meal_name}* — \`${m.total_calories} kcal\` (P: ${m.total_protein_g}g, C: ${m.total_carbs_g}g, F: ${m.total_fat_g}g)`
          )
          .join('\n')
      : '_No meals logged yet today, sir._';

  return [
    `🥗 *Daily Calorie Ledger — ${daily.date}*`,
    '',
    `🎯 *Target Cap:* \`${target} kcal\``,
    `📊 *Current Intake:* \`${daily.total_calories} kcal\` (${progressBar})`,
    remaining >= 0
      ? `${statusEmoji} *Remaining:* \`${remaining} kcal\` available.`
      : `⚠️ *Status:* \`Exceeded by ${Math.abs(remaining)} kcal\``,
    '',
    `💪 *Macronutrients Total:*`,
    `• Protein: \`${daily.total_protein_g}g\` | Carbs: \`${daily.total_carbs_g}g\` | Fat: \`${daily.total_fat_g}g\``,
    '',
    `📋 *Meals Logged Today (${daily.meals.length}):*`,
    mealsList,
    '',
    `_Send a food photo or text (e.g. "/eat 2 eggs and rice") to log your next meal, sir._`,
  ].join('\n');
}
