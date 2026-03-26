// InsightCard.tsx — KPI card (Tailwind v4 + dark/light)
import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type{ InsightData } from "../api/analytics";

interface Props { data: InsightData; loading?: boolean; }

const T = {
  up:      { top: "border-t-emerald-500", badge: "text-emerald-400 bg-emerald-500/10", bar: "bg-emerald-500/40" },
  down:    { top: "border-t-rose-500",    badge: "text-rose-400 bg-rose-500/10",       bar: "bg-rose-500/40"    },
  neutral: { top: "border-t-amber-500",   badge: "text-amber-400 bg-amber-500/10",     bar: "bg-amber-500/40"   },
};

const InsightCard: React.FC<Props> = ({ data, loading }) => {
  if (loading) {
    return (
      <div className="rounded-xl p-5 border border-t-2 border-t-transparent flex flex-col gap-3
        dark:bg-[#131622] dark:border-white/[0.07]
        light:bg-white light:border-gray-200 light:shadow-sm">
        <div className="skeleton h-3 w-1/2 rounded" />
        <div className="skeleton h-8 w-2/3 rounded mt-1" />
        <div className="skeleton h-3 w-1/3 rounded" />
        <div className="skeleton h-5 w-full rounded mt-2" />
      </div>
    );
  }

  const c = T[data.trend];
  const bars = Array.from({ length: 12 }, (_, i) => ({
    h: 14 + Math.sin(i * 0.8 + (data.trend === "down" ? Math.PI : 0)) * 10 + Math.random() * 5,
    delay: i * 40,
  }));

  return (
    <div className={`rounded-xl p-5 border border-t-2 ${c.top} flex flex-col gap-1 overflow-hidden
      transition-all duration-200 hover:-translate-y-0.5 cursor-default
      dark:bg-[#131622] dark:border-white/[0.07]
      light:bg-white light:border-gray-200 light:shadow-sm`}>

      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest dark:text-gray-500 light:text-gray-400">
          {data.title}
        </span>
        <span className={`flex items-center gap-1 text-[11px] font-semibold font-mono px-2 py-0.5 rounded-full ${c.badge}`}>
          {data.trend === "up"      && <TrendingUp size={11} />}
          {data.trend === "down"    && <TrendingDown size={11} />}
          {data.trend === "neutral" && <Minus size={11} />}
          {data.change > 0 ? "+" : ""}{data.change}%
        </span>
      </div>

      <div className="text-[25px] font-extrabold tracking-tight leading-none dark:text-gray-100 light:text-gray-900">
        {data.value}
      </div>
      <div className="text-[11px] mt-0.5 dark:text-gray-500 light:text-gray-400">{data.description}</div>

      <div className="flex items-end gap-0.5 h-6 mt-3">
        {bars.map((b, i) => (
          <div key={i} className={`flex-1 rounded-sm spark-bar ${c.bar}`}
            style={{ height: `${b.h}px`, animationDelay: `${b.delay}ms` }} />
        ))}
      </div>
    </div>
  );
};

export default InsightCard;