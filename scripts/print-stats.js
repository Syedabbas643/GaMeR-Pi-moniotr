const { createStatsCollector } = require("../src/stats");

async function main() {
  const statsCollector = createStatsCollector();
  const stats = await statsCollector.getStats();
  console.log(JSON.stringify(stats, null, 2));
}

main();
