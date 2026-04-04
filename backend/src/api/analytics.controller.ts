import { Router, Request, Response } from 'express';
import dotenv from 'dotenv';
import { LLMClient } from '../ai/llmClient';
import { DatabaseClient } from '../sql/dbClient';
import { requirePermission } from '../security/rbac';
import { tableTranslations } from '../semantic/tableTranslations';
import {
  getTranslationForGermanName,
} from './analytics/schemaContext';
import axios from 'axios';

const router = Router();

dotenv.config();

const llmClient = new LLMClient();

const dbClient = new DatabaseClient({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME || 'ERP42test',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  trustedConnection: process.env.DB_TRUSTED_CONNECTION === 'true',
  encrypt: process.env.DB_ENCRYPT === 'true',
  trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
});

export const analyticsSchemaReady = dbClient
  .ensureAnalyticsSchema()
  .then(() => console.log('Analytics helper tables ensured'))
  .catch((err) => {
    console.error('Failed to ensure analytics helper tables', err);
    throw err;
  });

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, temperature = 0.7 } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Message is required',
      });
    }

    const response = await llmClient.chat(
      [{ role: 'user', content: message }],
      { temperature }
    );

    return res.json({ success: true, data: { message, response } });
  } catch (error) {
    console.error('Chat route error:', error);
    return res.status(500).json({
      error: 'CHAT_ERROR',
      message: (error as Error).message,
    });
  }
});

router.get('/table-usage', requirePermission('analytics:query:read'), async (req, res) => {
  try {
    const rows = await dbClient.getRows<{ name: string; row_count: number }>(`
      SELECT TOP 50
        t.name,
        SUM(p.rows) AS row_count
      FROM sys.tables t
      JOIN sys.partitions p ON p.object_id = t.object_id
      WHERE p.index_id IN (0, 1)
      GROUP BY t.name
      ORDER BY SUM(p.rows) DESC;
    `);

    const translations = tableTranslations.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.germanName.toLowerCase()] = entry.englishAlias;
      return acc;
    }, {});

    const payload = rows.map((row) => ({
      name: row.name,
      englishAlias: translations[row.name.toLowerCase()] || '',
      rowCount: Number(row.row_count ?? 0),
    }));

    res.status(200).json({ success: true, data: payload });
  } catch (error) {
    console.error('Table usage fetch failed', error);
    res.status(500).json({
      success: false,
      error: 'TABLE_USAGE_ERROR',
      message: (error as Error).message,
    });
  }
});

router.get('/table-relationships', requirePermission('analytics:query:read'), async (req, res) => {
  try {
    const fkRows = await dbClient.getRows<{
      constraintName: string;
      parentTable: string;
      referencedTable: string;
      parentColumns: string;
      referencedColumns: string;
      onDelete: string;
      onUpdate: string;
    }>(`
      SELECT
        fk.name AS constraintName,
        parentTab.name AS parentTable,
        referencedTab.name AS referencedTable,
        fk.delete_referential_action_desc AS onDelete,
        fk.update_referential_action_desc AS onUpdate,
        STRING_AGG(parentCol.name, ', ') AS parentColumns,
        STRING_AGG(refCol.name, ', ') AS referencedColumns
      FROM sys.foreign_keys fk
      INNER JOIN sys.tables parentTab ON fk.parent_object_id = parentTab.object_id
      INNER JOIN sys.tables referencedTab ON fk.referenced_object_id = referencedTab.object_id
      INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      INNER JOIN sys.columns parentCol ON parentCol.object_id = parentTab.object_id AND parentCol.column_id = fkc.parent_column_id
      INNER JOIN sys.columns refCol ON refCol.object_id = referencedTab.object_id AND refCol.column_id = fkc.referenced_column_id
      GROUP BY fk.name, parentTab.name, referencedTab.name, fk.delete_referential_action_desc, fk.update_referential_action_desc
      ORDER BY fk.name;
    `);

    const nodeMap = new Map<string, { id: string; name: string; englishAlias: string }>();
    const edgeKeySet = new Set<string>();
    const edges: Array<{
      id: string;
      source: string;
      target: string;
      parentColumns: string;
      referencedColumns: string;
      onDelete: string;
      onUpdate: string;
      type: 'fk' | 'inferred';
      inferredReason?: string;
    }> = [];

    const ensureNode = (tableName: string) => {
      const normalized = tableName.toLowerCase();
      if (nodeMap.has(normalized)) return;
      const translation = getTranslationForGermanName(tableName);
      nodeMap.set(normalized, {
        id: normalized,
        name: tableName,
        englishAlias: translation?.englishAlias || translation?.germanName || tableName,
      });
    };

    fkRows.forEach((row) => {
      const parentKey = row.parentTable.toLowerCase();
      const referencedKey = row.referencedTable.toLowerCase();
      ensureNode(row.parentTable);
      ensureNode(row.referencedTable);
      const key = `${parentKey}-${referencedKey}-${row.parentColumns}`;
      edgeKeySet.add(key);
      edges.push({
        id: `${row.constraintName}_${parentKey}_${referencedKey}`,
        source: parentKey,
        target: referencedKey,
        parentColumns: row.parentColumns,
        referencedColumns: row.referencedColumns,
        onDelete: row.onDelete,
        onUpdate: row.onUpdate,
        type: 'fk',
      });
    });

    const keyColumnRows = await dbClient.getRows<{
      tableName: string;
      columnName: string;
      isKey: number;
    }>(`
      SELECT
        kcu.TABLE_NAME AS tableName,
        kcu.COLUMN_NAME AS columnName,
        CASE WHEN tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE') THEN 1 ELSE 0 END AS isKey
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
      WHERE kcu.TABLE_SCHEMA = 'dbo'
        AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE');
    `);

    const columnTableMap = new Map<string, { table: string; isKey: boolean }[]>();
    keyColumnRows.forEach((row) => {
      const key = row.columnName.toLowerCase();
      const entries = columnTableMap.get(key) || [];
      entries.push({ table: row.tableName.toLowerCase(), isKey: Boolean(row.isKey) });
      columnTableMap.set(key, entries);
    });

    columnTableMap.forEach((entries, column) => {
      if (entries.length < 2) return;
      entries.forEach((entry) => ensureNode(entry.table));
      const keyTables = entries.filter((entry) => entry.isKey);
      const otherTables = entries.filter((entry) => !entry.isKey);

      const children = otherTables.length > 0 ? otherTables : entries;
      const parents = keyTables.length > 0 ? keyTables : entries;

      children.forEach((child) => {
        parents.forEach((parent) => {
          if (child.table === parent.table) return;
          const edgeKey = `${child.table}-${parent.table}-${column}`;
          if (edgeKeySet.has(edgeKey)) return;
          edgeKeySet.add(edgeKey);
          edges.push({
            id: `inferred_${column}_${child.table}_${parent.table}`,
            source: child.table,
            target: parent.table,
            parentColumns: column,
            referencedColumns: column,
            onDelete: 'INFERRED',
            onUpdate: 'INFERRED',
            type: 'inferred',
            inferredReason: `Shared key column ${column}`,
          });
        });
      });
    });

    res.status(200).json({
      success: true,
      data: {
        nodes: Array.from(nodeMap.values()),
        edges,
      },
    });
  } catch (error) {
    console.error('Table relationships fetch failed', error);
    res.status(500).json({
      success: false,
      error: 'TABLE_RELATIONSHIP_ERROR',
      message: (error as Error).message,
    });
  }
});

router.get('/chart/:metric', async (req: Request, res: Response) => {
  const { metric } = req.params;
  const startTime = Date.now();

  try {
    let query = '';
    switch (metric) {
      case 'revenue':
        query = `
          SELECT TOP 30 metric_date AS date, value
          FROM financial_metrics
          WHERE metric_type = 'REVENUE'
          ORDER BY metric_date DESC;
        `;
        break;
      case 'queries':
        query = `
          SELECT TOP 30 CAST(created_at AS DATE) AS date,
                 COUNT(*) AS value
          FROM query_history
          GROUP BY CAST(created_at AS DATE)
          ORDER BY date DESC;
        `;
        break;
      case 'latency':
        query = `
          SELECT TOP 30 CAST(created_at AS DATE) AS date,
                 ROUND(AVG(execution_time), 0) AS value
          FROM query_history
          GROUP BY CAST(created_at AS DATE)
          ORDER BY date DESC;
        `;
        break;
      case 'users':
        query = `
          SELECT TOP 30 CAST(login_time AS DATE) AS date,
                 COUNT(DISTINCT user_id) AS value
          FROM user_sessions
          GROUP BY CAST(login_time AS DATE)
          ORDER BY date DESC;
        `;
        break;
      default:
        console.error(`[CHART] Invalid metric requested: ${metric}`);
        return res.status(400).json({ error: 'Invalid metric' });
    }

    const result = await dbClient.query(query);
    if (!result.rows || result.rows.length === 0) {
      console.warn(`[CHART] Empty result set | metric=${metric}`);
    }

    return res.json({ success: true, data: result.rows });
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error(`[CHART] ERROR | metric=${metric} | duration=${duration}ms`);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    return res.status(500).json({
      error: 'CHART_ERROR',
      message: err.message,
    });
  }
});
router.post('/query', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  const requestId = (req as any).id;

  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Query is required',
        requestId,
      });
    }

    const sql = query.trim();

    // optional basic safety (can remove if you want 100% raw)
    if (!/^(SELECT|WITH)\b/i.test(sql)) {
      return res.status(400).json({
        error: 'INVALID_SQL',
        message: 'Only SELECT/WITH allowed',
        requestId,
      });
    }
    console.log(`[QUERY][SQL]`, sql);

    const start = Date.now();

    const result = await dbClient.query(sql);

    const duration = Date.now() - start;


    return res.status(200).json({
      success: true,
      data: {
        result: result.rows,
        metadata: {
          recordCount: result.rows.length,
          executionTime: duration,
          requestId,
        },
      },
    });

  } catch (error) {
    console.error(`[QUERY][ERROR] requestId=${requestId}`, error);

    return res.status(500).json({
      error: 'QUERY_ERROR',
      message: (error as Error).message,
      requestId,
    });
  }
});
router.get(
  '/analytics/insights',
  requirePermission('analytics:query:read'),
  async (req: Request, res: Response) => {
    try {
      const totalQueries = await dbClient.query('SELECT COUNT(*) AS count FROM query_history');
      const activeSessions = await dbClient.query(
        `
        SELECT COUNT(*) AS count
        FROM user_sessions
        WHERE is_active = 1
      `
      );
      const avgQueryTime = await dbClient.query(
        `
        SELECT AVG(execution_time) AS avg
        FROM query_history
        WHERE execution_time IS NOT NULL
      `
      );
      const successRate = await dbClient.query(
        `
        SELECT 
          ROUND((SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0)) * 100, 2) AS rate
        FROM query_history;
      `
      );

      return res.json({
        success: true,
        data: {
          totalQueries: totalQueries.rows[0].count,
          activeSessions: activeSessions.rows[0].count,
          avgQueryTime: Math.round(avgQueryTime.rows[0].avg || 0),
          successRate: successRate.rows[0].rate || 0,
        },
      });
    } catch (error) {
      return res.status(500).json({
        error: 'INSIGHTS_ERROR',
        message: (error as Error).message,
      });
    }
  }
);
/**
 * Natural Language → SQL Route
 * Database: ERP42test (SQL Server / T-SQL)
 * Supports: English + German queries
 * Intents: search | math | stats
 */

type Intent = 'search' | 'math' | 'stats' | 'unknown';

// ─────────────────────────────────────────────────────────────
// TABLE SORT ORDERS — used in fallback SQL per table
// kunde has no Datum — use Kundennumm instead
// ─────────────────────────────────────────────────────────────

const TABLE_ORDER_COL: Record<string, string> = {
  auftrag:  'Datum DESC',
  rechnung: 'Datum DESC',
  anposten: 'Datum DESC',
  reposten: 'Datum DESC',
  liefer:   'Datum DESC',
  kontakt:  'Datum DESC',
  waren:    'Datum DESC',
  lagerbuc: 'Datum DESC',
  zeitraum: 'Jahr DESC, Monat DESC',
  bestatus: 'ID',
  artbest:  'Artikelnum',
  kunde:    'Kundennumm',   // ← no Datum column on kunde
};

function getOrderCol(table: string): string {
  return TABLE_ORDER_COL[table] ?? '(SELECT NULL)';
}

// ─────────────────────────────────────────────────────────────
// HARDCODED SCHEMA
// ─────────────────────────────────────────────────────────────

const STATIC_SCHEMA: Record<string, string> = {
  auftrag: `auftrag (orders):
  Auftragid uniqueidentifier PK
  Nummer varchar            -- order number, links to anposten.Nummer
  Datum datetime            -- order date -> YEAR(Datum) for year filter
  Kundennumm varchar        -- customer number -> JOIN kunde ON Kundennumm
  Name varchar              -- customer name on order
  Summe decimal             -- net total
  Rohgesamt decimal         -- gross profit total
  Erstellt datetime`,

  kunde: `kunde (customers):
  Kundenid uniqueidentifier PK
  Kundennumm varchar        -- customer number -> JOIN auftrag/rechnung/kontakt ON Kundennumm
  Name varchar              -- company name -> LIKE '%X%' for search
  Vorname varchar           -- first name
  Matchcode varchar         -- short search code
  Ort varchar               -- city
  Land varchar              -- country
  Email varchar
  Telefon varchar
  Branche varchar           -- industry`,

  kontakt: `kontakt (customer interactions):
  Kontaktid uniqueidentifier PK
  Kundennumm varchar        -- -> JOIN kunde ON Kundennumm
  Datum datetime            -- contact date
  Art varchar               -- contact type
  Grund varchar             -- reason
  Uhrzeit datetime          -- start time
  Bis datetime              -- end time -> DATEDIFF(minute,Uhrzeit,Bis) for duration
  Erledigt varchar
  Bearbeiter varchar`,

  rechnung: `rechnung (invoices):
  Rechnungid uniqueidentifier PK
  Nummer varchar            -- invoice number -> links to reposten.Nummer
  Datum datetime
  Kundennumm varchar        -- -> JOIN kunde ON Kundennumm
  Name varchar
  Summe decimal
  Rohgesamt decimal         -- gross profit
  Faelligam datetime`,

  anposten: `anposten (order line items):
  Postenid uniqueidentifier PK
  Nummer varchar            -- -> JOIN auftrag ON Nummer
  Artikelnum varchar        -- -> JOIN artbest ON Artikelnum
  Bezeichnun varchar        -- product description -> LIKE '%Y%' for product search
  Datum datetime
  Anzahl decimal            -- quantity
  Einzelprei decimal        -- unit price
  Betrag decimal            -- line amount
  Rohgewinn decimal         -- GROSS PROFIT per line <- use for profit queries
  Rohgewinnp decimal        -- gross profit %
  Kundennumm varchar`,

  reposten: `reposten (invoice line items):
  Postenid uniqueidentifier PK
  Nummer varchar            -- -> JOIN rechnung ON Nummer
  Artikelnum varchar
  Bezeichnun varchar
  Datum datetime
  Anzahl decimal
  Betrag decimal
  Rohgewinn decimal         -- GROSS PROFIT per line
  Kundennumm varchar`,

  artbest: `artbest (item/product master):
  Artbestid uniqueidentifier PK
  Artikelnum varchar        -- article number (unique key)
  Anzahl decimal            -- stock qty
  Einkauf decimal           -- purchase price
  Verkauf decimal           -- sales price`,

  liefer: `liefer (deliveries):
  Liefersche uniqueidentifier PK
  Nummer varchar
  Datum datetime
  Kundennumm varchar        -- -> JOIN kunde ON Kundennumm
  Name varchar
  Wartung varchar           -- MAINTENANCE FLAG: 'J' = yes
  Summe decimal
  Lieferdatu datetime`,

  zeitraum: `zeitraum (accounting periods):
  Zeitraumid uniqueidentifier PK
  Zeitraum varchar          -- label e.g. '2024-01'
  Monat int                 -- month 1-12
  Jahr int                  -- year e.g. 2024
  Anfang datetime`,

  bestatus: `bestatus (document status):
  ID uniqueidentifier PK
  Belegid uniqueidentifier  -- links to auftrag.Auftragid or rechnung.Rechnungid
  Formart varchar
  Lieferbar varchar`,
};

const ALL_KNOWN_TABLES = Object.keys(STATIC_SCHEMA);

// ─────────────────────────────────────────────────────────────
// JOIN RULES
// ─────────────────────────────────────────────────────────────

const JOIN_RULES = `JOINS (use exactly these, never guess):
  auftrag  -> kunde    : auftrag.Kundennumm = kunde.Kundennumm
  rechnung -> kunde    : rechnung.Kundennumm = kunde.Kundennumm
  liefer   -> kunde    : liefer.Kundennumm = kunde.Kundennumm
  kontakt  -> kunde    : kontakt.Kundennumm = kunde.Kundennumm
  anposten -> auftrag  : anposten.Nummer = auftrag.Nummer
  reposten -> rechnung : reposten.Nummer = rechnung.Nummer
  anposten -> artbest  : anposten.Artikelnum = artbest.Artikelnum
  reposten -> artbest  : reposten.Artikelnum = artbest.Artikelnum
  bestatus -> auftrag  : bestatus.Belegid = auftrag.Auftragid`;

// ─────────────────────────────────────────────────────────────
// INTENT DETECTION
// ─────────────────────────────────────────────────────────────

type IntentConfig = { pattern: RegExp; tables: string[] };

const INTENT_CONFIG: Record<Intent, IntentConfig> = {
  math: {
    pattern: /\b(total|sum|profit|revenue|cost|calculate|calc|average|avg|count|amount|earn|margin|how much|wie viel|gesamt|summe|gewinn|umsatz|kosten|berechne|ertrag|marge|einnahmen|rohgewinn)\b/i,
    tables: ['anposten', 'rechnung', 'reposten', 'auftrag'],
  },
  stats: {
    pattern: /\b(statistics|stats|average|mean|interval|maintenance|expected|trend|frequency|distribution|analyze|analyse|wartung|intervall|erwart|statistik|mittelwert|verteilung|prognose|durchschnitt)\b/i,
    tables: ['kontakt', 'liefer', 'zeitraum', 'artbest'],
  },
  search: {
    pattern: /\b(find|search|show|list|get|where|who|which|all|filter|look|finde|suche|zeige|liste|welche|alle|wo|wer|zeig|gib|display|give)\b/i,
    tables: ['auftrag', 'kunde', 'rechnung', 'liefer'],
  },
  unknown: { pattern: /.*/, tables: ['auftrag', 'kunde'] },
};

function detectIntent(query: string): Intent {
  for (const intent of (['math', 'stats', 'search'] as Intent[])) {
    if (INTENT_CONFIG[intent].pattern.test(query)) return intent;
  }
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────
// TABLE DETECTION
// ─────────────────────────────────────────────────────────────

const TABLE_KEYWORDS: Record<string, string[]> = {
  auftrag:  ['auftrag', 'order', 'orders', 'bestellung'],
  kunde:    ['kunde', 'kunden', 'customer', 'customers', 'client', 'firma', 'name'],
  kontakt:  ['kontakt', 'contact', 'contacts', 'interaction'],
  rechnung: ['rechnung', 'rechnungen', 'invoice', 'invoices'],
  anposten: ['anposten', 'order line'],
  reposten: ['reposten', 'invoice line'],
  artbest:  ['artbest', 'artikel', 'article', 'product', 'products', 'item', 'software'],
  liefer:   ['liefer', 'lieferung', 'delivery', 'deliveries', 'wartung', 'maintenance'],
  zeitraum: ['zeitraum', 'period', 'monat', 'month'],
  bestatus: ['bestatus', 'status'],
};

function detectTablesFromQuery(query: string): string[] {
  const lower = query.toLowerCase();
  const found = new Set<string>();
  for (const [table, keywords] of Object.entries(TABLE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { found.add(table); break; }
    }
  }
  return [...found];
}

function isValidSQL(sql: string): boolean {
  if (!sql) return false;

  const s = sql.trim().toUpperCase();

  // must start with SELECT or WITH
  if (!/^(SELECT|WITH)\b/.test(s)) return false;

  // reject obvious garbage
  const invalidPatterns = [
    /RULES/i,
    /JOINS/i,
    /SCHEMA/i,
    /READ USER/i,
    /USE ONLY/i,
    /DO NOT/i,
    /\bONLY\b/, // your bug source
    /\bQUESTION\b/,
  ];

  for (const pattern of invalidPatterns) {
    if (pattern.test(sql)) return false;
  }

  // must contain FROM
  if (!/\bFROM\b/i.test(sql)) return false;

  return true;
}
// ─────────────────────────────────────────────────────────────
// FALLBACK SQL — schema-aware, no bad column guesses
// ─────────────────────────────────────────────────────────────

function buildFallbackSQL(intent: Intent, primaryTable: string): string {
  const orderCol = getOrderCol(primaryTable);

  switch (intent) {
    case 'math':
      if (primaryTable === 'anposten' || primaryTable === 'reposten') {
        return `SELECT SUM(Rohgewinn) AS total_profit, SUM(Betrag) AS total_revenue, COUNT(*) AS line_count FROM ${primaryTable};`;
      }
      return `SELECT SUM(Rohgesamt) AS total_profit, SUM(Summe) AS total_revenue, COUNT(*) AS order_count FROM auftrag;`;

    case 'stats':
      if (primaryTable === 'kontakt') {
        return `SELECT AVG(DATEDIFF(minute, Uhrzeit, Bis)) AS avg_duration_min, COUNT(*) AS total_contacts FROM kontakt WHERE Uhrzeit IS NOT NULL AND Bis IS NOT NULL;`;
      }
      if (primaryTable === 'liefer') {
        return `SELECT COUNT(*) AS total_deliveries, SUM(CASE WHEN Wartung = 'J' THEN 1 ELSE 0 END) AS maintenance_count FROM liefer;`;
      }
      return `SELECT COUNT(*) AS record_count FROM ${primaryTable};`;

    case 'search':
    default:
      // Safe fallback: specific columns for kunde (no Datum), generic * for others
      if (primaryTable === 'kunde') {
        return `SELECT TOP 100 Kundennumm, Name, Vorname, Ort, Email, Telefon FROM kunde ORDER BY Kundennumm;`;
      }
      return `SELECT TOP 100 * FROM ${primaryTable} ORDER BY ${orderCol};`;
  }
}

// ─────────────────────────────────────────────────────────────
// DIRECT SQL — pattern-matched queries that phi consistently
// gets wrong. We extract values from the query text and build
// the SQL ourselves — guaranteed correct T-SQL every time.
//
// Covers:
//   A) Simple listings   "show me customers"
//   B) Search with name  "find orders of customer X from 2024"
//   C) Math with product "total profit for software Y in 2025"
//   D) Stats             "maintenance interval for company Z"
// ─────────────────────────────────────────────────────────────

function tryDirectMatch(query: string): string | null {
  const q = query.trim();

  // ── A. SIMPLE LISTINGS (no filters) ──────────────────────────

  if (/^\s*(show\s*(me)?|list|get|display|zeige|liste|gib\s*mir?)\s*(me\s+|all\s+|alle\s+|mir\s+)?(the\s+)?(customers?|kunden?|clients?)\s*(name[s]?)?\s*$/i.test(q)) {
    return `SELECT TOP 100 Kundennumm, Name, Vorname, Ort, Land, Email, Telefon FROM kunde ORDER BY Name;`;
  }
  if (/^\s*(show\s*(me)?|list|get|display|zeige|liste)\s*(me\s+|all\s+|alle\s+|mir\s+)?(the\s+)?(orders?|auftr[äa]ge?)\s*$/i.test(q)) {
    return `SELECT TOP 100 Nummer, Datum, Name, Summe, Rohgesamt FROM auftrag ORDER BY Datum DESC;`;
  }
  if (/^\s*(show\s*(me)?|list|get|display|zeige|liste)\s*(me\s+|all\s+|alle\s+|mir\s+)?(the\s+)?(invoices?|rechnungen?)\s*$/i.test(q)) {
    return `SELECT TOP 100 Nummer, Datum, Name, Summe, Rohgesamt FROM rechnung ORDER BY Datum DESC;`;
  }
  if (/^\s*(show\s*(me)?|list|get|display|zeige|liste)\s*(me\s+|all\s+|alle\s+|mir\s+)?(the\s+)?(deliveries|lieferungen?)\s*$/i.test(q)) {
    return `SELECT TOP 100 Nummer, Datum, Name, Summe, Lieferdatu FROM liefer ORDER BY Datum DESC;`;
  }
  if (/^\s*(show\s*(me)?|list|get|display|zeige|liste)\s*(me\s+|all\s+|alle\s+|mir\s+)?(the\s+)?(contacts?|kontakte?)\s*$/i.test(q)) {
    return `SELECT TOP 100 Kundennumm, Datum, Art, Grund, Bearbeiter FROM kontakt ORDER BY Datum DESC;`;
  }
  if (/^\s*(show\s*(me)?|list|get|display|zeige|liste)\s*(me\s+|all\s+|alle\s+|mir\s+)?(the\s+)?(products?|articles?|items?|artikel)\s*$/i.test(q)) {
    return `SELECT TOP 100 Artikelnum, Anzahl, Einkauf, Verkauf FROM artbest ORDER BY Artikelnum;`;
  }

  // ── B. SEARCH: orders/invoices/deliveries of customer X [from YEAR] ──
  // Handles: "find all orders of customer Dieckmann from 2024"
  //          "zeige Aufträge von Kunde Müller 2023"
  //          "find orders for Dieckmann"

  const orderCustomerMatch = q.match(
    /\b(orders?|auftr[äa]ge?)\b.{0,40}\b(of|for|von|f[üu]r|customer|kunde)\b\s+([A-Za-zÄÖÜäöüß-]+)(?:.{0,20}\b(20\d{2})\b)?/i
  );
  if (orderCustomerMatch) {
    const name = orderCustomerMatch[3].trim();
    const year = orderCustomerMatch[4];
    const yearClause = year ? ` AND YEAR(a.Datum) = ${year}` : '';
    return `SELECT TOP 100 a.Nummer, a.Datum, a.Name, a.Summe, a.Rohgesamt\nFROM auftrag a\nJOIN kunde k ON a.Kundennumm = k.Kundennumm\nWHERE k.Name LIKE '%${name}%'${yearClause}\nORDER BY a.Datum DESC;`;
  }

  const invoiceCustomerMatch = q.match(
    /\b(invoices?|rechnungen?)\b.{0,40}\b(of|for|von|f[üu]r|customer|kunde)\b\s+([A-Za-zÄÖÜäöüß-]+)(?:.{0,20}\b(20\d{2})\b)?/i
  );
  if (invoiceCustomerMatch) {
    const name = invoiceCustomerMatch[3].trim();
    const year = invoiceCustomerMatch[4];
    const yearClause = year ? ` AND YEAR(r.Datum) = ${year}` : '';
    return `SELECT TOP 100 r.Nummer, r.Datum, r.Name, r.Summe, r.Rohgesamt\nFROM rechnung r\nJOIN kunde k ON r.Kundennumm = k.Kundennumm\nWHERE k.Name LIKE '%${name}%'${yearClause}\nORDER BY r.Datum DESC;`;
  }

  // ── C. MATH: profit/revenue for product Y [in YEAR] ──────────
  // Handles: "calculate total profit we made with software Y in 2025"
  //          "total revenue for product X"
  //          "berechne Gewinn für Artikel Y in 2024"

  const profitProductMatch = q.match(
    /\b(profit|gewinn|rohgewinn|revenue|umsatz|earnings?|ertrag)\b.{0,50}\b(with|for|f[üu]r|von|product|software|artikel|item)\s+([A-Za-zÄÖÜäöüß0-9\s-]+?)(?:\s+in\s+(20\d{2}))?\s*$/i
  );
  if (profitProductMatch) {
    const product = profitProductMatch[3].trim();
    const year    = profitProductMatch[4];
    const yearClause = year ? ` AND YEAR(ap.Datum) = ${year}` : '';
    return `SELECT\n  SUM(ap.Rohgewinn) AS total_profit,\n  SUM(ap.Betrag)    AS total_revenue,\n  COUNT(*)          AS line_count\nFROM anposten ap\nWHERE ap.Bezeichnun LIKE '%${product}%'${yearClause};`;
  }

  // Total profit/revenue with no product filter (just year or no filter)
  const totalProfitMatch = q.match(
    /\b(total|gesamt|calculate|berechne|sum)\b.{0,30}\b(profit|gewinn|rohgewinn|revenue|umsatz)\b(?:.{0,20}\b(20\d{2})\b)?/i
  );
  if (totalProfitMatch) {
    const year = totalProfitMatch[3];
    const yearClause = year ? ` WHERE YEAR(Datum) = ${year}` : '';
    return `SELECT\n  SUM(Rohgesamt) AS total_profit,\n  SUM(Summe)     AS total_revenue,\n  COUNT(*)       AS order_count\nFROM auftrag${yearClause};`;
  }

  // ── D. STATS: maintenance interval for company Z ─────────────
  // Handles: "what is the expected interval for maintenance at company Z"
  //          "Wartungsintervall für Firma Müller"

  const maintenanceMatch = q.match(
    /\b(maintenance|wartung|interval|intervall)\b.{0,50}\b(company|firma|customer|kunde|at|bei|f[üu]r)\b\s+([A-Za-zÄÖÜäöüß0-9\s-]+?)\s*$/i
  );
  if (maintenanceMatch) {
    const company = maintenanceMatch[3].trim();
    return `SELECT\n  kd.Name,\n  COUNT(*)                                       AS total_maintenance_visits,\n  MIN(l.Datum)                                   AS first_visit,\n  MAX(l.Datum)                                   AS last_visit,\n  AVG(DATEDIFF(day, l.Datum, l.Lieferdatu))      AS avg_days_to_complete\nFROM liefer l\nJOIN kunde kd ON l.Kundennumm = kd.Kundennumm\nWHERE kd.Name LIKE '%${company}%'\n  AND l.Wartung = 'J'\nGROUP BY kd.Name;`;
  }

  // No direct match — fall through to LLM
  return null;
}

// ─────────────────────────────────────────────────────────────
// SQL EXTRACTION
// ─────────────────────────────────────────────────────────────
function extractSQL(raw: string): string {
  if (!raw?.trim()) return '';

  let text = raw
    .replace(/\r\n/g, '\n')
    .replace(/```sql\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  // remove everything before SELECT/WITH
  const match = text.match(/(SELECT|WITH)[\s\S]*/i);
  if (!match) return '';

  text = match[0];

  // cut after first semicolon
  const semi = text.indexOf(';');
  if (semi !== -1) text = text.slice(0, semi + 1);

  // remove comments
  text = text
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  // reject placeholders
  if (/LIKE\s+'%X%'/i.test(text) || /LIKE\s+'%Y%'/i.test(text)) return '';

  if (!text.endsWith(';')) text += ';';

  return text;
}

// -------------------------------------------------------------
// SQL SANITIZER — fixes T-SQL syntax errors the LLM commonly makes
// Runs AFTER extractSQL, BEFORE returning to client
// -------------------------------------------------------------

function sanitizeSQL(sql: string): string {
  if (!sql) return sql;
  let s = sql;

  // 1. MySQL LIMIT n → T-SQL TOP n
  // Strip LIMIT, then inject TOP if not present
  const limitMatch = s.match(/\bLIMIT\s+(\d+)/i);
  if (limitMatch) {
    const n = limitMatch[1];
    s = s.replace(/\bLIMIT\s+\d+\s*;?\s*$/im, '');
    if (!/\bTOP\s+\d+/i.test(s)) {
      s = s.replace(/^(\s*SELECT)\b/i, `$1 TOP ${n}`);
    }
  }

  // 2. Add TOP 100 if missing on non-aggregate queries
  const hasTop     = /\bTOP\s+\d+/i.test(s);
  const hasAgg     = /\b(SUM|AVG|MIN|MAX|COUNT|STDEV)\s*\(/i.test(s);
  const hasGroupBy = /\bGROUP\s+BY\b/i.test(s);
  if (!hasTop && !hasAgg && !hasGroupBy) {
    s = s.replace(/^(\s*SELECT)\b/i, '$1 TOP 100');
  }

  // 3. Truncated year: YEAR(x) = 202 or YEAR(x) = 20 — reject, trigger fallback
  if (/YEAR\s*\([^)]+\)\s*=\s*\b\d{1,3}\b/i.test(s)) {
    return '';
  }

  // 4. Missing WHERE: LIKE value sitting right after JOIN line with no WHERE
  // e.g. "FROM auftrag a\nJOIN kunde k ON ...\n  '%Dieckmann%'"
  s = s.replace(
    /((?:FROM|JOIN)[^\n]+\n(?:\s*JOIN[^\n]+\n)*)\s*(\n?\s*'%[^']+%')/gi,
    (_, joins, likePart) => `${joins}WHERE Name LIKE ${likePart.trim()}`
  );

  // 5. Backticks → square brackets (MySQL → T-SQL)
  s = s.replace(/`([^`]+)`/g, '[$1]');

  // 6. MySQL/Postgres date functions → T-SQL
  s = s.replace(/\bNOW\s*\(\s*\)/gi, 'GETDATE()');
  s = s.replace(/\bCURDATE\s*\(\s*\)/gi, 'CAST(GETDATE() AS DATE)');
  s = s.replace(/\bILIKE\b/gi, 'LIKE');

  // 7. Semicolon
  s = s.trim();
  if (s && !s.endsWith(';')) s += ';';

  // REMOVE accidental numbered lines like "1. Read ..."
   s = s.replace(/\n?\s*\d+\.\s+[^\n]+/g, '');

  return s;
}


// ─────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────


function buildPrompt(intent: Intent, query: string, schemaForPrompt: string): string {
  return [
    'You are a SQL generator for SQL Server (T-SQL).',
    'Return ONLY ONE valid SQL query.',
    'Do NOT explain. Do NOT add text.',
    '',

    '-- RULES:',
    '1. Read User Question carefully to understand intent.',
    '2. Use ONLY tables and columns from SCHEMA.',
    '3. Use ONLY given JOIN conditions.',
    '4. Use TOP 100 for SELECT unless aggregation.',
    '5. Use LIKE \'%text%\' for names.',
    '6. Use YEAR(date_column) for year filters.',
    '7. If unsure, return simple SELECT from main table.',
    '8. Never use placeholders like X or Y. Always use real values from the question.',
    '',

    '-- JOINS:',
    JOIN_RULES,
    '',

    '-- SCHEMA:',
    schemaForPrompt,
    '',

    '-- QUESTION:',
    query,
    '',

    '-- SQL:',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// ROUTE
// ─────────────────────────────────────────────────────────────

const TABLE_PROMPT_LIMIT = 5;

router.post(
  '/validate',
  requirePermission('analytics:query:read'),
  async (req: Request, res: Response) => {
    const requestId = (req as any).id;

    try {
      const { query } = req.body;
      const trimmedQuery = typeof query === 'string' ? query.trim() : '';

      if (!trimmedQuery) {
        return res.status(400).json({ error: 'INVALID_REQUEST', message: 'Query is required', requestId });
      }

      console.log(`[VALIDATE][START] requestId=${requestId} query="${trimmedQuery}"`);

      const intent = detectIntent(trimmedQuery);
      console.log(`[VALIDATE][INTENT] requestId=${requestId} intent=${intent}`);

      // ── STEP 1: Try direct pattern match (no LLM needed) ───
      const directSQL = tryDirectMatch(trimmedQuery);
      if (directSQL) {
        console.log(`[VALIDATE][DIRECT_MATCH] requestId=${requestId}`, directSQL);
        return res.json({
          success: true,
          requestId,
          query: trimmedQuery,
          intent,
          tablesUsed: detectTablesFromQuery(trimmedQuery),
          generatedSQL: directSQL,
          usedFallback: false,
          source: 'direct',
        });
      }

      // ── STEP 2: Build table list ───────────────────────────
      const mentionedTables = detectTablesFromQuery(trimmedQuery);
      const defaultTables = INTENT_CONFIG[intent].tables;
      const tableCandidates: string[] = [...mentionedTables];
      for (const t of defaultTables) {
        if (!tableCandidates.includes(t)) tableCandidates.push(t);
      }
      const tablesForPrompt = tableCandidates
        .filter(t => ALL_KNOWN_TABLES.includes(t))
        .slice(0, TABLE_PROMPT_LIMIT);

      console.log(`[VALIDATE][TABLES] requestId=${requestId}`, tablesForPrompt);

      // ── STEP 3: Call LLM ───────────────────────────────────
      const schemaForPrompt = tablesForPrompt.map(t => STATIC_SCHEMA[t]).join('\n\n');
      const prompt = buildPrompt(intent, trimmedQuery, schemaForPrompt);
      console.log(`[VALIDATE][PROMPT_SENT] requestId=${requestId} chars=${prompt.length}`);

      const llmResponse = await axios.post(
        'http://localhost:11434/api/generate',
        {
          model: 'phi',
          prompt,
          stream: false,
          temperature: 0,
          options: {
            num_predict: 400,
            // No \n\n stop — it truncated "YEAR(Datum) = \n\n2024" → "202"
            stop: ['\nNote:', '\nExplanation:', '\nThis ', '\nThe query', '\nQuestion:', '\n-- Q:'],
          },
        },
        { timeout: 30_000 }
      );

      const raw: string = llmResponse.data?.response ?? '';
      console.log(`[VALIDATE][RAW_OUTPUT] requestId=${requestId}`, raw.slice(0, 400));

      // Model continues from "SELECT" (prompt ends with it)
      const rawWithPrefix = /^\s*(SELECT|WITH)\b/i.test(raw) ? raw : 'SELECT ' + raw;
      let sql = extractSQL(rawWithPrefix);

// ALWAYS sanitize
sql = sanitizeSQL(sql);

// STRICT validation
const valid = isValidSQL(sql);

      // ── STEP 4: Fallback if LLM failed ────────────────────
      if (!valid) {
  console.warn(`[VALIDATE][INVALID_SQL] requestId=${requestId}`);

  // try direct AGAIN as safety
  const retryDirect = tryDirectMatch(trimmedQuery);
  if (retryDirect) {
    sql = retryDirect;
    return res.json({
      success: true,
      requestId,
      query: trimmedQuery,
      intent,
      tablesUsed: detectTablesFromQuery(trimmedQuery),
      generatedSQL: sql,
      usedFallback: false,
      source: 'direct-retry',
    });
  }

  // fallback
  sql = buildFallbackSQL(intent, tablesForPrompt[0] ?? 'auftrag');
}

      console.log(`[VALIDATE][FINAL_SQL] requestId=${requestId}`, sql);

      return res.json({
        success: true,
        requestId,
        query: trimmedQuery,
        intent,
        tablesUsed: tablesForPrompt,
        generatedSQL: sql,
        usedFallback: !isValidSQL,
        source: isValidSQL ? 'llm' : 'fallback',
      });

    } catch (err) {
      console.error(`[VALIDATE][ERROR] requestId=${requestId}`, err);
      return res.status(500).json({
        error: 'VALIDATION_ERROR',
        message: (err as Error).message,
        requestId,
      });
    }
  }
);

export default router;