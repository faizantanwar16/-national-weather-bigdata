import { MongoMemoryServer } from "mongodb-memory-server";
import path from "path";
import fs from "fs";

async function main() {
  const dbPath = path.resolve(__dirname, "../../data/mongodb");
  fs.mkdirSync(dbPath, { recursive: true });

  const mongod = await MongoMemoryServer.create({
    instance: {
      port: 27017,
      dbName: "nwbdap",
      dbPath,
      storageEngine: "wiredTiger",
    },
  });

  console.log(`[mongo] Local MongoDB running on ${mongod.getUri()} (persisted at ${dbPath})`);
  console.log("[mongo] Ready for backend-api and Spark/Python layer. Press Ctrl+C to stop.");

  const cleanup = async () => {
    console.log("\n[mongo] Stopping...");
    await mongod.stop();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  console.error("[mongo] Failed to start:", err);
  process.exit(1);
});
