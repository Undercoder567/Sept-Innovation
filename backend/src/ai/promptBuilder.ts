import { TableTranslation, tableTranslations } from '../semantic/tableTranslations';

interface PromptOptions {
  translationHints?: TableTranslation[];
  includeTopN?: number;
}

/**
 * Simple Prompt Builder for SQL generation
 * Focus: clean prompt + schema + mappings
 */
class PromptBuilder {
  buildSQLGenerationPrompt(
    userQuery: string,
    schemaContext: string,
    options: PromptOptions = {}
  ): string {
    const translationSection = this.buildTranslationSection(
      options.translationHints
    );

    return `
You are a SQL Server (T-SQL) expert.

TASK:
Generate ONE valid SQL query.

RULES:
- Use only provided schema
- No SELECT *
- Use JOINs when required
- Use TOP ${options.includeTopN ?? 100}
- Use correct filters (YEAR, DATE, etc.)
- Output ONLY SQL (no explanation)

SCHEMA:
${schemaContext}

${translationSection ? `MAPPINGS:\n${translationSection}` : ''}

USER QUERY:
${userQuery}

SQL:
`.trim();
  }

  private buildTranslationSection(
    translations?: TableTranslation[]
  ): string {
    const list =
      translations?.length
        ? translations
        : tableTranslations.slice(0, 10);

    if (!list.length) return '';

    return list
      .map((t) => {
        const alias = t.englishAlias || t.germanName;
        return `- ${alias} = ${t.germanName}`;
      })
      .join('\n');
  }
}

export { PromptBuilder };