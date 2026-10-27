import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import './env.ts';
import cron, { type ScheduledTask } from 'node-cron';
import { runSyncPipeline } from './pipeline.ts';
import { pipelineStore } from './store.ts';
import { initVapid } from './pushService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env from parent directory (e.g. deploy/.env)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const HOURLY_CRON = '0 * * * *';
export const SIX_HOURS_CRON = HOURLY_CRON; // Alias for backward compatibility

let scheduledTask: ScheduledTask | null = null;

/**
 * Starts the recurring 1-hour background sync worker.
 * Runs on cron schedule '0 * * * *' (cron: hourly at minute 0).
 */
export function startSyncWorker(options: { runOnStartupIfDue?: boolean } = {}): {
  stop: () => void;
  task: ScheduledTask;
} {
  initVapid();

  console.log(`[SyncWorker] Initializing 1-hour background sync worker (cron: '${HOURLY_CRON}')...`);

  // Update initial worker state
  const state = pipelineStore.getWorkerState();
  const nextRun = Date.now() + 1 * 60 * 60 * 1000;
  pipelineStore.updateWorkerState({
    cronExpression: HOURLY_CRON,
    nextRunAt: nextRun
  });

  // Check if due on startup (if never run or last run was > 1 hour ago)
  if (options.runOnStartupIfDue !== false) {
    const lastRun = state.lastRunAt;
    const oneHourMs = 1 * 60 * 60 * 1000;
    if (!lastRun || Date.now() - lastRun >= oneHourMs) {
      console.log(`[SyncWorker] Initial sync is due (last run: ${lastRun ? new Date(lastRun).toISOString() : 'Never'}). Triggering initial sync run...`);
      runSyncPipeline().catch((err: any) => {
        console.error('[SyncWorker] Error during initial startup sync:', err);
      });
    }
  }

  // Schedule cron: 0 * * * *
  scheduledTask = cron.schedule(
    HOURLY_CRON,
    async () => {
      console.log(`[SyncWorker] Cron trigger activated ('${HOURLY_CRON}'). Executing scheduled 1-hour sync...`);
      try {
        await runSyncPipeline();
      } catch (err) {
        console.error('[SyncWorker] Scheduled 1-hour sync failed:', err);
      }
    },
    {
      timezone: 'America/Toronto' // Standard Canadian Health Canada time zone
    }
  );

  console.log(`[SyncWorker] Background sync scheduled. Next estimated execution in ~1 hour.`);

  return {
    stop: () => {
      if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        console.log('[SyncWorker] 1-hour sync worker stopped.');
      }
    },
    task: scheduledTask
  };
}

// ==================== CLI RUNNER ====================
// If executed directly: tsx src/server/worker.ts
const isMain =
  (process.argv[1]?.endsWith('worker.ts') ||
   process.argv[1]?.endsWith('worker.js') ||
   process.argv[1]?.endsWith('worker.mjs')) &&
  !process.argv[1]?.includes('server');

if (isMain) {
  const args = process.argv.slice(2);
  const isRunOnce = args.includes('--run-once') || args.includes('-1');
  const isForceAll = args.includes('--force-all');
  const windowArg = args.find((a) => a.startsWith('--window-hours='));
  const customWindowHours = windowArg ? parseInt(windowArg.split('=')[1], 10) : undefined;

  console.log('='.repeat(70));
  console.log('🇨🇦 Health Canada 1-Hour Background Sync & Web Push Notification Worker');
  console.log('='.repeat(70));

  if (isRunOnce) {
    console.log('[CLI] Running single sync cycle and exiting (--run-once)...');
    runSyncPipeline({
      forceAll: isForceAll,
      windowHours: customWindowHours
    })
      .then((summary: any) => {
        console.log('[CLI] Sync completed successfully:', JSON.stringify(summary, null, 2));
        process.exit(0);
      })
      .catch((err: any) => {
        console.error('[CLI] Sync failed:', err);
        process.exit(1);
      });
  } else {
    // Daemon mode
    console.log('[CLI] Starting daemon in background mode with cron: 0 * * * *');
    const worker = startSyncWorker({ runOnStartupIfDue: true });

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n[CLI] Received termination signal. Shutting down worker...');
      worker.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}
