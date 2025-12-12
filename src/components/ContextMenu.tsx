import React, { useEffect, useRef, useState, useLayoutEffect } from "react";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  options: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
  }[];
  anchorElement?: HTMLElement | null;
}

export default function ContextMenu({
  x,
  y,
  onClose,
  options,
  anchorElement,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Calculate initial position with viewport constraints
  const calculatePosition = () => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 8;
    const estimatedMenuWidth = 180;
    const estimatedMenuHeight = options.length * 40 + 8; // Approximate height

    let finalLeft = x;
    let finalTop = y;

    // Check right edge overflow
    if (x + estimatedMenuWidth > viewportWidth - padding) {
      if (anchorElement) {
        const anchorRect = anchorElement.getBoundingClientRect();
        finalLeft = anchorRect.left - estimatedMenuWidth;
      } else {
        finalLeft = viewportWidth - estimatedMenuWidth - padding;
      }
      if (finalLeft < padding) finalLeft = padding;
    }

    // Check bottom edge overflow
    if (y + estimatedMenuHeight > viewportHeight - padding) {
      if (anchorElement) {
        const anchorRect = anchorElement.getBoundingClientRect();
        finalTop = anchorRect.top - estimatedMenuHeight;
      } else {
        finalTop = viewportHeight - estimatedMenuHeight - padding;
      }
      if (finalTop < padding) finalTop = padding;
    }

    // Ensure minimum padding
    if (finalLeft < padding) finalLeft = padding;
    if (finalTop < padding) finalTop = padding;

    return { top: finalTop, left: finalLeft };
  };

  const [position, setPosition] = useState(calculatePosition);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Refine position after render with actual dimensions
  useLayoutEffect(() => {
    if (!menuRef.current) return;

    const menu = menuRef.current;
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 8;

    let finalLeft = position.left;
    let finalTop = position.top;

    // Refine based on actual dimensions
    if (menuRect.right > viewportWidth - padding) {
      if (anchorElement) {
        const anchorRect = anchorElement.getBoundingClientRect();
        finalLeft = anchorRect.left - menuRect.width;
      } else {
        finalLeft = viewportWidth - menuRect.width - padding;
      }
      if (finalLeft < padding) finalLeft = padding;
    }

    if (menuRect.bottom > viewportHeight - padding) {
      if (anchorElement) {
        const anchorRect = anchorElement.getBoundingClientRect();
        finalTop = anchorRect.top - menuRect.height;
      } else {
        finalTop = viewportHeight - menuRect.height - padding;
      }
      if (finalTop < padding) finalTop = padding;
    }

    // Only update if position changed significantly (avoid unnecessary re-renders)
    if (
      Math.abs(finalLeft - position.left) > 1 ||
      Math.abs(finalTop - position.top) > 1
    ) {
      setPosition({ top: finalTop, left: finalLeft });
    }
  }, [x, y, anchorElement, position.left, position.top]);

  return (
    <div
      ref={menuRef}
      className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[180px] max-w-[calc(100vw-16px)]"
      style={{ top: position.top, left: position.left }}
    >
      {options.map((option, index) => (
        <button
          key={index}
          onClick={() => {
            option.onClick();
            onClose();
          }}
          className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 hover:bg-gray-100 transition-colors ${
            option.danger ? "text-red-600 hover:bg-red-50" : "text-gray-700"
          }`}
        >
          {option.icon ? (
            <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
              {option.icon}
            </span>
          ) : (
            <span className="flex-shrink-0 w-4 h-4" />
          )}
          <span className="truncate flex-1">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
