const { createStatsCollector } = require("../src/stats");

async function main() {
  const statsCollector = createStatsCollector();
  const stats = await statsCollector.getStats();
  const list = Array.isArray(stats?.storage?.hdd) ? stats.storage.hdd : [];
  console.log(JSON.stringify(list, null, 2));
}

main();
