import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  Search,
  ChevronDown,
  Sparkles,
  Camera
} from 'lucide-react';
import type { RecallItem, CategoryFilter, DatasetSyncState } from './types/recall';
import { fetchRecallsData, filterRecalls } from './services/recallData';
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

const ITEMS_PER_PAGE = 30;

export const App: React.FC = () => {
  // Navigation tab state (Shared between mobile bottom nav & desktop sidebar)
  const [currentTab, setCurrentTab] = useState<MobileTab>('feed');

  // Dataset state
  const [allRecalls, setAllRecalls] = useState<RecallItem[]>([]);
  const [syncState, setSyncState] = useState<DatasetSyncState>({
    status: 'loading',
    lastSynced: null,
    totalRecords: 0,
    source: 'live'
  });
  const [loadingProgress, setLoadingProgress] = useState('Connecting to Canadian recall registry...');

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

  // Load Canadian Recalls Data
  const loadData = useCallback(async (forceRefresh = false) => {
    setSyncState((prev) => ({ ...prev, status: 'loading', errorMessage: undefined }));
    try {
      const res = await fetchRecallsData(forceRefresh, (step) => setLoadingProgress(step));
      setAllRecalls(res.data);
      setSyncState({
        status: 'cached',
        lastSynced: Date.now(),
        totalRecords: res.count,
        source: res.source
      });
    } catch (err: any) {
      console.error('Failed to load recalls:', err);
      setSyncState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err?.message || 'Error downloading Canadian safety recalls.'
      }));
    }
  }, []);

  useEffect(() => {
    loadData(false);
  }, [loadData]);

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
      />

      {/* MAIN RESPONSIVE CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 min-h-screen">
        {/* MOBILE TOP BAR (Visible on mobile only, hidden on md+) */}
        <div className="md:hidden">
          <Header
            syncState={syncState}
            onRefreshFeed={() => loadData(true)}
            onOpenScanner={() => setIsScannerOpen(true)}
            canInstallPwa={Boolean(deferredPrompt)}
            onInstallPwa={handleInstallPwa}
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

          <div className="flex items-center gap-3">
            {/* Direct Scan CTA Button in desktop top bar */}
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Barcode & Vision Scanner</span>
            </button>

            {/* Gemini Vision badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Gemini 2.5 Flash</span>
            </div>
          </div>
        </div>

        {/* MAIN BODY CONTENT */}
        <main className="flex-1 px-3.5 sm:px-6 py-4 space-y-4 max-w-6xl w-full mx-auto pb-24 md:pb-10">
          {/* PWA Install Banner */}
          {showInstallBanner && deferredPrompt && (
            <InstallPromptBanner
              onInstall={handleInstallPwa}
              onDismiss={() => setShowInstallBanner(false)}
            />
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

              {/* Feed Status / Error / Loading States */}
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
                /* RESPONSIVE CARDS GRID: 1 col on mobile, 2 col on tablet, 2-3 col on desktop */
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
                            onClick={() => setSelectedRecall(recall)}
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

          {/* TAB 3: SETTINGS */}
          {currentTab === 'settings' && (
            <SettingsView
              syncState={syncState}
              onRefreshFeed={() => loadData(true)}
              canInstallPwa={Boolean(deferredPrompt)}
              onInstallPwa={handleInstallPwa}
            />
          )}
        </main>

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
          onSelectRecall={(recall) => setSelectedRecall(recall)}
        />

        <RecallDetailModal
          recall={selectedRecall}
          isOpen={Boolean(selectedRecall)}
          onClose={() => setSelectedRecall(null)}
        />
      </div>
    </div>
  );
};

export default App;
