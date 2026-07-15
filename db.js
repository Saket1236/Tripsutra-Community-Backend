const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.connect()
  .then(() => {
    console.log('✅ PostgreSQL Connected');
  })
  .catch((err) => {
    console.error('❌ PostgreSQL Connection Error');
    console.error(err);
  });

// Prevents an idle-client connection error from crashing the whole process.
// Without this, an error here is uncaught and Node exits with status 1.
pool.on('error', (err) => {
  console.error('⚠️ Unexpected PG pool error (idle client):', err.message);
});

module.exports = pool;
