const socket = io();

 
const devices = {};
let currentDevice = null;
let page = 0;
const CHART_LIMIT = 30;

 

function safeId(str) {
  return str ? str.replace(/[^a-zA-Z0-9_]/g, "_") : "unknown";
}

function formatTime(ts) {
  if (!ts) return "--:--:--";
  const date = new Date(Number(ts));
  return isNaN(date.getTime()) ? "--:--:--" :
    date.toLocaleTimeString("vi-VN", { hour12: false }) + " " + date.toLocaleDateString("vi-VN");
}

function getStatus(ts) {
  const diff = Date.now() - Number(ts);
  if (diff < 6000) return { color: "#10b981", label: "Online" };
  if (diff < 12000) return { color: "#f59e0b", label: "Warning" };
  return { color: "#ef4444", label: "Offline" };
}
 

async function init() {
  try {
    const locations = await fetch("/api/locations").then(res => res.json());

    for (const dev of locations) {
      const history = await fetch(`/api/device/${encodeURIComponent(dev.device)}/history`)
        .then(res => res.json());

      devices[dev.device] = {
        ...dev,
        ts: Number(dev.ts),
        history: history.map(h => ({ ts: Number(h.ts), lux: h.lux })).sort((a, b) => a.ts - b.ts)
      };

      // Tạo card nhưng chưa hiển thị, organizeGroups sẽ lo việc hiển thị
      renderDeviceCard(devices[dev.device]);
    }
    organizeGroups();
  } catch (err) {
    console.error("Lỗi khởi tạo:", err);
  }
}

function renderDeviceCard(dev) {
  const id = safeId(dev.device);
  if (document.getElementById(`card_${id}`)) return document.getElementById(`card_${id}`);

  const card = document.createElement("div");
  card.className = "device";
  card.id = `card_${id}`;
  card.onclick = () => openDetail(dev.device);

  card.innerHTML = `
        <div class="device-header">
            <span class="device-name">${dev.device}</span>
            <div class="status">
                <span id="status_label_${id}" style="font-size: 10px; font-weight: 700;">--</span>
                <span id="dot_${id}" class="status-dot"></span>
            </div>
        </div>
        <div style="margin: 10px 0;">
            <span id="val_${id}" style="font-size: 24px; font-weight: 800; color: #1e293b;">--</span> 
            <small style="color: #64748b;">lux</small>
        </div>
        <div class="mini-chart"><canvas id="c_${id}"></canvas></div>
        <div id="time_${id}" style="font-size: 10px; color: #94a3b8; margin-top: 8px; font-family: monospace;"></div>
    `;

  // Khởi tạo chart mini ngay khi tạo thẻ
  setTimeout(() => createMiniChart(`c_${id}`, dev.history), 0);
  return card;
}

function organizeGroups() {
  const mainContainer = document.getElementById("locations");
  if (!mainContainer) return;

  Object.values(devices).forEach(d => {
    const locName = d.location || "Mặc định";
    const locId = safeId(locName);

    // 1. Tìm hoặc tạo Room (Location)
    let locDiv = document.getElementById(`group_container_${locId}`);
    if (!locDiv) {
      locDiv = document.createElement("div");
      locDiv.className = "location";
      locDiv.id = `group_container_${locId}`;
      locDiv.innerHTML = `
                <div class="location-title">${locName}</div>
                <div class="devices" id="group_list_${locId}"></div>
            `;
      mainContainer.appendChild(locDiv);
    }

    // 2. Lấy danh sách thiết bị trong Room này
    const deviceGrid = document.getElementById(`group_list_${locId}`);
    const card = document.getElementById(`card_${safeId(d.device)}`) || renderDeviceCard(d);

    // 3. Đính kèm card vào Room (nếu chưa có)
    if (card.parentElement !== deviceGrid) {
      deviceGrid.appendChild(card);
    }
  });
}

function updateUI(deviceName) {
  const dev = devices[deviceName];
  if (!dev) return;
  const id = safeId(deviceName);
  const state = getStatus(dev.ts);

  const valEl = document.getElementById(`val_${id}`);
  const timeEl = document.getElementById(`time_${id}`);
  const dot = document.getElementById(`dot_${id}`);
  const label = document.getElementById(`status_label_${id}`);

  if (valEl) valEl.innerText = dev.lux;
  if (timeEl) timeEl.innerText = formatTime(dev.ts);
  if (dot) { dot.style.background = state.color; dot.style.boxShadow = `0 0 10px ${state.color}`; }
  if (label) { label.innerText = state.label.toUpperCase(); label.style.color = state.color; }

  updateMiniChart(`c_${id}`, dev.history);
}

 
socket.on("lux", (data) => {
  const name = data.device;
  const newTs = Number(data.ts);

  if (!devices[name]) {
     devices[name] = {
      device: name,
      location: data.location || "Mặc định",
      lux: data.lux,
      ts: newTs,
      history: [{ ts: newTs, lux: data.lux }]
    };
    renderDeviceCard(devices[name]);
    organizeGroups();
  } else {
     const dev = devices[name];
    if (dev.ts === newTs) return;
    dev.lux = data.lux;
    dev.ts = newTs;
    dev.history.push({ ts: newTs, lux: data.lux });
    if (dev.history.length > CHART_LIMIT) dev.history.shift();
  }

  updateUI(name);
  if (currentDevice === name) updateDetailChart(devices[name].history);
});

 
async function openDetail(deviceName) {
  currentDevice = deviceName;
  page = 0;
  document.getElementById("detail").style.display = "block";
  document.getElementById("detailTitle").innerText = `Phân tích: ${deviceName}`;
  createDetailChart(devices[deviceName].history);
  loadTableData();
  document.getElementById("detail").scrollIntoView({ behavior: 'smooth' });
}

 async function loadTableData() {
  if (!currentDevice) return;

  const fromInput = document.getElementById('from').value; // '2026-01-04T15:45'
  const toInput = document.getElementById('to').value;
  const tbody = document.getElementById("tableBody");
  const limit = 10;

  // Cập nhật số trang hiển thị
  const pageDisplay = document.getElementById("pageInfo");
  if (pageDisplay) pageDisplay.innerText = `Trang ${page + 1}`;

  // Tạo URL cơ bản
  let url = `/api/table?device=${encodeURIComponent(currentDevice)}&limit=${limit}&offset=${page * limit}`;

  if (fromInput && toInput) {
    const startTs = new Date(fromInput).getTime();
    const endTs = new Date(toInput).getTime();

    if (!isNaN(startTs) && !isNaN(endTs)) {
      url += `&from=${startTs}&to=${endTs}`;
    }
  }

  try {
    const res = await fetch(url);
    const rows = await res.json();

    if (rows.length === 0) {
      if (page > 0) {
        alert("Không còn dữ liệu ở trang tiếp theo");
        page--;
        return;
      }
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; padding: 20px; color: #94a3b8;">Không tìm thấy dữ liệu trong khoảng này</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => `
            <tr>
                <td style="color: #64748b; font-family: monospace;">${formatTime(r.ts)}</td>
                <td style="font-weight: 700; color: #2563eb;">${r.lux} <small>lux</small></td>
            </tr>
        `).join("");

  } catch (err) {
    console.error("Lỗi Fetch:", err);
    tbody.innerHTML = `<tr><td colspan="2" style="color: red; text-align:center;">Lỗi kết nối máy chủ</td></tr>`;
  }
}
function nextPage() {
  page++;
  loadTableData();
}

function prevPage() {
  if (page === 0) return;
  page--;
  loadTableData();
}

async function filterData() {
  if (!currentDevice) return alert("Vui lòng chọn thiết bị!");

  const fromVal = document.getElementById('from').value;
  const toVal = document.getElementById('to').value;

  if (!fromVal || !toVal) {
    return alert("Vui lòng chọn đầy đủ thời gian Từ và Đến!");
  }

   page = 0;

   await loadTableData();

   // const startTs = new Date(fromVal).getTime();
  // const endTs = new Date(toVal).getTime();

  // const chartUrl = `/api/device/${encodeURIComponent(currentDevice)}/chartfilter?from=${startTs}&to=${endTs}`;

  // try {
  //   const res = await fetch(chartUrl);
  //   const filteredHistory = await res.json();
  //   if (filteredHistory && filteredHistory.length > 0) {
  //     createDetailChart(filteredHistory);
  //   }
  // } catch (e) {
  //   console.error("Lỗi cập nhật biểu đồ:", e);
  // }
}


 async function exportCSV() {
  try {
    if (!currentDevice) {
      alert("Chưa chọn thiết bị");
      return;
    }

    const fromVal = document.getElementById("from")?.value;
    const toVal = document.getElementById("to")?.value;

    if (!fromVal || !toVal) {
      alert("Vui lòng chọn đầy đủ thời gian");
      return;
    }

    const fromTs = new Date(fromVal).getTime();
    const toTs = new Date(toVal).getTime();

    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) {
      alert("Thời gian không hợp lệ");
      return;
    }

    if (fromTs >= toTs) {
      alert("Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc");
      return;
    }

    const params = new URLSearchParams({
      device: currentDevice,
      from: fromTs,
      to: toTs
    });

    const res = await fetch(`/api/export?${params.toString()}`);
    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.error("Server trả về không phải JSON:", text);
      alert("Server lỗi (không trả JSON)");
      return;
    }

    if (!res.ok || !json.success) {
      alert(json.error || "Export thất bại");
      return;
    }

    if (!json.data || json.data.length === 0) {
      alert("Không có dữ liệu");
      return;
    }

     let csv = "lux,time\n";

    json.data.forEach(r => {
      const lux = r.lux ?? "";
      const t = Number(r.ts);

      const timeStr = Number.isFinite(t)
        ? new Date(t).toLocaleString("vi-VN",
          {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
          }
        )
        : "";

      csv += `${lux},${timeStr}\n`;
    });

    /* ===== DOWNLOAD FILE ===== */
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const fromStr = fromVal.replace(/[^0-9]/g, "");
    const toStr = toVal.replace(/[^0-9]/g, "");
    const fileName = `${currentDevice}_${fromStr}_${toStr}.csv`;

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error("Export CSV error:", err);
  }
}


init();
setInterval(() => Object.keys(devices).forEach(updateUI), 3000);