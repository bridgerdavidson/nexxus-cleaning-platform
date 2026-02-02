import React from "react";

interface AnimatedBroomProps {
  className?: string;
}

export default function AnimatedBroom({ className = "w-10 h-10" }: AnimatedBroomProps) {
  return (
    <div className={`${className} text-purple-600`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="animate-sweep"
      >
        {/* Broom bristles */}
        <path
          d="M12 14L8 20H16L12 14Z"
          fill="currentColor"
          opacity="0.7"
        />
        <path
          d="M10 19L12 14L14 19"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M9 18L12 14L15 18"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
        />
        
        {/* Broom handle */}
        <path
          d="M12 14L12 4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        
        {/* Handle grip lines */}
        <path
          d="M12 7L12 8"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M12 10L12 11"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
