# Nicky & Gina Wedding Camera — V0.2.1

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

This build is configured for the `ourbeginning-camera` Firebase project. Follow `firebase/SETUP.md` to enable the required Firebase services, publish the included rules, and verify uploads, the shared gallery, and hearts. If a Firebase service is unavailable, the app keeps photos in its device-local queue and retries later. Google Drive backup remains reserved for a later server-side phase.

## Test locally

Serve the `dist` folder from any local web server. Camera access normally requires HTTPS, except on `localhost`.

## Deploy to GitHub Pages

1. Create a GitHub repository and place these files in it.
2. Push to the `main` branch.
3. In **Settings → Pages**, select **GitHub Actions** as the source.
4. The included workflow publishes the `dist` folder automatically.

The production URL will look like `https://yourusername.github.io/repository-name/`.
