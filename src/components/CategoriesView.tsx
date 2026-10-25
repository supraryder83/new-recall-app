import React from 'react';
import {
  Utensils,
  Car,
  ShoppingBag,
  HeartPulse,
  ChevronRight,
  Flame
} from 'lucide-react';
import type { CategoryFilter, RecallItem } from '../types/recall';

interface CategoriesViewProps {
  recalls: RecallItem[];
  onSelectCategory: (cat: CategoryFilter) => void;
  onSelectClass: (cls: string) => void;
}

export const CategoriesView: React.FC<CategoriesViewProps> = ({
  recalls,
  onSelectCategory,
  onSelectClass
}) => {
  // Compute counts per category
  const foodCount = recalls.filter((item) => {
    const org = (item.Organization || '').toLowerCase();
    const cat = (item.Category || '').toLowerCase();
    return (
      org === 'cfia' ||
      cat.includes('food') ||
      cat.includes('snack') ||
      cat.includes('meat') ||
      cat.includes('dairy')
    );
  }).length;

  const vehicleCount = recalls.filter((item) => {
    const org = (item.Organization || '').toUpperCase();
    const cat = (item.Category || '').toLowerCase();
    return org === 'TC' || cat.includes('car') || cat.includes('suv') || cat.includes('truck');
  }).length;

  const consumerCount = recalls.filter((item) => {
    const org = (item.Organization || '').toLowerCase();
    return org.includes('consumer product');
  }).length;

  const medicalCount = recalls.filter((item) => {
    const org = (item.Organization || '').toLowerCase();
    return org.includes('medical') || org.includes('drug');
  }).length;

  const class1Count = recalls.filter((item) => {
    const cls = (item['Recall class'] || '').toLowerCase();
    return cls.includes('class 1') || cls.includes('type i');
  }).length;

  return (
    <div className="space-y-4 text-left animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 tracking-tight">
          Browse Categories
        </h2>
        <p className="text-xs md:text-sm text-slate-500 mt-0.5">
          Explore safety notices by Canadian regulatory authority & risk severity
        </p>
      </div>

      {/* Critical Class 1 Alert Card */}
      <div
        onClick={() => {
          onSelectCategory('ALL');
          onSelectClass('Class 1');
        }}
        className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-red-600 via-red-600 to-red-700 text-white cursor-pointer shadow-md hover:shadow-red-600/30 transition-all flex items-center justify-between group"
      >
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-white/20 rounded-xl backdrop-blur-md shrink-0">
            <Flame className="w-6 h-6 text-amber-300 animate-bounce" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-sm sm:text-base">Class 1 High Risk Recalls</h3>
              <span className="bg-white/20 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase">
                URGENT
              </span>
            </div>
            <p className="text-xs text-red-100 mt-0.5">
              Life-threatening hazards, anaphylaxis, severe vehicle defects & contaminated food
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-base font-extrabold">{class1Count.toLocaleString()}</span>
          <ChevronRight className="w-5 h-5 text-white/80 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>

      {/* Department Category Cards Grid (Responsive 2-column on tablet/desktop) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        {/* Food */}
        <div
          onClick={() => {
            onSelectCategory('FOOD');
            onSelectClass('ALL');
          }}
          className="p-4 bg-white rounded-2xl border border-slate-200/80 hover:border-emerald-300 hover:shadow-md shadow-xs cursor-pointer flex items-center justify-between group transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center font-bold shrink-0">
              <Utensils className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-slate-900 group-hover:text-emerald-600 transition-colors">
                  Food & Nutrition
                </h4>
                <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200/60">
                  CFIA
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                Allergen alerts, listeria, salmonella & undeclared ingredients
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-bold text-slate-700">{foodCount.toLocaleString()}</span>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        {/* Vehicles */}
        <div
          onClick={() => {
            onSelectCategory('VEHICLES');
            onSelectClass('ALL');
          }}
          className="p-4 bg-white rounded-2xl border border-slate-200/80 hover:border-amber-300 hover:shadow-md shadow-xs cursor-pointer flex items-center justify-between group transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center font-bold shrink-0">
              <Car className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-slate-900 group-hover:text-amber-600 transition-colors">
                  Vehicles & Transport
                </h4>
                <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200/60">
                  TC
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                Automobiles, SUVs, trucks, child car seats & tires
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-bold text-slate-700">{vehicleCount.toLocaleString()}</span>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        {/* Consumer Products */}
        <div
          onClick={() => {
            onSelectCategory('CONSUMER');
            onSelectClass('ALL');
          }}
          className="p-4 bg-white rounded-2xl border border-slate-200/80 hover:border-blue-300 hover:shadow-md shadow-xs cursor-pointer flex items-center justify-between group transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold shrink-0">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors">
                  Consumer Products
                </h4>
                <span className="text-[10px] font-semibold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200/60">
                  Health Canada
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                Electronics, toys, household items, clothing & appliances
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-bold text-slate-700">{consumerCount.toLocaleString()}</span>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        {/* Health & Medical */}
        <div
          onClick={() => {
            onSelectCategory('HEALTH');
            onSelectClass('ALL');
          }}
          className="p-4 bg-white rounded-2xl border border-slate-200/80 hover:border-purple-300 hover:shadow-md shadow-xs cursor-pointer flex items-center justify-between group transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center font-bold shrink-0">
              <HeartPulse className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-slate-900 group-hover:text-purple-600 transition-colors">
                  Health & Medical Devices
                </h4>
                <span className="text-[10px] font-semibold bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-200/60">
                  Santé Canada
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                Pharmaceuticals, implants, diagnostic tools & therapeutics
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-bold text-slate-700">{medicalCount.toLocaleString()}</span>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </div>
    </div>
  );
};
