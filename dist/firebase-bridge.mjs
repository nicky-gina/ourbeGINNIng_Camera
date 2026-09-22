import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
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
  deleteObject,
  getDownloadURL,
  getStorage,
  listAll as listStorageItems,
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

  const urls = new Map();
  const likes = new Map();
  let refreshGallery = async () => {};
  function subscribeGallery(onPhotos, onError, onState = () => {}) {
    const galleryQuery = query(collection(db, "photos"), orderBy("createdAt", "desc"));
    let generation = 0;
    let stopped = false;
    let refreshing = false;
    let timer;
    const started = performance.now();
    const bounded = (promise) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Gallery request timed out")), 15000);
      promise.then(resolve, reject).finally(() => clearTimeout(timeout));
    });
    async function apply(snapshot) {
      if (stopped) return;
      const current = ++generation;
      clearTimeout(timer);
      if (snapshot.metadata.fromCache) timer = setTimeout(() => fail(new Error("Server response timed out")), 20000);
      let remaining = snapshot.size;
      let failed = false;
      const records = snapshot.docs.map(d => ({ ...d.data(), id: d.id, liked: likes.get(d.id) }));
      const emit = () => {
        if (stopped || current !== generation) return;
        onPhotos(records);
        onState({ loading: remaining > 0, error: failed,
          confirmed: !snapshot.metadata.fromCache,
          recordsMs: performance.now() - started });
      };
      records.forEach(photo => { photo.thumbUrl = urls.get(photo.thumbPath); });
      emit();
      await Promise.all(records.map(async photo => {
        try {
          if (!photo.thumbUrl) {
            photo.thumbUrl = await bounded(getDownloadURL(ref(storage, photo.thumbPath)));
            urls.set(photo.thumbPath, photo.thumbUrl);
          }
        } catch { photo.thumbError = true; failed = true; }
        remaining--;
        emit();
        // Personal hearts never delay the photo URL or other cards.
        if (!likes.has(photo.id)) {
          try {
            const result = await bounded(getDoc(doc(db, "photos", photo.id, "likes", user.uid)));
            if (!likes.has(photo.id)) likes.set(photo.id, result.exists());
            photo.liked = likes.get(photo.id);
            emit();
          } catch { /* Leave heart disabled until refresh retries it. */ }
        }
      }));
    }
    const fail = error => {
      if (stopped) return;
      clearTimeout(timer);
      generation++;
      onState({ loading: false, error: true, confirmed: false });
      onError(error);
    };
    timer = setTimeout(() => fail(new Error("Gallery connection timed out")), 20000);
    onState({ loading: true, error: false, confirmed: false });
    const stop = onSnapshot(galleryQuery, { includeMetadataChanges: true },
      snapshot => { if (!refreshing) void apply(snapshot); }, fail);
    refreshGallery = async () => {
      if (refreshing || stopped) return;
      refreshing = true;
      generation++;
      onState({ loading: true, error: false, confirmed: false });
      try { await apply(await bounded(getDocsFromServer(galleryQuery))); }
      catch (error) { fail(error); }
      finally { refreshing = false; }
    };
    return () => { stopped = true; generation++; clearTimeout(timer); stop(); };
  }

  async function toggleLike(photoId) {
    const photoRef = doc(db, "photos", photoId);
    const likeRef = doc(db, "photos", photoId, "likes", user.uid);
    const result = await runTransaction(db, async (transaction) => {
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
    likes.set(photoId, result.liked);
    return result;
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

  async function deleteStoredObject(path) {
    if (!path) return;
    try {
      await deleteObject(ref(storage, path));
    } catch (error) {
      if (error?.code !== "storage/object-not-found") throw error;
    }
  }

  async function deleteStorageTree(folderReference, onDeleted) {
    const listing = await listStorageItems(folderReference);
    for (const item of listing.items) {
      await deleteStoredObject(item.fullPath);
      onDeleted();
    }
    for (const prefix of listing.prefixes) await deleteStorageTree(prefix, onDeleted);
  }

  async function deleteAllPhotos(onProgress = () => {}) {
    const snapshot = await getDocs(query(collection(db, "photos"), orderBy("createdAt", "asc")));
    const total = snapshot.size;
    let deleted = 0;
    let storageDeleted = 0;

    await deleteStorageTree(ref(storage, "wedding-photos"), () => {
      storageDeleted += 1;
      onProgress({ phase: "storage", deleted, total, storageDeleted });
    });

    for (const photoSnapshot of snapshot.docs) {
      const likesSnapshot = await getDocs(collection(db, "photos", photoSnapshot.id, "likes"));
      for (const likeSnapshot of likesSnapshot.docs) await deleteDoc(likeSnapshot.ref);
      await deleteDoc(photoSnapshot.ref);
      deleted += 1;
      onProgress({ phase: "database", deleted, total, storageDeleted });
    }

    return { deleted, total, storageDeleted };
  }

  return {
    userId: user.uid,
    uploadPhoto,
    subscribeGallery,
    refreshGallery: () => refreshGallery(),
    toggleLike,
    getOriginalUrl,
    listAllPhotos,
    deleteAllPhotos
  };
}
