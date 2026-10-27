import type {
  PipelineSyncSummary,
  ProcessedRecallRecord
} from '../types/pipeline';
import { pipelineStore } from './store';
import { queryHealthCanadaFeed, type FetchOptions } from './fetchFeed';
import { normalizeRecallsBatch } from './normalizer';
import { matchWatchlistAgainstRecalls, type MatchOptions } from './matcher';
import { dispatchBatchNotifications } from './pushService';

export interface RunPipelineOptions extends FetchOptions, MatchOptions {}

/**
 * Executes one complete run of the 1-Hour Background Sync & Reverse-Lookup Notification Pipeline:
 * 1. Queries Health Canada feed with retry & exponential backoff
 * 2. Filters 24h window & deduplicates against processed_recalls
 * 3. Normalizes incoming recalls
 * 4. Reverse-lookups user watchlist (UPC exact, model substring/exact, brand+product fuzzy)
 * 5. Groups matches by user ID
 * 6. Dispatches Web Push notifications with deep links (/recalls/:id)
 * 7. Prunes expired push subscriptions (HTTP 404/410)
 * 8. Logs notification history and persists processed_recalls
 */
export async function runSyncPipeline(
  options: RunPipelineOptions = {}
): Promise<PipelineSyncSummary> {
  const startedAt = Date.now();
  const errors: string[] = [];

  console.log('='.repeat(70));
  console.log(`[Pipeline] Starting 1-Hour Background Sync Worker at ${new Date(startedAt).toISOString()}`);
  console.log('='.repeat(70));

  pipelineStore.updateWorkerState({ isRunning: true });

  let recordsQueried = 0;
  let recordsWithinWindow = 0;
  let recordsSkippedDeduplicated = 0;
  let recordsIngested = 0;
  let usersEvaluated = 0;
  let userMatchesFound = 0;
  let pushNotificationsDispatched = 0;
  let pushSubscriptionsPruned = 0;

  try {
    // 1. Fetch feed with exponential backoff & filter 24h & deduplicate
    const feedResult = await queryHealthCanadaFeed(options);
    recordsQueried = feedResult.allRecordsCount;
    recordsWithinWindow = feedResult.recordsInWindowCount;
    recordsSkippedDeduplicated = feedResult.deduplicatedCount;

    const rawNewRecalls = feedResult.newRecallsToProcess;
    recordsIngested = rawNewRecalls.length;

    console.log(
      `[Pipeline] Feed query successful. ${recordsIngested} new or updated recalls ready for processing.`
    );

    if (recordsIngested > 0) {
      // 2. Ingest & Normalize incoming batch
      const normalizedBatch = normalizeRecallsBatch(rawNewRecalls);

      // 3. Reverse Lookup Matching against user watchlist
      const allWatchlist = pipelineStore.getWatchlist();
      const distinctUsers = new Set(allWatchlist.map((w: any) => w.userId));
      usersEvaluated = distinctUsers.size;

      console.log(
        `[Pipeline] Running reverse-lookup matching across ${allWatchlist.length} watchlist item(s) for ${usersEvaluated} user(s)...`
      );

      const userMatchGroups = matchWatchlistAgainstRecalls(allWatchlist, normalizedBatch, options);
      userMatchesFound = userMatchGroups.reduce((acc: number, g: any) => acc + g.matches.length, 0);

      console.log(
        `[Pipeline] Matching complete: ${userMatchesFound} item match(es) grouped across ${userMatchGroups.length} user(s).`
      );

      // 4. Web Push Notification Dispatch & Pruning
      if (userMatchGroups.length > 0) {
        console.log(`[Pipeline] Dispatching Web Push notifications for matched users...`);
        const dispatchResult = await dispatchBatchNotifications(userMatchGroups);
        pushNotificationsDispatched = dispatchResult.totalDispatched;
        pushSubscriptionsPruned = dispatchResult.totalPruned;
        if (dispatchResult.errors.length > 0) {
          errors.push(...dispatchResult.errors);
        }
      }

      // 5. Deduplication storage: Record all ingested recall IDs in processed_recalls
      const processedRecords: ProcessedRecallRecord[] = normalizedBatch.map((nr: any) => ({
        id: `proc_${nr.recallId}_${Date.now()}`,
        recallNid: nr.recallId,
        title: nr.title,
        category: nr.category,
        publicationDate: nr.publicationDate,
        publicationTimestamp: nr.publicationTimestamp,
        url: nr.url,
        processedAt: Date.now()
      }));

      pipelineStore.markRecallsProcessedBatch(processedRecords);
      console.log(`[Pipeline] Marked ${processedRecords.length} recalls as processed in store.`);
    } else {
      console.log(`[Pipeline] No new recalls required processing in this cycle.`);
    }
  } catch (err: any) {
    const msg = `Pipeline execution error: ${err.message}`;
    console.error(`[Pipeline] ${msg}`);
    errors.push(msg);
  }

  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  const status: 'success' | 'partial' | 'error' =
    errors.length === 0 ? 'success' : pushNotificationsDispatched > 0 ? 'partial' : 'error';

  const summary: PipelineSyncSummary = {
    startedAt,
    finishedAt,
    durationMs,
    recordsQueried,
    recordsWithinWindow,
    recordsSkippedDeduplicated,
    recordsIngested,
    usersEvaluated,
    userMatchesFound,
    pushNotificationsDispatched,
    pushSubscriptionsPruned,
    errors,
    status
  };

  // Record summary and update worker state with next scheduled 1h timestamp
  pipelineStore.recordRunSummary(summary);

  console.log('='.repeat(70));
  console.log(
    `[Pipeline] Finished in ${durationMs}ms with status: ${status.toUpperCase()} | ` +
      `Ingested: ${recordsIngested} | Matches: ${userMatchesFound} | Dispatched: ${pushNotificationsDispatched}`
  );
  console.log('='.repeat(70));

  return summary;
}
