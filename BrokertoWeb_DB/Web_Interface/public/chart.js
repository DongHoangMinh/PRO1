/* ================= CẤU HÌNH CHUNG ================= */
const miniCharts = {};
let detailChart = null;

// Màu sắc chủ đạo (Theme)
const THEME = {
  primary: '#2563eb',
  primaryLight: 'rgba(37, 99, 235, 0.1)',
  gridColor: 'rgba(0, 0, 0, 0.05)',
  textColor: '#64748b'
};

/* ================= 1. MINI CHART (Trong Device Card) ================= */
/**
 * Tạo biểu đồ nhỏ gọn cho từng thiết bị
 * @param {string} canvasId - ID của canvas
 * @param {Array} history - Mảng dữ liệu [{ts: ..., lux: ...}]
 */
function createMiniChart(canvasId, history) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  miniCharts[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: history.map(p => p.ts),
      datasets: [{
        data: history.map(p => p.lux),
        borderColor: THEME.primary,
        borderWidth: 1.5,
        tension: 0,              
        pointRadius: 0,         
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,          
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false } 
      },
      scales: {
        x: { display: false },   
        y: {
          beginAtZero: false,
          ticks: {
            maxTicksLimit: 3,
            font: { size: 9, family: 'Inter' },
            color: THEME.textColor
          },
          grid: {
            color: THEME.gridColor,
            drawBorder: false
          }
        }
      }
    }
  });
}

function updateMiniChart(canvasId, history) {
  const chart = miniCharts[canvasId];
  if (!chart) return;

  chart.data.labels = history.map(p => p.ts);
  chart.data.datasets[0].data = history.map(p => p.lux);
  chart.update("none");  
}

/* ================= 2. DETAIL CHART (Bảng chi tiết phía dưới) ================= */
/**
 * Tạo biểu đồ chi tiết với hiệu ứng Gradient và hiển thị ngày giờ đẹp
 * @param {Array} history - Mảng dữ liệu lịch sử
 */
function createDetailChart(history) {
  const canvas = document.getElementById("detailChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  if (detailChart) {
    detailChart.destroy();  
  }

   const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, 'rgba(37, 99, 235, 0.2)');
  gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');

  detailChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: history.map(p => new Date(p.ts)),
      datasets: [{
        label: "Cường độ ánh sáng",
        data: history.map(p => p.lux),
        borderColor: THEME.primary,
        borderWidth: 3,
        backgroundColor: gradient,
        fill: true,
        tension: 0.4,          
        pointRadius: 2,          
        pointHoverRadius: 6,     
        pointBackgroundColor: "#fff",
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',           
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          titleColor: "#1e293b",
          bodyColor: "#1e293b",
          borderColor: "#e2e8f0",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
             title: function (context) {
              const d = new Date(context[0].label);
              return d.toLocaleString("en-GB", {


                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              });
            },
            label: function (context) {
              return `Độ sáng: ${context.parsed.y} Lux`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
            color: THEME.textColor,
            font: { size: 11 },
            callback: function (val, index) {
              // Chỉ hiện Giờ:Phút ở trục X cho đỡ rối
              const d = new Date(this.getLabelForValue(val));
              return d.getHours() + ":" + String(d.getMinutes()).padStart(2, '0');
            }
          }
        },
        y: {
          border: { display: false },
          grid: { color: THEME.gridColor },
          ticks: {
            color: THEME.textColor,
            padding: 10
          }
        }
      }
    }
  });
}

function updateDetailChart(history) {
  if (!detailChart) return;

  detailChart.data.labels = history.map(p => new Date(p.ts));
  detailChart.data.datasets[0].data = history.map(p => p.lux);
  detailChart.update("none");
}