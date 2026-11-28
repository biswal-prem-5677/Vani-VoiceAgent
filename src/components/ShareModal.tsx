import React, { useState } from 'react';
import { X, Share2, Copy, Check, Twitter, Linkedin, MessageCircle } from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareTitle = 'VaniVoice AI - Multilingual Multi-Tenant Voice Agent';
  const shareText = 'Check out VaniVoice AI: a multilingual voice agent supporting Odia, Hindi, Hinglish, Bengali, and English with sub-second turnaround and safety routing.';

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
      } catch {
        // User cancelled share
      }
    } else {
      handleCopyLink();
    }
  };

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl bg-[#0D111A] border border-white/10 shadow-2xl text-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0A0E17]">
          <div className="flex items-center gap-2.5">
            <Share2 className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white">Share VaniVoice AI</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs">
          <p className="text-slate-300">
            Share this multilingual voice agent prototype with teammates, stakeholders, or communities:
          </p>

          {/* Social Buttons */}
          <div className="grid grid-cols-3 gap-2.5">
            <a
              href={twitterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-slate-900 border border-white/5 hover:border-sky-500/40 hover:bg-sky-500/10 text-slate-300 hover:text-sky-300 transition group"
            >
              <Twitter className="w-5 h-5 text-sky-400 group-hover:scale-110 transition" />
              <span className="font-semibold text-[11px]">X / Twitter</span>
            </a>

            <a
              href={linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-slate-900 border border-white/5 hover:border-blue-500/40 hover:bg-blue-500/10 text-slate-300 hover:text-blue-300 transition group"
            >
              <Linkedin className="w-5 h-5 text-blue-400 group-hover:scale-110 transition" />
              <span className="font-semibold text-[11px]">LinkedIn</span>
            </a>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-slate-900 border border-white/5 hover:border-emerald-500/40 hover:bg-emerald-500/10 text-slate-300 hover:text-emerald-300 transition group"
            >
              <MessageCircle className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition" />
              <span className="font-semibold text-[11px]">WhatsApp</span>
            </a>
          </div>

          {/* Copy Link Field */}
          <div className="pt-2">
            <label className="block text-slate-400 mb-1 font-medium">Direct Web Link</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-slate-300 font-mono text-[11px] select-all focus:outline-none"
              />
              <button
                onClick={handleCopyLink}
                className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              onClick={handleNativeShare}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center justify-center gap-2 transition"
            >
              <Share2 className="w-4 h-4 text-indigo-400" />
              <span>Use Device Share Menu</span>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 bg-[#0A0E17] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
