document.getElementById("filterForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const start = document.getElementById("start").value;
  const end = document.getElementById("end").value;
  const luxMin = document.getElementById("luxMin").value;
  const luxMax = document.getElementById("luxMax").value;

  const params = new URLSearchParams({
    start,
    end,
    luxMin,
    luxMax,
  });

  const res = await fetch(`/api/lux?${params}`);
  const data = await res.json();

  const tbody = document.querySelector("#dataTable tbody");
  tbody.innerHTML = "";

  data.forEach((d) => {
    // Hiển thị giờ VN
    const localTime = new Date(d.timestamp).toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
    });

    const row = `<tr>
      <td>${localTime}</td>
      <td>${d.lux}</td>
    </tr>`;
    tbody.innerHTML += row;
  });
});
