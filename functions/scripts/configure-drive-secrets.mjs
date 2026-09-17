import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const setup = JSON.parse(await readFile(resolve("drive-backup-setup.local.json"), "utf8"));
const secretNames = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_FOLDER_ID"
];
const firebaseCommand = process.platform === "win32" ? "firebase.cmd" : "firebase";

for (const name of secretNames) {
  if (!setup[name]) throw new Error(`Missing ${name} in drive-backup-setup.local.json`);
  console.log(`Setting ${name}…`);
  const result = spawnSync(firebaseCommand, ["functions:secrets:set", name, "--project", "ourbeginning-camera"], {
    input: `${setup[name]}\n`,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Firebase CLI failed while setting ${name}`);
}

console.log("\nAll Drive secrets are configured. Return to the project root and deploy the function:");
console.log("firebase deploy --only functions:backupWeddingPhotoToDrive");
