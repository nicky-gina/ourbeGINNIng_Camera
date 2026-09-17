import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { google } from "googleapis";

const clientPath = resolve("drive-oauth-client.json");
const outputPath = resolve("drive-backup-setup.local.json");
const callbackPath = "/oauth2callback";

function waitForAuthorizationCode(server, expectedState) {
  return new Promise((resolveCode, reject) => {
    server.on("request", (request, response) => {
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname !== callbackPath) {
          response.writeHead(404).end("Not found");
          return;
        }
        if (url.searchParams.get("state") !== expectedState) throw new Error("OAuth state did not match");
        const error = url.searchParams.get("error");
        if (error) throw new Error(`Google authorization failed: ${error}`);
        const code = url.searchParams.get("code");
        if (!code) throw new Error("Google did not return an authorization code");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<h1>Google Drive connected</h1><p>You can close this tab and return to the terminal.</p>");
        resolveCode(code);
      } catch (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error.message);
        reject(error);
      }
    });
  });
}

async function main() {
  const raw = JSON.parse(await readFile(clientPath, "utf8"));
  const client = raw.installed || raw.web;
  if (!client?.client_id || !client?.client_secret) {
    throw new Error("drive-oauth-client.json is not a valid Google OAuth client download");
  }

  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}${callbackPath}`;
  const oauth = new google.auth.OAuth2(client.client_id, client.client_secret, redirectUri);
  const state = randomUUID();
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.file"],
    state
  });

  console.log("\nOpen this URL in your browser and authorize your Google Drive account:\n");
  console.log(authorizationUrl);
  console.log("\nWaiting for Google to return to this computer…\n");

  try {
    const code = await waitForAuthorizationCode(server, state);
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Re-run and approve the consent screen again.");
    oauth.setCredentials(tokens);

    const drive = google.drive({ version: "v3", auth: oauth });
    const folder = await drive.files.create({
      requestBody: {
        name: "Nicky & Gina Wedding — Guest Camera",
        mimeType: "application/vnd.google-apps.folder"
      },
      fields: "id,name,webViewLink"
    });

    await writeFile(outputPath, JSON.stringify({
      GOOGLE_DRIVE_CLIENT_ID: client.client_id,
      GOOGLE_DRIVE_CLIENT_SECRET: client.client_secret,
      GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token,
      GOOGLE_DRIVE_FOLDER_ID: folder.data.id,
      driveFolderName: folder.data.name,
      driveFolderLink: folder.data.webViewLink
    }, null, 2), { mode: 0o600 });

    console.log(`Created Drive folder: ${folder.data.name}`);
    console.log(folder.data.webViewLink || `https://drive.google.com/drive/folders/${folder.data.id}`);
    console.log("\nCredentials were saved locally to drive-backup-setup.local.json.");
    console.log("Next run: npm run configure-drive-secrets");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(`\nDrive authorization failed: ${error.message}`);
  process.exitCode = 1;
});
