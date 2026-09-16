# Firebase setup for Nicky & Gina Wedding Camera

This build is connected to the Firebase project `ourbeginning-camera`. Complete the console steps below to activate cloud uploads, the shared gallery, and hearts.

## 1. Confirm the registered web app

1. Open the `ourbeginning-camera` project in the Firebase Console.
2. Confirm the registered Web app matches the values in `dist/firebase-config.js`.
3. Add `nicky-gina.github.io` to **Authentication → Settings → Authorized domains** if it is not already present.

## 2. Enable Anonymous Authentication

Open **Authentication → Sign-in method → Anonymous**, enable it, and save.

## 3. Create Cloud Firestore

Create a Firestore database in production mode. Choose the region closest to Jakarta/Singapore and paste the complete contents of `firebase/firestore.rules` into **Firestore Database → Rules**, then publish.

## 4. Create Cloud Storage

Create the default Storage bucket and paste the complete contents of `firebase/storage.rules` into **Storage → Rules**, then publish. Cloud Storage may require the Blaze billing plan; set a budget alert before reception-day testing.

## 5. Deploy the updated site

Commit the complete `dist` folder and the existing `.github/workflows/pages.yml`. The workflow will publish `dist` to GitHub Pages. The `firebase` folder and `firebase.json` can remain in the repository for rule versioning but are not served publicly by Pages.

## Verification checklist

- The Gallery header says **Cloud connected**.
- A newly kept photo first appears in **My Roll**, then shows **Uploaded**.
- The photo appears in **Our Night** on a second phone.
- A heart toggled on one phone updates the count on the other.
- With airplane mode enabled, a new photo remains in My Roll as **Waiting**, then uploads when connectivity returns.
