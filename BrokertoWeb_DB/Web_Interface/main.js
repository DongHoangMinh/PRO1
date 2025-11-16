import express from "express";
import { Server } from "socket.io";
import http from "http";
import { dataEmitter } from "../mqtt_data/mqtt_receivedata.js";
import path from "path";               // Dùng để xử lý đường dẫn file
import { fileURLToPath } from "url";   // Chuyển URL module thành đường dẫn file thật
import { Op } from "sequelize";
import { Luxdata } from "../Database/models/Luxdata.js";
import { sequelize } from "../Database/db.js";
import { connectDB } from "../Database/db.js";


const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;
//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);

await connectDB();
await Luxdata.sync();
console.log(" Luxdata table is READY...");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kết nối CSDL
await connectDB();
await Luxdata.sync();
console.log("Luxdata table is READY...");

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
  const where = {};
  if (start && end)
    where.timestamp = { [Op.between]: [new Date(start), new Date(end)] };
  if (luxMin && luxMax)
    where.lux = { [Op.between]: [parseFloat(luxMin), parseFloat(luxMax)] };
  else if (luxMin)
    where.lux = { [Op.gte]: parseFloat(luxMin) };
  else if (luxMax)
    where.lux = { [Op.lte]: parseFloat(luxMax) };
  try {
    const data = await Luxdata.findAll({ where });
    res.json(data);
  } catch (err) {
    console.error(err);
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
