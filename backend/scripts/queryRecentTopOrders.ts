import dotenv from "dotenv";
import { DatabaseClient } from "../src/sql/dbClient";

dotenv.config();

async function main() {
  const client = new DatabaseClient({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "1433", 10),
    database: process.env.DB_NAME || "ERP42test",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    trustServerCertificate: true,
  });

  const sql = `
    WITH top_customers AS (
      SELECT TOP 5 Kundennumm
      FROM auftrag
      GROUP BY Kundennumm
      ORDER BY SUM(Summe) DESC
    )
    SELECT TOP 10
      Nummer,
      Datum,
      Name,
      Kundennumm,
      Summe
    FROM auftrag
    WHERE Kundennumm IN (SELECT Kundennumm FROM top_customers)
    ORDER BY Datum DESC;
  `;

  try {
    const result = await client.query(sql);
    console.log("Most recent orders for top customers:");
    console.table(result.rows);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Query failed:", error);
  process.exit(1);
});
