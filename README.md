# Nicky & Gina Wedding Camera — V0.3.0

A mobile-first, GitHub Pages-ready prototype for the wedding disposable-camera experience.

## Included in this build

- Celestial editorial landing page matched to Editorial Invitation V4.2.15, including its custom moon, sapphire sky, animated stars, clouds, and script typography
- Guest-name setup stored on the device
- Live browser camera with front/rear switching
- Photo-library fallback for testing
- Fixed Portra-inspired warm film processing
- Review, retake, and keep flow
- 12-frame disposable-camera counter
- Device-local My Roll using IndexedDB
- Fullscreen viewing and native share/download
- Responsive desktop preview and mobile safe-area support
- PWA shell caching for the interface
- Optional Firebase anonymous authentication
- Automatic original + thumbnail upload with device-local retry queue
- Live shared **Our Night** gallery
- One-heart-per-anonymous-user likes
- Firestore and Storage security rules
- Automatic full-size photo backup to a private Google Drive folder
- Idempotent Drive backup with retry-safe duplicate prevention
- Meaningful Drive filenames using capture time, guest name, and photo ID
- Per-photo Drive backup status in Firestore and My Roll

This build is configured for the `ourbeginning-camera` Firebase project. Follow `firebase/SETUP.md` for the core services and `firebase/DRIVE_BACKUP_SETUP.md` for the one-time private Google Drive authorization and function deployment. If Firebase is temporarily unavailable, the app keeps photos in its device-local queue and retries later. If Drive is temporarily unavailable, Firebase Storage remains the primary copy and the server-side backup retries independently.

## Test locally

Serve the `dist` folder from any local web server. Camera access normally requires HTTPS, except on `localhost`.

## Deploy to GitHub Pages

1. Create a GitHub repository and place these files in it.
2. Push to the `main` branch.
3. In **Settings → Pages**, select **GitHub Actions** as the source.
4. The included workflow publishes the `dist` folder automatically.

The production URL will look like `https://yourusername.github.io/repository-name/`.

GitHub Pages deploys only the static `dist` frontend. Deploy the server-side backup separately with Firebase CLI as documented in `firebase/DRIVE_BACKUP_SETUP.md`.
