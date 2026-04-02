import dotenv from 'dotenv';
import { DatabaseClient } from '../src/sql/dbClient';
import { tableTranslations } from '../src/semantic/tableTranslations';

dotenv.config();

async function main() {
  const client = new DatabaseClient({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME || 'ERP42test',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    trustServerCertificate: true,
  });

  try {
    const tables = await client.getRows<{ name: string }>(`
      SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo');
    `);

    const translationMap = new Map<string, string>();
    tableTranslations.forEach((entry) => {
      translationMap.set(entry.germanName.toLowerCase(), entry.englishAlias || entry.germanName);
    });

    const missing = tables
      .map((table) => table.name)
      .filter((name) => !translationMap.has(name.toLowerCase()))
      .sort();

    if (missing.length === 0) {
      console.log('✅ All dbo tables have translation entries.');
    } else {
      console.log('⚠️ Missing translations for the following tables:');
      missing.forEach((table) => console.log(`  - ${table}`));
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Failed to validate translations:', error);
  process.exit(1);
});
