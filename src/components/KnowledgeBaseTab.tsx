import React, { useState } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Trash2,
  Tag,
  Calendar,
  Sparkles,
  CheckCircle2,
  FileText,
  SlidersHorizontal,
} from 'lucide-react';
import { TenantConfig, DocumentChunk } from '../types';
import { searchKnowledgeBase, chunkDocumentText } from '../utils/ragEngine';

interface KnowledgeBaseTabProps {
  tenant: TenantConfig;
  onUpdateKnowledgeBase: (chunks: DocumentChunk[]) => void;
}

export const KnowledgeBaseTab: React.FC<KnowledgeBaseTabProps> = ({
  tenant,
  onUpdateKnowledgeBase,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('Policies & FAQs');
  const [newTags, setNewTags] = useState('rules, timings, fees');
  const [newContent, setNewContent] = useState('');

  // RAG Search Sandbox
  const [testRagQuery, setTestRagQuery] = useState('');
  const [ragResults, setRagResults] = useState<any[]>([]);

  const handleTestRag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testRagQuery.trim()) return;
    const results = searchKnowledgeBase(testRagQuery, tenant.knowledgeBase, 3);
    setRagResults(results);
  };

  const handleAddDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const tags = newTags.split(',').map(t => t.trim()).filter(Boolean);
    const newChunks = chunkDocumentText(newTitle, newCategory, newContent, tags);

    const updated = [...tenant.knowledgeBase, ...newChunks];
    onUpdateKnowledgeBase(updated);

    setNewTitle('');
    setNewContent('');
    setShowAddModal(false);
  };

  const handleDeleteChunk = (chunkId: string) => {
    const updated = tenant.knowledgeBase.filter(c => c.id !== chunkId);
    onUpdateKnowledgeBase(updated);
  };

  const filteredChunks = tenant.knowledgeBase.filter(c => {
    const q = searchQuery.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.content.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Banner & Stats */}
      <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white tracking-tight">
              Company Knowledge Base & Isolated Tenant RAG
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Every business tenant&apos;s documents are stored under its tenant ID. Upload FAQs, consultation fees, return rules, or admission cutoffs for cross-lingual keyword matching and Gemini context grounding.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white shadow-xl transition-all hover:opacity-90 active:scale-95 text-xs whitespace-nowrap"
          style={{ backgroundColor: tenant.primaryColor }}
        >
          <Plus className="w-4 h-4" />
          <span>Upload Knowledge Document</span>
        </button>
      </div>

      {/* RAG Query Test Bench Sandbox */}
      <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">
              Knowledge Retrieval Simulator (Cross-Lingual Keyword Scoring)
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">Local JS scoring</span>
        </div>

        <form onSubmit={handleTestRag} className="flex gap-2">
          <input
            type="text"
            value={testRagQuery}
            onChange={e => setTestRagQuery(e.target.value)}
            placeholder="Type any test query in Odia, Hindi, Hinglish, or English (e.g. 'Dr. Jena consultation time', 'Sunday OPD', 'Fee structure')..."
            className="flex-1 bg-[#131926] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
          />
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md"
          >
            Run RAG Search
          </button>
        </form>

        {ragResults.length > 0 && (
          <div className="space-y-3 pt-3 border-t border-white/[0.06]">
            <p className="text-xs font-semibold text-slate-300">
              Top Matched Chunks ({ragResults.length} hits):
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ragResults.map((res, i) => (
                <div
                  key={i}
                  className="p-3.5 rounded-xl bg-[#131926] border border-emerald-500/30 text-xs space-y-2 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-400">{res.chunk.title}</span>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                      Relevance: {res.score}
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed line-clamp-3">
                    {res.chunk.content}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 pt-1 border-t border-white/[0.04]">
                    <span>Matched terms:</span>
                    {res.matchedTerms.map((term: string, idx: number) => (
                      <span key={idx} className="px-1.5 py-0.5 rounded bg-[#090D15] text-slate-300 font-mono">
                        {term}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Documents Grid & Search */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter company documents by title, keyword, or tag..."
              className="w-full bg-[#0D111A] border border-white/[0.08] rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-white/[0.16]"
            />
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {filteredChunks.length} documents indexed for {tenant.name}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredChunks.map(chunk => (
            <div
              key={chunk.id}
              className="bg-[#0D111A] border border-white/[0.08] hover:border-white/[0.16] rounded-2xl p-5 shadow-xl flex flex-col justify-between transition-all group"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#131926] text-slate-300 border border-white/[0.06]">
                    {chunk.category}
                  </span>
                  <button
                    onClick={() => handleDeleteChunk(chunk.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                    title="Delete document chunk"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <h3 className="text-sm font-bold text-white mb-2 leading-snug">
                  {chunk.title}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed line-clamp-4">
                  {chunk.content}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Tag className="w-3 h-3 text-slate-500" />
                  {chunk.tags.slice(0, 3).map((t, idx) => (
                    <span key={idx} className="text-slate-400">
                      #{t}
                    </span>
                  ))}
                </div>
                <span>{chunk.addedAt}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Document Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0D111A] border border-white/[0.1] rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <h3 className="text-base font-bold text-white">Add Document to {tenant.name}</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddDocument} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Document Title
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. Doctor Consultation Schedules & Cashless Empanelment"
                  className="w-full bg-[#131926] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    placeholder="e.g. Billing, Schedules, Policies"
                    className="w-full bg-[#131926] border border-white/[0.08] rounded-xl px-4 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={newTags}
                    onChange={e => setNewTags(e.target.value)}
                    placeholder="e.g. fees, dr jena, sunday"
                    className="w-full bg-[#131926] border border-white/[0.08] rounded-xl px-4 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Full Document Content (Auto-chunked and indexed)
                </label>
                <textarea
                  rows={5}
                  required
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  placeholder="Paste rules, timings, FAQs, fee charts here..."
                  className="w-full bg-[#131926] border border-white/[0.08] rounded-xl p-3 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl font-semibold text-white shadow-md bg-emerald-600 hover:bg-emerald-500"
                >
                  Save & Index Chunks
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
