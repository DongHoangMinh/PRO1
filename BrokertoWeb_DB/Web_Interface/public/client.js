const socket = io();

const luxEl = document.getElementById("lux");
const timeEl = document.getElementById("time");
const statusEl = document.getElementById("status");

// Khi có dữ liệu Lux mới từ server
socket.on("DataWS", (data) => {
  luxEl.textContent = `Lux: ${data.lux}`;
  const time = new Date(data.time).toLocaleTimeString();
  timeEl.textContent = `Last update: ${time}`;
  statusEl.textContent = "Đang nhận dữ liệu...";
  statusEl.style.color = "green";
});

// Khi không nhận dữ liệu trong 10s
socket.on("noDataWS", () => {
  statusEl.textContent = " Không nhận được dữ liệu trong 10 giây!";
  statusEl.style.color = "red";
});

// Khi trang vừa tải
window.addEventListener("load", () => {
  statusEl.textContent = "Chưa có dữ liệu";
  statusEl.style.color = "gray";
});
