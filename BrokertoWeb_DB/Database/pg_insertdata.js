import { dataEmitter } from "../mqtt_data/mqtt_receivedata.js";
import pg1 from "pg"
const { Pool } = pg1;

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "iotdb",
  password: "minhtinh",
  port: 5432,
});
async function insertLux(lux, time) {
  try {
    await pool.query(
      "INSERT INTO bh1750lux (lux, timestamp) VALUES ($1, $2)", [lux, time]
    );
    console.log(`DA INSERT GIA TRI ${lux} LUX`)
  } catch (err) {
    console.error("Loi INSERT PostgreSQL:", err.message);
  }

}
dataEmitter.on("Lux", (data) => {
  insertLux(data.lux, data.time);
});