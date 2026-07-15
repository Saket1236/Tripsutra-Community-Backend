if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const cloudinary = require('./cloudinary');
const cron = require('node-cron');

const app = express();

app.use(cors());
app.use(express.json());

// ---- Startup checks ----
if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('❌ Missing Cloudinary credentials in environment variables');
}

// ---- Categories (keep in sync with Flutter's _kAllCategories) ----
const ALLOWED_CATEGORIES = [
  'Food', 'Attraction', 'Monument', 'Nature',
  'Trekking Spot', 'Waterfall', 'Temple', 'Park', 'Auditorium',
  'Event'
];

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

// ---- Event cleanup ----
async function cleanupExpiredEvents() {
  try {
    console.log('🧹 Checking for expired events...');

    const result = await pool.query(
      `SELECT *
       FROM spots
       WHERE category = 'Event'
       AND event_date IS NOT NULL
       AND event_time IS NOT NULL
       AND (event_date + event_time::interval)
           < (NOW() AT TIME ZONE 'Asia/Kolkata')`
    );

    console.log(`🔍 Found ${result.rows.length} expired event(s)`);

    for (const spot of result.rows) {
      try {
        await deleteImageIfExists(spot.image_url);

        await pool.query('DELETE FROM spots WHERE id=$1', [spot.id]);

        console.log(`🗑️ Expired event deleted: ${spot.title} (id: ${spot.id})`);
      } catch (deleteError) {
        console.error(`❌ Failed to delete event ${spot.id}:`, deleteError.message);
      }
    }

    if (result.rows.length > 0) {
      console.log(`✅ Event cleanup complete: ${result.rows.length} expired event(s) removed`);
    }
  } catch (error) {
    console.error('⚠️ Event cleanup failed:', error);
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
      submitted_by_email,
      event_date,
      event_time
    } = req.body;

    if (!title || !image_url) {
      return res.status(400).json({
        success: false,
        error: 'title and image_url are required'
      });
    }

    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        error: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    if (category === 'Event' && (!event_date || !event_time)) {
      return res.status(400).json({
        success: false,
        error: 'event_date and event_time are required for Event category'
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
        submitted_by_email,
        event_date,
        event_time
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        submitted_by_email,
        category === 'Event' ? event_date : null,
        category === 'Event' ? event_time : null
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
    // Delete expired events whenever this endpoint is hit
    // (covers the case where Render's cron didn't fire because the service was asleep)
    await cleanupExpiredEvents();

    const result = await pool.query(
      `SELECT *
       FROM spots
       WHERE status = 'approved'
       AND (
         category != 'Event'
         OR event_date IS NULL
         OR event_time IS NULL
         OR (event_date + event_time::interval)
            >= (NOW() AT TIME ZONE 'Asia/Kolkata')
       )
       ORDER BY id DESC`
    );

    res.json(result.rows);

  } catch (error) {
    console.error('❌ Approved spots error:', error);
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

// Admin: edit a spot's title/category/description (works for pending or approved)
app.put('/edit-spot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, description, event_date, event_time } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }

    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        error: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    if (category === 'Event' && (!event_date || !event_time)) {
      return res.status(400).json({
        success: false,
        error: 'event_date and event_time are required for Event category'
      });
    }

    const result = await pool.query(
      `UPDATE spots
       SET title=$1, category=$2, description=$3, event_date=$4, event_time=$5
       WHERE id=$6
       RETURNING *`,
      [
        title,
        category,
        description ?? '',
        category === 'Event' ? event_date : null,
        category === 'Event' ? event_time : null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Spot not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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


// ─────────────────────────────────────────────────────────
// TRAVEL SHORTS
// ─────────────────────────────────────────────────────────

// Public: only active shorts, ordered — used by the Flutter app
app.get('/travel-shorts', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM travel_shorts WHERE is_active=true ORDER BY display_order ASC, id ASC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: all shorts (active + hidden) — used by the admin panel
app.get('/admin/travel-shorts', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM travel_shorts ORDER BY display_order ASC, id ASC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/travel-shorts', async (req, res) => {
  try {
    const { youtube_url, title } = req.body;
    if (!youtube_url) {
      return res.status(400).json({ error: 'youtube_url is required' });
    }

    const maxOrder = await pool.query(
      'SELECT COALESCE(MAX(display_order), -1) AS max_order FROM travel_shorts'
    );
    const nextOrder = maxOrder.rows[0].max_order + 1;

    const result = await pool.query(
      `INSERT INTO travel_shorts (youtube_url, title, is_active, display_order)
       VALUES ($1, $2, true, $3) RETURNING *`,
      [youtube_url, title || null, nextOrder]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Partial update — any field left out of the body keeps its current value
app.put('/travel-shorts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM travel_shorts WHERE id=$1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Short not found' });
    }
    const current = existing.rows[0];

    const youtube_url  = req.body.youtube_url  ?? current.youtube_url;
    const title        = req.body.title        ?? current.title;
    const is_active    = req.body.is_active    ?? current.is_active;
    const display_order = req.body.display_order ?? current.display_order;

    const result = await pool.query(
      `UPDATE travel_shorts
       SET youtube_url=$1, title=$2, is_active=$3, display_order=$4
       WHERE id=$5 RETURNING *`,
      [youtube_url, title, is_active, display_order, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/travel-shorts/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const result = await pool.query(
      'UPDATE travel_shorts SET is_active=$1 WHERE id=$2 RETURNING *',
      [is_active, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Short not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/travel-shorts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM travel_shorts WHERE id=$1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Short not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;

// ---- Event cleanup cron ----
// Runs every 15 minutes while the service is awake, in IST
cron.schedule(
  '*/15 * * * *',
  async () => {
    console.log('⏰ Cron triggered');
    await cleanupExpiredEvents();
  },
  {
    timezone: 'Asia/Kolkata'
  }
);

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  console.log('🧹 Running startup event cleanup...');
  await cleanupExpiredEvents();
});
