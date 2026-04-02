import { DatabaseClient } from '../../sql/dbClient';
import { LLMClient } from '../../ai/llmClient';
import { PromptBuilder } from '../../ai/promptBuilder';
import { SQLValidator, ValidationIssue } from '../../sql/sqlValidator';
import { TableTranslation } from '../../semantic/tableTranslations';
import { translateTableNames } from './schemaContext';

const DEFAULT_TOP_LIMIT = parseInt(process.env.DEFAULT_TOP_LIMIT || '100', 10);

export interface SQLWorkflowDeps {
  llmClient: LLMClient;
  promptBuilder: PromptBuilder;
  sqlValidator: SQLValidator;
  dbClient: DatabaseClient;
}

function buildSchemaIssue(error: unknown): ValidationIssue {
  return {
    type: 'ERROR',
    code: 'SCHEMA_MISMATCH',
    message: (error as Error).message,
    suggestion: 'Use only tables/columns that exist in the current database schema.',
  };
}

export function ensureTopLimit(sql: string, limit = DEFAULT_TOP_LIMIT): string {
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed)) {
    return sql;
  }

  if (/\boffset\s+\d+\s+rows\b/i.test(trimmed) || /\btop\s+\d+/i.test(trimmed)) {
    return sql;
  }

  const selectRegex = /^(\s*select\s+)(distinct\s+)?/i;
  if (!selectRegex.test(sql)) {
    return sql;
  }

  return sql.replace(selectRegex, (match, selectPart, distinctPart = '') => {
    return `${selectPart}${distinctPart}TOP ${limit} `;
  });
}

export function extractSqlStatement(rawText: string): string {
  if (!rawText) return '';

  let text = rawText
    .replace(/```sql/gi, '')
    .replace(/```/g, '')
    .replace(/^SQL:\s*/i, '')
    .replace(/^ANSWER:\s*/i, '')
    .trim();

  const startMatch = text.match(/\b(SELECT|WITH)\b/i);
  if (!startMatch || startMatch.index === undefined) {
    return text;
  }

  text = text.slice(startMatch.index).trim();

  const stopMarkers = [
    /\bOutput\s+Explanation\s*:/i,
    /\bExplanation\s*:/i,
    /\bReasoning\s*:/i,
    /\bAnswer\s*:/i,
    /\bQuestion\s*:/i,
    /\bNotes?\s*:/i,
    /\bPlease\s+note\b/i,
    /\bYour\s+task\b/i,
    /\bRewrite\b/i,
    /\bAs\s+an\s+AI\b/i,
    /^##/im,
  ];

  let cutIndex = -1;
  for (const marker of stopMarkers) {
    const match = marker.exec(text);
    if (match && match.index >= 0) {
      cutIndex = cutIndex === -1 ? match.index : Math.min(cutIndex, match.index);
    }
  }
  if (cutIndex >= 0) {
    text = text.slice(0, cutIndex).trim();
  }

  const paragraphBreak = /\n\s*\n/.exec(text);
  if (paragraphBreak && paragraphBreak.index >= 0) {
    const afterBreak = text.slice(paragraphBreak.index).trim().toUpperCase();
    const sqlClauseStarters = [
      'SELECT', 'WITH', 'FROM', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL',
      'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'HAVING', 'UNION'
    ];
    const isSqlContinuation = sqlClauseStarters.some((clause) => afterBreak.startsWith(clause));
    if (!isSqlContinuation) {
      text = text.slice(0, paragraphBreak.index).trim();
    }
  }

  const semicolonIndex = text.indexOf(';');
  if (semicolonIndex >= 0) {
    return normalizeExtractedSql(text.slice(0, semicolonIndex + 1).trim());
  }

  return normalizeExtractedSql(text.trim());
}

function normalizeExtractedSql(sql: string): string {
  let normalized = sql.trim();

  normalized = normalized.replace(/[`#]+$/g, '').trim();

  if (/\bLIMIT\s*$/i.test(normalized)) {
    normalized = `${normalized} 100`;
  }

  normalized = normalized.replace(/\bLIMIT\s+(?!\d+\b|\$\d+\b)[\s\S]*$/i, 'LIMIT 100');

  normalized = normalized
    .replace(/\bproducts\.product_name\b/gi, 'products.name')
    .replace(/\bp\.product_name\b/gi, 'p.name')
    .replace(/\bproducts\.category_name\b/gi, 'products.category')
    .replace(/\bp\.category_name\b/gi, 'p.category')
    .replace(/\bproducts\.product_category\b/gi, 'products.category')
    .replace(/\bp\.product_category\b/gi, 'p.category')
    .replace(/\bproducts\.service\b/gi, 'products.category')
    .replace(/\bp\.service\b/gi, 'p.category');

  normalized = normalized.replace(
    /\b(LIKE|ILIKE)\s+%([A-Za-z0-9_\- ]+)%/gi,
    (_m, op, value) => `${op} '%${String(value).trim()}%'`
  );

  if ((normalized.match(/"/g) || []).length % 2 !== 0) {
    normalized = normalized.replace(/"\s*$/, '');
  }

  return normalized.trim();
}

export async function validateGeneratedSQL(
  sql: string,
  deps: Pick<SQLWorkflowDeps, 'sqlValidator' | 'dbClient'>
): Promise<ValidationIssue[]> {
  const issues = deps.sqlValidator.validate(sql);
  try {
    const sanitized = translateTableNames(sql.replace(/\$\d+/g, 'NULL'));
    await deps.dbClient.explainQuery(sanitized);
  } catch (explainError) {
    issues.push(buildSchemaIssue(explainError));
  }
  return issues;
}

function toIssueStrings(issues: ValidationIssue[]): string[] {
  return issues.map((issue) => `${issue.code}: ${issue.message}`);
}

export async function generateBestSQL(
  userQuery: string,
  dbSchema: string,
  translationHints: TableTranslation[] = [],
  deps: SQLWorkflowDeps
): Promise<{ sql: string; issues: ValidationIssue[] }> {
  const MAX_ATTEMPTS = 3;
  let candidate = '';
  let issues: ValidationIssue[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt === 1) {
      const prompt = deps.promptBuilder.buildSQLGenerationPrompt(userQuery, dbSchema, {
        translationHints,
      });
      const raw = await deps.llmClient.generate(prompt, { temperature: 0.15 });
      candidate = ensureTopLimit(extractSqlStatement(raw));
    } else {
      const repairPrompt = deps.promptBuilder.buildSQLRepairPrompt(
        userQuery,
        dbSchema,
        candidate,
        toIssueStrings(issues)
      );
      const raw = await deps.llmClient.generate(repairPrompt, { temperature: 0.05 });
      candidate = ensureTopLimit(extractSqlStatement(raw));
    }

    issues = await validateGeneratedSQL(candidate, {
      sqlValidator: deps.sqlValidator,
      dbClient: deps.dbClient,
    });
    const hasErrors = issues.some((issue) => issue.type === 'ERROR');
    if (!hasErrors) {
      return { sql: candidate, issues };
    }
  }

  return { sql: candidate, issues };
}

export async function generateSQLExplanation(
  sql: string,
  deps: Pick<SQLWorkflowDeps, 'promptBuilder' | 'llmClient'>
): Promise<string> {
  try {
    const prompt = deps.promptBuilder.buildExplanationPrompt(sql);
    return await deps.llmClient.generate(prompt, { temperature: 0.3 });
  } catch {
    return 'Unable to generate explanation';
  }
}
