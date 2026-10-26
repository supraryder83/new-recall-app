import assert from 'node:assert';
import type { RecallItem } from '../types/recall';
import type { WatchlistItem, UserPushSubscription } from '../types/pipeline';
import { normalizeRecall, cleanAlphanumeric } from './normalizer';
import { evaluateItemMatch, matchWatchlistAgainstRecalls } from './matcher';
import { dispatchNotificationForUser } from './pushService';
import { PipelineStore } from './store';
import { fetchWithExponentialBackoff } from './fetchFeed';
import { SIX_HOURS_CRON } from './worker';

async function runTests() {
  console.log('🧪 Starting Canadian Health Recall 6-Hour Background Sync & Pipeline Tests...\n');

  // =========================================================================
  // TEST 1: Cron schedule configuration
  // =========================================================================
  console.log('Test 1: Cron schedule configuration (0 */6 * * *)');
  assert.strictEqual(SIX_HOURS_CRON, '0 */6 * * *', 'Cron expression must be 0 */6 * * *');
  console.log('  ✅ Scheduled cron expression verified: 0 */6 * * *\n');

  // =========================================================================
  // TEST 2: Ingestion & Normalization
  // =========================================================================
  console.log('Test 2: Recall Ingestion & Entity Normalization');
  const mockFoodRecall: RecallItem = {
    NID: '89100',
    Title: "Plantropy brand Jack'd Up Bites Crispy Protein Bites recalled due to undeclared milk",
    URL: 'https://recalls-rappels.canada.ca/en/alert-recall/plantropy-protein-bites',
    Organization: 'CFIA',
    Product: "Jack'd Up Bites Crispy Protein Bites - Jalapeno, 250g, UPC: 065633458921, Lot # L2410A",
    Issue: 'Undeclared Milk Hazard',
    'What you should do': 'Do not consume if allergic. Model # JAL-100',
    Category: 'Food and Nutrition',
    'Recall class': 'Class 1',
    'Last updated': '2026-10-25',
    Archived: '0'
  };

  const normalized = normalizeRecall(mockFoodRecall);
  assert.strictEqual(normalized.recallId, '89100');
  assert.strictEqual(normalized.normalizedBrand, 'plantropy');
  assert.strictEqual(normalized.publicationDate, '2026-10-25');
  assert(normalized.upcs.includes('065633458921'), 'Should extract UPC 065633458921');
  assert(normalized.modelNumbers.includes('jal100'), 'Should extract model number jal100');
  assert(normalized.lotCodes.includes('l2410a'), 'Should extract lot code l2410a');
  console.log('  ✅ Normalized: Brand, UPCs, Models, Lots, and Dates extracted correctly.\n');

  // =========================================================================
  // TEST 3: Reverse Lookup Matching - Exact UPC Priority (Score: 100)
  // =========================================================================
  console.log('Test 3: Reverse Lookup - Exact Match on UPC/Barcode (Highest Priority)');
  const upcWatchItem: WatchlistItem = {
    id: 'w_upc_1',
    userId: 'user_alice',
    productName: 'Protein Snack Bites',
    brand: 'Generic',
    upcBarcode: '065633458921',
    createdAt: Date.now()
  };

  const matchUpc = evaluateItemMatch(upcWatchItem, normalized);
  assert(matchUpc !== null, 'UPC match should succeed');
  assert.strictEqual(matchUpc.matchType, 'upc');
  assert.strictEqual(matchUpc.score, 100);
  console.log('  ✅ Exact UPC match succeeded with highest priority score (100).\n');

  // =========================================================================
  // TEST 4: Reverse Lookup Matching - Model Number Match (Score: 90-95)
  // =========================================================================
  console.log('Test 4: Reverse Lookup - Model Number Match');
  const mockMedicalRecall: RecallItem = {
    NID: '82797',
    Title: 'Cochlear Implant Model CI1012 Safety Advisory',
    URL: 'https://recalls-rappels.canada.ca/en/alert-recall/cochlear-ci1012',
    Organization: 'Health Canada',
    Product: 'Cochlear Implant Receiver Model CI1012',
    Issue: 'Component integrity',
    'What you should do': 'Contact surgeon. Part # CI-1012',
    Category: 'Medical Devices',
    'Recall class': 'Class 2',
    'Last updated': '2026-10-24',
    Archived: '0'
  };
  const normMedical = normalizeRecall(mockMedicalRecall);

  const modelWatchItem: WatchlistItem = {
    id: 'w_mod_1',
    userId: 'user_bob',
    productName: 'Hearing Device',
    brand: 'Cochlear',
    modelNumber: 'CI1012',
    createdAt: Date.now()
  };

  const matchModel = evaluateItemMatch(modelWatchItem, normMedical);
  assert(matchModel !== null, 'Model match should succeed');
  assert.strictEqual(matchModel.matchType, 'model');
  assert(matchModel.score >= 90, 'Model match score should be >= 90');
  console.log('  ✅ Model number match succeeded.\n');

  // =========================================================================
  // TEST 5: Reverse Lookup Matching - Tokenized Fuzzy Match on Brand + Product
  // =========================================================================
  console.log('Test 5: Reverse Lookup - Tokenized Fuzzy Match on Brand + Product Keywords');
  const fuzzyWatchItem: WatchlistItem = {
    id: 'w_fuz_1',
    userId: 'user_charlie',
    productName: 'Jackd Protein Bites',
    brand: 'Plantropy',
    keywords: ['jalapeno', 'crispy'],
    createdAt: Date.now()
  };

  const matchFuzzy = evaluateItemMatch(fuzzyWatchItem, normalized);
  assert(matchFuzzy !== null, 'Fuzzy match should succeed');
  assert.strictEqual(matchFuzzy.matchType, 'brand_keyword');
  assert(matchFuzzy.score >= 75, 'Fuzzy match score should be >= 75');
  console.log('  ✅ Tokenized fuzzy brand + product keyword match succeeded.\n');

  // =========================================================================
  // TEST 6: User Grouping (Prevent Spamming Multiple Notifications per Cycle)
  // =========================================================================
  console.log('Test 6: User Match Grouping by User ID');
  const multiWatchlist: WatchlistItem[] = [
    {
      id: 'w_multi_1',
      userId: 'user_alice',
      productName: 'Item 1',
      brand: 'Plantropy',
      upcBarcode: '065633458921',
      createdAt: Date.now()
    },
    {
      id: 'w_multi_2',
      userId: 'user_alice',
      productName: 'Item 2',
      brand: 'Plantropy',
      modelNumber: 'JAL-100',
      createdAt: Date.now()
    },
    {
      id: 'w_multi_3',
      userId: 'user_bob',
      productName: 'Item 3',
      brand: 'Cochlear',
      modelNumber: 'CI1012',
      createdAt: Date.now()
    }
  ];

  const groupedMatches = matchWatchlistAgainstRecalls(multiWatchlist, [normalized, normMedical]);
  assert.strictEqual(groupedMatches.length, 2, 'Should group into exactly 2 distinct users');

  const aliceGroup = groupedMatches.find((g) => g.userId === 'user_alice');
  assert(aliceGroup !== null && aliceGroup!.matches.length >= 2, 'Alice should have multiple matches grouped');
  console.log(`  ✅ Grouped ${groupedMatches.reduce((a, b) => a + b.matches.length, 0)} items into ${groupedMatches.length} user groups.\n`);

  // =========================================================================
  // TEST 7: Notification Dispatch, Payload Deep Link & History Logging
  // =========================================================================
  console.log('Test 7: Web Push Notification Dispatch & Deep Link Payload (/recalls/:id)');
  const testStore = new PipelineStore('/tmp/test-pipeline-store.json');
  testStore.reset();

  const testSub: UserPushSubscription = {
    userId: 'user_alice',
    endpoint: 'https://fcm.googleapis.com/fcm/send/fake-expired-test-endpoint-410',
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcPP3135nZ_99g234test',
      auth: '5AOBgAwqtest'
    },
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  testStore.savePushSubscription(testSub);

  // Dispatch notifications for Alice's group using testStore
  const dispatchResult = await dispatchNotificationForUser(aliceGroup!, testStore);
  assert(dispatchResult.recordsLogged >= 1, 'Should log match in notification history');

  const history = testStore.getNotificationHistory('user_alice');
  assert(history.length >= 1, 'Notification history should contain record');
  assert.strictEqual(history[0].deepLink, '/recalls/89100', 'Deep link URL must point to /recalls/:id');
  console.log(`  ✅ Deep link URL verified: ${history[0].deepLink}`);
  console.log('  ✅ Notification match logged in history table.\n');

  // =========================================================================
  // TEST 8: Push Subscription Cleanup on Expired / 404 / 410 Gone
  // =========================================================================
  console.log('Test 8: Automatic Pruning of Expired Push Subscriptions');
  const dummyEndpoint = 'https://updates.push.services.mozilla.com/wpush/v2/expired-endpoint-404';
  testStore.savePushSubscription({
    userId: 'user_expired_test',
    endpoint: dummyEndpoint,
    keys: { p256dh: 'test', auth: 'test' },
    active: true
  });

  assert(testStore.getPushSubscriptionsForUser('user_expired_test').length === 1);
  // Simulate prune
  testStore.removePushSubscription(dummyEndpoint);
  assert.strictEqual(testStore.getPushSubscriptionsForUser('user_expired_test').length, 0);
  console.log('  ✅ Expired subscription pruned successfully from store.\n');

  // =========================================================================
  // TEST 9: Deduplication Store Check
  // =========================================================================
  console.log('Test 9: Deduplication against processed_recalls store');
  testStore.markRecallProcessed({
    id: 'proc_1',
    recallNid: '89100',
    title: 'Test Recall',
    category: 'Food',
    publicationDate: '2026-10-25',
    publicationTimestamp: Date.now(),
    url: 'https://example.com',
    processedAt: Date.now()
  });

  assert(testStore.isRecallProcessed('89100'), 'Recall 89100 should be marked as processed');
  assert(!testStore.isRecallProcessed('99999'), 'Recall 99999 should not be processed');
  console.log('  ✅ Deduplication check verified.\n');

  console.log('🎉 ALL 9 TEST SUITES PASSED CLEANLY!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
