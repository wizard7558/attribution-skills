// Interactive transaction wrappers shared by all collector adapters.
// Never emulate transactions by sending BEGIN/COMMIT through pool.query().
export function createPgDatabase(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('pg pool must provide query and connect');
  }
  return {
    query: (text, params) => pool.query(text, params),
    async transaction(callback) {
      if (typeof callback !== 'function') throw new TypeError('transaction callback must be a function');
      const client = await pool.connect();
      let begun = false, failed = false, destroy = false;
      try {
        await client.query('BEGIN');
        begun = true;
        const result = await callback({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        failed = true;
        if (begun) {
          try { await client.query('ROLLBACK'); }
          catch { destroy = true; }
        } else {
          // A failed BEGIN leaves connection usability uncertain.
          destroy = true;
        }
        throw error;
      } finally {
        try { client.release(destroy); }
        catch (error) { if (!failed) throw error; }
      }
    },
  };
}

export function createPostgresDatabase(sql) {
  if (!sql || typeof sql.unsafe !== 'function' || typeof sql.begin !== 'function') {
    throw new TypeError('postgres.js client must provide unsafe and begin');
  }
  const queries = (connection) => ({
    async query(text, params = []) {
      return { rows: Array.from(await connection.unsafe(text, params)) };
    },
  });
  return {
    ...queries(sql),
    async transaction(callback) {
      if (typeof callback !== 'function') throw new TypeError('transaction callback must be a function');
      return sql.begin((transaction) => callback(queries(transaction)));
    },
  };
}
