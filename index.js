const { createApp } = require("./src/app");
const { PORT } = require("./src/config");

const app = createApp();

app.listen(PORT, () => {
  console.log(`Monitor activo en http://localhost:${PORT}`);
});
