const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'tripsutra',
  password: 'saket@05',
  port: 5432,
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