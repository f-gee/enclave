const pool = require('../config/db');

/**
 * ScopedDb wraps the raw Postgres pool so that every query is:
 *   1. App-level filtered by tenant_id (belt)
 *   2. Run inside a transaction where `app.current_tenant` is set,
 *      so Postgres Row Level Security enforces the same boundary
 *      independently of the application code (suspenders)
 *
 * Routes should never import `config/db` directly — always go through
 * req.db (attached by middleware/scopeDb.js) so it's structurally
 * hard to forget the tenant filter.
 */
class ScopedDb {
  constructor(tenantId) {
    if (!tenantId) {
      throw new Error('ScopedDb requires a tenantId');
    }
    this.tenantId = tenantId;
  }

  async _withClient(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // set_config(..., true) behaves like SET LOCAL (transaction-scoped) but,
      // unlike raw SET LOCAL, accepts a bound parameter — avoids string-building SQL.
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [this.tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async query(text, params = []) {
    return this._withClient((client) => client.query(text, params));
  }

  async find(table, whereClause = '1=1', params = []) {
    const sql = `SELECT * FROM ${table} WHERE tenant_id = $1 AND (${whereClause})`;
    const { rows } = await this.query(sql, [this.tenantId, ...params]);
    return rows;
  }

  async findOne(table, whereClause = '1=1', params = []) {
    const rows = await this.find(table, whereClause, params);
    return rows[0] || null;
  }

  async insert(table, data) {
    const payload = { ...data, tenant_id: this.tenantId };
    const columns = Object.keys(payload);
    const values = Object.values(payload);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const { rows } = await this.query(sql, values);
    return rows[0];
  }

  async update(table, id, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');

    const sql = `
      UPDATE ${table}
      SET ${setClause}, updated_at = now()
      WHERE id = $${columns.length + 1} AND tenant_id = $${columns.length + 2}
      RETURNING *`;
    const { rows } = await this.query(sql, [...values, id, this.tenantId]);
    return rows[0] || null;
  }

  async delete(table, id) {
    const sql = `DELETE FROM ${table} WHERE id = $1 AND tenant_id = $2 RETURNING id`;
    const { rows } = await this.query(sql, [id, this.tenantId]);
    return rows[0] || null;
  }
}

module.exports = ScopedDb;
