import express from "express";
import http from "http";
import { Server } from "socket.io";
import mqtt from "mqtt";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===== DB ===== */
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "iotdb",
  password: "minhtinh",
  port: 5432,
});

await pool.query(`
CREATE TABLE IF NOT EXISTS bh1750lux (
  id SERIAL PRIMARY KEY,
  lux REAL NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  device VARCHAR(50),
  location VARCHAR(50),
  UNIQUE(device, "timestamp")
);
CREATE INDEX IF NOT EXISTS idx_loc_dev_time
ON bh1750lux(location, device, "timestamp" DESC);
`);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

/* ===== LOCATIONS ===== */
app.get("/api/locations", async (_, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (device)
      location, device, lux,
      (EXTRACT(EPOCH FROM "timestamp") * 1000)::BIGINT AS ts
    FROM bh1750lux
    ORDER BY device, "timestamp" DESC
  `);
  res.json(rows);
});

/* ===== HISTORY ===== */
app.get("/api/device/:device/history", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT lux,
      (EXTRACT(EPOCH FROM "timestamp") * 1000)::BIGINT AS ts
    FROM bh1750lux
    WHERE device = $1
    ORDER BY "timestamp" DESC
    LIMIT 30
  `, [req.params.device]);

  res.json(rows.reverse());
});

/* ===== TABLE ===== */
app.get("/api/table", async (req, res) => {
  const { device, limit = 10, offset = 0, from, to } = req.query;

  try {
    let query = `
      SELECT lux,
        (EXTRACT(EPOCH FROM "timestamp") * 1000)::BIGINT AS ts
      FROM bh1750lux
      WHERE device = $1
    `;
    const params = [device];

    if (from && to) {
      query += `
        AND "timestamp" BETWEEN
          TO_TIMESTAMP($2 / 1000.0)
          AND TO_TIMESTAMP($3 / 1000.0)
      `;
      params.push(Number(from), Number(to));
    }

    query += `
      ORDER BY "timestamp" DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("TABLE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// app.get("/api/device/:device/chartfilter", async (req, res) => {
   
// });

/* ===== EXPORT ===== */
app.get("/api/export", async (req, res) => {
  try {
    const { device, from, to } = req.query;
    const fromTs = Number(from);
    const toTs = Number(to);

    if (!device || !Number.isFinite(fromTs) || !Number.isFinite(toTs)) {
      return res.status(400).json({
        success: false,
        error: "Invalid timestamp"
      });
    }

    const sql = `
      SELECT lux,
        (EXTRACT(EPOCH FROM "timestamp") * 1000)::BIGINT AS ts
      FROM bh1750lux
      WHERE device = $1
        AND "timestamp" BETWEEN
          TO_TIMESTAMP($2 / 1000.0)
          AND TO_TIMESTAMP($3 / 1000.0)
      ORDER BY "timestamp" ASC
      
    `;

    const { rows } = await pool.query(sql, [device, fromTs, toTs]);
    res.json({ success: true, data: rows });

  } catch (err) {
    console.error("EXPORT ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/* ===== MQTT ===== */
const mqttClient = mqtt.connect("mqtt://broker.hivemq.com:1883");
mqttClient.subscribe("esp32/luxbh1750");

mqttClient.on("message", async (_, msg) => {
  const d = JSON.parse(msg.toString());
  const ts = new Date(d.time * 1000);

  await pool.query(
    `INSERT INTO bh1750lux(lux,"timestamp",device,location)
     VALUES($1,$2,$3,$4)`,
    [d.lux, ts, d.device, d.location]
  );

  io.emit("lux", {
    device: d.device,
    location: d.location,
    lux: d.lux,
    ts: ts.getTime()
  });
});

server.listen(5500, () =>
  console.log("✅ http://localhost:5500")
);
