// electron-builder reads this file; the logic lives in scripts/builder-config.cjs so tests can reach it.
module.exports = require("./scripts/builder-config.cjs").createBuilderConfig(process.env);
