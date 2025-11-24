import mqtt from "mqtt"
import EventEmitter from "events";
import pg1 from "pg"
const { Pool } = pg1;

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "iotdb",
  password: "minhtinh",
  port: 5432,
});


const MQTT_BROKER = "mqtt://broker.hivemq.com:1883"
const TOPIC = "esp32/luxbh1750";

const client = mqtt.connect(MQTT_BROKER);
const TIMEOUT = 10000; // Thoi gian chờ nhận data



export const dataEmitter = new EventEmitter();

client.on("connect", () => {
  console.log("MQTT Broker connected");
  client.subscribe(TOPIC, (err) => {
    if (!err) { console.log(`Dang ki topic: ${TOPIC}`) }
    else { console.log(`Khong dang ki topic: ${TOPIC}`) };
  })

})

let timeoutID;
function resetTimeout() {
  if (timeoutID) clearTimeout(timeoutID)
  timeoutID = setTimeout(() => {
    console.log("Khong nhan duoc du lieu trong 10s");
    dataEmitter.emit("noData");
  }, TIMEOUT)

}

client.on("message", async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    if (data && typeof data.lux === "number" && isFinite(data.lux) && typeof data.time === "number" && data.time > 100000) {

      const timestamp = new Date(data.time * 1000);
      console.log("Nhận giá trị lux:", data.lux, "lúc:", timestamp.toISOString());
      resetTimeout();

      try {
        await pool.query(
          "INSERT INTO bh1750lux (lux, timestamp) VALUES ($1, $2)", [data.lux, timestamp]
        );
        console.log(`DA INSERT GIA TRI ${data.lux} LUX`)
      } catch (err) {
        console.error("Loi INSERT PostgreSQL:", err.message);
      }


      dataEmitter.emit("Lux", {
        lux: data.lux,
        time: timestamp.getTime(),
      })
    }
    else {
      console.warn("JSON khong hop le:", message.toString());
    }

  }
  catch (err) {
    console.error("JSON parse error:", err.message);
  }
})
//resetTimeout();// reset lan dau