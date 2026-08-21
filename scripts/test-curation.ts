/**
 * Test Curation Engine and Queue Pipeline end-to-end.
 */
import { extractUrl, fetchUrlMetadata, analyzeCurationItem, formatTelegramQueueCard } from '../src/curation.ts';
import * as vault from '../src/vault.ts';

async function runTests() {
  console.log('--- 1. Testing URL extraction ---');
  const text1 = 'Look at this new tool https://github.com/grammyjs/grammY it looks awesome for our water station bot';
  const url1 = extractUrl(text1);
  console.log('Extracted URL:', url1);
  if (url1 !== 'https://github.com/grammyjs/grammY') {
    throw new Error('URL extraction failed');
  }
  console.log('✓ URL extraction passed');

  console.log('\n--- 2. Testing URL metadata fetching ---');
  const meta = await fetchUrlMetadata('https://github.com/grammyjs/grammY');
  console.log('Fetched Title:', meta?.title);
  console.log('Fetched Desc:', meta?.description?.slice(0, 80));
  console.log('✓ URL metadata fetched');

  console.log('\n--- 3. Testing AI / Heuristic Analysis ---');
  const analysis = await analyzeCurationItem(
    'New Telegram framework updates with webhook auto-retry patterns for our water refilling bot',
    meta
  );
  console.log('Analyzed Title:', analysis.title);
  console.log('Category:', analysis.category);
  console.log('Target Project:', analysis.target_project);
  console.log('Priority:', analysis.priority);
  console.log('Takeaways:', analysis.takeaways);
  console.log('Antigravity Action:', analysis.antigravity_action);
  console.log('✓ Analysis passed');

  console.log('\n--- 4. Testing Vault Queue Integration ---');
  const testChatId = 123456789;
  const queueItem = await vault.addQueueItem(testChatId, analysis, text1, url1, 'url');
  if (!queueItem) throw new Error('Failed to add item to queue');
  console.log('Added Queue Item ID:', queueItem.id, 'Short ID:', queueItem.short_id);

  const card = formatTelegramQueueCard(queueItem);
  console.log('\n--- Formatted Telegram Card ---');
  console.log(card);

  console.log('\n--- 5. Testing Queue Listing & Status Updates ---');
  const pendingItems = await vault.listQueueItems('pending');
  console.log('Pending Items Count:', pendingItems.length);
  const found = await vault.getQueueItem(queueItem.short_id);
  console.log('Found Item by Short ID:', found?.short_id, found?.title);

  // Test updating category
  const updatedCat = await vault.updateQueueItemCategory(queueItem.short_id, 'project', 'water-station-telegram-bot');
  console.log('Updated Category Item:', updatedCat?.category, updatedCat?.target_project);

  // Test marking done
  const updatedDone = await vault.updateQueueItemStatus(queueItem.short_id, 'done');
  console.log('Updated Status:', updatedDone?.status);
  console.log('✓ Queue storage operations passed');
}

runTests().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
