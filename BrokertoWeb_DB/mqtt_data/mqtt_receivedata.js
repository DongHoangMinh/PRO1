import mqtt from "mqtt"
import EventEmitter from "events";
import { Luxdata } from "../Database/models/Luxdata.js";

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
        await Luxdata.create({ lux: data.lux, timestamp });
        console.log(`Saved : ${data.lux} at ${timestamp.toISOString()}`);

      } catch (dbErr) {
        console.error("Database_save error:", dbErr.message);
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