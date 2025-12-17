"use client";

import React, { useState } from "react";
import { X, DollarSign, CheckCircle, Loader2, Calendar, User } from "lucide-react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface Payout {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  cleaner: {
    first_name: string;
    last_name: string;
  } | null;
  appointment: {
    scheduled_date: string;
    id: string;
  } | null;
}

interface ApprovePayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPayoutApproved: () => void;
  payout: Payout | null;
}

export default function ApprovePayoutModal({
  isOpen,
  onClose,
  onPayoutApproved,
  payout,
}: ApprovePayoutModalProps) {
  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  React.useEffect(() => {
    if (isOpen && payout) {
      setAmount(payout.amount.toString());
      setNotes("");
      setError(null);
    }
  }, [isOpen, payout]);

  const handleClose = () => {
    setAmount("");
    setNotes("");
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!payout) return;

    // Validation
    if (!amount || Number(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/payouts/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payout_id: payout.id,
          amount: Number(amount),
          notes: notes || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to approve payout");
      }

      onPayoutApproved();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve payout");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !payout) return null;

  const cleanerName = payout.cleaner
    ? `${payout.cleaner.first_name} ${payout.cleaner.last_name}`
    : "Unknown Cleaner";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-green-600 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white">Approve Payout</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-white/80 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Cleaner Name - Display Only */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Cleaner Name
            </label>
            <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg">
              <User className="w-5 h-5 text-gray-400" />
              <span className="font-medium text-gray-900">{cleanerName}</span>
            </div>
          </div>

          {/* Booking Reference - Display Only */}
          {payout.appointment && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Booking Reference
              </label>
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg">
                <Calendar className="w-5 h-5 text-gray-400" />
                <span className="font-medium text-gray-900">
                  {payout.appointment.scheduled_date}
                </span>
                <span className="text-sm text-gray-500">
                  (ID: {payout.appointment.id.slice(0, 8)})
                </span>
              </div>
            </div>
          )}

          {/* Original Amount Display */}
          {Number(amount) !== payout.amount && (
            <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded-lg">
              <div className="text-sm text-blue-700">
                <span className="font-semibold">Original amount:</span> ${payout.amount.toFixed(2)}
              </div>
            </div>
          )}

          {/* Amount - Editable */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Payout Amount *
              <span className="ml-2 text-sm font-normal text-gray-500">
                (editable override)
              </span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <DollarSign className="w-5 h-5 text-gray-400" />
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-lg font-semibold"
                required
              />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Edit this amount if you need to adjust the payout
            </p>
          </div>

          {/* Notes (Optional) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              placeholder="Add any notes about this payout..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Warning */}
          <div className="bg-yellow-50 border border-yellow-200 px-4 py-3 rounded-lg">
            <p className="text-sm text-yellow-800">
              <span className="font-semibold">Note:</span> This will initiate a transfer via
              Stripe Connect. Make sure the amount is correct before confirming.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" />
                  Confirm Transfer
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
