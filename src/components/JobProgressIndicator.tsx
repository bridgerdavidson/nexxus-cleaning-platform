import React from "react";
import { JobProgress } from "../types";

interface JobProgressIndicatorProps {
  currentProgress: JobProgress;
  size?: "sm" | "md" | "lg";
}

export default function JobProgressIndicator({
  currentProgress,
  size = "md",
}: JobProgressIndicatorProps) {
  const progressPercentage: Record<JobProgress, number> = {
    not_started: 0,
    before_photos: 0,
    checklist: 50,
    after_photos: 100,
    completed: 100,
  };

  const percent = progressPercentage[currentProgress];

  const sizeConfig = {
    sm: {
      barHeight: 3,
      stepSize: 28,
      fontSize: "text-[10px]",
      iconSize: "w-3 h-3",
    },
    md: {
      barHeight: 4,
      stepSize: 40,
      fontSize: "text-xs",
      iconSize: "w-4 h-4",
    },
    lg: {
      barHeight: 5,
      stepSize: 48,
      fontSize: "text-sm",
      iconSize: "w-5 h-5",
    },
  };

  const config = sizeConfig[size];

  const steps = [
    { label: "Before Photos", position: 0 },
    { label: "Checklist", position: 50 },
    { label: "After Photos", position: 100 },
  ];

  const getStepState = (position: number): "completed" | "current" | "upcoming" => {
    if (percent > position) return "completed";
    if (percent === position) return "current";
    return "upcoming";
  };

  const halfStep = config.stepSize / 2;

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Single row: bar runs through center of circles */}
      <div
        className="relative flex justify-between items-center"
        style={{
          height: config.stepSize,
          marginLeft: halfStep,
          marginRight: halfStep,
        }}
      >
        {/* Bar track - through center of row */}
        <div
          className="absolute left-0 right-0 rounded-full bg-gray-200"
          style={{
            height: config.barHeight,
            top: "50%",
            transform: "translateY(-50%)",
          }}
        />
        <div
          className="absolute left-0 rounded-full transition-[width] duration-300"
          style={{
            width: `calc((100% - ${config.stepSize}px) * ${percent / 100})`,
            height: config.barHeight,
            top: "50%",
            transform: "translateY(-50%)",
            background: "linear-gradient(to right, #10b981, #059669)",
          }}
        />
        {/* Circles - in same row, centered with bar */}
        {steps.map((step, index) => {
          const state = getStepState(step.position);
          return (
            <div
              key={index}
              className={`relative z-10 rounded-full border-[3px] transition-all duration-300 flex items-center justify-center flex-shrink-0 ${
                state === "completed"
                  ? "bg-green-500 border-green-600 shadow-md shadow-green-200"
                  : state === "current"
                    ? "bg-blue-500 border-blue-600 shadow-md shadow-blue-200 ring-4 ring-blue-100"
                    : "bg-white border-gray-300"
              }`}
              style={{ width: config.stepSize, height: config.stepSize }}
            >
              {state === "completed" ? (
                <svg
                  className={`${config.iconSize} text-white`}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : state === "current" ? (
                <div className="w-2 h-2 bg-white rounded-full" />
              ) : null}
            </div>
          );
        })}
      </div>
      {/* Labels row below */}
      <div
        className="flex justify-between mt-2"
        style={{ marginLeft: halfStep, marginRight: halfStep }}
      >
        {steps.map((step, index) => {
          const state = getStepState(step.position);
          return (
            <span
              key={index}
              className={`${config.fontSize} text-center leading-tight whitespace-nowrap ${
                state === "completed" || state === "current"
                  ? "text-gray-900 font-semibold"
                  : "text-gray-400"
              }`}
              style={{ maxWidth: 80 }}
            >
              {step.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
