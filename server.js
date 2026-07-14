if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const cloudinary = require('./cloudinary');

const app = express();

app.use(cors());
app.use(express.json());

// ---- Startup checks ----
if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('❌ Missing Cloudinary credentials in environment variables');
}

// ---- Helpers ----
function getPublicIdFromUrl(url) {
  if (!url) return null;
  const parts = url.split('/upload/');
  if (parts.length < 2) return null;
  const afterUpload = parts[1]; // v1699999999/tripsutra_upload/abc123.jpg
  const withoutVersion = afterUpload.replace(/^v\d+\//, '');
  const withoutExt = withoutVersion.replace(/\.[^/.]+$/, '');
  return withoutExt;
}

async function deleteImageIfExists(imageUrl) {
  const publicId = getPublicIdFromUrl(imageUrl);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
    console.log('🗑️ Cloudinary image deleted:', publicId);
  } catch (err) {
    console.error('⚠️ Cloudinary delete failed:', err.message);
  }
}

// ---- Routes ----

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
      title,
      description,
      category,
      latitude,
      longitude,
      map_link,
      location_label,
      image_url,
      submitted_by_email
    } = req.body;

    if (!title || !image_url) {
      return res.status(400).json({
        success: false,
        error: 'title and image_url are required'
      });
    }

    const result = await pool.query(
      `
      INSERT INTO spots
      (
        title,
        description,
        category,
        latitude,
        longitude,
        map_link,
        location_label,
        image_url,
        submitted_by_email
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        title,
        description,
        category,
        latitude,
        longitude,
        map_link,
        location_label,
        image_url,
        submitted_by_email
      ]
    );

    console.log('✅ Spot Saved');

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

} catch (error) {
    console.error('❌ ERROR');
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
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

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Spot not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reject a pending spot (deletes DB row + Cloudinary image)
app.delete('/reject-spot/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const spotResult = await pool.query('SELECT * FROM spots WHERE id=$1', [id]);
    if (spotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Spot not found' });
    }

    await deleteImageIfExists(spotResult.rows[0].image_url);

    await pool.query('DELETE FROM spots WHERE id=$1', [id]);
    res.json({ success: true, message: 'Spot rejected and deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: delete any approved spot (deletes DB row + Cloudinary image)
app.delete('/delete-spot/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const check = await pool.query(
      "SELECT * FROM spots WHERE id=$1 AND status='approved'",
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Approved spot not found' });
    }

    await deleteImageIfExists(check.rows[0].image_url);

    await pool.query("DELETE FROM spots WHERE id=$1", [id]);

    res.json({ success: true, message: 'Spot permanently deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/spots/user', async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ error: 'email query param is required' });
    }

    const result = await pool.query(
      "SELECT * FROM spots WHERE submitted_by_email=$1 ORDER BY id DESC",
      [email]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User deletes their own pending spot (deletes DB row + Cloudinary image)
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

    await deleteImageIfExists(check.rows[0].image_url);

    await pool.query('DELETE FROM spots WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
