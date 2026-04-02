import React, { useEffect, useMemo, useState } from "react";
import { fetchTableRelationships, fetchTableUsage } from "../api/analytics";
import type { TableRelationshipGraph, TableUsageRow } from "../api/analytics";
import { RefreshCw, Expand, X } from "lucide-react";
import { useTheme } from "../ThemeContent";

const GRAPH_WIDTH = 420;
const GRAPH_HEIGHT = 420;

const TableRelationshipExplorer: React.FC = () => {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageRows, setUsageRows] = useState<TableUsageRow[]>([]);
  const [graph, setGraph] = useState<TableRelationshipGraph>({ nodes: [], edges: [] });
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [fullScreen, setFullScreen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usage, relationships] = await Promise.all([
        fetchTableUsage(),
        fetchTableRelationships(),
      ]);
      setUsageRows(usage);
      setGraph(relationships);
      if (!selectedTable && relationships.nodes.length > 0) {
        setSelectedTable(relationships.nodes[0].id);
      }
    } catch (err) {
      console.error("Unable to load table relationship data", err);
      setError("Could not load relationship data right now.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connections = useMemo(() => {
    if (!selectedTable) {
      return [];
    }
    return graph.edges
      .filter((edge) => edge.source === selectedTable || edge.target === selectedTable)
      .map((edge) => {
        const isOutbound = edge.source === selectedTable;
        const otherTableId = isOutbound ? edge.target : edge.source;
        const otherNode = graph.nodes.find((node) => node.id === otherTableId);
        return {
          id: edge.id,
          table: otherNode ? `${otherNode.name} (${otherNode.englishAlias || otherNode.name})` : otherTableId,
          direction: isOutbound ? "references" : "referenced by",
          columns: isOutbound
            ? `${edge.parentColumns} → ${edge.referencedColumns}`
            : `${edge.referencedColumns} → ${edge.parentColumns}`,
          onDelete: edge.onDelete,
          onUpdate: edge.onUpdate,
          type: edge.type,
          hint: edge.inferredReason,
        };
      });
  }, [graph.edges, graph.nodes, selectedTable]);

  const selectedNode = graph.nodes.find((node) => node.id === selectedTable);
  const highlightColor = dark ? "#22d3ee" : "#0ea5e9";
  const tablesWithRelations = useMemo(() => {
    const set = new Set<string>();
    graph.edges.forEach((edge) => {
      set.add(edge.source);
      set.add(edge.target);
    });
    return set;
  }, [graph.edges]);

  const renderGraph = () => {
    if (!selectedTable) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-white/70">
          Select a table to see its local relationship graph.
        </div>
      );
    }

    const focusEdges = graph.edges.filter(
      (edge) => edge.source === selectedTable || edge.target === selectedTable
    );
    const relatedIds = new Set<string>();
    focusEdges.forEach((edge) => {
      relatedIds.add(edge.source);
      relatedIds.add(edge.target);
    });
    const centerX = GRAPH_WIDTH / 2;
    const centerY = GRAPH_HEIGHT / 2;
    const radius = Math.min(centerX, centerY) - 60;
    const neighbors = Array.from(relatedIds).filter((id) => id !== selectedTable);

    const neighborPositions = neighbors.map((neighborId, index) => {
      const angle = (index / Math.max(neighbors.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return {
        id: neighborId,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      };
    });

    const positions = new Map<string, { x: number; y: number }>();
    positions.set(selectedTable, { x: centerX, y: centerY });
    neighborPositions.forEach((p) => positions.set(p.id, { x: p.x, y: p.y }));

    const getNodeMeta = (id: string) => graph.nodes.find((node) => node.id === id);

    return (
      <svg
        width={GRAPH_WIDTH}
        height={GRAPH_HEIGHT}
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        className="w-full h-full"
      >
        <defs>
          <linearGradient id="relationship-highlight" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#818cf8" />
          </linearGradient>
        </defs>
        {focusEdges.map((edge) => {
          const sourcePos = positions.get(edge.source);
          const targetPos = positions.get(edge.target);
          if (!sourcePos || !targetPos) return null;
          const isOutbound = edge.source === selectedTable;
          const lineStroke =
            edge.type === "inferred"
              ? "rgba(234,179,8,0.7)"
              : isOutbound
                ? highlightColor
                : "rgba(148,163,184,0.35)";
          return (
            <line
              key={`edge-${edge.id}`}
              x1={sourcePos.x}
              y1={sourcePos.y}
              x2={targetPos.x}
              y2={targetPos.y}
              stroke={lineStroke}
              strokeWidth={edge.type === "inferred" ? 2 : 3}
              strokeLinecap="round"
              strokeDasharray={edge.type === "inferred" ? "6 4" : undefined}
            />
          );
        })}
        {Array.from(relatedIds).map((nodeId) => {
          const pos = positions.get(nodeId);
          if (!pos) return null;
          const meta = getNodeMeta(nodeId);
          const label = meta?.englishAlias || meta?.name || nodeId;
          const isCenter = nodeId === selectedTable;
          return (
            <React.Fragment key={`node-${nodeId}`}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={isCenter ? 20 : 14}
                fill={isCenter ? "#0ff" : "#0ea5e9"}
                opacity={isCenter ? 1 : 0.8}
                stroke={highlightColor}
                strokeWidth={2}
                onClick={() => setSelectedTable(nodeId)}
                className="cursor-pointer"
              />
              <text
                x={pos.x}
                y={pos.y + (isCenter ? 30 : 26)}
                textAnchor="middle"
                className="text-[10px] font-semibold"
                fill="white"
              >
                {label}
              </text>
            </React.Fragment>
          );
        })}
      </svg>
    );
  };

  return (
    <>
      <section
      className={`rounded-2xl border flex flex-col gap-6 p-5 transition-all
        ${dark
          ? "dark:border-white/[0.08] dark:bg-[#131622]"
          : "light:border-gray-200 light:bg-white"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-500">Table Navigator</p>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Explore relationships
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Click a table to see every foreign key that links to or from it.
          </p>
        </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="flex items-center gap-1 px-3 py-1 rounded-full border text-[11px] font-semibold
                dark:border-white/10 dark:text-gray-200 light:border-gray-200 light:text-gray-600"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              onClick={() => setFullScreen((prev) => !prev)}
              className="flex items-center gap-1 px-3 py-1 rounded-full border text-[11px] font-semibold
                dark:border-white/10 dark:text-gray-200 light:border-gray-200 light:text-gray-600"
            >
              <Expand size={12} />
              {fullScreen ? "Exit full screen" : "View full screen"}
            </button>
          </div>
      </div>

      <div className="grid lg:grid-cols-[260px,1fr] gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-gray-500">Popular Tables</p>
              <h4 className="text-base font-semibold dark:text-gray-100">Top 50 by rows</h4>
            </div>
            <span className="text-xs text-gray-400">
              {usageRows.length} tables
            </span>
          </div>
          <div className="space-y-2 overflow-y-auto max-h-[480px]">
            {loading ? (
              <p className="text-sm text-gray-500">Loading table list…</p>
            ) : error ? (
              <p className="text-sm text-red-400">{error}</p>
            ) : usageRows.length === 0 ? (
              <p className="text-sm text-gray-500">No table data available.</p>
            ) : (
              usageRows.map((table) => {
                const tableKey = table.name.toLowerCase();
                const isActive = selectedTable === tableKey;
                return (
                    <button
                      key={table.name}
                      onClick={() => setSelectedTable(tableKey)}
                      className={`w-full text-left rounded-xl border px-3 py-2 transition-all
                        ${isActive
                          ? `border-cyan-400 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300`
                          : tablesWithRelations.has(tableKey)
                            ? "border-yellow-300/40 bg-yellow-100/40 dark:border-yellow-400/40 dark:bg-yellow-500/5 text-gray-800 dark:text-yellow-200"
                            : "border-transparent bg-gray-100/60 dark:bg-white/5 dark:border-white/5 text-gray-600 dark:text-gray-300"}`}
                    >
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span>{table.name}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {table.rowCount.toLocaleString()} rows
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {table.englishAlias || "alias unknown"}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
            <div className="relative rounded-2xl border p-3 bg-gradient-to-br from-slate-900 to-slate-950 text-white overflow-hidden">
              <div className="absolute inset-0 pointer-events-none">
                {renderGraph()}
              </div>
              <div className="absolute bottom-3 right-3 flex gap-2 text-[11px] uppercase tracking-[0.1em] text-white/70">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-white rounded-full" /> FK
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-amber-400 rounded-full" /> Inferred
                </span>
              </div>
            <div className="relative flex flex-col gap-1">
              <p className="text-[11px] uppercase tracking-[0.2em] text-teal-300/60">
                Relationship layout
              </p>
              <p className="text-sm text-white/80">
                Graph showing foreign-key links between tables.
              </p>
              <p className="text-xs text-white/60">
                {graph.nodes.length ? `${graph.nodes.length} tables · ${graph.edges.length} relationships` : "No relationships detected."}
              </p>
            </div>
          </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border p-4">
                <p className="text-xs uppercase text-gray-500">Selected Table</p>
                <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {selectedNode ? selectedNode.name : "Pick a table"}
                </h4>
              {selectedNode && (
                <p className="text-sm text-gray-500">
                  Alias: {selectedNode.englishAlias || "not available"}
                </p>
              )}
            </div>
              <div className="rounded-2xl border p-4 bg-gray-50/60 dark:bg-white/5">
                <p className="text-xs uppercase text-gray-500">Connections</p>
                {connections.length === 0 ? (
                  <p className="text-sm text-gray-500 mt-2">Select a table to see its links.</p>
                ) : (
                  <div className="flex flex-col gap-2 mt-2">
                    {connections.map((conn) => (
                      <div
                      key={conn.id}
                      className="rounded-xl border px-3 py-2 text-sm bg-white dark:bg-[#0b1120]"
                    >
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span className="capitalize">{conn.direction}</span>
                        <span>{conn.type === "fk" ? "Foreign key" : "Inferred"}</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {conn.table}
                      </p>
                      <p className="text-[11px] text-gray-500">Columns: {conn.columns}</p>
                      <p className="text-[11px] text-gray-500">
                        Updates: {conn.onUpdate ?? "default"} · Deletes: {conn.onDelete ?? "default"}
                      </p>
                      {conn.hint && (
                        <p className="text-[11px] text-amber-500/80">{conn.hint}</p>
                      )}
                      </div>
                    ))}
                  </div>
                )}
                {connections.length > 0 && (
                  <div className="mt-4 rounded-xl border border-dashed border-gray-300/50 dark:border-white/10 bg-white/60 dark:bg-white/5 p-3 text-[11px]">
                    <p className="mb-2 text-xs uppercase tracking-[0.2em] text-gray-500">
                      Relationship summary
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="pb-1 pr-2">Table</th>
                            <th className="pb-1 pr-2">Direction</th>
                            <th className="pb-1 pr-2">Columns</th>
                            <th className="pb-1 pr-2">Type</th>
                            <th className="pb-1">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {connections.map((conn) => (
                            <tr key={`summary-${conn.id}`} className="border-t border-gray-200/80 dark:border-white/10">
                              <td className="py-1 pr-2 font-semibold text-gray-900 dark:text-gray-100">
                                {conn.table}
                              </td>
                              <td className="py-1 pr-2 text-gray-600 dark:text-gray-300">
                                {conn.direction}
                              </td>
                              <td className="py-1 pr-2 text-gray-600 dark:text-gray-300">
                                {conn.columns}
                              </td>
                              <td
                                className={`py-1 pr-2 uppercase text-xs font-bold tracking-widest ${
                                  conn.type === "fk" ? "text-cyan-600" : "text-amber-600"
                                }`}
                              >
                                {conn.type}
                              </td>
                              <td className="py-1 text-gray-600 dark:text-gray-300">
                                {conn.hint || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
      {fullScreen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
          <div className="relative w-full max-w-6xl max-h-[92vh] rounded-3xl border border-white/20 bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-2xl">
            <button
              onClick={() => setFullScreen(false)}
              className="absolute top-4 right-4 rounded-full border border-white/30 p-2 text-white/80 hover:text-white hover:border-white"
            >
              <X size={16} />
            </button>
            <div className="mb-3 flex flex-col gap-2">
              <p className="text-sm font-semibold text-white">Relationship graph — full-screen</p>
              <p className="text-xs text-white/70">
                Click on any node to focus it; inferred connections are dashed orange lines.
              </p>
            </div>
              <div className="w-full h-[70vh] rounded-2xl border border-white/10 bg-white/5 p-4">
              {renderGraph()}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
export default TableRelationshipExplorer;
