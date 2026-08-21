/**
 * Test autonomous natural language intent classification.
 */
import { classifyIntent } from '../src/intent.ts';

const testMessages = [
  'Had 2 scrambled eggs, 1 cup of white rice, and 150g chicken breast for lunch',
  'How many calories do I have left today?',
  'https://github.com/fastapi/fastapi Awesome Python web framework for our report generator',
  'Remind me to check the database logs at 5pm',
  'Note down: Remember to update the Supabase pooler connection string #dev',
  'Give me my morning briefing please',
  'What is the best way to handle agent memory in Antigravity?',
];

async function run() {
  console.log('--- Testing Autonomous Intent Router ---');
  for (const msg of testMessages) {
    const res = await classifyIntent(msg);
    console.log(`\nInput: "${msg}"`);
    console.log(`👉 Intent: [${res.intent}] (confidence: ${res.confidence})`);
    if (res.extracted) {
      console.log('   Extracted:', JSON.stringify(res.extracted));
    }
  }
  console.log('\n✓ Intent routing test passed!');
}

run().catch((e) => {
  console.error('Intent test failed:', e);
  process.exit(1);
});
