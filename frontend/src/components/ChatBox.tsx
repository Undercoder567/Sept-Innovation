// ChatBox.tsx — AI assistant chat (Tailwind v4 + dark/light)
import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {  sendChat, sendChatMessage } from "../api/analytics";
import type{ ChatMessage } from "../api/analytics";
import { useTheme } from "../ThemeContent";

const WELCOME: ChatMessage = {
  id: "welcome", role: "assistant", timestamp: new Date(),
  content: "Hi! I'm your analytics assistant. Ask me about revenue trends, user behaviour, or I can generate SQL queries for your data.",
};
const QUICK = [/* "Summarize revenue", "Top customers SQL", "Show DAU breakdown", "Latency analysis" */];
const COLORS = ["#00e5ff", "#7c3aed", "#f59e0b"];

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

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        // SQL / analytics mode
        reply = await sendChat(messages, content);
      }

      setMessages((p) => [...p, reply]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`rounded-xl border flex flex-col h-full overflow-hidden
      dark:bg-[#131622] dark:border-white/[0.07]
      light:bg-white light:border-gray-200 light:shadow-sm`}
    >

      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b flex-shrink-0
        dark:border-white/[0.07] light:border-gray-100`}
      >
        <div className="flex items-center gap-2 text-[12px] font-bold dark:text-gray-100 light:text-gray-800">
          <Bot size={14} className="text-cyan-400" />
          AI Assistant
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center gap-2">
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

          <span className="text-[10px] text-emerald-400 font-semibold">
            ● Live
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
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
        {QUICK.map((p) => (
          <button
            key={p}
            onClick={() => handleSend(p)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-all
              dark:bg-[#1a1d2e] dark:border-white/[0.07] dark:text-gray-400 dark:hover:border-cyan-500/40 dark:hover:text-cyan-400
              light:bg-gray-50 light:border-gray-200 light:text-gray-500 light:hover:border-cyan-300 light:hover:text-cyan-600`}
          >
            {p}
          </button>
        ))}
      </div>

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
          placeholder={
            mode === "chat"
              ? "Ask anything..."
              : "Ask about your data..."
          }
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
  );
};

export default ChatBox;