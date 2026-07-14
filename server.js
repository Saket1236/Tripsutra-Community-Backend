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


// ─────────────────────────────────────────────────────────
// STARTUP CHECKS
// ─────────────────────────────────────────────────────────

if (
  !process.env.CLOUDINARY_API_KEY ||
  !process.env.CLOUDINARY_API_SECRET
) {
  console.error(
    '❌ Missing Cloudinary credentials in environment variables'
  );
}


// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function getPublicIdFromUrl(url) {
  if (!url) return null;

  const parts = url.split('/upload/');

  if (parts.length < 2) {
    return null;
  }

  const afterUpload = parts[1];

  const withoutVersion = afterUpload.replace(
    /^v\d+\//,
    ''
  );

  const withoutExt = withoutVersion.replace(
    /\.[^/.]+$/,
    ''
  );

  return withoutExt;
}


async function deleteImageIfExists(imageUrl) {
  const publicId = getPublicIdFromUrl(imageUrl);

  if (!publicId) {
    return;
  }

  try {
    await cloudinary.uploader.destroy(
      publicId
    );

    console.log(
      '🗑️ Cloudinary image deleted:',
      publicId
    );
  } catch (err) {
    console.error(
      '⚠️ Cloudinary delete failed:',
      err.message
    );
  }
}


// ─────────────────────────────────────────────────────────
// BASIC ROUTES
// ─────────────────────────────────────────────────────────

app.post('/test', (req, res) => {
  console.log('TEST HIT');

  res.json({
    success: true
  });
});


app.get('/', (req, res) => {
  res.send(
    'TripSutra API Running'
  );
});


// ═════════════════════════════════════════════════════════
// TRAVEL SHORTS
// ═════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────
// GET ACTIVE TRAVEL SHORTS
// PUBLIC APP ROUTE
// ─────────────────────────────────────────────────────────

app.get('/travel-shorts', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        youtube_url,
        title,
        display_order,
        is_active,
        created_at
      FROM travel_shorts
      WHERE is_active = TRUE
      ORDER BY
        display_order ASC,
        created_at DESC
      `
    );

    res.json(
      result.rows
    );
  } catch (error) {
    console.error(
      '❌ Fetch travel shorts error:',
      error
    );

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// ─────────────────────────────────────────────────────────
// GET ALL TRAVEL SHORTS
// ADMIN ROUTE
// ─────────────────────────────────────────────────────────

app.get(
  '/admin/travel-shorts',
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM travel_shorts
        ORDER BY
          display_order ASC,
          created_at DESC
        `
      );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        '❌ Fetch admin travel shorts error:',
        error
      );

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// ADD TRAVEL SHORT
// ─────────────────────────────────────────────────────────

app.post(
  '/travel-shorts',
  async (req, res) => {
    try {
      const {
        youtube_url,
        title,
        display_order
      } = req.body;

      if (!youtube_url) {
        return res.status(400).json({
          success: false,
          error: 'youtube_url is required'
        });
      }

      const youtubeRegex =
        /(?:youtube\.com\/shorts\/|youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

      if (!youtubeRegex.test(youtube_url)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid YouTube URL'
        });
      }

      let order = display_order;

      if (
        order === undefined ||
        order === null
      ) {
        const orderResult =
          await pool.query(
            `
            SELECT
              COALESCE(
                MAX(display_order),
                0
              ) + 1 AS next_order
            FROM travel_shorts
            `
          );

        order =
          orderResult.rows[0].next_order;
      }

      const result = await pool.query(
        `
        INSERT INTO travel_shorts
        (
          youtube_url,
          title,
          display_order
        )
        VALUES
        ($1, $2, $3)
        RETURNING *
        `,
        [
          youtube_url,
          title || '',
          order
        ]
      );

      console.log(
        '🎬 Travel Short added:',
        result.rows[0].id
      );

      res.status(201).json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      console.error(
        '❌ Add Travel Short error:',
        error
      );

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// UPDATE TRAVEL SHORT
// ─────────────────────────────────────────────────────────

app.put(
  '/travel-shorts/:id',
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
        youtube_url,
        title,
        display_order,
        is_active
      } = req.body;

      const check = await pool.query(
        `
        SELECT *
        FROM travel_shorts
        WHERE id = $1
        `,
        [id]
      );

      if (check.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Travel Short not found'
        });
      }

      const current = check.rows[0];

      const result = await pool.query(
        `
        UPDATE travel_shorts
        SET
          youtube_url = $1,
          title = $2,
          display_order = $3,
          is_active = $4
        WHERE id = $5
        RETURNING *
        `,
        [
          youtube_url ??
            current.youtube_url,

          title ??
            current.title,

          display_order ??
            current.display_order,

          is_active ??
            current.is_active,

          id
        ]
      );

      console.log(
        '✏️ Travel Short updated:',
        id
      );

      res.json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      console.error(
        '❌ Update Travel Short error:',
        error
      );

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// ENABLE / DISABLE TRAVEL SHORT
// ─────────────────────────────────────────────────────────

app.patch(
  '/travel-shorts/:id/status',
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
        is_active
      } = req.body;

      if (
        typeof is_active !== 'boolean'
      ) {
        return res.status(400).json({
          success: false,
          error:
            'is_active must be boolean'
        });
      }

      const result = await pool.query(
        `
        UPDATE travel_shorts
        SET is_active = $1
        WHERE id = $2
        RETURNING *
        `,
        [
          is_active,
          id
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Travel Short not found'
        });
      }

      res.json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      console.error(
        '❌ Change Short status error:',
        error
      );

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// DELETE TRAVEL SHORT
// ─────────────────────────────────────────────────────────

app.delete(
  '/travel-shorts/:id',
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `
        DELETE FROM travel_shorts
        WHERE id = $1
        RETURNING *
        `,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Travel Short not found'
        });
      }

      console.log(
        '🗑️ Travel Short deleted:',
        id
      );

      res.json({
        success: true,
        message:
          'Travel Short deleted successfully'
      });
    } catch (error) {
      console.error(
        '❌ Delete Travel Short error:',
        error
      );

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


// ═════════════════════════════════════════════════════════
// COMMUNITY SPOTS
// ═════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────
// SUBMIT SPOT
// ─────────────────────────────────────────────────────────

app.post('/spots', async (req, res) => {
  try {
    console.log(
      '📥 POST Request Received'
    );

    console.log(
      req.body
    );

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
        error:
          'title and image_url are required'
      });
    }


    // ─────────────────────────────────────────────────────
    // EVENT VALIDATION
    // ─────────────────────────────────────────────────────

    if (
      category === 'Event' &&
      (!event_date || !event_time)
    ) {
      return res.status(400).json({
        success: false,
        error:
          'event_date and event_time are required for Event'
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
      (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,$11
      )
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
        category === 'Event'
          ? event_date
          : null,
        category === 'Event'
          ? event_time
          : null
      ]
    );

    console.log(
      '✅ Spot Saved'
    );

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error(
      '❌ ERROR'
    );

    console.error(
      error
    );

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// ─────────────────────────────────────────────────────────
// PENDING SPOTS
// ─────────────────────────────────────────────────────────

app.get(
  '/pending-spots',
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM spots
        WHERE status = 'pending'
        ORDER BY id DESC
        `
      );

      res.json(
        result.rows
      );
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// APPROVED SPOTS
// ─────────────────────────────────────────────────────────

app.get(
  '/approved-spots',
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM spots
        WHERE status = 'approved'
        ORDER BY id DESC
        `
      );

      res.json(
        result.rows
      );
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// APPROVE SPOT
// ─────────────────────────────────────────────────────────

app.put(
  '/approve-spot/:id',
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `
        UPDATE spots
        SET status = 'approved'
        WHERE id = $1
        RETURNING *
        `,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Spot not found'
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// REJECT PENDING SPOT
// ─────────────────────────────────────────────────────────

app.delete(
  '/reject-spot/:id',
  async (req, res) => {
    try {
      const { id } = req.params;

      const spotResult =
        await pool.query(
          `
          SELECT *
          FROM spots
          WHERE id = $1
          `,
          [id]
        );

      if (
        spotResult.rows.length === 0
      ) {
        return res.status(404).json({
          error: 'Spot not found'
        });
      }

      await deleteImageIfExists(
        spotResult.rows[0].image_url
      );

      await pool.query(
        `
        DELETE FROM spots
        WHERE id = $1
        `,
        [id]
      );

      res.json({
        success: true,
        message:
          'Spot rejected and deleted'
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// DELETE APPROVED SPOT
// ─────────────────────────────────────────────────────────

app.delete(
  '/delete-spot/:id',
  async (req, res) => {
    try {
      const { id } = req.params;

      const check = await pool.query(
        `
        SELECT *
        FROM spots
        WHERE id = $1
        AND status = 'approved'
        `,
        [id]
      );

      if (check.rows.length === 0) {
        return res.status(404).json({
          error:
            'Approved spot not found'
        });
      }

      await deleteImageIfExists(
        check.rows[0].image_url
      );

      await pool.query(
        `
        DELETE FROM spots
        WHERE id = $1
        `,
        [id]
      );

      res.json({
        success: true,
        message:
          'Spot permanently deleted'
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// USER SPOTS
// ─────────────────────────────────────────────────────────

app.get(
  '/spots/user',
  async (req, res) => {
    try {
      const email = req.query.email;

      if (!email) {
        return res.status(400).json({
          error:
            'email query param is required'
        });
      }

      const result = await pool.query(
        `
        SELECT *
        FROM spots
        WHERE submitted_by_email = $1
        ORDER BY id DESC
        `,
        [email]
      );

      res.json(
        result.rows
      );
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// USER DELETE OWN PENDING SPOT
// ─────────────────────────────────────────────────────────

app.delete(
  '/spots/user/:id',
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
        email
      } = req.query;

      if (!email) {
        return res.status(400).json({
          error:
            'email query param is required'
        });
      }

      const check = await pool.query(
        `
        SELECT *
        FROM spots
        WHERE id = $1
        AND submitted_by_email = $2
        AND status = 'pending'
        `,
        [
          id,
          email
        ]
      );

      if (check.rows.length === 0) {
        return res.status(403).json({
          error:
            'Not allowed or spot not pending'
        });
      }

      await deleteImageIfExists(
        check.rows[0].image_url
      );

      await pool.query(
        `
        DELETE FROM spots
        WHERE id = $1
        `,
        [id]
      );

      res.json({
        success: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);


// ─────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────

const PORT =
  process.env.PORT || 3000;


app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `🚀 Server running on port ${PORT}`
    );
  }
);
