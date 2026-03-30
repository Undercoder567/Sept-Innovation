import sql, { ConnectionPool, config as SqlConfig, ISOLATION_LEVEL, Transaction, IResult } from 'mssql';

interface DBConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  trustedConnection?: boolean;
  schema?: string;
  instanceName?: string;
}

interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  fields: { name: string }[];
}

interface TableDescriptor {
  schema: string;
  name: string;
}

type IsolationLevel = typeof ISOLATION_LEVEL[keyof typeof ISOLATION_LEVEL];

interface TransactionOptions {
  isolationLevel?: IsolationLevel;
}

/**
 * Database Client
 * Wraps mssql ConnectionPool, parameterizes queries, and exposes helpers
 * tailored for SQL Server metadata/introspection.
 */
class DatabaseClient {
  private pool: ConnectionPool;
  private connectionCount = 0;
  private schemaEnsured = false;
  private connectionPromise: Promise<void>;

  constructor(config: DBConfig = {}) {
    const password = config.password ?? process.env.DB_PASSWORD;
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error(
        'Invalid database configuration: SQL Server authentication requires DB_PASSWORD.'
      );
    }

    const parsedPort = config.port ?? parseInt(process.env.DB_PORT || '1433', 10);
    if (!Number.isFinite(parsedPort)) {
      throw new Error('Invalid database configuration: DB_PORT must be a valid number.');
    }

    const hostRaw = config.host || process.env.DB_HOST || 'localhost';
    const instanceSeparatorIndex = hostRaw.indexOf('\\');
    const serverName = instanceSeparatorIndex >= 0 ? hostRaw.substring(0, instanceSeparatorIndex) : hostRaw;
    const derivedInstanceName = instanceSeparatorIndex >= 0 ? hostRaw.substring(instanceSeparatorIndex + 1) : undefined;
    const instanceName = config.instanceName ?? derivedInstanceName;

    const optionsConfig: SqlConfig['options'] = {
      encrypt: config.encrypt ?? process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: config.trustServerCertificate ?? process.env.DB_TRUST_SERVER_CERT === 'true',
      enableArithAbort: true,
    };
    if (instanceName) {
      optionsConfig.instanceName = instanceName;
    }

    const finalConfig: SqlConfig = {
      server: serverName,
      port: instanceName ? undefined : parsedPort,
      database: config.database || process.env.DB_NAME || 'ERP42test',
      pool: {
        max: config.max || 20,
        idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
      },
      options: optionsConfig,
      connectionTimeout: config.connectionTimeoutMillis ?? 10000,
      requestTimeout: config.connectionTimeoutMillis ?? 10000,
    };

    finalConfig.user = config.user || process.env.DB_USER || 'sa';
    finalConfig.password = password!;

    this.pool = new sql.ConnectionPool(finalConfig);
    this.pool.on('error', (err) => {
      console.error('Database pool error', err);
    });

    this.connectionPromise = this.pool.connect()
      .then(() => {
        this.connectionCount++;
        console.log(`Database connected. Active connections: ${this.connectionCount}`);
      })
      .catch((err) => {
        console.error('Failed to connect to SQL Server', err);
        throw err;
      });
  }

  /**
   * Check database connectivity
   */
  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.query<{ value: number }>('SELECT 1 AS value');
      return result.rows.length > 0;
    } catch {
      return false;
    }
  }

  private convertPlaceholders(sqlText: string): string {
    return sqlText.replace(/\$([1-9]\d*)/g, (_, num) => `@p${num}`);
  }

  private async executeQuery<T>(sqlText: string, params?: any[]): Promise<QueryResult<T>> {
    const normalizedSql = this.convertPlaceholders(sqlText);
    const request = this.pool.request();

    (params || []).forEach((value, index) => {
      request.input(`p${index + 1}`, value);
    });

    await this.connectionPromise;
    const raw = await request.query<T>(normalizedSql);
    const rows = (raw.recordset ?? []) as T[];
    const rowCount = Array.isArray(raw.rowsAffected)
      ? raw.rowsAffected.reduce((acc, curr) => acc + curr, 0)
      : rows.length;
    const fields = raw.recordset?.columns
      ? Object.keys(raw.recordset.columns).map(name => ({ name }))
      : [];

    return { rows, rowCount, fields };
  }

  /**
   * Ensure analytics helper tables exist so caching and audit logging can operate.
   */
  async ensureAnalyticsSchema(): Promise<void> {
    if (this.schemaEnsured) {
      return;
    }

    await this.connectionPromise;

    const statements = [
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.tables t
        WHERE t.name = 'audit_logs' AND t.schema_id = SCHEMA_ID('dbo')
      )
      BEGIN
        CREATE TABLE dbo.audit_logs (
          audit_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          action NVARCHAR(100) NOT NULL,
          user_id NVARCHAR(255) NOT NULL,
          resource NVARCHAR(255) NOT NULL,
          details NVARCHAR(MAX),
          severity NVARCHAR(20) DEFAULT 'INFO',
          ip_address NVARCHAR(45),
          status NVARCHAR(20),
          created_at DATETIME2 DEFAULT SYSUTCDATETIME()
        );
        CREATE INDEX IDX_AUDIT_USER ON dbo.audit_logs(user_id);
        CREATE INDEX IDX_AUDIT_TIMESTAMP ON dbo.audit_logs(timestamp DESC);
      END`,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.tables t
        WHERE t.name = 'query_cache' AND t.schema_id = SCHEMA_ID('dbo')
      )
      BEGIN
        CREATE TABLE dbo.query_cache (
          cache_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          query_hash NVARCHAR(64) NOT NULL UNIQUE,
          user_id NVARCHAR(255) NOT NULL,
          original_query NVARCHAR(MAX) NOT NULL,
          generated_sql NVARCHAR(MAX) NOT NULL,
          result_data NVARCHAR(MAX),
          execution_time INT,
          record_count INT,
          created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          expires_at DATETIME2,
          access_count INT DEFAULT 0
        );
        CREATE INDEX IDX_QUERY_CACHE_HASH ON dbo.query_cache(query_hash);
      END`,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.tables t
        WHERE t.name = 'query_history' AND t.schema_id = SCHEMA_ID('dbo')
      )
      BEGIN
        CREATE TABLE dbo.query_history (
          query_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          user_id NVARCHAR(255) NOT NULL,
          original_query NVARCHAR(MAX) NOT NULL,
          generated_sql NVARCHAR(MAX) NOT NULL,
          execution_time INT,
          record_count INT,
          success BIT,
          error_message NVARCHAR(MAX),
          created_at DATETIME2 DEFAULT SYSUTCDATETIME()
        );
        CREATE INDEX IDX_QUERY_HISTORY_USER ON dbo.query_history(user_id);
        CREATE INDEX IDX_QUERY_HISTORY_CREATED ON dbo.query_history(created_at);
      END`,
      `
      IF NOT EXISTS (
        SELECT 1 FROM sys.tables t
        WHERE t.name = 'user_sessions' AND t.schema_id = SCHEMA_ID('dbo')
      )
      BEGIN
        CREATE TABLE dbo.user_sessions (
          session_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          user_id NVARCHAR(255) NOT NULL,
          login_time DATETIME2 DEFAULT SYSUTCDATETIME(),
          last_activity DATETIME2 DEFAULT SYSUTCDATETIME(),
          ip_address NVARCHAR(45),
          user_agent NVARCHAR(MAX),
          is_active BIT DEFAULT 1,
          logout_time DATETIME2
        );
        CREATE INDEX IDX_USER_SESSIONS_USER ON dbo.user_sessions(user_id);
      END`,
    ];

    for (const statement of statements) {
      const request = this.pool.request();
      await request.batch(statement);
    }

    this.schemaEnsured = true;
  }

  /**
   * Execute a single query with parameters
   */
  async query<T = any>(sqlText: string, params?: any[]): Promise<QueryResult<T>> {
    try {
      return await this.executeQuery<T>(sqlText, params);
    } catch (error) {
      console.error('Database query error:', {
        sql: sqlText.substring(0, 200),
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getRows<T = any>(sqlText: string, params?: any[]): Promise<T[]> {
    const result = await this.query<T>(sqlText, params);
    return result.rows;
  }

  async getRow<T = any>(sqlText: string, params?: any[]): Promise<T | null> {
    const rows = await this.getRows<T>(sqlText, params);
    return rows[0] || null;
  }

  async getScalar<T = any>(sqlText: string, params?: any[]): Promise<T | null> {
    const row = await this.getRow<Record<string, T>>(sqlText, params);
    if (!row) return null;
    return Object.values(row)[0] || null;
  }

  async getCount(sqlText: string, params?: any[]): Promise<number> {
    const value = await this.getScalar<number>(sqlText, params);
    return value ?? 0;
  }

  async transaction<T>(callback: (transaction: Transaction) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const transaction = new sql.Transaction(this.pool);
    const isolation = options.isolationLevel || ISOLATION_LEVEL.READ_COMMITTED;
    await transaction.begin(isolation);

    try {
      const result = await callback(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      console.error('Transaction error:', error);
      throw error;
    }
  }

  async batchInsert(
    table: string,
    columns: string[],
    rows: any[][]
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const placeholders = rows
      .map((_, rowIdx) => {
        const group = columns
          .map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`)
          .join(', ');
        return `(${group})`;
      })
      .join(', ');

    const flatValues = rows.flat();
    const sqlText = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`;
    const result = await this.query(sqlText, flatValues);
    return result.rowCount || 0;
  }

  private buildTableIdentifier(table: string): TableDescriptor {
    const parts = table.includes('.') ? table.split('.') : ['dbo', table];
    if (parts.length === 1) {
      return { schema: 'dbo', name: parts[0] };
    }
    return {
      schema: parts.slice(0, -1).join('.'),
      name: parts[parts.length - 1],
    };
  }

  async getTableSchema(table: string): Promise<Record<string, any>[]> {
    const descriptor = this.buildTableIdentifier(table);
    const sqlText = `
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `;

    return this.getRows(sqlText, [descriptor.schema, descriptor.name]);
  }

  async getTables(): Promise<TableDescriptor[]> {
    const sqlText = `
      SELECT TABLE_SCHEMA, TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME;
    `;

    const rows = await this.getRows<{ TABLE_SCHEMA: string; TABLE_NAME: string }>(sqlText);
    return rows.map(row => ({
      schema: row.TABLE_SCHEMA,
      name: row.TABLE_NAME,
    }));
  }

  async getDatabaseSchema(): Promise<string> {
    const tables = await this.getTables();
    const ddlChunks: string[] = [];

    for (const descriptor of tables) {
      const columns = await this.getTableSchema(`${descriptor.schema}.${descriptor.name}`);
      const columnDefs = columns
        .map(col => {
          const maxLength = col.character_maximum_length;
          const lengthSuffix = maxLength && maxLength !== -1 ? `(${maxLength})` : '';
          const nullability = col.is_nullable === 'NO' ? ' NOT NULL' : ' NULL';
          return `  [${col.column_name}] ${col.data_type?.toUpperCase() || 'sql_variant'}${lengthSuffix}${nullability}`;
        })
        .join('\n');

      const qualifiedName = `[${descriptor.schema}].[${descriptor.name}]`;
      ddlChunks.push(`CREATE TABLE ${qualifiedName} (\n${columnDefs}\n);`);
    }

    return ddlChunks.join('\n\n');
  }

  async explainQuery(sqlText: string, params?: any[]): Promise<any[]> {
    const normalizedSql = this.convertPlaceholders(sqlText);
    const request = this.pool.request();
    (params || []).forEach((value, index) => {
      request.input(`p${index + 1}`, value);
    });

    const explainSql = `
      BEGIN TRY
        SET PARSEONLY ON;
        ${normalizedSql};
        SET PARSEONLY OFF;
      END TRY
      BEGIN CATCH
        SET PARSEONLY OFF;
        THROW;
      END CATCH;
    `;

    await request.query(explainSql);
    return [];
  }

  getPoolStats() {
    return {
      totalConnections: this.connectionCount,
      idleConnections: (this.pool as any).idleCount ?? 0,
      waitingRequests: (this.pool as any).waitingRequestCount ?? 0,
    };
  }

  async close(): Promise<void> {
    await this.pool.close();
    console.log('Database connection pool closed');
  }
}

export { DatabaseClient, DBConfig, TransactionOptions, QueryResult };
