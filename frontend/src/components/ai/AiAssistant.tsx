/**
 * AiAssistant.tsx — v2.0 — PROFESSIONAL AI ASSISTANT
 * ---------------------------------------------------------------------------
 * Improvements over v1:
 *   - Categorized suggestion prompts (Candidats / Clients / Commandes /
 *     Paiements / Prospects / Pipeline)
 *   - "Tool trace" footer on each AI message showing which DB queries were run
 *     (e.g. "📊 a interrogé: get_candidates_by_city(Tunis)")
 *   - Better message rendering: bold, bullet lists, code blocks, tables
 *   - "Thinking" status that cycles through real status messages
 *   - "What can you do?" link that opens a capabilities modal
 *   - Persistent history (sessionStorage) — survives page navigations
 *   - "Nouvelle conversation" button to clear context
 *   - Markdown-lite rendering (no dep needed — handles **bold**, *italic*,
 *     `code`, bullet lists, numbered lists, line breaks)
 * ---------------------------------------------------------------------------
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { Bot, Send, X, Sparkles, Database, HelpCircle, Trash2, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import type { ChatMessage } from '../../types';

// ---------------------------------------------------------------------------
// SUGGESTION PROMPTS — organized by category
// ---------------------------------------------------------------------------
interface Suggestion {
  category: string;
  icon: string;
  prompts: string[];
}

const SUGGESTIONS_BY_CATEGORY: Suggestion[] = [
  {
    category: 'Candidats',
    icon: '👥',
    prompts: [
      'Combien de candidats avons-nous ?',
      'Top 5 villes par candidats',
      'Top 5 langues demandées',
      'Combien de candidats à Tunis ?',
      'Combien de candidats francophones ?',
      'Combien de candidats livrés ?',
      'Derniers 5 candidats inscrits',
      'Combien viennent de Facebook ?',
    ],
  },
  {
    category: 'Clients',
    icon: '🏢',
    prompts: [
      'Combien de sociétés ?',
      'Combien de sociétés actives ?',
    ],
  },
  {
    category: 'Commandes',
    icon: '📦',
    prompts: [
      'Combien de commandes ?',
      'Combien de commandes livrées ?',
      'Combien de commandes en cours ?',
      'Combien de commandes annulées ?',
    ],
  },
  {
    category: 'Finances',
    icon: '💰',
    prompts: [
      'Quel est le chiffre d\'affaires ?',
      'Paiements en attente',
      'Paiements en retard',
    ],
  },
  {
    category: 'Prospects',
    icon: '🎯',
    prompts: [
      'Combien de prospects ?',
      'Pipeline prospects',
    ],
  },
  {
    category: 'Vue d\'ensemble',
    icon: '📊',
    prompts: [
      'Donne-moi un résumé de la plateforme',
    ],
  },
];

const THINKING_MESSAGES = [
  'Analyse de votre question...',
  'Recherche dans la base MongoDB...',
  'Exécution des outils...',
  'Synthèse de la réponse...',
];

// ---------------------------------------------------------------------------
// Markdown-lite renderer (handles **bold**, *italic*, `code`, lines, lists)
// ---------------------------------------------------------------------------
function renderMarkdown(text: string): JSX.Element[] {
  const lines = text.split('\n');
  const out: JSX.Element[] = [];

  lines.forEach((line, idx) => {
    if (!line.trim()) {
      out.push(<div key={idx} style={{ height: 8 }} />);
      return;
    }
    // Bullet list item
    if (/^\s*[•\-\*]\s+/.test(line)) {
      const content = line.replace(/^\s*[•\-\*]\s+/, '');
      out.push(
        <div key={idx} className="flex gap-2 items-start">
          <span className="text-indigo-500 mt-0.5">•</span>
          <span className="flex-1">{renderInline(content)}</span>
        </div>
      );
      return;
    }
    // Numbered list
    const numMatch = line.match(/^\s*(\d+)\.\s+(.*)/);
    if (numMatch) {
      out.push(
        <div key={idx} className="flex gap-2 items-start">
          <span className="text-indigo-500 font-medium mt-0.5">{numMatch[1]}.</span>
          <span className="flex-1">{renderInline(numMatch[2])}</span>
        </div>
      );
      return;
    }
    // Regular paragraph
    out.push(<div key={idx}>{renderInline(line)}</div>);
  });

  return out;
}

function renderInline(text: string): JSX.Element[] {
  // Split on **bold**, *italic*, `code`
  const parts: JSX.Element[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={key++} className="font-semibold text-gray-900 dark:text-gray-100">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={key++} className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-indigo-600 dark:text-indigo-300 text-[11px] font-mono">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface ExtendedChatMessage extends ChatMessage {
  tools_used?: string[];
  data?: Record<string, any>;
  error?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  get_total_candidates: 'Total candidats',
  get_candidates_by_city: 'Candidats par ville',
  get_top_cities: 'Top villes',
  get_candidates_by_language: 'Candidats par langue',
  get_top_languages: 'Top langues',
  get_candidates_by_status: 'Candidats par statut',
  get_candidates_by_source: 'Candidats par source',
  get_recent_candidates: 'Candidats récents',
  get_candidate_details: 'Fiche candidat',
  get_total_companies: 'Total sociétés',
  get_active_companies: 'Sociétés actives',
  get_total_orders: 'Total commandes',
  get_orders_by_status: 'Commandes par statut',
  get_total_revenue: 'Revenu total',
  get_pending_payments: 'Paiements en attente',
  get_late_payments: 'Paiements en retard',
  get_total_prospects: 'Total prospects',
  get_prospect_pipeline: 'Pipeline prospects',
  get_dashboard_summary: 'Vue d\'ensemble',
};

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ExtendedChatMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem('ccm_ai_history_v2');
      return raw ? (JSON.parse(raw) as ExtendedChatMessage[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('Candidats');
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, open]);

  useEffect(() => {
    try {
      sessionStorage.setItem('ccm_ai_history_v2', JSON.stringify(messages.slice(-20)));
    } catch {}
  }, [messages]);

  // Cycle through "thinking" status messages while loading
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setThinkingStatus((s) => (s + 1) % THINKING_MESSAGES.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [loading]);

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const userMsg: ExtendedChatMessage = { role: 'user', content };
    const history = messages.filter((m) => m.role !== 'system').concat(userMsg);
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setThinkingStatus(0);

    try {
      const result: any = await api.aiChat(history, content);

      // Debug: log the raw result to help diagnose empty responses
      console.log('[ai] backend result:', result);

      // Be tolerant of any shape the backend may return
      let reply = '';
      if (result) {
        reply = (result.response || result.message || result.reply || result.text || '').toString().trim();
      }
      if (!reply) {
        // Show the raw payload so the user sees what's wrong
        reply = `Réponse vide du backend. Voici ce qui a été reçu:\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
      }
      const aiMsg: ExtendedChatMessage = {
        role: 'assistant',
        content: reply,
        tools_used: result?.tools_used || [],
        data: result?.data || {},
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Désolé, erreur de connexion au service IA: ${err?.message || 'erreur inconnue'}`,
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    setMessages([]);
    try { sessionStorage.removeItem('ccm_ai_history_v2'); } catch {}
  };

  const activeSuggestions = useMemo(() => {
    return SUGGESTIONS_BY_CATEGORY.find((s) => s.category === activeCategory) || SUGGESTIONS_BY_CATEGORY[0];
  }, [activeCategory]);

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`ai-fab ${open ? 'open' : ''}`}
        title="Assistant IA"
        aria-label="Assistant IA"
      >
        {open ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
      </button>

      <div className={`ai-panel ${open ? 'open' : ''}`} style={{ width: 460, maxWidth: 'calc(100vw - 24px)' }}>
        {/* Header */}
        <div className="ai-header">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white">
            <Bot className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Assistant CCM</p>
            <p className="text-[10px] text-gray-400 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {'18 outils · MongoDB live'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-300 p-1"
            title="Ce que je peux faire"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={clearConversation}
            className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-1"
            title="Nouvelle conversation"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="ai-messages" style={{ height: 380 }}>
          {messages.length === 0 && !loading && (
            <div className="text-center text-gray-400 text-xs py-4 px-3">
              <Bot className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm mb-1">Bonjour ! Je suis votre assistant CCM</p>
              <p className="text-[11px] mb-3">Je peux interroger la base MongoDB en temps réel pour répondre à vos questions.</p>

              {/* Category tabs */}
              <div className="flex flex-wrap gap-1 justify-center mb-3">
                {SUGGESTIONS_BY_CATEGORY.map((s) => (
                  <button
                    key={s.category}
                    type="button"
                    onClick={() => setActiveCategory(s.category)}
                    className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                      activeCategory === s.category
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-indigo-400'
                    }`}
                  >
                    {s.icon} {s.category}
                  </button>
                ))}
              </div>

              {/* Active category prompts */}
              <div className="flex flex-wrap gap-1 justify-center">
                {activeSuggestions.prompts.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendMessage(s)}
                    className="text-[10px] px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 text-gray-500"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`ai-msg ${msg.role} ${msg.error ? 'error' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] leading-relaxed text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                      {renderMarkdown(msg.content)}
                    </div>
                    {/* Tool trace */}
                    {msg.tools_used && msg.tools_used.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                        <div className="text-[9px] text-gray-400 flex items-center gap-1 mb-1">
                          <Database className="w-3 h-3" />
                          <span>a interrogé la base :</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {msg.tools_used.map((tool, ti) => (
                            <span
                              key={ti}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 font-mono"
                            >
                              {TOOL_LABELS[tool] || tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {msg.role === 'user' && (
                <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-lg px-3 py-2 text-[12px] text-gray-700 dark:text-gray-200">
                  {msg.content}
                </div>
              )}
              {msg.role === 'system' && (
                <div className="text-[10px] text-gray-400 italic px-2">{msg.content}</div>
              )}
            </div>
          ))}

          {loading && (
            <div className="ai-msg assistant">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1">
                  <div className="ai-typing">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">{THINKING_MESSAGES[thinkingStatus]}</p>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEnd} />
        </div>

        {/* Input */}
        <div className="ai-input-area">
          <input
            type="text"
            className="ai-input"
            placeholder="Posez votre question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <button
            type="button"
            className="ai-send"
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            aria-label="Envoyer"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Help modal */}
      {showHelp && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-indigo-500" />
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                  Ce que je peux faire
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <p className="text-xs text-gray-500 mb-4">
                Je peux répondre à toutes vos questions sur la plateforme en interrogeant MongoDB
                en temps réel. Voici 18 outils que j'utilise :
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTIONS_BY_CATEGORY.map((cat) => (
                  <div key={cat.category} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {cat.icon} {cat.category}
                    </div>
                    <ul className="space-y-1">
                      {cat.prompts.map((p) => (
                        <li key={p} className="text-[11px] text-gray-500 dark:text-gray-400">
                          • {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-4 italic">
                Astuce : plus votre question est précise, meilleure est ma réponse.
                Vous pouvez aussi poser des questions en langage naturel comme
                "Quelle est la répartition de nos candidats par ville ?" ou "Donne-moi le pipeline prospects".
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
