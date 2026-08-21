/**
 * Test 7am & 7pm briefing generator.
 */
import { generateBriefing } from '../src/briefing.ts';

async function testBriefings() {
  console.log('--- Testing 7:00 AM Morning Briefing ---');
  const morningText = await generateBriefing('morning');
  console.log(morningText);

  console.log('\n--- Testing 7:00 PM Evening Wrap-Up ---');
  const eveningText = await generateBriefing('evening');
  console.log(eveningText);
  console.log('\n✓ Briefing tests completed successfully');
}

testBriefings().catch((e) => {
  console.error('Briefing test error:', e);
  process.exit(1);
});
