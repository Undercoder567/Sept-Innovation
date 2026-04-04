// ChatBox.tsx — AI assistant chat (Tailwind v4 + dark/light)
import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Maximize2, Minimize2, List, Settings2, Clock3 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { sendChat, sendChatMessage } from "../api/analytics";
import type { ChatMessage } from "../api/analytics";
import { useTheme } from "../ThemeContent";

const WELCOME: ChatMessage = {
  id: "welcome", role: "assistant", timestamp: new Date(),
  content: "Hi! I'm your analytics assistant. Ask me about revenue trends, user behaviour, or I can generate SQL queries for your data.",
};
const QUICK: string[] = ["what is a book?"];
const COLORS = ["#00e5ff", "#7c3aed", "#f59e0b"];

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
  { value: "tr", label: "Türkçe" },
  { value: "zh", label: "中文" },
];

const MsgBubble: React.FC<{ msg: ChatMessage; dark: boolean }> = ({ msg, dark }) => {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2 fade-up ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px]
        ${isUser
          ? "bg-purple-500/15 text-purple-400 border border-purple-500/25"
          : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"}`}>
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>

      {/* Content */}
      <div className={`flex flex-col gap-1.5 max-w-[85%] ${isUser ? "items-end" : ""}`}>
        <div className={`px-3 py-2 rounded-xl text-[12.5px] leading-relaxed
          ${isUser
            ? "bg-purple-500/15 border border-purple-500/25 dark:text-gray-200 light:text-gray-700 rounded-tr-sm"
            : "dark:bg-[#1a1d2e] dark:border dark:border-white/[0.07] dark:text-gray-200 light:bg-gray-100 light:text-gray-700 rounded-tl-sm"}`}>
          {msg.content}
        </div>

        {msg.sqlQuery && (
          <div className="dark:bg-[#0f1120] dark:border-white/[0.07] dark:text-cyan-300
            light:bg-gray-50 light:border-gray-200 light:text-indigo-600
            border rounded-lg px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap overflow-x-auto">
            {msg.sqlQuery}
          </div>
        )}

        {msg.chartData && (
          <div className="w-full">
            <ResponsiveContainer width="100%" height={130}>
              <PieChart>
                <Pie data={msg.chartData} cx="50%" cy="50%" outerRadius={50} dataKey="value" nameKey="name" paddingAngle={3}>
                  {msg.chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{
                  background: dark ? "#1a1d2e" : "#fff",
                  border: dark ? "1px solid rgba(255,255,255,0.07)" : "1px solid #e5e7eb",
                  borderRadius: 8, fontSize: 11,
                }} itemStyle={{ color: dark ? "#e2e8f0" : "#374151" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex gap-3 flex-wrap text-[10px] font-mono px-1">
              {msg.chartData.map((d, i) => (
                <span key={i} style={{ color: COLORS[i % COLORS.length] }}>● {d.name}: {d.value}%</span>
              ))}
            </div>
          </div>
        )}

        <span className="text-[10px] font-mono dark:text-gray-600 light:text-gray-400">
          {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
};

const ChatBox: React.FC = () => {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // NEW: chat mode
  const [mode, setMode] = useState<"chat" | "query">("chat");
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"history" | "settings" | "resources">("history");

  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedLanguageLabel =
    LANGUAGE_OPTIONS.find((opt) => opt.value === selectedLanguage)?.label ||
    "English";

  const recentQueries = messages
    .filter((msg) => msg.role === "user")
    .slice(-6)
    .reverse()
    .map((msg) => ({
      id: msg.id,
      text: msg.content,
      time: msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }));

  const wrapperClass = isFullScreen ? "fixed inset-0 z-50 bg-black/60 p-3" : "relative";
  const containerClasses = `rounded-xl border flex flex-col h-full overflow-hidden
    dark:bg-[#131622] dark:border-white/[0.07]
    light:bg-white light:border-gray-200 light:shadow-sm ${isFullScreen ? "h-full" : ""}`;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isFullScreen) {
        setIsFullScreen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isFullScreen]);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((p) => [...p, userMsg]);
    setInput("");
    setLoading(true);

    try {
      let reply: ChatMessage;

      if (mode === "chat") {
        // normal AI chat
        reply = await sendChatMessage(messages, content);
      } else {
        // SQL / analytics mode (backend will translate when needed)
        reply = await sendChat(messages, content, selectedLanguage);
      }

      setMessages((p) => [...p, reply]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={wrapperClass}>
      <div className={containerClasses}>

      {/* Header */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-6 py-3 border-b flex-shrink-0
        dark:border-white/[0.07] light:border-gray-100`}
      >
        <div className="flex items-center gap-2 text-[12px] font-bold dark:text-gray-100 light:text-gray-800">
          <Bot size={14} className="text-cyan-400" />
          AI Assistant 
        </div>

        {/* Mode Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setMode("chat")}
            className={`text-[10px] px-2 py-1 rounded ${
              mode === "chat"
                ? "bg-cyan-400 text-black"
                : "dark:text-gray-400 light:text-gray-500"
            }`}
          >
            Chat
          </button>

          <button
            onClick={() => setMode("query")}
            className={`text-[10px] px-2 py-1 rounded ${
              mode === "query"
                ? "bg-cyan-400 text-black"
                : "dark:text-gray-400 light:text-gray-500"
            }`}
          >
            Query
          </button>

          <div className="flex items-center gap-1 text-[10px]">
            <label htmlFor="chat-language" className="hidden">
              Language
            </label>
            <select
              id="chat-language"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="text-[10px] px-2 py-1 rounded border transition-colors
                dark:bg-[#121524] dark:border-white/[0.1] dark:text-gray-100
                light:bg-white light:border-gray-200 light:text-gray-700"
            >
              {LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <button
              type="button"
              aria-label="Toggle sidebar"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="flex items-center justify-center w-8 h-8 rounded-full border text-gray-500 dark:border-white/[0.1]"
            >
              <List size={14} />
            </button>

            <button
              type="button"
              aria-label="Open settings"
              onClick={() => {
                setSidebarOpen(true);
                setActiveSidebarTab("settings");
              }}
              className="flex items-center justify-center w-8 h-8 rounded-full border text-gray-500 dark:border-white/[0.1]"
            >
              <Settings2 size={14} />
            </button>
          </div>

          <button
            type="button"
            aria-label="Toggle fullscreen"
            onClick={() => setIsFullScreen((prev) => !prev)}
            className="flex items-center justify-center w-8 h-8 rounded-full border text-gray-500 dark:border-white/[0.1]"
          >
            {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          <span className="text-[10px] text-emerald-400 font-semibold flex-shrink-0 whitespace-nowrap">
            ● Live
          </span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0">
            {messages.map((m) => (
              <MsgBubble key={m.id} msg={m} dark={dark} />
            ))}

            {loading && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex-shrink-0 mt-0.5">
                  <Bot size={12} />
                </div>

                <div
                  className="px-3 py-2 rounded-xl rounded-tl-sm flex items-center gap-2 text-xs
                  dark:bg-[#1a1d2e] dark:border dark:border-white/[0.07] dark:text-gray-500
                  light:bg-gray-100 light:text-gray-400"
                >
                  <Loader2 size={13} className="spin" /> Thinking…
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Quick Prompts */}
          <div
            className={`flex flex-wrap gap-1.5 px-3 py-2 border-t flex-shrink-0
        dark:border-white/[0.07] light:border-gray-100`}
          >
            {QUICK.length ? (
              QUICK.map((p) => (
                <button
                  key={p}
                  onClick={() => handleSend(p)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-all
              dark:bg-[#1a1d2e] dark:border-white/[0.07] dark:text-gray-400 dark:hover:border-cyan-500/40 dark:hover:text-cyan-400
              light:bg-gray-50 light:border-gray-200 light:text-gray-500 light:hover:border-cyan-300 light:hover:text-cyan-600`}
                >
                  {p}
                </button>
              ))
            ) : (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                No quick prompts configured.
              </span>
            )}
          </div>

          {selectedLanguage !== "en" && mode === "query" && (
            <div className="px-3 pb-1 text-[10px] opacity-80 text-slate-500 dark:text-slate-400">
              Queries written in {selectedLanguageLabel} are translated to English on the server via LibreTranslate before validation.
            </div>
          )}

          {/* Input */}
          <div
            className={`flex items-end gap-2 px-3 py-3 border-t flex-shrink-0
        dark:border-white/[0.07] light:border-gray-100`}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={mode === "chat" ? "Ask anything..." : "Ask about your data..."}
              rows={1}
              className={`flex-1 text-[12.5px] px-3 py-2 rounded-lg border outline-none resize-none leading-relaxed transition-colors
            dark:bg-[#0f1120] dark:border-white/[0.07] dark:text-gray-200 dark:placeholder-gray-600 dark:focus:border-cyan-500/30
            light:bg-gray-50 light:border-gray-200 light:text-gray-800 light:placeholder-gray-400 light:focus:border-cyan-300`}
            />

            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-cyan-400 text-black
            transition-opacity hover:opacity-85 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
        </div>

        {sidebarOpen && (
          <aside className="hidden md:flex flex-col w-72 border-l dark:border-white/[0.05] bg-white/80 dark:bg-[#0b0d16]/90 backdrop-blur">
            <div className="flex items-center justify-between px-3 py-2 border-b dark:border-white/[0.05]">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <Clock3 size={14} /> Overview
              </div>
              <button
                type="button"
                aria-label="Close sidebar"
                onClick={() => setSidebarOpen(false)}
                className="text-gray-500 dark:text-gray-300"
              >
                <List size={16} />
              </button>
            </div>

            <div className="flex gap-1 px-3 py-2 border-b dark:border-white/[0.05] text-[11px]">
              {(["history", "settings", "resources"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveSidebarTab(tab)}
                  className={`flex-1 rounded-full px-2 py-1 transition ${
                    activeSidebarTab === tab
                      ? "bg-cyan-400 text-black"
                      : "bg-transparent text-gray-500 dark:text-gray-300"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 text-sm space-y-3">
              {activeSidebarTab === "history" && (
                <div className="space-y-3 text-xs text-gray-600 dark:text-gray-300">
                  {recentQueries.length === 0 ? (
                    <p>No previous queries yet.</p>
                  ) : (
                    recentQueries.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-dashed border-slate-200 px-2 py-1">
                        <div className="font-semibold text-[11px] dark:text-white text-gray-700">
                          {entry.time}
                        </div>
                        <p className="text-[12px] line-clamp-2">{entry.text}</p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeSidebarTab === "settings" && (
                <div className="space-y-3 text-xs text-gray-600 dark:text-gray-300">
                  <div className="flex items-center justify-between">
                    <span>Mode</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setMode("chat")}
                        className={`px-2 py-0.5 rounded ${mode === "chat" ? "bg-cyan-500 text-black" : "bg-gray-200 dark:bg-gray-700"}`}
                      >
                        Chat
                      </button>
                      <button
                        onClick={() => setMode("query")}
                        className={`px-2 py-0.5 rounded ${mode === "query" ? "bg-cyan-500 text-black" : "bg-gray-200 dark:bg-gray-700"}`}
                      >
                        Query
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Full screen</span>
                    <button
                      onClick={() => setIsFullScreen((prev) => !prev)}
                      className={`px-2 py-0.5 rounded ${isFullScreen ? "bg-cyan-500 text-black" : "bg-gray-200 dark:bg-gray-700"}`}
                    >
                      {isFullScreen ? "On" : "Off"}
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Sidebar</span>
                    <button
                      onClick={() => setSidebarOpen((prev) => !prev)}
                      className={`px-2 py-0.5 rounded ${sidebarOpen ? "bg-cyan-500 text-black" : "bg-gray-200 dark:bg-gray-700"}`}
                    >
                      {sidebarOpen ? "Shown" : "Hidden"}
                    </button>
                  </div>
                </div>
              )}

              {activeSidebarTab === "resources" && (
                <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                  <p className="text-[12px] font-semibold text-gray-700 dark:text-white">Quick tips</p>
                  {QUICK.length === 0 ? (
                    <p className="text-[12px] text-gray-500 dark:text-gray-400">
                      No quick prompts configured yet. They'll appear here once defined.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-[12px]">
                      {QUICK.map((prompt, index) => (
                        <li key={prompt || index} className="rounded border border-dashed border-slate-200 px-2 py-1">
                          {prompt}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  </div>
  );
};

export default ChatBox;
