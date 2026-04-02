import React, { useEffect, useMemo, useState } from "react";
import { fetchTableUsage } from "../api/analytics";
import type { TableUsageRow } from "../api/analytics";
import { RefreshCw } from "lucide-react";
import { useTheme } from "../ThemeContent";

const TableUsagePanel: React.FC = () => {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [tables, setTables] = useState<TableUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTables = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchTableUsage();
      setTables(rows);
    } catch (err) {
      console.error("Failed to load table usage", err);
      setError("Unable to load table usage right now.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTables();
  }, []);

  const maxRows = useMemo(
    () => (tables.length > 0 ? tables[0].rowCount : 1),
    [tables]
  );

  return (
    <section
      className={`rounded-2xl border flex flex-col gap-4 p-4 transition-all
        ${dark
          ? "dark:border-white/[0.08] dark:bg-[#141827]"
          : "light:border-gray-200 light:bg-white"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-500">
            Inventory Spotlight
          </p>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Tables with most rows
          </h3>
        </div>
        <button
          onClick={loadTables}
          className="flex items-center gap-1 px-3 py-1 rounded-full border text-[11px] font-semibold
            dark:border-white/10 dark:text-gray-200 light:border-gray-200 light:text-gray-600"
          aria-label="Refresh table usage"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-gray-500">Loading table usage…</p>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : tables.length === 0 ? (
          <p className="text-sm text-gray-500">No data available.</p>
        ) : (
          tables.map((table, index) => {
            const width = maxRows ? Math.min(100, (table.rowCount / maxRows) * 100) : 0;
            return (
              <div key={table.name} className="space-y-1">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span className="text-gray-900 dark:text-gray-100">
                        {index + 1}. {table.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {table.rowCount.toLocaleString()} rows
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {table.englishAlias || "alias unknown"}
                    </p>
                  </div>
                <div className="h-1 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-purple-500"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default TableUsagePanel;
