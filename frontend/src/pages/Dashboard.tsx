// Dashboard.tsx — Main page (Tailwind v4 + dark/light)
import React, { useState, useEffect } from "react";
import { LayoutDashboard, RefreshCw, Bell, Sun, Moon } from "lucide-react";
import InsightCard from "../components/InsightCard";
import ChartRenderer from "../components/ChartRenderer";
import SqlViewer from "../components/SqlViewer";
import ChatBox from "../components/ChatBox";
import { fetchInsights } from "../api/analytics";
import type{  InsightData } from "../api/analytics";
import { useTheme } from "../ThemeContent";

const Dashboard: React.FC = () => {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";

  const [insights,       setInsights]       = useState<InsightData[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [lastRefresh,    setLastRefresh]    = useState(new Date());
  const [activeTab,      setActiveTab]      = useState<"chart" | "sql">("chart");

  const loadInsights = () => {
    setLoadingInsights(true);
    fetchInsights().then((d) => { setInsights(d); setLoadingInsights(false); setLastRefresh(new Date()); });
  };

  useEffect(() => { loadInsights(); }, []);

  const iconBtn = (label: string, onClick: () => void, children: React.ReactNode) => (
    <button onClick={onClick} title={label}
      className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-all
        dark:border-white/[0.07] dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/5
        light:border-gray-200 light:text-gray-400 light:hover:text-gray-700 light:hover:bg-gray-50`}>
      {children}
    </button>
  );

  return (
    <div className={`flex flex-col h-screen overflow-hidden
      dark:bg-[#0d0f1a] light:bg-gray-50`}
      style={{
        backgroundImage: dark
          ? "radial-gradient(ellipse 80% 50% at 20% 0%,rgba(0,229,255,.04) 0%,transparent 60%),radial-gradient(ellipse 60% 40% at 80% 100%,rgba(124,58,237,.04) 0%,transparent 60%)"
          : "none"
      }}>

      {/* ── Header ── */}
      <header className={`flex items-center justify-between px-6 py-3.5 border-b sticky top-0 z-50 backdrop-blur-xl
        dark:border-white/[0.07] dark:bg-[#0d0f1a]/90
        light:border-gray-200 light:bg-white/90`}>

        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center">
            <LayoutDashboard size={14} className="text-black" />
          </div>
          <span className="text-[17px] font-extrabold tracking-tight dark:text-gray-100 light:text-gray-900">
            DataLens
          </span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border
            dark:bg-[#1a1d2e] dark:border-white/[0.07] dark:text-gray-500
            light:bg-gray-100 light:border-gray-200 light:text-gray-400`}>
            v2.1
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono dark:text-gray-500 light:text-gray-400 mr-1">
            Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {iconBtn("Refresh", loadInsights, <RefreshCw size={14} />)}
          {iconBtn("Notifications", () => {}, <Bell size={14} />)}

          {/* Theme Toggle */}
          <button onClick={toggle}
            className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-all
              ${dark
                ? "border-white/[0.07] text-amber-400 bg-amber-500/10 hover:bg-amber-500/15"
                : "border-gray-200 text-indigo-500 bg-indigo-50 hover:bg-indigo-100"}`}>
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-[11px] font-bold text-black ml-1">
            JD
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto px-6 pt-5 pb-6 flex flex-col gap-4">

        {/* KPI row */}
        <section className="grid grid-cols-4 gap-3">
          {loadingInsights
            ? Array.from({ length: 4 }).map((_, i) => <InsightCard key={i} data={{} as InsightData} loading />)
            : insights.map((ins) => <InsightCard key={ins.id} data={ins} />)}
        </section>

        {/* Middle */}
        <section className="grid grid-cols-[1fr_380px] gap-4 flex-1 min-h-0">
          {/* Left */}
          <div className="flex flex-col gap-3">
            {/* Tab bar */}
            <div className={`flex gap-0.5 p-1 rounded-xl border w-fit
              dark:bg-[#131622] dark:border-white/[0.07]
              light:bg-white light:border-gray-200`}>
              {(["chart", "sql"] as const).map((t) => (
                <button key={t} onClick={() => setActiveTab(t)}
                  className={`px-4 py-1.5 text-[12px] font-semibold rounded-lg capitalize transition-all
                    ${activeTab === t
                      ? "text-cyan-400 " + (dark ? "bg-[#1a1d2e]" : "bg-gray-100")
                      : "dark:text-gray-500 dark:hover:text-gray-300 light:text-gray-400 light:hover:text-gray-600"}`}>
                  {t === "chart" ? "Charts" : "SQL"}
                </button>
              ))}
            </div>
            {activeTab === "chart" ? <ChartRenderer /> : <SqlViewer />}
          </div>

          {/* Right */}
          <div className="flex flex-col">
            <ChatBox />
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;