function numOrZero(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function fmtMB(val) {
  return `${numOrZero(val)} MB`;
}

const centerTextPlugin = {
  id: "centerText",
  afterDraw: (chart) => {
    const options = chart.config.options.plugins.centerText;
    if (!options || !options.display) return;
    const { ctx, chartArea: { top, right, bottom, left, width, height } } = chart;
    ctx.save();
    ctx.font = options.font || "bold 24px Arial";
    ctx.fillStyle = options.color || "#eee";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(options.text || "", left + width / 2, top + height / 2);
    ctx.restore();
  }
};

async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();

    document.getElementById("uptime").textContent = data.uptime.formatted;

    const memRow = document.getElementById("mem-table-row");

    if (memRow) {
      const mem = data.memory || {};

      const total = fmtMB(mem.total);
      const available = fmtMB(mem.available);

      const totalMB = Number(mem.total) || 0;
      const availableMB = Number(mem.available) || 0;
      const usedMB = Math.max(0, totalMB - availableMB);

      const usedPercent = totalMB > 0
        ? ((usedMB / totalMB) * 100).toFixed(1)
        : "0.0";

      memRow.innerHTML = `
        <div class="network-interface">
          <span class="metric-label">Total:</span> ${total}<br>
          <span class="metric-label">Used:</span> ${usedMB} MB<br>
          <span class="metric-label">Usage:</span> ${usedPercent}%<br>
          <span class="metric-label">Available:</span> ${available}
        </div>
      `;
    }

    document.getElementById("temp-cpu").textContent = data.temperature.cpu;
    document.getElementById("temp-gpu").textContent = data.temperature.gpu;

    function renderStorage(list, containerId) {
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!Array.isArray(list) || list.length === 0) {
        el.innerHTML = '<div class="metric-value">Not Detected</div>';
        return;
      }
      const html = list.map(d => {
        const st = d.alert?.status || "ok";
        const cls = st === "crit" ? "alert-crit" : (st === "warn" ? "alert-warn" : "alert-ok");
        return `
          <div class="network-interface">
            <span class="metric-label">Directory:</span> ${d.fs}<br>
            <span class="metric-label">Used %:</span> <span class="${cls}">${d.usePercent}%</span><br>
            <span class="metric-label">Total:</span> ${d.total}<br>
            <span class="metric-label">Used:</span> ${d.used}
          </div>
        `;
      }).join("");
      el.innerHTML = html;
    }
    const hddStorage = (data.storage?.hdd || []).filter(d => d.mount !== "/boot/firmware");
    renderStorage(hddStorage, "storage-hdd");
    updateHddPie(hddStorage);
    //renderStorage(data.storage?.sd || [], "storage-sd");
    //updateSdPie(data.storage?.sd || []);

    const networkDiv = document.getElementById("network");
    const bandwidth = data.network.bandwidth || {};
    const totals = data.network.totals || {};
    if (Object.keys(bandwidth).length === 0) {
      networkDiv.innerHTML = '<div class="metric-value">Collecting data...</div>';
    } else {
      let networkHTML = "";
      for (const [interfaceName, stats] of Object.entries(bandwidth)) {
        const ifaceTotals = totals.perInterface ? totals.perInterface[interfaceName] : null;
        networkHTML += `
          <div class="network-interface">
            <span class="metric-label">↓ Speed:</span> ${stats.rx}<br>
            <span class="metric-label">↑ Speed:</span> ${stats.tx}<br>
            ${ifaceTotals ? `
              <span class="metric-label">Total ↓:</span> ${ifaceTotals.rxTotal}<br>
              <span class="metric-label">Total ↑:</span> ${ifaceTotals.txTotal}
            ` : ``}
          </div>
        `;
      }
      networkDiv.innerHTML = networkHTML || '<div class="metric-value">No active interfaces</div>';
    }

    document.getElementById("public-ip").textContent = data.ipAddresses.public;

    const ipv4Div = document.getElementById("local-ipv4");
    if (data.ipAddresses.local.ipv4.length === 0) {
      ipv4Div.innerHTML = '<div class="ip-item">None</div>';
    } else {
      ipv4Div.innerHTML = data.ipAddresses.local.ipv4
        .map(ip => `<div class="ip-item">${ip.interface}: ${ip.address}</div>`)
        .join("");
    }

    const throttlingDiv = document.getElementById("throttling");
    const throttlingStatus = data.throttling.status;
    let throttlingClass = "throttling-normal";
    if (throttlingStatus !== "Normal") {
      throttlingClass = throttlingStatus.includes("Throttled") || throttlingStatus.includes("Undervoltage")
        ? "throttling-error"
        : "throttling-warning";
    }
    throttlingDiv.className = `metric-value ${throttlingClass}`;
    throttlingDiv.textContent = throttlingStatus;
  } catch (error) {
    console.error("Error loading stats:", error);
  }
}

function updateHddPie(hddList) {
  if (!hddList || hddList.length === 0) return;
  // Usamos el primer disco HDD para el gráfico circular
  const hdd = hddList[0];
  const used = numOrZero(hdd.usePercent);
  const free = 100 - used;

  const ctx = document.getElementById("chart-hdd-pie");
  if (!ctx) return;

  if (!charts.hddPie) {
    charts.hddPie = new Chart(ctx, {
      type: "doughnut",
      plugins: [centerTextPlugin],
      data: {
        labels: ["Usado", "Libre"],
        datasets: [{
          data: [used, free],
          backgroundColor: ["#FFC107", "#333"],
          borderWidth: 0,
        }]
      },
      options: {
        cutout: "70%",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${item.raw}%`
            }
          },
          centerText: {
            display: true,
            text: `${used}%`
          }
        }
      }
    });
  } else {
    charts.hddPie.data.datasets[0].data = [used, free];
    charts.hddPie.options.plugins.centerText.text = `${used}%`;
    charts.hddPie.update();
  }
}

function updateSdPie(sdList) {
  if (!sdList || sdList.length === 0) return;
  const sd = sdList[0];
  const used = numOrZero(sd.usePercent);
  const free = 100 - used;

  const ctx = document.getElementById("chart-sd-pie");
  if (!ctx) return;

  if (!charts.sdPie) {
    charts.sdPie = new Chart(ctx, {
      type: "doughnut",
      plugins: [centerTextPlugin],
      data: {
        labels: ["Usado", "Libre"],
        datasets: [{
          data: [used, free],
          backgroundColor: ["#03A9F4", "#333"],
          borderWidth: 0,
        }]
      },
      options: {
        cutout: "70%",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${item.raw}%`
            }
          },
          centerText: {
            display: true,
            text: `${used}%`
          }
        }
      }
    });
  } else {
    charts.sdPie.data.datasets[0].data = [used, free];
    charts.sdPie.options.plugins.centerText.text = `${used}%`;
    charts.sdPie.update();
  }
}

loadStats();

setInterval(loadStats, 3000);

async function checkPCStatus() {
  const statusElement = document.getElementById("pcStatus");
  const button = document.getElementById("powerOnBtn");

  try {
    const response = await fetch("/api/tailscale/netrunner");
    const data = await response.json();

    if (data.connected) {
      statusElement.textContent = "🟢 Connected";

      button.disabled = false;
      button.innerHTML = "⚡ Power Off PC";

    } else {
      statusElement.textContent = "🔴 Disconnected";

      button.disabled = false;
      button.textContent = "⚡ Power On PC";
    }

  } catch (error) {
    console.error("PC status error:", error);

    statusElement.textContent = "⚠️ Unknown";
    button.disabled = false;
    button.textContent = "⚡ Power On PC";
  }
}

  async function powerOnPC() {
    const button = document.getElementById("powerOnBtn");

    button.disabled = true;
    button.textContent = "⚡ Powering On...";

    try {
      const response = await fetch("/gpio17");
      const data = await response.json();

      if (data.success) {
        button.textContent = "✅ Power Signal Sent";

      } else {
        throw new Error(data.error || "Power-on failed");
      }

    } catch (error) {
      console.error("Power on error:", error);

      button.textContent = "❌ Failed";
    }
  }

  // Check immediately
  checkPCStatus();

  // Check every 5 seconds
  setInterval(checkPCStatus, 3000);

let charts = { cpu: null, ram: null, swap: null, net: null, tx: null, hddPie: null, sdPie: null };

function makeLineChart(ctx, label, datasets) {
  return new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { ticks: { color: "#aaa" }, grid: { color: "#333" } },
        y: { ticks: { color: "#aaa" }, grid: { color: "#333" } },
      },
      plugins: {
        legend: { labels: { color: "#eee" } },
      },
    },
  });
}

/* =========================
   SIMPLE ROUTER
========================= */

const pages = {
  system: document.getElementById("page-system"),
  network: document.getElementById("page-network"),
  more: document.getElementById("page-more")
};

const navItems = document.querySelectorAll(".nav-item");


function showPage(pageName) {

  /* Hide all pages */
  Object.values(pages).forEach(page => {
    page.classList.remove("active");
  });


  /* Show selected page */
  if (pages[pageName]) {
    pages[pageName].classList.add("active");
  }


  /* Update navigation */
  navItems.forEach(item => {
    item.classList.remove("active");

    if (item.dataset.page === pageName) {
      item.classList.add("active");
    }
  });


  /* Change URL without page reload */
  history.pushState(
    { page: pageName },
    "",
    "#" + pageName
  );
}

/* Navigation click */

navItems.forEach(item => {

  item.addEventListener("click", () => {

    const page = item.dataset.page;

    showPage(page);

  });

});

/* Browser back / forward */

window.addEventListener("popstate", () => {

  const page =
    window.location.hash.substring(1) || "system";

  showPageWithoutHistory(page);

});


/* Show page without adding another history entry */

function showPageWithoutHistory(pageName) {

  Object.values(pages).forEach(page => {
    page.classList.remove("active");
  });

  if (pages[pageName]) {
    pages[pageName].classList.add("active");
  }

  navItems.forEach(item => {

    item.classList.toggle(
      "active",
      item.dataset.page === pageName
    );

  });

}

/* Open correct page when loading */

const initialPage =
  window.location.hash.substring(1) || "system";

showPageWithoutHistory(initialPage);