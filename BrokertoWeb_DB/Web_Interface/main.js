import express from "express";
import { Server } from "socket.io";
import http from "http";
import { dataEmitter } from "../mqtt_data/mqtt_receivedata.js";
import path from "path";               // Dùng để xử lý đường dẫn file
import { fileURLToPath } from "url";   // Chuyển URL module thành đường dẫn file thật
import { Pool } from "pg";
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "iotdb",
  password: "minhtinh",
  port: 5432,
});
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bh1750lux (
        id SERIAL PRIMARY KEY,
        lux REAL NOT NULL,
        timestamp TIMESTAMP NOT NULL  
      );
    `);

    console.log("Bảng bh1750lux đã sẵn sàng.");
  } catch (err) {
    console.error("Lỗi tạo bảng:", err.message);
  }
}

initDatabase();
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;
//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cho phép Express truy cập folder public
app.use(express.static(path.join(__dirname, "public")));

// Trang chính hiển thị realtime
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Trang lọc dữ liệu
app.get("/filter", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "filter_index.html"));
});


app.get("/api/lux", async (req, res) => {
  const { start, end, luxMin, luxMax } = req.query;
  let query = "SELECT * FROM bh1750lux WHERE 1=1";
  const params = [];
  let idx = 1;

  // Filter theo thời gian
  if (start && end) {
    query += ` AND timestamp BETWEEN $${idx++} AND $${idx++}`;
    params.push(new Date(start), new Date(end));
  } else if (start) {  // chỉ có start
    query += ` AND timestamp >= $${idx++}`;
    params.push(new Date(start));
  } else if (end) {    // chỉ có end
    query += ` AND timestamp <= $${idx++}`;
    params.push(new Date(end));
  }

  // Filter theo Lux
  if (luxMin && luxMax) {
    query += ` AND lux BETWEEN $${idx++} AND $${idx++}`;
    params.push(parseFloat(luxMin), parseFloat(luxMax));
  } else if (luxMin) {
    query += ` AND lux >= $${idx++}`;
    params.push(parseFloat(luxMin));
  } else if (luxMax) {
    query += ` AND lux <= $${idx++}`;
    params.push(parseFloat(luxMax));
  }

  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Lỗi truy vấn:", err.message);
    res.status(500).json({ error: err.message });
  }

})


io.on("connection", (socket) => {
  console.log(" Client connected");

  const luxListener = (data) => {
    socket.emit("DataWS", data); // gửi cả đối tượng {lux, timeStr}
  };

  const noDataListener = () => {
    socket.emit("noDataWS");
  };

  dataEmitter.on("Lux", luxListener);
  dataEmitter.on("noData", noDataListener);

  socket.on("disconnect", () => {
    console.log("Client disconnected");

    dataEmitter.off("Lux", luxListener);
    dataEmitter.off("noData", noDataListener);
  });
});
server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}/`);
})
