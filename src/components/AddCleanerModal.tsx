"use client";

import React from "react";
import Link from "next/link";
import { X, Users, ArrowRight } from "lucide-react";

interface AddCleanerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AddCleanerModal({
  isOpen,
  onClose,
}: AddCleanerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-slide-up">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
              <Users className="w-8 h-8 text-primary-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Add New Cleaner
            </h2>
            <p className="text-gray-600">
              Direct new cleaners to the signup page to create their account
            </p>
          </div>

          {/* Content */}
          <div className="space-y-4 mb-6">
            <p className="text-sm text-gray-600 text-center">
              New cleaners can sign up through our registration page. Share this
              link with them to get started.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <Link
              href="/signup/cleaner"
              className="btn-primary flex justify-center items-center space-x-2"
              onClick={onClose}
            >
              <span>Go to Cleaner Signup Page</span>
              <ArrowRight className="w-5 h-5" />
            </Link>
            <button
              onClick={onClose}
              className="bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

