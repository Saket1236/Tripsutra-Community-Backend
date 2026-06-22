const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

app.post('/test', (req, res) => {
  console.log('TEST HIT');
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.send('TripSutra API Running');
});

app.post('/spots', async (req, res) => {
  try {
    console.log('📥 POST Request Received');
    console.log(req.body);

    const {
      title, description, category,
      latitude, longitude, image_url,
      submitted_by_email
    } = req.body;

    const result = await pool.query(
      `INSERT INTO spots
       (title, description, category, latitude, longitude, image_url, submitted_by_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [title, description, category, latitude, longitude, image_url, submitted_by_email]
    );

    console.log('✅ Spot Saved');
    res.json({ success: true, data: result.rows[0] });

  } catch (error) {
    console.error('❌ ERROR', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/pending-spots', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM spots WHERE status='pending' ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/approved-spots', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM spots WHERE status='approved' ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/approve-spot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE spots SET status='approved' WHERE id=$1 RETURNING *",
      [id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/reject-spot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM spots WHERE id=$1", [id]);
    res.json({ success: true, message: 'Spot rejected and deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Admin: delete any approved spot


app.delete('/delete-spot/:id', async (req, res) => {


  try {


    const { id } = req.params;


    const check = await pool.query(


      "SELECT id FROM spots WHERE id=$1 AND status='approved'",


      [id]


    );


    if (check.rows.length === 0) {


      return res.status(404).json({ error: 'Approved spot not found' });


    }


    await pool.query("DELETE FROM spots WHERE id=$1", [id]);


    res.json({ success: true, message: 'Spot permanently deleted' });


  } catch (error) {


    res.status(500).json({ error: error.message });


  }


});


app.get('/spots/user', async (req, res) => {
  try {
    const email = req.query.email;
    const result = await pool.query(
      "SELECT * FROM spots WHERE submitted_by_email=$1 ORDER BY id DESC",
      [email]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/spots/user/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    const check = await pool.query(
      "SELECT * FROM spots WHERE id=$1 AND submitted_by_email=$2 AND status='pending'",
      [id, email]
    );

    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not allowed or spot not pending' });
    }

    await pool.query('DELETE FROM spots WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('🚀 Server running on port 3000');
});