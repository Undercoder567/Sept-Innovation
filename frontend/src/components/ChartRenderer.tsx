// ChartRenderer.tsx — Adaptive chart (Tailwind v4 + dark/light)
import React, { useState, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { BarChart2, TrendingUp, PieChart as PieIcon } from "lucide-react";
import {  fetchChartData } from "../api/analytics";
import type{ ChartData } from "../api/analytics";
import { useTheme } from "../ThemeContent";

type ChartType = "line" | "bar" | "pie";
type Metric    = "revenue" | "users" | "queries" | "latency";

const ACCENT  = ["#00e5ff", "#7c3aed", "#f59e0b", "#10b981", "#ef4444"];
const MLABELS: Record<Metric, string> = {
  revenue: "Revenue ($)", users: "Active Users", queries: "SQL Queries", latency: "Latency (ms)",
};

const CustomTooltip = ({ active, payload, label, dark }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs font-mono shadow-xl
      ${dark ? "bg-[#1a1d2e] border-white/[0.07] text-gray-300" : "bg-white border-gray-200 text-gray-700"}`}>
      <p className="text-[10px] mb-1 opacity-60">{label}</p>
      {payload.map((e: any, i: number) => (
        <p key={i} style={{ color: e.color }}>{e.name}: <strong>{e.value.toLocaleString()}</strong></p>
      ))}
    </div>
  );
};

const ChartRenderer: React.FC = () => {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [chartType, setChartType] = useState<ChartType>("line");
  const [metric, setMetric]       = useState<Metric>("revenue");
  const [data, setData]           = useState<ChartData[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchChartData(metric).then((d) => { setData(d); setLoading(false); });
  }, [metric]);

  const tickColor   = dark ? "#6b7280" : "#9ca3af";
  const gridColor   = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";

  const typeBtn = (t: ChartType, Icon: React.ElementType) => (
    <button key={t} onClick={() => setChartType(t)}
      className={`p-1.5 rounded transition-all duration-150
        ${chartType === t
          ? "text-cyan-400 " + (dark ? "bg-[#131622]" : "bg-white shadow-sm")
          : "text-gray-500 hover:text-gray-300"}`}>
      <Icon size={14} />
    </button>
  );

  return (
    <div className={`rounded-xl border overflow-hidden flex-1
      dark:bg-[#131622] dark:border-white/[0.07]
      light:bg-white light:border-gray-200 light:shadow-sm`}>

      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b
        dark:border-white/[0.07] light:border-gray-100`}>
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-bold dark:text-gray-100 light:text-gray-800">Analytics</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border cursor-pointer outline-none transition-colors
              dark:bg-cyan-500/10 dark:border-cyan-500/20 dark:text-cyan-400
              light:bg-cyan-50 light:border-cyan-200 light:text-cyan-600`}>
            {(Object.keys(MLABELS) as Metric[]).map((m) => (
              <option key={m} value={m}>{MLABELS[m]}</option>
            ))}
          </select>
        </div>
        <div className={`flex gap-0.5 p-1 rounded-lg
          dark:bg-[#1a1d2e] light:bg-gray-100`}>
          {typeBtn("line", TrendingUp)}
          {typeBtn("bar",  BarChart2)}
          {typeBtn("pie",  PieIcon)}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 pt-5">
        {loading ? (
          <div className="h-60 flex flex-col items-center justify-center gap-3 dark:text-gray-500 light:text-gray-400 text-xs">
            <div className="w-5 h-5 rounded-full border-2 dark:border-white/10 light:border-gray-200 border-t-cyan-400 spin" />
            Loading data…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            {chartType === "line" ? (
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="name" tick={{ fill: tickColor, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: tickColor, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip dark={dark} />} />
                <Line type="monotone" dataKey="value"     stroke="#00e5ff" strokeWidth={2} dot={{ fill: "#00e5ff", r: 3 }} name={MLABELS[metric]} />
                <Line type="monotone" dataKey="secondary" stroke="#7c3aed" strokeWidth={2} dot={{ fill: "#7c3aed", r: 3 }} strokeDasharray="4 4" name="Prev period" />
              </LineChart>
            ) : chartType === "bar" ? (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="name" tick={{ fill: tickColor, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: tickColor, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip dark={dark} />} />
                <Bar dataKey="value"     fill="#00e5ff" radius={[3, 3, 0, 0]} name={MLABELS[metric]} />
                <Bar dataKey="secondary" fill="#7c3aed" radius={[3, 3, 0, 0]} name="Prev period" />
              </BarChart>
            ) : (
              <PieChart>
                <Pie data={data.slice(0, 6)} cx="50%" cy="50%" innerRadius={55} outerRadius={105} dataKey="value" nameKey="name" paddingAngle={3}>
                  {data.slice(0, 6).map((_, i) => <Cell key={i} fill={ACCENT[i % ACCENT.length]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip dark={dark} />} />
              </PieChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default ChartRenderer;