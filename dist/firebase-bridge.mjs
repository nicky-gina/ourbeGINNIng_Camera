import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

const requiredConfigKeys = ["apiKey", "authDomain", "projectId", "storageBucket", "appId"];

function validateConfig(config) {
  return Boolean(config && requiredConfigKeys.every((key) => typeof config[key] === "string" && config[key].trim()));
}

function waitForUser(auth) {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      stop();
      resolve(user);
    }, reject);
  });
}

export async function connectWeddingCloud(config) {
  if (!validateConfig(config)) throw new Error("Firebase configuration is incomplete");

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  if (!auth.currentUser) await signInAnonymously(auth);
  const user = auth.currentUser || await waitForUser(auth);

  async function uploadPhoto({ id, guestName, blob, thumbBlob, createdAt }) {
    const basePath = `wedding-photos/${user.uid}/${id}`;
    const originalPath = `${basePath}/original.jpg`;
    const thumbPath = `${basePath}/thumb.jpg`;
    const metadata = { contentType: "image/jpeg", cacheControl: "public,max-age=31536000,immutable" };

    await Promise.all([
      uploadBytes(ref(storage, originalPath), blob, metadata),
      uploadBytes(ref(storage, thumbPath), thumbBlob, metadata)
    ]);

    const photoRef = doc(db, "photos", id);
    const existingPhoto = await getDoc(photoRef);
    if (!existingPhoto.exists()) {
      await setDoc(photoRef, {
        guestId: user.uid,
        guestName: String(guestName || "Guest").slice(0, 36),
        originalPath,
        thumbPath,
        capturedAt: createdAt,
        createdAt: serverTimestamp(),
        likeCount: 0,
        width: 1080,
        height: 1440
      });
    }

    return { originalPath, thumbPath };
  }

  function subscribeGallery(onPhotos, onError) {
    const galleryQuery = query(collection(db, "photos"), orderBy("createdAt", "desc"), limit(60));
    return onSnapshot(galleryQuery, async (snapshot) => {
      try {
        const records = await Promise.all(snapshot.docs.map(async (snapshotDoc) => {
          const data = snapshotDoc.data();
          const likeRef = doc(db, "photos", snapshotDoc.id, "likes", user.uid);
          const [thumbUrl, likeSnapshot] = await Promise.all([
            getDownloadURL(ref(storage, data.thumbPath)),
            getDoc(likeRef)
          ]);
          return {
            id: snapshotDoc.id,
            ...data,
            thumbUrl,
            liked: likeSnapshot.exists()
          };
        }));
        onPhotos(records);
      } catch (error) {
        onError(error);
      }
    }, onError);
  }

  async function toggleLike(photoId) {
    const photoRef = doc(db, "photos", photoId);
    const likeRef = doc(db, "photos", photoId, "likes", user.uid);
    return runTransaction(db, async (transaction) => {
      const photoSnapshot = await transaction.get(photoRef);
      const likeSnapshot = await transaction.get(likeRef);
      if (!photoSnapshot.exists()) throw new Error("Photo no longer exists");
      const currentCount = Number(photoSnapshot.data().likeCount || 0);
      if (likeSnapshot.exists()) {
        transaction.delete(likeRef);
        transaction.update(photoRef, { likeCount: Math.max(0, currentCount - 1) });
        return { liked: false, likeCount: Math.max(0, currentCount - 1) };
      }
      transaction.set(likeRef, { createdAt: serverTimestamp() });
      transaction.update(photoRef, { likeCount: currentCount + 1 });
      return { liked: true, likeCount: currentCount + 1 };
    });
  }

  async function getOriginalUrl(path) {
    return getDownloadURL(ref(storage, path));
  }

  async function listAllPhotos() {
    const allPhotosQuery = query(collection(db, "photos"), orderBy("createdAt", "asc"));
    const snapshot = await getDocs(allPhotosQuery);
    return snapshot.docs.map((snapshotDoc) => ({
      id: snapshotDoc.id,
      ...snapshotDoc.data()
    }));
  }

  return {
    userId: user.uid,
    uploadPhoto,
    subscribeGallery,
    toggleLike,
    getOriginalUrl,
    listAllPhotos
  };
}
