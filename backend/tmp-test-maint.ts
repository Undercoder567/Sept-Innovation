import dotenv from 'dotenv'; import { DatabaseClient } from './src/sql/dbClient';
dotenv.config({path:"./.env"});
(async()=>{
  const client=new DatabaseClient({host:process.env.DB_HOST||'localhost',port:parseInt(process.env.DB_PORT||'1433',10),database:process.env.DB_NAME||'',user:process.env.DB_USER||'',password:process.env.DB_PASSWORD||'',trustServerCertificate:true});
  const sql=`WITH maintenance_events AS (
      SELECT
        w.Kundennumm,
        w.Name,
        w.Datum,
        LEAD(w.Datum) OVER (PARTITION BY w.Kundennumm ORDER BY w.Datum) AS next_datum
      FROM wartung w
      WHERE w.Name LIKE $1
         OR w.Kundennumm IN (
              SELECT k.Kundennumm FROM kunde k WHERE k.Name LIKE $1
           )
    )
    SELECT
      AVG(DATEDIFF(DAY, Datum, next_datum)) AS avg_days_between_maintenance
    FROM maintenance_events
    WHERE next_datum IS NOT NULL;`;
  const r=await client.query(sql,['%Dieckmann%']);
  console.log(r.rows);
  await client.close();
})();
