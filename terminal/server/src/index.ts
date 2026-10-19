import { loadConfig } from "./config.js";
import { buildTerminal } from "./app.js";

const config = loadConfig();
const terminal = await buildTerminal({ config });
await terminal.app.listen({ host: config.host, port: config.port });
terminal.app.log.info(`Terminal on http://${config.host}:${config.port} — network ${config.network} (${config.rpcUrl})`);
if (config.network === "mainnet") terminal.app.log.warn("MAINNET: real funds. Spend cap per action is %d SOL.", config.maxSolPerAction);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    terminal.close().finally(() => process.exit(0));
  });
}
