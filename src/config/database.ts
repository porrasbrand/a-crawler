/**
 * MySQL database configuration and connection pool
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Database configuration from environment variables
 */
const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'loco',
  password: process.env.MYSQL_PASSWORD || 'Probandolo901!',
  database: process.env.MYSQL_DATABASE || 'crawler_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

/**
 * MySQL connection pool
 * Use pool.execute() or pool.query() for queries
 */
export const pool = mysql.createPool(dbConfig);

/**
 * Test database connection
 * Call this on application startup to verify connectivity
 */
export async function testConnection(): Promise<void> {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Database connected successfully');
    connection.release();
  } catch (error) {
    console.error('❌ Database connection failed:', (error as Error).message);
    throw error;
  }
}

/**
 * Close all connections in the pool
 * Call this on application shutdown
 */
export async function closePool(): Promise<void> {
  await pool.end();
  console.log('Database connection pool closed');
}

/**
 * Execute a query with automatic error handling
 * Convenience wrapper around pool.execute
 */
export async function executeQuery<T = any>(
  query: string,
  params?: any[]
): Promise<T[]> {
  try {
    const [rows] = await pool.execute(query, params);
    return rows as T[];
  } catch (error) {
    console.error('Query execution error:', {
      query: query.substring(0, 100) + '...',
      error: (error as Error).message,
    });
    throw error;
  }
}
