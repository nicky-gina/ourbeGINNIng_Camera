"use strict";

const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { google } = require("googleapis");

initializeApp();

const driveClientId = defineSecret("GOOGLE_DRIVE_CLIENT_ID");
const driveClientSecret = defineSecret("GOOGLE_DRIVE_CLIENT_SECRET");
const driveRefreshToken = defineSecret("GOOGLE_DRIVE_REFRESH_TOKEN");
const driveFolderId = defineSecret("GOOGLE_DRIVE_FOLDER_ID");

const PHOTO_PATH = /^wedding-photos\/([^/]+)\/([^/]+)\/original\.jpg$/;
const BACKUP_LEASE_MS = 5 * 60 * 1000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanFilePart(value, fallback) {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return cleaned || fallback;
}

function jakartaTimestamp(value) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
}

function makeDriveFileName(photoId, photo) {
  const guest = cleanFilePart(photo.guestName, "Guest");
  const shortId = cleanFilePart(photoId, "photo").slice(-8);
  return `NG_${jakartaTimestamp(photo.capturedAt)}_${guest}_${shortId}.jpg`;
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function getPhotoRecord(photoRef) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const snapshot = await photoRef.get();
    if (snapshot.exists) return snapshot;
    await sleep(1500 * (attempt + 1));
  }
  throw new Error("Photo metadata was not available after the Storage upload completed");
}

function createDriveClient() {
  const oauth = new google.auth.OAuth2(driveClientId.value(), driveClientSecret.value());
  oauth.setCredentials({ refresh_token: driveRefreshToken.value() });
  return google.drive({ version: "v3", auth: oauth });
}

async function findExistingDriveFile(drive, folderId, photoId) {
  const escapedFolderId = escapeDriveQuery(folderId);
  const escapedPhotoId = escapeDriveQuery(photoId);
  const result = await drive.files.list({
    q: `'${escapedFolderId}' in parents and appProperties has { key='firebasePhotoId' and value='${escapedPhotoId}' } and trashed=false`,
    spaces: "drive",
    pageSize: 2,
    fields: "files(id,name,webViewLink,appProperties)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return result.data.files?.[0] || null;
}

async function markBackedUp(photoRef, file, sourcePath, sourceGeneration, attemptCount) {
  await photoRef.update({
    "driveBackup.status": "backed_up",
    "driveBackup.attemptCount": attemptCount,
    "driveBackup.fileId": file.id,
    "driveBackup.fileName": file.name,
    "driveBackup.webViewLink": file.webViewLink || null,
    "driveBackup.sourcePath": sourcePath,
    "driveBackup.sourceGeneration": sourceGeneration,
    "driveBackup.backedUpAt": FieldValue.serverTimestamp(),
    "driveBackup.updatedAt": FieldValue.serverTimestamp(),
    "driveBackup.leaseUntil": FieldValue.delete(),
    "driveBackup.eventId": FieldValue.delete(),
    "driveBackup.lastError": FieldValue.delete()
  });
}

exports.backupWeddingPhotoToDrive = onObjectFinalized({
  bucket: "ourbeginning-camera.firebasestorage.app",
  region: "asia-southeast1",
  memory: "512MiB",
  timeoutSeconds: 180,
  retry: true,
  maxInstances: 10,
  secrets: [driveClientId, driveClientSecret, driveRefreshToken, driveFolderId]
}, async (event) => {
  const object = event.data;
  const sourcePath = object.name || "";
  const match = PHOTO_PATH.exec(sourcePath);
  if (!match) {
    logger.debug("Ignoring non-original wedding-camera object", { sourcePath });
    return;
  }

  const [, userId, photoId] = match;
  const sourceGeneration = String(object.generation || "");
  const photoRef = getFirestore().collection("photos").doc(photoId);
  await getPhotoRecord(photoRef);

  let claimedPhoto;
  let attemptCount = 1;
  const claimResult = await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(photoRef);
    if (!snapshot.exists) throw new Error("Photo metadata disappeared before backup");
    const photo = snapshot.data();
    if (photo.guestId !== userId || photo.originalPath !== sourcePath) {
      throw new Error("Storage object does not match its Firestore photo metadata");
    }

    const current = photo.driveBackup || {};
    if (current.status === "backed_up" && current.fileId) {
      return { action: "complete" };
    }
    if (current.status === "processing" && Number(current.leaseUntil || 0) > Date.now() && current.eventId !== event.id) {
      return { action: "busy" };
    }

    attemptCount = Number(current.attemptCount || 0) + 1;
    claimedPhoto = photo;
    transaction.update(photoRef, {
      "driveBackup.status": "processing",
      "driveBackup.attemptCount": attemptCount,
      "driveBackup.sourcePath": sourcePath,
      "driveBackup.sourceGeneration": sourceGeneration,
      "driveBackup.eventId": event.id,
      "driveBackup.leaseUntil": Date.now() + BACKUP_LEASE_MS,
      "driveBackup.updatedAt": FieldValue.serverTimestamp(),
      "driveBackup.lastError": FieldValue.delete()
    });
    return { action: "continue" };
  });

  if (claimResult.action !== "continue") {
    logger.info("Drive backup already complete or currently claimed", { photoId, action: claimResult.action });
    return;
  }

  try {
    const drive = createDriveClient();
    const folderId = driveFolderId.value();
    const existing = await findExistingDriveFile(drive, folderId, photoId);
    if (existing) {
      await markBackedUp(photoRef, existing, sourcePath, sourceGeneration, attemptCount);
      logger.info("Recovered existing Drive backup without creating a duplicate", { photoId, driveFileId: existing.id });
      return;
    }

    const fileName = makeDriveFileName(photoId, claimedPhoto);
    const sourceFile = getStorage().bucket(object.bucket).file(sourcePath);
    const upload = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        description: `Captured by ${claimedPhoto.guestName || "Guest"} for Nicky & Gina's wedding camera.`,
        mimeType: "image/jpeg",
        appProperties: {
          firebasePhotoId: photoId,
          firebaseUserId: userId,
          firebaseGeneration: sourceGeneration
        }
      },
      media: {
        mimeType: "image/jpeg",
        body: sourceFile.createReadStream()
      },
      fields: "id,name,webViewLink",
      supportsAllDrives: true
    });

    await markBackedUp(photoRef, upload.data, sourcePath, sourceGeneration, attemptCount);
    logger.info("Wedding photo backed up to Google Drive", { photoId, driveFileId: upload.data.id, fileName });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    await photoRef.update({
      "driveBackup.status": "failed",
      "driveBackup.attemptCount": attemptCount,
      "driveBackup.lastError": message,
      "driveBackup.updatedAt": FieldValue.serverTimestamp(),
      "driveBackup.leaseUntil": FieldValue.delete(),
      "driveBackup.eventId": FieldValue.delete()
    }).catch((statusError) => logger.error("Could not record Drive backup failure", statusError));
    logger.error("Google Drive backup failed and will be retried", { photoId, error: message });
    throw error;
  }
});
