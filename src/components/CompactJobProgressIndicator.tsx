import React from "react";
import { JobProgress } from "../types";

interface CompactJobProgressIndicatorProps {
  currentProgress: JobProgress;
  className?: string;
}

export default function CompactJobProgressIndicator({
  currentProgress,
  className = "",
}: CompactJobProgressIndicatorProps) {
  // Map progress states to percentage values
  const progressPercentage: Record<JobProgress, number> = {
    not_started: 0,
    before_photos: 0,
    checklist: 50,
    after_photos: 100,
    completed: 100,
  };

  const percent = progressPercentage[currentProgress];

  // Determine color based on progress
  const getProgressColor = () => {
    if (percent === 0) return "bg-gray-300";
    if (percent === 50) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className={`flex items-center ${className}`}>
      {/* Progress bar container */}
      <div className="relative w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        {/* Progress fill */}
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${getProgressColor()}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
