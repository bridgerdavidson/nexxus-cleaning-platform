import React, { useState, useRef, KeyboardEvent } from "react";
import { Send, Image as ImageIcon, X, Plus } from "lucide-react";
import { createPreviewUrl, revokePreviewUrl } from "../lib/upload";

interface MessageInputProps {
  onSend: (content: string, attachments: File[]) => Promise<void>;
  disabled?: boolean;
}

export default function MessageInput({
  onSend,
  disabled = false,
}: MessageInputProps) {
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Create previews
    const newPreviews = files.map((file) => createPreviewUrl(file));
    setPreviews([...previews, ...newPreviews]);
    setAttachments([...attachments, ...files]);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Close menu after selection
    setShowAttachmentMenu(false);
  };

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };

    if (showAttachmentMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showAttachmentMenu]);

  const removeAttachment = (index: number) => {
    // Revoke preview URL to free memory
    revokePreviewUrl(previews[index]);

    setPreviews(previews.filter((_, i) => i !== index));
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if ((!content.trim() && attachments.length === 0) || sending || disabled)
      return;

    setSending(true);
    try {
      await onSend(content.trim(), attachments);

      // Clear form
      setContent("");
      setAttachments([]);

      // Revoke all preview URLs
      previews.forEach((url) => revokePreviewUrl(url));
      setPreviews([]);

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setSending(false);
      // Restore focus to the textarea after send, unless the user
      // has intentionally moved focus to a different interactive element.
      // Clicking the send button or send completing while textarea was focused
      // both land here; body/null/the send button are all "unintentional" targets.
      const active = document.activeElement;
      const isOutsideTextarea = active !== textareaRef.current;
      const isNotOtherInput =
        active === document.body ||
        active === null ||
        active?.closest("[data-message-input]") !== null;
      if (textareaRef.current && isOutsideTextarea && isNotOtherInput) {
        textareaRef.current.focus();
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);

    // Auto-expand textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const canSend =
    (content.trim() !== "" || attachments.length > 0) && !sending && !disabled;

  return (
    <div className="bg-white md:bg-gray-50 p-4 border-t border-gray-100 md:border-t-0" data-message-input>
      {/* Attachment previews */}
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 px-2">
          {previews.map((preview, index) => (
            <div key={index} className="relative">
              <img
                src={preview}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-lg border border-gray-200"
              />
              <button
                onClick={() => removeAttachment(index)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Floating message input box */}
      <div className="relative">
        {/* Input container with padding from sides */}
        <div className="mx-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          {/* Text input area with icons inside */}
          <div className="px-3 py-2">
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Write a message..."
              rows={1}
              className="w-full resize-none border-0 focus:outline-none focus:ring-0 max-h-32 overflow-y-auto bg-transparent text-gray-900 placeholder-gray-400"
              style={{ minHeight: "24px" }}
            />

            {/* Bottom row: + button on left, Send button on right */}
            <div className="flex items-center justify-between mt-1">
              {/* Left side: + button for attachments */}
              <div className="relative flex-shrink-0" ref={menuRef}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
                  disabled={disabled || sending}
                  className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Add attachment"
                >
                  <Plus className="w-4 h-4 text-gray-700" />
                </button>

                {/* Attachment menu dropdown */}
                {showAttachmentMenu && (
                  <div className="absolute bottom-full left-0 mb-2 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 min-w-[120px]">
                    <button
                      onClick={() => {
                        fileInputRef.current?.click();
                        setShowAttachmentMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                    >
                      <ImageIcon className="w-4 h-4" />
                      <span>Add image</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Right side: Send button */}
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  canSend
                    ? "bg-primary-600 text-white hover:bg-primary-700"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
