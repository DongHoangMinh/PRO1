import mqtt from 'mqtt';

const BROKER = 'mqtt://broker.hivemq.com:1883';
const TOPIC = 'esp32/luxbh1750';

const client = mqtt.connect(BROKER);
let fakeTime = 1767719640;

client.on('connect', () => {
  console.log(`Đã kết nối (ESM): ${BROKER}`);
  setInterval(() => {
    fakeTime += 2;
    const data = {
      lux: parseFloat((1036.67 + Math.random()).toFixed(2)),
      time: fakeTime,
      device: "espAB",
      location: "Room4"
    };
    client.publish(TOPIC, JSON.stringify(data));
    console.log("Sent:", data);
  }, 2000);
});