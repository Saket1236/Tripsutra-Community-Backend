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

module.exports = pool;