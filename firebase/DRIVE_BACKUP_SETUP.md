# Google Drive backup setup

This is a one-time setup for the `ourbeginning-camera` project. The function copies only `original.jpg`; gallery thumbnails remain in Firebase Storage. Firebase Storage stays the primary source if Drive is unavailable.

## What the function does

- Runs after each full-size wedding photo finishes uploading.
- Creates a name such as `NG_2026-10-11_19-45-12_Kevin_a8f32c1d.jpg` using Jakarta time.
- Searches Drive for the Firebase photo ID before uploading.
- Stores that ID in Drive `appProperties`, so a retried event cannot create another copy.
- Writes `processing`, `backed_up`, or `failed` plus attempt details into the Firestore photo document.
- Retries failed background events automatically.

## 1. Install the command-line tools

Install Node.js 22 and Firebase CLI on the computer used for deployment:

```powershell
npm install -g firebase-tools
firebase login
```

From the project root, install the function dependencies:

```powershell
cd functions
npm install
```

## 2. Enable Google Drive API

1. Open Google Cloud Console and select `ourbeginning-camera`.
2. Go to **APIs & Services → Library**.
3. Search for **Google Drive API** and click **Enable**.

Direct page: <https://console.cloud.google.com/apis/library/drive.googleapis.com?project=ourbeginning-camera>

## 3. Configure the OAuth consent screen

1. Open **Google Auth Platform → Branding** and complete the required app name and support email. A suitable app name is `Nicky & Gina Wedding Camera Backup`.
2. Under **Audience**, choose **External** for a normal personal Google account. Add your own Google account as a test user while configuring it.
3. Publish the OAuth app to **Production** before relying on it for the wedding. External apps left in Testing can receive short-lived refresh tokens; the backup needs long-term access through 11 October 2026.
4. Under **Data Access**, the helper requests only `https://www.googleapis.com/auth/drive.file`. This allows the backup to manage the folder and files that it creates, rather than granting access to every file in your Drive.

## 4. Create a Desktop OAuth client

1. Open **Google Auth Platform → Clients**.
2. Click **Create client**.
3. Select **Desktop app**.
4. Name it `Wedding Camera Drive Backup`.
5. Download its JSON credentials.
6. Rename the downloaded file to `drive-oauth-client.json`.
7. Place it inside the local `functions` folder.

The filename is excluded by `.gitignore`. Never commit it to GitHub or send it in chat.

## 5. Authorize Drive and create the destination folder

While still inside `functions`, run:

```powershell
npm run authorize-drive
```

Open the URL printed in the terminal, choose the Google account that should own the wedding album, and approve access. The helper will:

1. Receive the OAuth response on a temporary local-only callback.
2. Create `Nicky & Gina Wedding — Guest Camera` in My Drive.
3. Save the credentials locally to `drive-backup-setup.local.json`.

Both local credential files are excluded from Git. Do not move them into `dist`.

## 6. Store credentials in Firebase Secret Manager

Confirm Firebase CLI is logged into the account that owns `ourbeginning-camera`, then run:

```powershell
npm run configure-drive-secrets
```

The helper securely sends these four values to Firebase Secret Manager without printing them:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`

The credentials are never sent to the browser and are not part of the GitHub Pages deployment.

## 7. Deploy the Cloud Function

Return to the project root and deploy:

```powershell
cd ..
firebase deploy --only functions:backupWeddingPhotoToDrive
```

The first deployment may ask Google Cloud to enable Eventarc, Cloud Build, Artifact Registry, Pub/Sub, and Secret Manager APIs. Accept those prompts. The Firebase project must remain on the Blaze plan.

Optionally configure automatic cleanup of old function deployment artifacts:

```powershell
firebase functions:artifacts:setpolicy --days 7
```

## 8. Test end to end

1. Deploy the updated `dist` folder to GitHub Pages.
2. Capture and keep a new photo. Old Storage objects do not automatically retrigger the new function.
3. In My Roll, confirm the status progresses through **Uploading**, **Uploaded/Drive backup…**, and **Drive backed up**.
4. Open the Drive folder and confirm there is one full-size JPEG with the meaningful filename.
5. In Firestore, open the photo document and verify:

```text
driveBackup.status       backed_up
driveBackup.fileId       ...
driveBackup.fileName     NG_2026-10-11_...
driveBackup.attemptCount 1
driveBackup.backedUpAt   ...
```

6. Re-uploading the same Firebase photo path should not create a duplicate Drive file because the function searches by `firebasePhotoId` first.

## Troubleshooting

- **My Roll remains at Uploaded:** confirm the function has been deployed and all four secrets have active versions.
- **`invalid_grant`:** authorize Drive again and rerun `npm run configure-drive-secrets`; also confirm the OAuth app is not left in Testing.
- **`File not found` for the folder:** the Google account used for the refresh token must own the folder created by the helper.
- **Function location error:** the function is configured for `asia-southeast1`, matching the recommended Singapore bucket location. If your actual bucket uses another location, update the `region` in `functions/index.js` before deployment.
- **Inspect retries:** open **Firebase Console → Functions → backupWeddingPhotoToDrive → Logs**. Firestore also retains `driveBackup.lastError` when the latest attempt fails.
