import crypto from 'crypto';
import { DatabaseClient } from '../../sql/dbClient';

const VALIDATED_SQL_TTL_MS = parseInt(process.env.VALIDATED_SQL_TTL_MS || '180000', 10);
const QUERY_CACHE_TTL_SECONDS = parseInt(process.env.QUERY_CACHE_TTL_SECONDS || '300', 10);

const validatedSqlCache = new Map<string, { sql: string; expiresAt: number }>();

function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function buildCacheKey(
  userId: string,
  query: string,
  options: { masked: boolean; limit: number; offset: number }
): string {
  const normalized = normalizeQuery(query);
  const raw = `${userId}|${normalized}|masked:${options.masked}|limit:${options.limit}|offset:${options.offset}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function buildValidatedSqlKey(userId: string, userQuery: string): string {
  return `${userId}|${normalizeQuery(userQuery)}`;
}

export function getCachedValidatedSql(userId: string, userQuery: string): string | null {
  const key = buildValidatedSqlKey(userId, userQuery);
  const hit = validatedSqlCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    validatedSqlCache.delete(key);
    return null;
  }
  return hit.sql;
}

export function setCachedValidatedSql(userId: string, userQuery: string, sql: string): void {
  const key = buildValidatedSqlKey(userId, userQuery);
  validatedSqlCache.set(key, { sql, expiresAt: Date.now() + VALIDATED_SQL_TTL_MS });
}

export async function getCachedQuery(
  dbClient: DatabaseClient,
  queryHash: string
): Promise<Record<string, any> | null> {
  const result = await dbClient.getRow<Record<string, any>>(
    `SELECT query_hash, result_data, generated_sql, execution_time, record_count, created_at, expires_at
     FROM query_cache
     WHERE query_hash = $1
       AND (expires_at IS NULL OR expires_at > GETUTCDATE())`,
    [queryHash]
  );

  if (result && typeof result.result_data === 'string') {
    try {
      result.result_data = JSON.parse(result.result_data);
    } catch {
      // Keep raw string if parsing fails
    }
  }

  return result || null;
}

export async function upsertQueryCache(
  dbClient: DatabaseClient,
  queryHash: string,
  userId: string,
  originalQuery: string,
  generatedSQL: string,
  responseData: Record<string, any>,
  executionTime: number,
  recordCount: number
): Promise<void> {
  await dbClient.query(
    `
      MERGE INTO query_cache AS target
      USING (SELECT $1 AS query_hash) AS source
      ON target.query_hash = source.query_hash
      WHEN MATCHED THEN
        UPDATE SET
          user_id = $2,
          original_query = $3,
          generated_sql = $4,
          result_data = $5,
          execution_time = $6,
          record_count = $7,
          expires_at = DATEADD(SECOND, $8, GETUTCDATE()),
          access_count = target.access_count + 1
      WHEN NOT MATCHED THEN
        INSERT (
          query_hash,
          user_id,
          original_query,
          generated_sql,
          result_data,
          execution_time,
          record_count,
          expires_at,
          access_count,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          DATEADD(SECOND, $8, GETUTCDATE()),
          1,
          GETUTCDATE()
        );
    `,
    [
      queryHash,
      userId,
      originalQuery,
      generatedSQL,
      JSON.stringify(responseData),
      executionTime,
      recordCount,
      QUERY_CACHE_TTL_SECONDS,
    ]
  );
}
