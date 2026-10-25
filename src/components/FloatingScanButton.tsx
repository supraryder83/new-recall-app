import React from 'react';
import { Camera, Barcode } from 'lucide-react';

interface FloatingScanButtonProps {
  onClick: () => void;
}

export const FloatingScanButton: React.FC<FloatingScanButtonProps> = ({ onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 sm:hidden flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-r from-red-600 to-red-700 text-white font-extrabold text-sm rounded-full shadow-2xl shadow-red-600/50 hover:shadow-red-600/70 active:scale-95 transition-all border border-red-500/30"
      aria-label="Scan Product Barcode or Photo"
    >
      <div className="relative">
        <Camera className="w-5 h-5" />
        <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-red-600" />
      </div>
      <span>Scan Product</span>
    </button>
  );
};
