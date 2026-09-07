const { createStatsCollector } = require("../src/stats");

async function main() {
  const statsCollector = createStatsCollector();
  const stats = await statsCollector.getStats();
  const list = Array.isArray(stats?.storage?.sd) ? stats.storage.sd : [];
  console.log(JSON.stringify(list, null, 2));
}

main();
