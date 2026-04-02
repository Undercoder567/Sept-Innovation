import { DatabaseClient } from '../../sql/dbClient';
import { TableTranslation, tableTranslations } from '../../semantic/tableTranslations';

const englishToGermanTableMap: Map<string, string> = new Map();
const germanToTranslation: Map<string, TableTranslation> = new Map();

function addAliasVariant(alias: string, target: string) {
  const normalized = alias.toLowerCase();
  englishToGermanTableMap.set(normalized, target);
  if (normalized.endsWith('s')) {
    englishToGermanTableMap.set(normalized.slice(0, -1), target);
  } else {
    englishToGermanTableMap.set(`${normalized}s`, target);
  }
}

tableTranslations.forEach((entry) => {
  const target = entry.germanName.toLowerCase();
  if (entry.englishAlias) {
    addAliasVariant(entry.englishAlias, target);
  }
  entry.additionalAliases?.forEach((alias) => {
    addAliasVariant(alias, target);
  });
  germanToTranslation.set(target, entry);
});

const translationOrder = Array.from(englishToGermanTableMap.keys()).sort((a, b) => b.length - a.length);

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function translateTableNames(sql: string): string {
  if (!sql) return sql;
  let translated = sql;
  for (const alias of translationOrder) {
    const germanName = englishToGermanTableMap.get(alias);
    if (!germanName) continue;
    const pattern = new RegExp(`\\b${escapeForRegExp(alias)}\\b`, 'gi');
    translated = translated.replace(pattern, germanName);
  }
  return translated;
}

async function describeTable(dbClient: DatabaseClient, tableName: string): Promise<string> {
  try {
    const columns = await dbClient.getRows<{
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
    }>(
      `
      SELECT column_name, data_type, character_maximum_length
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE table_schema = 'dbo'
        AND LOWER(table_name) = $1
      ORDER BY ordinal_position;
    `,
      [tableName.toLowerCase()]
    );

    if (columns.length === 0) {
      return `Table: ${tableName} (no column metadata)`;
    }

    const columnDescs = columns
      .slice(0, 12)
      .map((col) => {
        const length = col.character_maximum_length;
        const lenSuffix = length && length > 0 ? `(${length})` : '';
        return `${col.column_name} ${col.data_type}${lenSuffix}`;
      })
      .join(', ');

    return `Table: ${tableName} | Columns: ${columnDescs}`;
  } catch (error) {
    return `Table: ${tableName} (schema unavailable)`;
  }
}

function detectMentionedTables(query: string): string[] {
  const normalized = query.toLowerCase();
  const detected = new Set<string>();

  for (const entry of tableTranslations) {
    if (!entry.germanName) continue;
    const german = entry.germanName.toLowerCase();
    if (normalized.includes(german)) {
      detected.add(german);
      continue;
    }

    const aliasCandidates = [entry.englishAlias, ...(entry.additionalAliases || [])]
      .filter(Boolean)
      .flatMap((alias) => {
        const normalizedAlias = alias!.toLowerCase();
        const variants = normalizedAlias.endsWith('s')
          ? [normalizedAlias, normalizedAlias.slice(0, -1)]
          : [normalizedAlias, `${normalizedAlias}s`];
        return variants;
      });

    for (const alias of aliasCandidates) {
      const pattern = new RegExp(`\\b${escapeForRegExp(alias)}\\b`, 'i');
      if (pattern.test(normalized)) {
        detected.add(german);
        break;
      }
    }
  }

  if (detected.size === 0) {
    return ['kunde', 'auftrag', 'waren'];
  }

  return Array.from(detected);
}

export function getRelevantTranslations(tableNames: string[]): TableTranslation[] {
  const normalized = new Set(tableNames.map((name) => name.toLowerCase()));
  return tableTranslations.filter((entry) => normalized.has(entry.germanName.toLowerCase()));
}

export async function getSchemaContextForQuery(
  dbClient: DatabaseClient,
  userQuery: string
): Promise<{ schema: string; tables: string[] }> {
  const tableNames = detectMentionedTables(userQuery);
  const summaries = await Promise.all(tableNames.map((table) => describeTable(dbClient, table)));
  return {
    schema: summaries.join('\n'),
    tables: tableNames,
  };
}

export function getTranslationForGermanName(name: string): TableTranslation | undefined {
  return germanToTranslation.get(name.toLowerCase());
}
