// SqlViewer.tsx — SQL editor + results (Tailwind v4 + dark/light)
import React, { useState } from "react";
import { Play, Clock, Database, Copy, Check } from "lucide-react";
import { runSqlQuery } from "../api/analytics";
import type{ SqlResult } from "../api/analytics";

const DEFAULT_QUERY = `SELECT c.name 
FROM customers c 
ORDER BY c.name ASC 
LIMIT 100`;

const SqlViewer: React.FC = () => {
  const [query,   setQuery]   = useState(DEFAULT_QUERY);
  const [result,  setResult]  = useState<SqlResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);

  const handleRun = async () => {
    if (!query.trim()) return;
    setRunning(true); setError(null);
    try   { setResult(await runSqlQuery(query)); }
    catch (e: any) { setError(e.message || "Query failed"); }
    finally { setRunning(false); }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(query);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const lines = query.split("\n");

  return (
    <div className={`rounded-xl border overflow-hidden
      dark:bg-[#131622] dark:border-white/[0.07]
      light:bg-white light:border-gray-200 light:shadow-sm`}>

      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b
        dark:border-white/[0.07] light:border-gray-100`}>
        <div className="flex items-center gap-2 text-[12px] font-bold dark:text-gray-100 light:text-gray-800">
          <Database size={14} className="text-purple-400" />
          SQL Console
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy}
            className={`w-7 h-7 flex items-center justify-center rounded border transition-all
              dark:border-white/[0.07] dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/5
              light:border-gray-200 light:text-gray-400 light:hover:text-gray-700 light:hover:bg-gray-50`}>
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
          <button onClick={handleRun} disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-400 text-black text-[11px] font-bold rounded-md
              transition-opacity hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed">
            <Play size={12} />
            {running ? "Running…" : "Run (⌘↵)"}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex dark:bg-[#0f1120] light:bg-gray-50 border-b dark:border-white/[0.07] light:border-gray-100">
        <div className="flex flex-col py-3 px-3 min-w-[32px] text-right select-none
          font-mono text-[11px] leading-[1.7] dark:text-gray-600 light:text-gray-300
          border-r dark:border-white/[0.07] light:border-gray-200">
          {lines.map((_, i) => <span key={i}>{i + 1}</span>)}
        </div>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleRun(); }}
          rows={lines.length}
          spellCheck={false}
          className={`sql-editor flex-1 bg-transparent border-none outline-none
            font-mono text-[12.5px] leading-[1.7] px-4 py-3 resize-none
            dark:text-cyan-300 light:text-indigo-600`}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 my-3 px-3 py-2 rounded-lg text-xs font-mono
          bg-rose-500/10 border border-rose-500/20 text-rose-400">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="p-4">
          <div className="flex justify-between items-center mb-3 font-mono text-[11px]
            dark:text-gray-500 light:text-gray-400">
            <span><strong className="dark:text-gray-300 light:text-gray-700">{result.rowCount}</strong> rows returned</span>
            <span className="flex items-center gap-1 text-emerald-400">
              <Clock size={10} />{result.executionTime}ms
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11.5px] font-mono">
              <thead>
                <tr>
                  {result.columns.map((col) => (
                    <th key={col} className={`text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider
                      border-b dark:bg-[#1a1d2e] dark:border-white/[0.07] dark:text-gray-500
                      light:bg-gray-50 light:border-gray-100 light:text-gray-400`}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, ri) => (
                  <tr key={ri} className="dark:hover:bg-white/[0.02] light:hover:bg-gray-50 transition-colors">
                    {row.map((cell, ci) => (
                      <td key={ci} className={`px-3 py-2 border-b whitespace-nowrap
                        dark:border-white/[0.05] dark:text-gray-300
                        light:border-gray-100 light:text-gray-700`}>
                        {cell === null
                          ? <span className="dark:text-gray-600 light:text-gray-300 italic">NULL</span>
                          : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default SqlViewer;