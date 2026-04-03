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
interface TableColumnInfo {
  columns: string[];
  columnNames: string[];
  numericColumns: string[];
}

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
 *
 * KEY FACTS discovered from real schema:
 *  - NO foreign keys enforced — joins use Kundennumm (varchar) as soft link
 *  - auftrag.Kundennumm = kunde.Kundennumm  ← correct customer join
 *  - anposten.Nummer = auftrag.Nummer        ← line items link to order by document number
 *  - anposten.Rohgewinn = gross profit per line
 *  - auftrag.Rohgesamt  = total gross profit on order
 *  - liefer.Wartung     = maintenance flag on deliveries
 *  - kontakt.Kundennumm = customer contact/interaction log
 *  - zeitraum           = accounting periods (Monat, Jahr, Anfang)
 */


// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

type Intent = 'search' | 'math' | 'stats' | 'unknown';

// ─────────────────────────────────────────────────────────────
// HARDCODED SCHEMA — only the columns that matter for queries
// Keeps the prompt tight; avoids wasting tokens on RTFID etc.
// ─────────────────────────────────────────────────────────────

const STATIC_SCHEMA: Record<string, string> = {
  auftrag: `auftrag (orders):
  Auftragid (uniqueidentifier) PK
  Nummer (varchar)             -- order number, links to anposten.Nummer
  Datum (datetime)             -- order date -> use YEAR(Datum) for year filter
  Kundennumm (varchar)         -- customer number -> JOIN kunde ON Kundennumm
  Name (varchar)               -- customer name stored on order
  Vorname (varchar)
  Projekt (varchar)
  Summe (decimal)              -- net order total
  Bruttosumm (decimal)         -- gross order total
  Rohgesamt (decimal)          -- gross profit total
  Mwst (decimal)               -- VAT
  Erstellt (datetime)          -- created date`,

  kunde: `kunde (customers):
  Kundenid (uniqueidentifier) PK
  Kundennumm (varchar)         -- customer number -> JOIN auftrag/rechnung/kontakt ON Kundennumm
  Name (varchar)               -- company/customer name -> use LIKE '%X%' for search
  Vorname (varchar)
  Matchcode (varchar)          -- short search code
  Ort (varchar)                -- city
  Land (varchar)               -- country
  Email (varchar)
  Telefon (varchar)
  Branche (varchar)            -- industry
  Umsatzgepl (decimal)         -- planned revenue`,

  kontakt: `kontakt (customer contacts/interactions):
  Kontaktid (uniqueidentifier) PK
  Kundennumm (varchar)         -- -> JOIN kunde ON Kundennumm
  Datum (datetime)             -- contact date
  Art (varchar)                -- contact type
  Grund (varchar)              -- reason/topic
  Uhrzeit (datetime)           -- start time
  Bis (datetime)               -- end time -> interval = DATEDIFF(minute,Uhrzeit,Bis)
  Erledigt (varchar)           -- done flag
  Bearbeiter (varchar)         -- staff member`,

  rechnung: `rechnung (invoices):
  Rechnungid (uniqueidentifier) PK
  Nummer (varchar)             -- invoice number -> links to reposten.Nummer
  Datum (datetime)             -- invoice date
  Kundennumm (varchar)         -- -> JOIN kunde ON Kundennumm
  Name (varchar)
  Summe (decimal)              -- net total
  Bruttosumm (decimal)
  Rohgesamt (decimal)          -- gross profit
  Mwst (decimal)
  Faelligam (datetime)         -- due date`,

  anposten: `anposten (order line items):
  Postenid (uniqueidentifier) PK
  Nummer (varchar)             -- document number -> JOIN auftrag ON Nummer
  Artikelnum (varchar)         -- article number -> JOIN artbest ON Artikelnum
  Bezeichnun (varchar)         -- product description -> LIKE '%Y%' for product search
  Datum (datetime)
  Anzahl (decimal)             -- quantity
  Einzelprei (decimal)         -- unit price
  Betrag (decimal)             -- line amount
  Summe (decimal)              -- net line total
  Rohgewinn (decimal)          -- GROSS PROFIT per line <- use for profit queries
  Rohgewinnp (decimal)         -- gross profit %
  Ekmittel (decimal)           -- avg purchase cost
  Kundennumm (varchar)         -- customer number (denormalized)
  Rabatt (decimal)             -- discount %`,

  reposten: `reposten (invoice line items):
  Postenid (uniqueidentifier) PK
  Nummer (varchar)             -- invoice number -> JOIN rechnung ON Nummer
  Artikelnum (varchar)         -- -> JOIN artbest ON Artikelnum
  Bezeichnun (varchar)         -- product description
  Datum (datetime)
  Anzahl (decimal)
  Einzelprei (decimal)
  Betrag (decimal)
  Summe (decimal)
  Rohgewinn (decimal)          -- GROSS PROFIT per line
  Rohgewinnp (decimal)
  Kundennumm (varchar)`,

  artbest: `artbest (item master / stock):
  Artbestid (uniqueidentifier) PK
  Artikelnum (varchar)         -- article number (unique key)
  Datum (datetime)
  Anzahl (decimal)             -- stock quantity
  Einkauf (decimal)            -- purchase price
  Verkauf (decimal)            -- sales price
  Inventur (decimal)
  Auftrag (decimal)            -- qty on order`,

  liefer: `liefer (deliveries):
  Liefersche (uniqueidentifier) PK
  Nummer (varchar)
  Datum (datetime)
  Kundennumm (varchar)         -- -> JOIN kunde ON Kundennumm
  Name (varchar)
  Wartung (varchar)            -- MAINTENANCE FLAG: 'J' = yes
  Summe (decimal)
  Lieferdatu (datetime)        -- actual delivery date
  Wunschterm (datetime)        -- requested delivery date
  Terminbest (datetime)        -- confirmed delivery date`,

  zeitraum: `zeitraum (accounting time periods):
  Zeitraumid (uniqueidentifier) PK
  Zeitraum (varchar)           -- period label e.g. '2024-01'
  Monat (int)                  -- month 1-12
  Jahr (int)                   -- year e.g. 2024
  Anfang (datetime)            -- period start date
  Verboten (varchar)           -- locked flag`,

  bestatus: `bestatus (document status):
  ID (uniqueidentifier) PK
  Belegid (uniqueidentifier)   -- links to order/delivery/invoice PK
  Formart (varchar)            -- document type
  Druck (varchar)              -- printed flag
  Lieferbar (varchar)          -- deliverable flag`,
};

const ALL_KNOWN_TABLES = Object.keys(STATIC_SCHEMA);

// ─────────────────────────────────────────────────────────────
// HARDCODED JOIN CONDITIONS
// ─────────────────────────────────────────────────────────────

const JOIN_RULES = `JOINS -- use EXACTLY these, never guess column names:
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
// SEMANTIC HINTS
// ─────────────────────────────────────────────────────────────

const SEMANTIC_HINTS = `COLUMN SEMANTICS:
  customer name search  -> kunde.Name LIKE '%X%'
  order date filter     -> YEAR(auftrag.Datum) = 2024
  product search        -> anposten.Bezeichnun LIKE '%Y%'
  profit (order total)  -> auftrag.Rohgesamt
  profit (line items)   -> anposten.Rohgewinn (SUM for total)
  profit (invoice)      -> rechnung.Rohgesamt or reposten.Rohgewinn
  maintenance records   -> liefer WHERE Wartung = 'J'
  contact interval      -> DATEDIFF(day, kontakt.Datum, LEAD(kontakt.Datum) OVER ...)
  accounting period     -> zeitraum.Jahr, zeitraum.Monat`;

// ─────────────────────────────────────────────────────────────
// INTENT DETECTION
// ─────────────────────────────────────────────────────────────

type IntentConfig = { pattern: RegExp; tables: string[] };

const INTENT_CONFIG: Record<Intent, IntentConfig> = {
  math: {
    pattern: /\b(total|sum|profit|revenue|cost|calculate|calc|average|avg|count|amount|earn|margin|how much|wie viel|gesamt|summe|gewinn|umsatz|kosten|berechne|ertrag|marge|einnahmen|ausgaben|rohgewinn)\b/i,
    tables: ['anposten', 'rechnung', 'reposten', 'auftrag'],
  },
  stats: {
    pattern: /\b(statistics|stats|average|mean|interval|maintenance|expected|trend|frequency|distribution|analyze|analyse|wartung|intervall|erwart|haufigkeit|statistik|mittelwert|verteilung|prognose|durchschnitt)\b/i,
    tables: ['kontakt', 'liefer', 'zeitraum', 'artbest'],
  },
  search: {
    pattern: /\b(find|search|show|list|get|where|who|which|all|filter|look|finde|suche|zeige|liste|welche|alle|wo|wer|zeig|gib)\b/i,
    tables: ['auftrag', 'kunde', 'rechnung', 'liefer'],
  },
  unknown: {
    pattern: /.*/,
    tables: ['auftrag', 'kunde'],
  },
};

function detectIntent(query: string): Intent {
  for (const intent of (['math', 'stats', 'search'] as Intent[])) {
    if (INTENT_CONFIG[intent].pattern.test(query)) return intent;
  }
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────
// TABLE DETECTION FROM QUERY
// ─────────────────────────────────────────────────────────────

const TABLE_KEYWORDS: Record<string, string[]> = {
  auftrag:  ['auftrag', 'auftr', 'order', 'orders', 'bestellung'],
  kunde:    ['kunde', 'kunden', 'customer', 'customers', 'client', 'firma'],
  kontakt:  ['kontakt', 'kontakte', 'contact', 'contacts', 'interaction'],
  rechnung: ['rechnung', 'rechnungen', 'invoice', 'invoices', 'faktura'],
  anposten: ['anposten', 'order line', 'auftragsposten'],
  reposten: ['reposten', 'invoice line', 'rechnungsposten'],
  artbest:  ['artbest', 'artikel', 'article', 'product', 'products', 'item', 'items', 'software'],
  liefer:   ['liefer', 'lieferung', 'delivery', 'deliveries', 'wartung', 'maintenance'],
  zeitraum: ['zeitraum', 'period', 'monat', 'month', 'quartal', 'quarter'],
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

// ─────────────────────────────────────────────────────────────
// FALLBACK SQL
// ─────────────────────────────────────────────────────────────

function buildFallbackSQL(intent: Intent, primaryTable: string): string {
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
      return `SELECT TOP 100 * FROM ${primaryTable} ORDER BY Datum DESC;`;
  }
}

// ─────────────────────────────────────────────────────────────
// SQL EXTRACTION — bulletproof
// ─────────────────────────────────────────────────────────────

function scoreSQLCandidate(candidate: string): number {
  let score = 0;
  const lower = candidate.toLowerCase();
  if (/\bfrom\b/.test(lower)) score += 3;
  if (/\bjoin\b/.test(lower)) score += 2;
  if (/\bwhere\b/.test(lower)) score += 1;
  if (/\border\s+by\b/.test(lower)) score += 1;
  score += Math.min(1, candidate.length / 200);
  return score;
}

function extractSQL(raw: string): string {
  if (!raw?.trim()) return '';

  let text = raw
    .replace(/\r\n/g, '\n')
    .replace(/```sql\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/^(here'?s?( the| a| my)?( sql| query| answer)?[:\-]?\s*)$/gim, '')
    .replace(/^(sql[:\-]\s*)$/gim, '')
    .replace(/^(note[:\-].*)$/gim, '')
    .replace(/^(this query.*)$/gim, '')
    .replace(/^(the (above|following|query).*)$/gim, '')
    .replace(/\b(assistant|user):\s*/gi, '')
    .trim();

  text = text
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n{3,}/g, '\n')
    .trim();

  const statementRegex = /(SELECT|WITH)[\s\S]*?;/gi;
  const statements: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = statementRegex.exec(text)) !== null) {
    statements.push(match[0].trim());
  }

  if (statements.length === 0) return '';

  const best = statements.reduce(
    (bestSoFar, current) => {
      const score = scoreSQLCandidate(current);
      return score > bestSoFar.score ? { statement: current, score } : bestSoFar;
    },
    { statement: '', score: -Infinity }
  );

  let bestStatement = best.statement.trim();
  if (bestStatement && !bestStatement.endsWith(';')) bestStatement += ';';
  return bestStatement;
}

// ─────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────

const INTENT_EXAMPLES: Record<Intent, string> = {
  search: `-- EXAMPLE:
-- Q: find all orders of customer Dieckmann from 2024
SELECT TOP 100 a.Nummer, a.Datum, a.Name, a.Summe, a.Rohgesamt
FROM auftrag a
JOIN kunde k ON a.Kundennumm = k.Kundennumm
WHERE k.Name LIKE '%Dieckmann%'
  AND YEAR(a.Datum) = 2024
ORDER BY a.Datum DESC;`,

  math: `-- EXAMPLE:
-- Q: calculate total profit for Software Pro in 2025
SELECT SUM(ap.Rohgewinn) AS total_profit, SUM(ap.Betrag) AS total_revenue, COUNT(*) AS lines
FROM anposten ap
WHERE ap.Bezeichnun LIKE '%Software Pro%'
  AND YEAR(ap.Datum) = 2025;`,

  stats: `-- EXAMPLE:
-- Q: what is the expected maintenance interval for company Acme
SELECT
  kd.Name,
  COUNT(*) AS total_deliveries,
  AVG(DATEDIFF(day, l.Datum, l.Lieferdatu)) AS avg_delivery_days
FROM liefer l
JOIN kunde kd ON l.Kundennumm = kd.Kundennumm
WHERE kd.Name LIKE '%Acme%'
  AND l.Wartung = 'J'
GROUP BY kd.Name;`,

  unknown: `-- EXAMPLE:
-- Q: show recent orders
SELECT TOP 100 * FROM auftrag ORDER BY Datum DESC;`,
};

const INTENT_INSTRUCTIONS: Record<Intent, string> = {
  search:  'SELECT with WHERE/JOIN to filter. Use TOP 100. LIKE with % for names. YEAR() for year filters.',
  math:    'SELECT with SUM/AVG/COUNT. Use Rohgewinn for profit, Betrag/Summe for revenue.',
  stats:   'SELECT with AVG/MIN/MAX/COUNT/DATEDIFF. Maintenance: liefer.Wartung = \'J\'. Intervals: DATEDIFF on dates.',
  unknown: 'SELECT that best answers the question.',
};

function buildPrompt(intent: Intent, query: string, schemaForPrompt: string): string {
  return [
    '-- T-SQL expert. Output ONE SQL query only. No markdown. No explanation.',
    '-- Start with SELECT or WITH. End with semicolon (;).',
    '',
    `-- INTENT: ${intent.toUpperCase()} -- ${INTENT_INSTRUCTIONS[intent]}`,
    '',
    JOIN_RULES,
    '',
    SEMANTIC_HINTS,
    '',
    '-- SCHEMA:',
    schemaForPrompt,
    '',
    INTENT_EXAMPLES[intent],
    '',
    `-- NOW ANSWER: ${query}`,
    'SELECT',
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

      // Detect intent
      const intent = detectIntent(trimmedQuery);
      console.log(`[VALIDATE][INTENT] requestId=${requestId} intent=${intent}`);

      // Select tables
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

      // Build schema + prompt
      const schemaForPrompt = tablesForPrompt.map(t => STATIC_SCHEMA[t]).join('\n\n');
      const prompt = buildPrompt(intent, trimmedQuery, schemaForPrompt);
      console.log(`[VALIDATE][PROMPT_SENT] requestId=${requestId} chars=${prompt.length}`);

      // Call LLM
      const llmResponse = await axios.post(
        'http://localhost:11434/api/generate',
        {
          model: 'phi',
          prompt,
          stream: false,
          temperature: 0,
          options: {
            num_predict: 400,
            // Do NOT use \n\n as stop token — it truncates multi-line SQL mid-value (caused the "= 202" bug)
            stop: ['\nNote:', '\nExplanation:', '\nThis query', '\nThe query', '\n--\n', '\nQuestion:'],
          },
        },
        { timeout: 30_000 }
      );

      const raw: string = llmResponse.data?.response ?? '';
      console.log(`[VALIDATE][RAW_OUTPUT] requestId=${requestId}`, raw.slice(0, 400));

      // The prompt ends with "SELECT" so model continues from there
      // Prepend SELECT back since model won't re-emit it
      const rawWithPrefix = /^\s*(SELECT|WITH)\b/i.test(raw) ? raw : 'SELECT ' + raw;
      let sql = extractSQL(rawWithPrefix);
      const isValidSQL = /^(SELECT|WITH)\b/i.test(sql) && sql.length > 15;

      if (!isValidSQL) {
        console.warn(`[VALIDATE][FALLBACK] requestId=${requestId} raw="${raw.slice(0, 80)}"`);
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
