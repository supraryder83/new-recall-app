import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  Search,
  ChevronDown,
  Camera,
  BellRing
} from 'lucide-react';
import type { RecallItem, CategoryFilter, DatasetSyncState, ScanHistoryItem } from './types/recall';
import {
  filterRecalls,
  loadInstantCachedRecalls
} from './services/recallData';
import { recallStorage } from './services/storage';
import {
  initAppOpenHistoryMonitor,
  updateDatabaseAndCheckHistory,
  getLastDatabaseSyncTime,
  requestRecallNotificationPermission,
  getProductVariationGrouping
} from './services/historyMonitor';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { SearchAndFilters } from './components/SearchAndFilters';
import { RecallCard } from './components/RecallCard';
import { RecallDetailModal } from './components/RecallDetailModal';
import { ScannerModal } from './components/ScannerModal';
import { InstallPromptBanner } from './components/InstallPromptBanner';
import { BottomNavBar, type MobileTab } from './components/BottomNavBar';
import { CategoriesView } from './components/CategoriesView';
import { SettingsView } from './components/SettingsView';
import { HistoryView } from './components/HistoryView';
import { EmergencyRecallModal } from './components/EmergencyRecallModal';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import { LegalModal } from './components/LegalModal';
import { playRecallAlarmSound } from './services/alarmSound';
import { syncScanHistoryToBackendWatchlist } from './services/pipelineClient';
import { getScanHistory } from './services/scanHistory';
import {
  isRecallNotificationAcknowledged,
  acknowledgeRecallNotification
} from './services/historyMonitor';

const ITEMS_PER_PAGE = 30;

export const App: React.FC = () => {
  // Navigation tab state (Shared between mobile bottom nav & desktop sidebar)
  const [currentTab, setCurrentTab] = useState<MobileTab>('feed');

  // Initial app loading screen state (lasts until recall database update and scan history check complete)
  const [isInitialAppLoading, setIsInitialAppLoading] = useState(true);

  // Legal modal state (Privacy Policy & Terms of Service)
  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<'privacy' | 'terms'>('privacy');

  const handleOpenLegal = (tab: 'privacy' | 'terms' = 'privacy') => {
    setLegalModalTab(tab);
    setLegalModalOpen(true);
  };

  // Dataset state
  const [allRecalls, setAllRecalls] = useState<RecallItem[]>([]);
  const [syncState, setSyncState] = useState<DatasetSyncState>({
    status: 'loading',
    lastSynced: null,
    totalRecords: 0,
    source: 'live'
  });
  const [loadingProgress, setLoadingProgress] = useState('Loading Canadian recall database...');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('ALL');
  const [selectedClass, setSelectedClass] = useState('ALL');
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);

  // Modals state
  const [selectedRecall, setSelectedRecall] = useState<RecallItem | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // PWA Install state
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  // Listen for PWA beforeinstallprompt
  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBanner(false);
      setDeferredPrompt(null);
    }
  };

  // Safety monitoring recall alerts (detected in scan history by 6-hour check)
  const [monitoringAlerts, setMonitoringAlerts] = useState<
    { historyItem: ScanHistoryItem; recall: RecallItem }[]
  >([]);

  // Emergency Recall Alert Modal state (plays siren and displays recall info)
  const [emergencyAlertItem, setEmergencyAlertItem] = useState<{
    historyItem: ScanHistoryItem;
    recall: RecallItem;
  } | null>(null);

  // Group monitoring alerts by product line/variations so variations are grouped together
  const groupedAlertSummary = useMemo(() => {
    if (monitoringAlerts.length === 0) return [];
    const groups = new Map<
      string,
      { baseTitle: string; variations: string[]; recalls: RecallItem[] }
    >();
    for (const { historyItem, recall } of monitoringAlerts) {
      const { groupKey, baseTitle, variationName } = getProductVariationGrouping(historyItem);
      let g = groups.get(groupKey);
      if (!g) {
        g = { baseTitle, variations: [], recalls: [] };
        groups.set(groupKey, g);
      }
      if (!g.variations.includes(variationName)) {
        g.variations.push(variationName);
      }
      if (!g.recalls.some((r) => r.NID === recall.NID)) {
        g.recalls.push(recall);
      }
    }
    return Array.from(groups.values());
  }, [monitoringAlerts]);

  // Notification permission state (automatically prompted on site visit)
  const [notificationPermission, setNotificationPermission] = useState<string>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [dismissedNotificationBanner, setDismissedNotificationBanner] = useState(false);

  // Automatically ask for notification permissions as soon as the user goes to the site
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        requestRecallNotificationPermission()
          .then((perm) => {
            if (perm !== 'unsupported') {
              setNotificationPermission(perm);
            }
          })
          .catch((err) => {
            console.warn('Automatic notification permission request error:', err);
          });
      }
    }
  }, []);

  const handleEnableNotifications = async () => {
    const perm = await requestRecallNotificationPermission();
    if (perm !== 'unsupported') {
      setNotificationPermission(perm);
    }
  };

  // Load Data & Update Database on App Open (only syncs once every 6 hours)
  const loadData = useCallback(async (forceRefresh = false) => {
    setSyncState((prev) => ({ ...prev, status: 'loading', errorMessage: undefined }));

    try {
      if (forceRefresh) {
        const syncRes = await updateDatabaseAndCheckHistory((step) => setLoadingProgress(step), true);
        const updated = await recallStorage.getAllRecalls();
        setAllRecalls(updated.length > 0 ? updated : []);
        setSyncState({
          status: 'cached',
          lastSynced: syncRes.timestamp,
          totalRecords: syncRes.recallsCount,
          source: (syncRes.source as any) || 'live'
        });
      } else {
        // Fast path: load cached data first so UI renders instantly behind splash
        const instant = await loadInstantCachedRecalls();
        const lastSync = getLastDatabaseSyncTime() || Date.now();
        if (instant && instant.data.length > 0) {
          setAllRecalls(instant.data);
          setSyncState({
            status: 'cached',
            lastSynced: lastSync,
            totalRecords: instant.count,
            source: instant.source
          });
        }

        // Only syncs from network if 6 hours have passed since last sync (force = false)
        const syncRes = await updateDatabaseAndCheckHistory((step) => setLoadingProgress(step), false);
        if (syncRes.recallsCount > 0) {
          const updated = await recallStorage.getAllRecalls();
          if (updated.length > 0) {
            setAllRecalls(updated);
            setSyncState({
              status: 'cached',
              lastSynced: syncRes.timestamp,
              totalRecords: syncRes.recallsCount,
              source: (syncRes.source as any) || 'live'
            });
          }
        }

        // If newly recalled items detected on open, display recall info and sound alarm (unless already acknowledged)
        if (syncRes.newlyRecalledCount > 0 && syncRes.newlyRecalledItems.length > 0) {
          const unacked = syncRes.newlyRecalledItems.find(
            ({ historyItem, recall }) => !isRecallNotificationAcknowledged(historyItem.id, recall)
          );
          if (unacked) {
            setEmergencyAlertItem(unacked);
            playRecallAlarmSound(15);
          }
        }
      }
    } catch (err: any) {
      console.warn('App open database update error:', err);
      // Fallback: load any existing cached data
      const existing = await recallStorage.getAllRecalls();
      if (existing.length > 0) {
        setAllRecalls(existing);
        setSyncState({
          status: 'cached',
          lastSynced: getLastDatabaseSyncTime() || Date.now(),
          totalRecords: existing.length,
          source: 'indexeddb'
        });
      } else {
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: err?.message || 'Error downloading Canadian safety recalls.'
        }));
      }
    } finally {
      setIsInitialAppLoading(false);
    }
  }, []);

  // Update recall database and check scan history when the app is opened
  useEffect(() => {
    loadData(false);

    // Sync local scan history to server background worker's watchlist so it monitors them for push notifications
    const history = getScanHistory();
    if (history.length > 0) {
      syncScanHistoryToBackendWatchlist(history).catch(() => {});

      // If user opens the app and has an active flagged recall in scan history, display info and sound alarm
      // UNLESS already acknowledged by the user (unless recall is new or expanded)
      const unacknowledgedFlagged = history
        .map((it) => {
          if (it.verdict !== 'MATCH_FOUND' || !it.matchedRecalls || it.matchedRecalls.length === 0) return null;
          const unackedRecall = it.matchedRecalls.find((rec) => !isRecallNotificationAcknowledged(it.id, rec));
          return unackedRecall ? { historyItem: it, recall: unackedRecall } : null;
        })
        .find(Boolean);

      if (unacknowledgedFlagged) {
        setEmergencyAlertItem(unacknowledgedFlagged);
        playRecallAlarmSound(15);
      }
    }

    // Initialize resume / focus monitor so returning to app checks for new recalls
    const cleanupMonitor = initAppOpenHistoryMonitor((updatedRecalls) => {
      setAllRecalls(updatedRecalls);
      setSyncState({
        status: 'cached',
        lastSynced: Date.now(),
        totalRecords: updatedRecalls.length,
        source: 'live'
      });
    });

    // Listen for recall alerts triggered by verification (filter out acknowledged notices)
    const handleRecallAlert = (e: any) => {
      const items = e.detail?.newlyRecalledItems;
      if (Array.isArray(items) && items.length > 0) {
        setMonitoringAlerts((prev) => [...items, ...prev]);
        const unackedItem = items.find(
          ({ historyItem, recall }: any) => !isRecallNotificationAcknowledged(historyItem.id, recall)
        );
        if (unackedItem) {
          setEmergencyAlertItem(unackedItem);
          playRecallAlarmSound(15);
        }
      }
    };

    window.addEventListener('recall-monitoring-alert', handleRecallAlert);

    return () => {
      cleanupMonitor();
      window.removeEventListener('recall-monitoring-alert', handleRecallAlert);
    };
  }, [loadData]);

  // Handle deep link routing for /recalls/:id (PWA Web Push notifications and direct links)
  useEffect(() => {
    const handleDeepLink = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/recalls\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        const recallNid = match[1];
        if (allRecalls.length > 0) {
          const found = allRecalls.find((r) => r.NID === recallNid);
          if (found) {
            setSelectedRecall(found);
            playRecallAlarmSound(12);
          }
        }
      }
    };

    handleDeepLink();
    window.addEventListener('popstate', handleDeepLink);
    return () => window.removeEventListener('popstate', handleDeepLink);
  }, [allRecalls]);

  const handleSelectRecall = (recall: RecallItem | null) => {
    setSelectedRecall(recall);
    if (recall) {
      if (window.location.pathname !== `/recalls/${recall.NID}`) {
        window.history.pushState(null, '', `/recalls/${recall.NID}`);
      }
    } else {
      if (window.location.pathname.startsWith('/recalls/')) {
        window.history.pushState(null, '', '/');
      }
    }
  };

  // Reset pagination when query or category changes
  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE);
  }, [searchQuery, selectedCategory, selectedClass]);

  // Filtered dataset
  const filteredRecalls = useMemo(() => {
    return filterRecalls(allRecalls, searchQuery, selectedCategory, selectedClass);
  }, [allRecalls, searchQuery, selectedCategory, selectedClass]);

  // Sliced items for smooth virtual pagination
  const visibleRecalls = useMemo(() => {
    return filteredRecalls.slice(0, displayCount);
  }, [filteredRecalls, displayCount]);

  const hasMore = displayCount < filteredRecalls.length;

  const handleLoadMore = () => {
    setDisplayCount((prev) => Math.min(prev + ITEMS_PER_PAGE, filteredRecalls.length));
  };

  return (
    <div className="min-h-screen bg-slate-100 flex text-slate-900 selection:bg-red-500 selection:text-white">
      {/* DESKTOP SIDEBAR (Visible on md and above) */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab)}
        onOpenScanner={() => setIsScannerOpen(true)}
        syncState={syncState}
        onRefreshFeed={() => loadData(true)}
        canInstallPwa={Boolean(deferredPrompt)}
        onInstallPwa={handleInstallPwa}
        onOpenLegal={handleOpenLegal}
      />

      {/* MAIN RESPONSIVE CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 min-h-screen overflow-x-hidden w-full max-w-full">
        {/* MOBILE TOP BAR (Visible on mobile only, hidden on md+) */}
        <div className="md:hidden">
          <Header
            syncState={syncState}
            onRefreshFeed={() => loadData(true)}
            canInstallPwa={Boolean(deferredPrompt)}
            onInstallPwa={handleInstallPwa}
            alertCount={monitoringAlerts.length}
            onOpenAlerts={() => {
              if (monitoringAlerts[0]?.recall) {
                setSelectedRecall(monitoringAlerts[0].recall);
              } else {
                setCurrentTab('history');
              }
            }}
            onOpenNotifications={() => {
              if (notificationPermission === 'default') {
                handleEnableNotifications();
              } else {
                setCurrentTab('history');
              }
            }}
            notificationsGranted={notificationPermission === 'granted'}
          />
        </div>

        {/* DESKTOP TOP BAR (Visible on md+) */}
        <div className="hidden md:flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30">
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <span>Canada Recall Alert</span>
              <span className="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                Live Feed
              </span>
            </h1>
            <p className="text-xs text-slate-500">
              Health Canada, CFIA & Transport Canada Official Notices
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Top Alert Icon (Prominently displayed at top of screen when recalls are detected) */}
            {monitoringAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (monitoringAlerts[0]?.recall) {
                    setSelectedRecall(monitoringAlerts[0].recall);
                  } else {
                    setCurrentTab('history');
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm animate-pulse active:scale-95"
                title={`${monitoringAlerts.length} Canadian recall alert(s) detected in scanned products`}
              >
                <AlertTriangle className="w-4 h-4 text-white" />
                <span>{monitoringAlerts.length} Recall Alert{monitoringAlerts.length > 1 ? 's' : ''}</span>
              </button>
            )}

            {/* Top Notification Bell Icon */}
            <button
              type="button"
              onClick={() => {
                if (notificationPermission === 'default') {
                  handleEnableNotifications();
                } else {
                  setCurrentTab('history');
                }
              }}
              className="relative p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all border border-slate-200/80 active:scale-95 flex items-center gap-1.5 text-xs font-semibold"
              title="Recall Notifications & Automatic Scan History Protection"
              aria-label="Recall Notifications"
            >
              <BellRing className="w-4 h-4 text-slate-700" />
              {notificationPermission === 'granted' && (
                <span className="w-2 h-2 bg-emerald-500 rounded-full" title="Notifications active" />
              )}
            </button>

            {/* Direct Scan CTA Button in desktop top bar */}
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Scan Item</span>
            </button>
          </div>
        </div>

        {/* MAIN BODY CONTENT */}
        <main className="flex-1 px-3.5 sm:px-6 py-4 space-y-4 max-w-6xl w-full mx-auto pb-24 md:pb-10 min-w-0 overflow-x-hidden">
          {/* PWA Install Banner */}
          {showInstallBanner && deferredPrompt && (
            <InstallPromptBanner
              onInstall={handleInstallPwa}
              onDismiss={() => setShowInstallBanner(false)}
            />
          )}

          {/* Automatic Site Visit Notification Permission Banner */}
          {notificationPermission === 'default' && !dismissedNotificationBanner && (
            <div className="bg-linear-to-r from-red-600 via-rose-600 to-red-700 text-white p-4 sm:p-5 rounded-3xl shadow-lg border border-red-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top duration-300">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 bg-white/20 rounded-2xl shrink-0">
                  <BellRing className="w-6 h-6 text-white animate-bounce-subtle" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-extrabold text-sm sm:text-base">
                      Enable Canadian Recall Notifications
                    </h4>
                    <span className="text-[10px] font-extrabold bg-white/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Auto-Monitored
                    </span>
                  </div>
                  <p className="text-xs text-red-100 mt-1 leading-relaxed">
                    Allow notifications to receive immediate alerts whenever the app updates if any product in your scan history is recalled by Health Canada, CFIA, or Transport Canada.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  className="px-4 py-2 bg-white text-red-700 hover:bg-red-50 text-xs font-extrabold rounded-xl transition-all shadow-xs active:scale-95"
                >
                  Allow Notifications
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedNotificationBanner(true)}
                  className="p-1.5 text-red-200 hover:text-white rounded-lg transition-colors"
                  title="Dismiss notification prompt"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Urgent Safety Recall Alert Banner */}
          {monitoringAlerts.length > 0 && (
            <div className="bg-red-600 text-white p-4 sm:p-5 rounded-3xl shadow-lg border border-red-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top duration-300">
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2.5 bg-white/20 rounded-2xl shrink-0 mt-0.5">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-extrabold text-sm sm:text-base">
                      🚨 Safety Recall Alert: Scanned Product Recalled!
                    </h4>
                    <span className="text-[10px] font-extrabold bg-white/20 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                      History Alert
                    </span>
                  </div>
                  <p className="text-xs text-red-100 mt-1 line-clamp-2 leading-relaxed">
                    {groupedAlertSummary && groupedAlertSummary.length === 1
                      ? groupedAlertSummary[0].variations.length > 1
                        ? `Active Canadian safety recall detected for ${groupedAlertSummary[0].baseTitle} affecting ${groupedAlertSummary[0].variations.length} scanned variations (${groupedAlertSummary[0].variations.slice(0, 3).join(', ')}).`
                        : `Your previously scanned item "${monitoringAlerts[0].historyItem.identifiedTitle}" matches an active Canadian safety recall: ${monitoringAlerts[0].recall.Title}`
                      : `${monitoringAlerts.length} products in your permanent scan history match active Canadian safety recalls.`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRecall(monitoringAlerts[0].recall);
                  }}
                  className="px-3.5 py-2 bg-white text-red-700 hover:bg-red-50 text-xs font-bold rounded-xl transition-all shadow-xs"
                >
                  View Notice
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTab('history');
                  }}
                  className="px-3.5 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-bold rounded-xl transition-all border border-red-500/40"
                >
                  View History
                </button>
                <button
                  type="button"
                  onClick={() => setMonitoringAlerts([])}
                  className="p-1.5 text-red-200 hover:text-white rounded-lg transition-colors"
                  title="Dismiss alert"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Non-blocking background sync toast */}
          {syncState.status === 'loading' && allRecalls.length > 0 && (
            <div className="py-2 px-3.5 bg-red-50 border border-red-200/80 rounded-2xl text-xs text-red-800 flex items-center justify-between animate-pulse">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-red-600 animate-spin" />
                <span>{loadingProgress || 'Updating Canadian safety notices in background...'}</span>
              </div>
              <span className="text-[10px] font-bold text-red-600 uppercase bg-white px-2 py-0.5 rounded-md border border-red-200">
                Syncing
              </span>
            </div>
          )}

          {/* TAB 1: ALERTS FEED */}
          {currentTab === 'feed' && (
            <div className="space-y-4">
              {/* Search & Category Filter Chips */}
              <SearchAndFilters
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
                selectedClass={selectedClass}
                onSelectClass={setSelectedClass}
                totalFiltered={filteredRecalls.length}
                totalDataset={allRecalls.length}
              />

              {/* Feed Initial Loading State (only if 0 recalls) */}
              {syncState.status === 'loading' && allRecalls.length === 0 ? (
                <div className="py-16 text-center space-y-3 bg-white rounded-3xl border border-slate-200/80 p-8 shadow-xs">
                  <div className="inline-flex p-3 bg-red-50 rounded-2xl text-red-600 animate-spin">
                    <RefreshCw className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">
                    Loading Canadian Safety Recalls...
                  </h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    {loadingProgress}
                  </p>
                </div>
              ) : syncState.status === 'error' && allRecalls.length === 0 ? (
                <div className="py-10 px-6 text-center bg-red-50/80 border border-red-200 rounded-3xl space-y-3">
                  <div className="inline-flex p-3 bg-red-600 text-white rounded-2xl shadow-sm">
                    <AlertTriangle className="w-7 h-7" />
                  </div>
                  <div className="max-w-md mx-auto space-y-1">
                    <h4 className="font-extrabold text-base text-red-950">Connection Notice</h4>
                    <p className="text-xs text-red-800 leading-relaxed">
                      {syncState.errorMessage || 'Unable to connect to the open safety feed.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadData(true)}
                    className="px-5 py-2.5 bg-red-600 text-white text-xs font-bold rounded-xl shadow-xs inline-flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Retry Sync</span>
                  </button>
                </div>
              ) : (
                /* RESPONSIVE CARDS GRID */
                <div className="space-y-4">
                  {filteredRecalls.length === 0 ? (
                    <div className="py-16 text-center bg-white rounded-3xl border border-slate-200/80 p-8 space-y-2 shadow-xs">
                      <div className="inline-flex p-3 bg-slate-100 rounded-2xl text-slate-400">
                        <Search className="w-7 h-7" />
                      </div>
                      <h4 className="font-bold text-base text-slate-800">No matching recall notices</h4>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Try modifying search terms, brand names, or resetting the category filter.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedCategory('ALL');
                          setSelectedClass('ALL');
                        }}
                        className="mt-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
                      >
                        Reset All Filters
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                        {visibleRecalls.map((recall) => (
                          <RecallCard
                            key={recall.NID}
                            recall={recall}
                            onClick={() => handleSelectRecall(recall)}
                          />
                        ))}
                      </div>

                      {/* Load More Button */}
                      {hasMore && (
                        <div className="pt-4 text-center">
                          <button
                            type="button"
                            onClick={handleLoadMore}
                            className="px-6 py-2.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded-2xl text-xs font-bold shadow-xs active:bg-slate-50 inline-flex items-center gap-2 transition-all"
                          >
                            <span>
                              Show More Recalls ({displayCount} of {filteredRecalls.length.toLocaleString()})
                            </span>
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CATEGORIES DIRECTORY */}
          {currentTab === 'categories' && (
            <CategoriesView
              recalls={allRecalls}
              onSelectCategory={(cat) => {
                setSelectedCategory(cat);
                setCurrentTab('feed');
              }}
              onSelectClass={(cls) => {
                setSelectedClass(cls);
                setCurrentTab('feed');
              }}
            />
          )}

          {/* TAB 3: SCAN HISTORY & MONITORED PRODUCTS */}
          {currentTab === 'history' && (
            <HistoryView
              recallsDataset={allRecalls}
              onOpenScanner={() => setIsScannerOpen(true)}
              onApplySearchQuery={(query) => {
                setSearchQuery(query);
                setCurrentTab('feed');
              }}
              onSelectRecall={(recall) => handleSelectRecall(recall)}
            />
          )}

          {/* TAB 4: SETTINGS */}
          {currentTab === 'settings' && (
            <SettingsView
              syncState={syncState}
              onRefreshFeed={() => loadData(true)}
              canInstallPwa={Boolean(deferredPrompt)}
              onInstallPwa={handleInstallPwa}
              onNavigateToHistory={() => setCurrentTab('history')}
              onOpenLegal={handleOpenLegal}
            />
          )}
        </main>

        {/* APP FOOTER WITH LEGAL & OWNERSHIP INFO */}
        <footer className="mt-auto py-8 px-5 border-t border-slate-200/80 bg-white/50 text-center text-xs text-slate-500 space-y-2.5 pb-24 md:pb-8">
          <p className="font-bold text-slate-700">
            Canada Recall Safety Registry & Product Verification
          </p>
          <p className="text-[11px] text-slate-400 max-w-xl mx-auto leading-relaxed">
            <strong>Open Data & Non-Endorsement Notice:</strong> Contains information licensed under the Open Government Licence – Canada. This site is independently owned and operated by <strong>Tyler Ziegler</strong> and is not endorsed by, sponsored by, or affiliated with Health Canada, CFIA, Transport Canada, or the Government of Canada.
          </p>
          <div className="flex items-center justify-center gap-3 text-[11px] text-slate-500 pt-1">
            <span>Site owned and operated by <strong className="text-slate-700">Tyler Ziegler</strong></span>
            <span>•</span>
            <button
              type="button"
              onClick={() => handleOpenLegal('privacy')}
              className="text-slate-600 hover:text-red-600 underline font-medium transition-colors"
            >
              Privacy Policy
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => handleOpenLegal('terms')}
              className="text-slate-600 hover:text-red-600 underline font-medium transition-colors"
            >
              Terms of Service
            </button>
          </div>
        </footer>

        {/* MOBILE BOTTOM NAVIGATION BAR (Hidden on md and above) */}
        <BottomNavBar
          currentTab={currentTab}
          onTabChange={(tab) => setCurrentTab(tab)}
          onOpenScanner={() => setIsScannerOpen(true)}
        />

        {/* MODALS */}
        <ScannerModal
          isOpen={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          recallsDataset={allRecalls}
          onSelectRecall={(recall) => handleSelectRecall(recall)}
          onApplySearchQuery={(query) => {
            setSearchQuery(query);
            setCurrentTab('feed');
          }}
        />

        <RecallDetailModal
          recall={selectedRecall}
          isOpen={Boolean(selectedRecall)}
          onClose={() => handleSelectRecall(null)}
        />

        {/* EMERGENCY RECALL ALERT MODAL (Plays alarm siren & displays recall info on open) */}
        {emergencyAlertItem && (
          <EmergencyRecallModal
            isOpen={Boolean(emergencyAlertItem)}
            onClose={() => setEmergencyAlertItem(null)}
            onAcknowledge={(historyItem, recall) => {
              acknowledgeRecallNotification(historyItem.id, recall);
              setEmergencyAlertItem(null);
            }}
            historyItem={emergencyAlertItem.historyItem}
            recall={emergencyAlertItem.recall}
            onNavigateToHistory={() => setCurrentTab('history')}
            onViewFullRecallNotice={(recall) => handleSelectRecall(recall)}
          />
        )}
        {/* INITIAL APP LOADING SCREEN WITH CANADIAN RECALL LOGO, DISCLAIMER & 4-SECOND PROGRESS BAR */}
        <AppLoadingScreen
          isLoading={isInitialAppLoading}
          onOpenLegal={handleOpenLegal}
        />

        {/* LEGAL MODAL (Privacy Policy & Terms of Service - Tyler Ziegler) */}
        <LegalModal
          isOpen={legalModalOpen}
          onClose={() => setLegalModalOpen(false)}
          initialTab={legalModalTab}
        />
      </div>
    </div>
  );
};

export default App;
