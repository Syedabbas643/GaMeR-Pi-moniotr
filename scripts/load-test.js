const http = require("http");

function request(path) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: Number(process.env.PORT) || 3000,
        path,
        method: "GET",
        timeout: 5000,
      },
      (res) => {
        const start = Date.now();
        let len = 0;
        res.on("data", (chunk) => { len += chunk.length; });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, ms: Date.now() - start, bytes: len });
        });
      }
    );
    req.on("error", () => resolve({ status: 0, ms: 0, bytes: 0 }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, ms: 0, bytes: 0 }); });
    req.end();
  });
}

async function run({ durationSeconds = 15, concurrency = 25 }) {
  const paths = ["/metrics", "/api/stats"];
  const endAt = Date.now() + durationSeconds * 1000;
  const stats = { count: 0, ok: 0, fail: 0, latenciesMs: [] };
  async function worker() {
    while (Date.now() < endAt) {
      for (const p of paths) {
        const res = await request(p);
        stats.count++;
        if (res.status && res.status >= 200 && res.status < 300) stats.ok++;
        else stats.fail++;
        if (res.ms > 0) stats.latenciesMs.push(res.ms);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  stats.latenciesMs.sort((a, b) => a - b);
  const avg = stats.latenciesMs.reduce((a, b) => a + b, 0) / (stats.latenciesMs.length || 1);
  const p50 = stats.latenciesMs[Math.floor(stats.latenciesMs.length * 0.5)] || 0;
  const p95 = stats.latenciesMs[Math.floor(stats.latenciesMs.length * 0.95)] || 0;
  const p99 = stats.latenciesMs[Math.floor(stats.latenciesMs.length * 0.99)] || 0;
  console.log(JSON.stringify({
    durationSeconds,
    concurrency,
    requests: stats.count,
    ok: stats.ok,
    fail: stats.fail,
    latencyMs: { avg: Number(avg.toFixed(1)), p50, p95, p99 },
  }, null, 2));
}

const dur = Number(process.env.DURATION_S) || 20;
const conc = Number(process.env.CONCURRENCY) || 30;
run({ durationSeconds: dur, concurrency: conc }).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

