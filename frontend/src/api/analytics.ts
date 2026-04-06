// analytics.ts - API layer for analytics dashboard
// Connected to backend analytics endpoints.

export interface ChartData {
  name: string;
  value: number;
  secondary?: number;
}

export interface InsightData {
  id: string;
  title: string;
  value: string;
  change: number;
  trend: "up" | "down" | "neutral";
  description: string;
}

export interface TableUsageRow {
  name: string;
  englishAlias: string;
  rowCount: number;
}

export interface TableRelationshipNode {
  id: string;
  name: string;
  englishAlias?: string;
}

export interface TableRelationshipEdge {
  id: string;
  source: string;
  target: string;
  parentColumns: string;
  referencedColumns: string;
  onDelete: string;
  onUpdate: string;
  type: "fk" | "inferred";
  inferredReason?: string;
}

export interface TableRelationshipGraph {
  nodes: TableRelationshipNode[];
  edges: TableRelationshipEdge[];
}

export interface SqlResult {
  columns: string[];
  rows: (string | number | null)[][];
  rowCount: number;
  executionTime: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  sqlQuery?: string;
  chartData?: ChartData[];
}

type Primitive = string | number | boolean | null;
type ResultRow = Record<string, Primitive>;

interface QueryApiResponse {
  success: boolean;
  data: {
    query: string;
    generatedSQL: string;
    result: ResultRow[] | ResultRow;
    summary?: string;
    insights?: string[];
    metadata: {
      recordCount: number;
      executionTime: number;
      masked: boolean;
      requestId: string;
    };
  };
}


interface InsightsApiResponse {
  success: boolean;
  data: {
    totalQueries: number;
    activeSessions: number;
    avgQueryTime: number;
    successRate: number;
  };
}

interface ChartApiResponse {
  success: boolean;
  data: Array<{ date: string; value: number }>;
}

const API_BASE = "http://localhost:3001/api/analytics";

export function getAuthToken(): string {
  return localStorage.getItem("jwt_token") || "";
}

async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

function normalizeRows(result: QueryApiResponse["data"]["result"]): ResultRow[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") return [result];
  return [];
}

function rowsToTable(rows: ResultRow[]): { columns: string[]; matrix: (string | number | null)[][] } {
  if (rows.length === 0) {
    return { columns: [], matrix: [] };
  }

  const columns = Object.keys(rows[0]);
  const matrix = rows.map((row) =>
    columns.map((column) => {
      const value = row[column];
      if (value === null || typeof value === "string" || typeof value === "number") {
        return value;
      }
      return String(value);
    })
  );

  return { columns, matrix };
}


function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toLabel(value: unknown): string {
  if (typeof value === "string") {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return value;
  }
  return String(value ?? "");
}

export async function fetchInsights(): Promise<InsightData[]> {
  try {
    const result = await apiCall<InsightsApiResponse>("/analytics/insights");

    const data = result.data;
    console.log("Fetched insights data:", data)

    return [
      {
        id: "1",
        title: "Total Queries",
        value: Number(data.totalQueries).toLocaleString(),
        change: 0,
        trend: "up",
        description: "All time",
      },
      {
        id: "2",
        title: "Active Sessions",
        value: data.activeSessions.toString(),
        change: 0,
        trend: "up",
        description: "Currently online",
      },
      {
        id: "3",
        title: "Avg Query Time",
        value: `${data.avgQueryTime}ms`,
        change: 0,
        trend: "down",
        description: "Execution time",
      },
      {
        id: "4",
        title: "Success Rate",
        value: `${data.successRate}%`,
        change: 0,
        trend: "up",
        description: "SQL execution rate",
      },
    ];
  } catch (error) {
    console.error("Failed to fetch insights:", error);

    return [
      {
        id: "1",
        title: "Connection Error",
        value: "--",
        change: 0,
        trend: "neutral",
        description: "Unable to connect to backend",
      },
    ];
  }
}

export async function fetchChartData(
  metric: "revenue" | "users" | "queries" | "latency"
): Promise<ChartData[]> {
  try {
    const response = await apiCall<ChartApiResponse>(`/chart/${metric}`);
    // backend returns { success: true, data: rows }
    const rows = response?.data;
    console.log(`Fetched ${metric} chart data:`, rows);

    if (!Array.isArray(rows) || rows.length === 0) {
      return generateChartFallback();
    }

    return rows.slice(0, 12).map((row: Record<string, unknown>) => ({
      name: toLabel(row.date),
      value: Math.round(toNumber(row.value)),
    }));
  } catch (error) {
    console.error(`Failed to fetch ${metric} chart data:`, error);
    return generateChartFallback();
  }
}

interface TableUsageApiResponse {
  success: boolean;
  data: TableUsageRow[];
}

interface TableRelationshipApiResponse {
  success: boolean;
  data: TableRelationshipGraph;
}

export async function fetchTableUsage(): Promise<TableUsageRow[]> {
  const response = await apiCall<TableUsageApiResponse>("/table-usage");
  return response.data;
}

export async function fetchTableRelationships(): Promise<TableRelationshipGraph> {
  const response = await apiCall<TableRelationshipApiResponse>("/table-relationships");
  return response.data;
}

function generateChartFallback(): ChartData[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  return months.map((name) => ({
    name,
    value: Math.floor(Math.random() * 100) + 50,
  }));
}

export async function runSqlQuery(query: string): Promise<SqlResult> {
  try {
    const startTime = performance.now();

    const result = await apiCall<QueryApiResponse>("/query", {
      method: "POST",
      body: JSON.stringify({
        query,
        masked: true,
      }),
    });
    const rows = normalizeRows(result.data.result);
    const { columns, matrix } = rowsToTable(rows);
    const rowCount = result.data.metadata.recordCount ?? matrix.length;
    const executionTime = result.data.metadata.executionTime ?? Math.round(performance.now() - startTime);

    return {
      columns,
      rows: matrix,
      rowCount,
      executionTime,
    };
  } catch (error) {
    console.error("Query execution failed:", error);
    throw error;
  }
}

export async function sendChatMessage(
_messages: ChatMessage[],
userMessage: string
): Promise<ChatMessage> {
try {
const response = await apiCall<{ success: boolean; data: { response: string } }>(
"/chat",
{
method: "POST",
body: JSON.stringify({
message: userMessage
}),
}
);
return {
  id: crypto.randomUUID(),
  role: "assistant",
  content: response.data.response,
  timestamp: new Date(),
};

} catch (error) {
console.error("Chat message failed:", error);
return {
  id: crypto.randomUUID(),
  role: "assistant",
  content: `Error: ${
    error instanceof Error ? error.message : "Unknown error"
  }`,
  timestamp: new Date(),
};

}
}


export function setAuthToken(token: string): void {
  localStorage.setItem("jwt_token", token);
}

export function clearAuthToken(): void {
  localStorage.removeItem("jwt_token");
}

export async function authenticate(
  userId: string,
  password: string
): Promise<string> {
  try {
    const response = await fetch("http://localhost:3001/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, password }),
    });

    if (!response.ok) throw new Error("Authentication failed");

    const data = (await response.json()) as { token: string };
    setAuthToken(data.token);
    return data.token;
  } catch (error) {
    console.error("Authentication error:", error);
    throw error;
  }
}

export async function logoutSession(): Promise<void> {
  await apiCall<{ success: boolean }>("/analytics/logout-session", {
    method: "POST",
  });
}

// ─────────────────────────────────────────────────────────────
// NATURAL LANGUAGE TO SQL API
// ─────────────────────────────────────────────────────────────

export interface NL2SQLRequest {
  query: string;
  maxRows?: number;
  allowFallback?: boolean;
  temperature?: number;
}

export interface NL2SQLResult {
  query: string;
  sql: string;
  results: ResultRow[];
  resultCount: number;
  executionTime: number;
  cached?: boolean;
  warnings?: string[];
}

export interface NL2SQLError {
  type: 'HALLUCINATION' | 'VALIDATION' | 'EXECUTION' | 'PARSE_ERROR' | 'SCHEMA_ERROR' | 'UNKNOWN_ERROR';
  message: string;
  details?: Record<string, unknown>;
  fallbackAvailable?: boolean;
  suggestions?: string[];
}

export interface NL2SQLResponse {
  success: boolean;
  data?: NL2SQLResult;
  error?: NL2SQLError;
}

/**
 * Convert natural language query to SQL and execute
 * 
 * Examples:
 * - "find all orders of customer X from 2024"
 * - "calculate the total profit we made with software Y in 2025"
 * - "what is the expected interval for maintenance at company Z"
 */
export async function queryNaturalLanguage(
  request: NL2SQLRequest
): Promise<NL2SQLResponse> {
  try {
    const response = await apiCall<{
      success: boolean;
      data?: NL2SQLResult;
      error?: NL2SQLError;
    }>("/nl-query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    return response;
  } catch (error) {
    console.error("NL2SQL query error:", error);
    return {
      success: false,
      error: {
        type: 'EXECUTION',
        message: `Failed to execute query: ${(error as Error).message}`,
        fallbackAvailable: true,
      },
    };
  }
}

/**
 * Validate a natural language query without executing
 */
export async function validateNaturalLanguageQuery(
  query: string
): Promise<{
  success: boolean;
  sql?: string;
  error?: Record<string, unknown>;
  warnings?: string[];
}> {
  try {
    const response = await apiCall<{
      success: boolean;
      sql?: string;
      error?: Record<string, unknown>;
      warnings?: string[];
    }>("/nl-query-validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    return response;
  } catch (error) {
    console.error("NL2SQL validation error:", error);
    return {
      success: false,
      error: {
        type: 'VALIDATION',
        message: (error as Error).message,
      },
    };
  }
}

