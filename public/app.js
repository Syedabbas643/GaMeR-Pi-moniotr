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

    document.getElementById("load1min").textContent = data.cpu.load1min;
    document.getElementById("load5min").textContent = data.cpu.load5min;
    document.getElementById("load15min").textContent = data.cpu.load15min;

    const memRow = document.getElementById("mem-table-row");
    if (memRow) {
      const mem = data.memory || {};
      const total = fmtMB(mem.total);
      const used = fmtMB(mem.used);
      const free = fmtMB(mem.free);
      const shared = fmtMB(mem.shared);
      const buffCacheVal = Number.isFinite(Number(mem.buffCache))
        ? Number(mem.buffCache)
        : (numOrZero(mem.buffers) + numOrZero(mem.cached));
      const buffcache = `${buffCacheVal} MB`;
      const available = fmtMB(mem.available);
      memRow.innerHTML = `
        <div>Mem:</div>
        <div>${total}</div>
        <div>${used}</div>
        <div>${free}</div>
        <div>${shared}</div>
        <div>${buffcache}</div>
        <div>${available}</div>
      `;
    }
    const swapRow = document.getElementById("swap-table-row");
    if (swapRow) {
      const mem = data.memory || {};
      const swapTotal = fmtMB(mem.swapTotal);
      const swapUsed = fmtMB(mem.swapUsed);
      const swapFree = fmtMB(numOrZero(mem.swapTotal) - numOrZero(mem.swapUsed));
      swapRow.innerHTML = `
        <div>Swap:</div>
        <div>${swapTotal}</div>
        <div>${swapUsed}</div>
        <div>${swapFree}</div>
        <div></div>
        <div></div>
        <div></div>
      `;
    }
    const memAlert = document.getElementById("mem-alert");
    if (memAlert && data.memory.alert) {
      const st = data.memory.alert.status;
      const pct = numOrZero(data.memory.usedPercent);
      const cls = st === "crit" ? "alert-crit" : (st === "warn" ? "alert-warn" : "alert-ok");
      memAlert.className = `metric-value ${cls}`;
      memAlert.textContent = `Memoria usada: ${pct}% (${st})`;
    }

    document.getElementById("temp-cpu").textContent = data.temperature.cpu;
    document.getElementById("temp-gpu").textContent = data.temperature.gpu;

    function renderStorage(list, containerId) {
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!Array.isArray(list) || list.length === 0) {
        el.innerHTML = '<div class="metric-value">No detectado</div>';
        return;
      }
      const html = list.map(d => {
        const st = d.alert?.status || "ok";
        const cls = st === "crit" ? "alert-crit" : (st === "warn" ? "alert-warn" : "alert-ok");
        return `
          <div class="network-interface">
            <strong>${d.mount || d.fs}</strong><br>
            <span class="metric-label">Dispositivo:</span> ${d.fs}<br>
            <span class="metric-label">Uso:</span> <span class="${cls}">${d.usePercent}%</span><br>
            <span class="metric-label">Tamaño:</span> ${d.total}<br>
            <span class="metric-label">Usado:</span> ${d.used}
          </div>
        `;
      }).join("");
      el.innerHTML = html;
    }
    renderStorage(data.storage?.hdd || [], "storage-hdd");
    updateHddPie(data.storage?.hdd || []);
    renderStorage(data.storage?.sd || [], "storage-sd");
    updateSdPie(data.storage?.sd || []);

    const networkDiv = document.getElementById("network");
    const bandwidth = data.network.bandwidth || {};
    const totals = data.network.totals || {};
    if (Object.keys(bandwidth).length === 0) {
      networkDiv.innerHTML = '<div class="metric-value">Collecting data...</div>';
    } else {
      let networkHTML = "";
      if (totals.aggregate) {
        networkHTML += `
          <div class="network-interface">
            <strong>Total (todas las interfaces):</strong><br>
            <span class="metric-label">↓ Total:</span> ${totals.aggregate.rxTotal}<br>
            <span class="metric-label">↑ Total:</span> ${totals.aggregate.txTotal}
          </div>
        `;
      }
      for (const [interfaceName, stats] of Object.entries(bandwidth)) {
        const ifaceTotals = totals.perInterface ? totals.perInterface[interfaceName] : null;
        networkHTML += `
          <div class="network-interface">
            <strong>${interfaceName}:</strong><br>
            <span class="metric-label">↓ Download:</span> ${stats.rx}<br>
            <span class="metric-label">↑ Upload:</span> ${stats.tx}<br>
            ${ifaceTotals ? `
              <span class="metric-label">↓ Total:</span> ${ifaceTotals.rxTotal}<br>
              <span class="metric-label">↑ Total:</span> ${ifaceTotals.txTotal}
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

    const ipv6Div = document.getElementById("local-ipv6");
    if (data.ipAddresses.local.ipv6.length === 0) {
      ipv6Div.innerHTML = '<div class="ip-item">None</div>';
    } else {
      ipv6Div.innerHTML = data.ipAddresses.local.ipv6
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

    const tx = data.transmission || {};
    const txStatusDiv = document.getElementById("transmission-status");
    const txDlDiv = document.getElementById("transmission-download");
    const txUlDiv = document.getElementById("transmission-upload");
    const txActiveCountDiv = document.getElementById("transmission-active-count");
    const txTorrentsDiv = document.getElementById("transmission-torrents");
    if (!tx.enabled) {
      txStatusDiv.textContent = tx.reason ? `Deshabilitado (${tx.reason})` : "Deshabilitado";
      txDlDiv.textContent = "-";
      txUlDiv.textContent = "-";
      txActiveCountDiv.textContent = "0";
      txTorrentsDiv.innerHTML = tx.reason
        ? `<div class="metric-value">${tx.reason}</div>`
        : '<div class="metric-value">No hay datos</div>';
    } else if (tx.error) {
      txStatusDiv.textContent = tx.error;
      txDlDiv.textContent = "-";
      txUlDiv.textContent = "-";
      txActiveCountDiv.textContent = "0";
      txTorrentsDiv.innerHTML = '<div class="metric-value">Error obteniendo torrents</div>';
    } else {
      txStatusDiv.textContent = "OK";
      txDlDiv.textContent = tx.session?.download || "-";
      txUlDiv.textContent = tx.session?.upload || "-";
      txActiveCountDiv.textContent = String(tx.session?.activeTorrents ?? 0);
      const list = Array.isArray(tx.torrents) ? tx.torrents : [];
      if (list.length === 0) {
        txTorrentsDiv.innerHTML = '<div class="metric-value">Sin torrents activos</div>';
      } else {
        txTorrentsDiv.innerHTML = list
          .map(t => `
            <div class="network-interface">
              <strong>${t.name}</strong><br>
              <span class="metric-label">Estado:</span> ${t.status}<br>
              <span class="metric-label">↓:</span> ${t.download} &nbsp; 
              <span class="metric-label">↑:</span> ${t.upload} &nbsp; 
              <span class="metric-label">Progreso:</span> ${t.progress}
            </div>
          `)
          .join("");
      }
    }
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

setInterval(loadStats, 5000);

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

async function loadHistory() {
  try {
    const res = await fetch("/api/history?rangeSeconds=3600");
    const { samples } = await res.json();
    const labels = samples.map(s => new Date(s.ts_ms).toLocaleTimeString());
    const cpu1 = samples.map(s => s.cpu_load1);
    const ramPct = samples.map(s => s.mem_total_mb > 0 ? Math.round((s.mem_used_mb / s.mem_total_mb) * 100) : 0);
    const netRx = samples.map(s => s.net_rx_bps);
    const netTx = samples.map(s => s.net_tx_bps);
    const txDl = samples.map(s => s.tx_download_bps);
    const txUl = samples.map(s => s.tx_upload_bps);
    const swapPct = samples.map(s => (s.mem_swap_total_mb > 0 ? Math.round((s.mem_swap_used_mb / s.mem_swap_total_mb) * 100) : 0));
    if (!charts.cpu) {
      charts.cpu = makeLineChart(document.getElementById("chart-cpu"), "CPU", [{
        label: "Load 1m",
        data: cpu1,
        borderColor: "#4CAF50",
        tension: 0.2,
      }]);
    } else {
      charts.cpu.data.datasets[0].data = cpu1;
    }
    charts.cpu.data.labels = labels;
    charts.cpu.update();
    if (!charts.ram) {
      charts.ram = makeLineChart(document.getElementById("chart-ram"), "RAM", [{
        label: "% usada",
        data: ramPct,
        borderColor: "#03A9F4",
        tension: 0.2,
      }]);
    } else {
      charts.ram.data.datasets[0].data = ramPct;
    }
    charts.ram.data.labels = labels;
    charts.ram.update();
    if (!charts.swap) {
      const el = document.getElementById("chart-swap");
      if (el) {
        charts.swap = makeLineChart(el, "Swap", [{
          label: "% usada",
          data: swapPct,
          borderColor: "#9E9E9E",
          tension: 0.2,
        }]);
      }
    } else {
      charts.swap.data.datasets[0].data = swapPct;
    }
    if (charts.swap) {
      charts.swap.data.labels = labels;
      charts.swap.update();
    }
    if (!charts.net) {
      charts.net = makeLineChart(document.getElementById("chart-net"), "Red", [
        { label: "↓ bps", data: netRx, borderColor: "#8BC34A", tension: 0.2 },
        { label: "↑ bps", data: netTx, borderColor: "#E91E63", tension: 0.2 },
      ]);
    } else {
      charts.net.data.datasets[0].data = netRx;
      charts.net.data.datasets[1].data = netTx;
    }
    charts.net.data.labels = labels;
    charts.net.update();
    if (!charts.tx) {
      charts.tx = makeLineChart(document.getElementById("chart-tx"), "Transmission", [
        { label: "↓ bps", data: txDl, borderColor: "#00BCD4", tension: 0.2 },
        { label: "↑ bps", data: txUl, borderColor: "#9C27B0", tension: 0.2 },
      ]);
    } else {
      charts.tx.data.datasets[0].data = txDl;
      charts.tx.data.datasets[1].data = txUl;
    }
    charts.tx.data.labels = labels;
    charts.tx.update();

    const resHdd = await fetch("/api/storage/history?deviceType=HDD&rangeSeconds=3600");
    const resSd = await fetch("/api/storage/history?deviceType=SD&rangeSeconds=3600");
    const hddData = await resHdd.json();
    const sdData = await resSd.json();
    function groupByFs(rows) {
      const groups = {};
      for (const r of rows || []) {
        const key = r.device_fs;
        if (!groups[key]) groups[key] = [];
        groups[key].push({ ts_ms: r.ts_ms, pct: r.use_percent, mount: r.mount });
      }
      return groups;
    }
    const hddGroups = groupByFs(hddData.samples || []);
    const sdGroups = groupByFs(sdData.samples || []);
    const baseSamples = (Array.isArray(hddData.samples) && hddData.samples.length ? hddData.samples : (sdData.samples || []));
    const labelsStorage = baseSamples.map(s => new Date(s.ts_ms).toLocaleTimeString());
    function makeDatasets(groups) {
      const colors = ["#FFC107", "#FF5722", "#8BC34A", "#03A9F4", "#9C27B0", "#E91E63"];
      let i = 0;
      return Object.entries(groups).map(([fs, arr]) => {
        const data = arr.map(a => a.pct);
        const label = arr[0]?.mount || fs;
        const c = colors[i++ % colors.length];
        return { label, data, borderColor: c, tension: 0.2 };
      });
    }
    const hddDatasets = makeDatasets(hddGroups);
    /* Removed HDD historical chart */
    if (charts.hdd) {
      charts.hdd.destroy();
      charts.hdd = null;
    }
    const sdDatasets = makeDatasets(sdGroups);
    if (charts.sd) {
      charts.sd.destroy();
      charts.sd = null;
    }
  } catch (e) {
  }
}

loadHistory();

setInterval(loadHistory, 10000);
