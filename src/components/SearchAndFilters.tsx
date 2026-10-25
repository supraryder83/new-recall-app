import React from 'react';
import {
  Search,
  X,
  Utensils,
  ShoppingBag,
  HeartPulse,
  Car,
  ShieldAlert,
  SlidersHorizontal
} from 'lucide-react';
import type { CategoryFilter } from '../types/recall';
import { CATEGORIES } from '../services/recallData';

interface SearchAndFiltersProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedCategory: CategoryFilter;
  onSelectCategory: (cat: CategoryFilter) => void;
  selectedClass: string;
  onSelectClass: (cls: string) => void;
  totalFiltered: number;
  totalDataset: number;
}

export const SearchAndFilters: React.FC<SearchAndFiltersProps> = ({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onSelectCategory,
  selectedClass,
  onSelectClass,
  totalFiltered,
  totalDataset
}) => {
  const getCategoryIcon = (id: CategoryFilter) => {
    switch (id) {
      case 'FOOD':
        return <Utensils className="w-3.5 h-3.5" />;
      case 'CONSUMER':
        return <ShoppingBag className="w-3.5 h-3.5" />;
      case 'HEALTH':
        return <HeartPulse className="w-3.5 h-3.5" />;
      case 'VEHICLES':
        return <Car className="w-3.5 h-3.5" />;
      default:
        return <ShieldAlert className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="space-y-3">
      {/* Search Bar - Responsive */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 md:pl-4 flex items-center pointer-events-none text-slate-400">
          <Search className="w-4 h-4 md:w-5 md:h-5" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search Canadian product recalls (e.g. food allergen, heater, VIN, batch)..."
          className="w-full pl-9 md:pl-11 pr-9 md:pr-10 py-2.5 md:py-3 bg-white md:bg-white border border-slate-200/90 rounded-2xl text-xs sm:text-sm text-slate-900 shadow-xs focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all placeholder:text-slate-400 font-medium"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute inset-y-0 right-0 pr-3 md:pr-3.5 flex items-center text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5 md:w-4 md:h-4" />
          </button>
        )}
      </div>

      {/* Category Filter Chips */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none text-left -mx-1 px-1">
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelectCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all shrink-0 active:scale-95 ${
                  isSelected
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                }`}
              >
                {getCategoryIcon(cat.id)}
                <span>{cat.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Secondary: Risk Filter & Match Counter */}
        <div className="flex items-center justify-between sm:justify-end gap-3 text-xs px-1">
          <div className="flex items-center gap-1.5 text-slate-500 font-medium bg-white px-2.5 py-1 rounded-xl border border-slate-200/70 shadow-xs">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              value={selectedClass}
              onChange={(e) => onSelectClass(e.target.value)}
              className="bg-transparent text-slate-800 font-bold text-xs focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Risk Levels</option>
              <option value="Class 1">Class 1 (High Risk)</option>
              <option value="Class 2">Class 2 (Moderate)</option>
              <option value="Class 3">Class 3 (Low Hazard)</option>
            </select>
          </div>

          <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
            Showing <strong className="text-slate-900">{totalFiltered.toLocaleString()}</strong>
            <span className="hidden sm:inline"> of {totalDataset.toLocaleString()}</span>
          </span>
        </div>
      </div>
    </div>
  );
};
