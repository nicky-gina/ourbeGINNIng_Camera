(() => {
  "use strict";

  const SHOT_LIMIT = 12;
  const DOWNLOAD_BATCH_SIZE = 75;
  const DB_NAME = "ng-wedding-camera";
  const STORE_NAME = "photos";
  const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((el) => [el.id, el]));

  let activeView = "landingView";
  let stream = null;
  let facingMode = "environment";
  let pendingPhoto = null;
  let photos = [];
  let selectedPhoto = null;
  let dbPromise = null;
  let toastTimer = null;
  let landingStarsController = null;
  let weddingCloud = null;
  let cloudInitPromise = null;
  let cloudState = "unconfigured";
  let galleryPhotos = [];
  let galleryUnsubscribe = null;
  let isFlushingUploads = false;
  let isDownloadingAlbum = false;
  let isPurgingAlbum = false;

  const guestName = () => localStorage.getItem("ng_guest_name") || "";

  function normalizedName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  function isAlbumOwner() {
    const configuredNames = Array.isArray(window.NG_OWNER_NAMES) ? window.NG_OWNER_NAMES : [];
    const currentName = normalizedName(guestName());
    return Boolean(currentName && configuredNames.some((name) => normalizedName(name) === currentName));
  }

  function updateOwnerTools() {
    if (!els.ownerTools) return;
    els.ownerTools.hidden = !isAlbumOwner();
    if (els.deployedVersion) els.deployedVersion.textContent = `V${window.NG_APP_VERSION || "unknown"}`;
    if (els.ownerTools.hidden && els.downloadAllStatus) els.downloadAllStatus.textContent = "";
  }

  function openDatabase() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  async function loadPhotos() {
    try {
      const db = await openDatabase();
      photos = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result
          .map((photo) => ({ ...photo, syncState: photo.syncState || "local-only" }))
          .sort((a, b) => b.createdAt - a.createdAt));
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Could not load local roll", error);
      photos = [];
      showToast("My Roll is unavailable in this browser.");
    }
    renderRoll();
  }

  async function persistPhoto(photo) {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(photo);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function storePhoto(photo) {
    await persistPhoto(photo);
    photos.unshift(photo);
  }

  function setView(id) {
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-active", view.id === id));
    activeView = id;
    if (landingStarsController) {
      if (id === "landingView") landingStarsController.start();
      else landingStarsController.stop();
    }
    if (id === "cameraView") {
      updateCameraUI();
      if (!stream && photos.length < SHOT_LIMIT) startCamera();
    } else if (stream) {
      stopCamera();
    }
    if (id === "rollView") renderRoll();
    if (id === "galleryView") renderGallery();
    updateOwnerTools();
    window.scrollTo(0, 0);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  function setCloudState(state, label) {
    cloudState = state;
    document.querySelectorAll("[data-cloud-status]").forEach((element) => {
      element.textContent = label;
      element.classList.toggle("is-connected", state === "connected");
      element.classList.toggle("is-error", state === "error" || state === "offline");
    });
    renderGallery();
  }

  function createLandingStars(canvas) {
    if (!canvas) return { start() {}, stop() {} };
    const ctx = canvas.getContext("2d", { alpha: true });
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars = [];
    let animationFrame = 0;
    let running = false;

    const resize = () => {
      const mobile = matchMedia("(max-width: 800px)").matches;
      const dpr = Math.min(devicePixelRatio || 1, mobile ? 1 : 1.75);
      const width = Math.max(1, innerWidth);
      const height = Math.max(1, innerHeight);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(mobile ? 32 : 70, Math.round(150 * width / 1440));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.35 + .15,
        alpha: Math.random() * .65 + .18,
        speed: Math.random() * .012 + .004,
        phase: Math.random() * Math.PI * 2
      }));
    };

    const draw = (time = 0) => {
      if (!running) return;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      stars.forEach((star) => {
        const alpha = reducedMotion ? star.alpha : star.alpha + Math.sin(time * star.speed + star.phase) * .18;
        ctx.beginPath();
        ctx.fillStyle = `rgba(225,236,255,${Math.max(.05, alpha)})`;
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (running) return;
      running = true;
      draw();
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(animationFrame);
    };
    resize();
    addEventListener("resize", resize, { passive: true });
    return { start, stop };
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Live camera is not supported here. Choose a photo instead.");
      updateCameraUI();
      return;
    }
    stopCamera();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 2560 }
        },
        audio: false
      });
      els.cameraFeed.srcObject = stream;
      await els.cameraFeed.play();
      els.cameraFrame.classList.add("is-ready");
      els.cameraFeed.classList.toggle("is-front", facingMode === "user");
    } catch (error) {
      console.warn("Camera unavailable", error);
      stream = null;
      els.cameraFrame.classList.remove("is-ready");
      if (error?.name === "NotAllowedError") showToast("Camera permission was not granted.");
      else showToast("Camera unavailable. You can choose a photo instead.");
    }
    updateCameraUI();
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    els.cameraFeed.srcObject = null;
    els.cameraFrame.classList.remove("is-ready");
    updateCameraUI();
  }

  function updateCameraUI() {
    const remaining = Math.max(0, SHOT_LIMIT - photos.length);
    els.shotsRemaining.textContent = String(remaining);
    els.frameNumber.textContent = String(Math.min(photos.length + 1, SHOT_LIMIT)).padStart(2, "0");
    els.shutterButton.disabled = !stream || remaining === 0;
    els.switchCameraButton.disabled = !stream || remaining === 0;
    els.libraryButton.disabled = remaining === 0;
    if (remaining === 0) showToast("Your roll is complete — all 12 frames are yours.");
  }

  function getCoverCrop(sourceWidth, sourceHeight, targetRatio) {
    const sourceRatio = sourceWidth / sourceHeight;
    if (sourceRatio > targetRatio) {
      const width = sourceHeight * targetRatio;
      return { sx: (sourceWidth - width) / 2, sy: 0, sw: width, sh: sourceHeight };
    }
    const height = sourceWidth / targetRatio;
    return { sx: 0, sy: (sourceHeight - height) / 2, sw: sourceWidth, sh: height };
  }

  function applyPortraInspiredTone(ctx, width, height) {
    const frame = ctx.getImageData(0, 0, width, height);
    const pixels = frame.data;
    for (let i = 0; i < pixels.length; i += 4) {
      let r = pixels[i] / 255;
      let g = pixels[i + 1] / 255;
      let b = pixels[i + 2] / 255;
      const luma = .2126 * r + .7152 * g + .0722 * b;

      r = .035 + r * .965;
      g = .028 + g * .958;
      b = .025 + b * .94;
      const contrast = .93;
      r = (r - .5) * contrast + .5;
      g = (g - .5) * contrast + .5;
      b = (b - .5) * contrast + .5;

      const warmth = .028 + Math.max(0, luma - .45) * .025;
      r += warmth;
      g += warmth * .32;
      b -= warmth * .48;

      const shadow = Math.max(0, .52 - luma);
      g += shadow * .018;
      b += shadow * .012;

      const sat = .93;
      r = luma + (r - luma) * sat;
      g = luma + (g - luma) * sat;
      b = luma + (b - luma) * sat;

      const grain = (Math.random() - .5) * .026;
      pixels[i] = Math.max(0, Math.min(255, (r + grain) * 255));
      pixels[i + 1] = Math.max(0, Math.min(255, (g + grain) * 255));
      pixels[i + 2] = Math.max(0, Math.min(255, (b + grain) * 255));
    }
    ctx.putImageData(frame, 0, 0);

    const vignette = ctx.createRadialGradient(width / 2, height * .47, width * .2, width / 2, height * .5, height * .72);
    vignette.addColorStop(0, "rgba(20,12,8,0)");
    vignette.addColorStop(1, "rgba(12,8,16,.24)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  async function renderSourceToBlob(source, sourceWidth, sourceHeight, mirror = false) {
    const canvas = els.captureCanvas;
    const width = 1080;
    const height = 1440;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const crop = getCoverCrop(sourceWidth, sourceHeight, width / height);
    ctx.save();
    if (mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
    ctx.restore();
    applyPortraInspiredTone(ctx, width, height);
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Photo processing failed")), "image/jpeg", .9));
  }

  async function loadFileSource(file) {
    if ("createImageBitmap" in window) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
      } catch (error) {
        console.warn("ImageBitmap fallback used", error);
      }
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Image could not be opened"));
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url)
    };
  }

  async function createThumbnailBlob(blob) {
    const loaded = await loadFileSource(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 360;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      const crop = getCoverCrop(loaded.width, loaded.height, canvas.width / canvas.height);
      ctx.drawImage(loaded.source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob(
        (thumbnail) => thumbnail ? resolve(thumbnail) : reject(new Error("Thumbnail processing failed")),
        "image/jpeg",
        .76
      ));
    } finally {
      loaded.cleanup();
    }
  }

  async function initWeddingCloud() {
    if (weddingCloud) return weddingCloud;
    if (cloudInitPromise) return cloudInitPromise;
    const config = window.NG_FIREBASE_CONFIG;
    if (!config) {
      setCloudState("unconfigured", "Local mode");
      return null;
    }

    setCloudState(navigator.onLine ? "connecting" : "offline", navigator.onLine ? "Connecting…" : "Offline");
    cloudInitPromise = (async () => {
      try {
        const { connectWeddingCloud } = await import("./firebase-bridge.mjs");
        weddingCloud = await connectWeddingCloud(config);
        setCloudState("connected", "Cloud connected");
        galleryUnsubscribe?.();
        galleryUnsubscribe = weddingCloud.subscribeGallery((records) => {
          galleryPhotos = records;
          renderGallery();
        }, (error) => {
          console.error("Gallery connection failed", error);
          setCloudState(navigator.onLine ? "error" : "offline", navigator.onLine ? "Gallery unavailable" : "Offline");
        });
        void flushUploadQueue();
        return weddingCloud;
      } catch (error) {
        console.error("Firebase connection failed", error);
        setCloudState(navigator.onLine ? "error" : "offline", navigator.onLine ? "Cloud unavailable" : "Offline");
        return null;
      } finally {
        cloudInitPromise = null;
      }
    })();
    return cloudInitPromise;
  }

  async function flushUploadQueue() {
    if (!weddingCloud || !navigator.onLine || isFlushingUploads || isPurgingAlbum) return;
    isFlushingUploads = true;
    try {
      const queue = photos.filter((photo) => photo.syncState === "pending" || photo.syncState === "failed");
      for (const photo of queue) {
        if (isPurgingAlbum) break;
        photo.syncState = "uploading";
        photo.uploadAttempts = Number(photo.uploadAttempts || 0) + 1;
        await persistPhoto(photo);
        renderRoll();
        try {
          const thumbBlob = await createThumbnailBlob(photo.blob);
          const remote = await weddingCloud.uploadPhoto({
            id: photo.id,
            guestName: photo.guestName,
            blob: photo.blob,
            thumbBlob,
            createdAt: photo.createdAt
          });
          photo.syncState = "uploaded";
          photo.uploadAttempts = 0;
          photo.originalPath = remote.originalPath;
          photo.thumbPath = remote.thumbPath;
          await persistPhoto(photo);
          renderRoll();
        } catch (error) {
          console.error("Photo upload failed", error);
          photo.syncState = "failed";
          await persistPhoto(photo);
          renderRoll();
          if (photo.uploadAttempts < 4) {
            const retryDelay = Math.min(30000, 4000 * (2 ** photo.uploadAttempts));
            setTimeout(() => void flushUploadQueue(), retryDelay);
          }
          break;
        }
      }
    } finally {
      isFlushingUploads = false;
    }
  }

  async function captureFromCamera() {
    if (!stream || photos.length >= SHOT_LIMIT) return;
    els.flashOverlay.classList.remove("fire");
    void els.flashOverlay.offsetWidth;
    els.flashOverlay.classList.add("fire");
    els.processingOverlay.classList.add("is-visible");
    els.shutterButton.disabled = true;
    try {
      pendingPhoto = await renderSourceToBlob(
        els.cameraFeed,
        els.cameraFeed.videoWidth,
        els.cameraFeed.videoHeight,
        facingMode === "user"
      );
      els.reviewImage.src = URL.createObjectURL(pendingPhoto);
      els.reviewDialog.showModal();
    } catch (error) {
      console.error(error);
      showToast("That frame could not be developed. Please try again.");
    } finally {
      els.processingOverlay.classList.remove("is-visible");
      updateCameraUI();
    }
  }

  async function processFile(file) {
    if (!file || photos.length >= SHOT_LIMIT) return;
    els.processingOverlay.classList.add("is-visible");
    let loaded = null;
    try {
      loaded = await loadFileSource(file);
      pendingPhoto = await renderSourceToBlob(loaded.source, loaded.width, loaded.height);
      els.reviewImage.src = URL.createObjectURL(pendingPhoto);
      els.reviewDialog.showModal();
    } catch (error) {
      console.error(error);
      showToast("That image could not be developed.");
    } finally {
      loaded?.cleanup();
      els.processingOverlay.classList.remove("is-visible");
      els.fileInput.value = "";
    }
  }

  function clearPendingPhoto() {
    if (els.reviewImage.src.startsWith("blob:")) URL.revokeObjectURL(els.reviewImage.src);
    els.reviewImage.removeAttribute("src");
    pendingPhoto = null;
  }

  async function keepPendingPhoto() {
    if (!pendingPhoto) return;
    els.keepButton.disabled = true;
    try {
      const now = Date.now();
      const photo = {
        id: `ng-${now}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        createdAt: now,
        guestName: guestName(),
        blob: pendingPhoto,
        syncState: "pending"
      };
      await storePhoto(photo);
      els.reviewDialog.close();
      clearPendingPhoto();
      renderRoll();
      updateCameraUI();
      if (navigator.vibrate) navigator.vibrate(35);
      showToast(`Frame ${String(photos.length).padStart(2, "0")} added to My Roll.`);
      void flushUploadQueue();
    } catch (error) {
      console.error(error);
      showToast("The photo could not be saved on this device.");
    } finally {
      els.keepButton.disabled = false;
    }
  }

  function makePhotoUrl(photo) {
    return URL.createObjectURL(photo.blob);
  }

  function renderRoll() {
    els.rollGrid.querySelectorAll("img").forEach((img) => {
      if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    });
    els.rollGrid.replaceChildren();
    els.rollEmpty.hidden = photos.length > 0;
    els.rollGuestName.textContent = guestName() || "Guest";
    els.rollCounter.textContent = `${photos.length} / ${SHOT_LIMIT}`;
    [els.rollCountBadge, els.rollCountBadgeRoll, els.rollCountBadgeGallery].forEach((badge) => {
      badge.textContent = String(photos.length);
      badge.hidden = photos.length === 0;
    });

    photos.forEach((photo, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "roll-card";
      button.setAttribute("aria-label", `Open photo ${photos.length - index}`);
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = `Wedding photo by ${photo.guestName || "Guest"}`;
      img.src = makePhotoUrl(photo);
      const label = document.createElement("span");
      label.textContent = `N&G / ${String(photos.length - index).padStart(2, "0")}`;
      const syncLabel = document.createElement("span");
      syncLabel.className = `sync-label is-${photo.syncState}`;
      syncLabel.textContent = ({
        uploaded: "Uploaded",
        uploading: "Uploading",
        failed: "Retrying",
        pending: "Waiting",
        "local-only": "Local"
      })[photo.syncState] || "Local";
      button.append(img, label, syncLabel);
      button.addEventListener("click", () => openPhoto(photo, photos.length - index));
      els.rollGrid.append(button);
    });

    const newest = photos[0];
    document.querySelectorAll(".roll-thumbnail").forEach((thumb) => {
      if (thumb.dataset.url) URL.revokeObjectURL(thumb.dataset.url);
      if (newest) {
        const url = makePhotoUrl(newest);
        thumb.style.backgroundImage = `url("${url}")`;
        thumb.dataset.url = url;
      } else {
        thumb.style.backgroundImage = "none";
        delete thumb.dataset.url;
      }
    });
  }

  function renderGallery() {
    if (!els.galleryGrid) return;
    els.galleryGrid.replaceChildren();
    els.galleryLoading.hidden = cloudState !== "connecting";

    if (cloudState === "unconfigured") {
      els.galleryEmpty.hidden = false;
      els.galleryEmptyTitle.textContent = "Cloud album not connected";
      els.galleryEmptyText.textContent = "Add the Firebase configuration to begin sharing everyone’s photos.";
      return;
    }
    if (cloudState === "connecting") {
      els.galleryEmpty.hidden = true;
      return;
    }
    if (cloudState === "offline" || cloudState === "error") {
      els.galleryEmpty.hidden = galleryPhotos.length > 0;
      els.galleryEmptyTitle.textContent = cloudState === "offline" ? "You’re offline" : "The album is taking a pause";
      els.galleryEmptyText.textContent = "Your camera and My Roll still work. The shared album will reconnect automatically.";
    } else {
      els.galleryEmpty.hidden = galleryPhotos.length > 0;
      els.galleryEmptyTitle.textContent = "The first frame is waiting";
      els.galleryEmptyText.textContent = "Photos shared by guests will gather here throughout the celebration.";
    }

    galleryPhotos.forEach((photo) => {
      const card = document.createElement("article");
      card.className = "gallery-card";
      const photoButton = document.createElement("button");
      photoButton.type = "button";
      photoButton.className = "gallery-card-photo";
      photoButton.setAttribute("aria-label", `Open photo by ${photo.guestName || "Guest"}`);
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = photo.thumbUrl;
      img.alt = `Wedding photo by ${photo.guestName || "Guest"}`;
      photoButton.append(img);
      photoButton.addEventListener("click", () => openGalleryPhoto(photo));

      const credit = document.createElement("span");
      credit.className = "gallery-credit";
      credit.textContent = `by ${photo.guestName || "Guest"}`;

      const heart = document.createElement("button");
      heart.type = "button";
      heart.className = `heart-button${photo.liked ? " is-liked" : ""}`;
      heart.setAttribute("aria-label", photo.liked ? "Remove heart" : "Heart this photo");
      heart.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.4 5.4 0 0 0-7.7 0L12 5.7l-1.1-1.1a5.4 5.4 0 0 0-7.7 7.7L12 21l8.8-8.7a5.4 5.4 0 0 0 0-7.7Z"></path></svg>';
      const count = document.createElement("span");
      count.textContent = String(photo.likeCount || 0);
      heart.append(count);
      heart.addEventListener("click", () => toggleGalleryLike(photo, heart));
      card.append(photoButton, credit, heart);
      els.galleryGrid.append(card);
    });
  }

  async function toggleGalleryLike(photo, button = null) {
    if (!weddingCloud || !navigator.onLine) {
      showToast("Hearts will be available when the album reconnects.");
      return;
    }
    if (button) button.disabled = true;
    try {
      const result = await weddingCloud.toggleLike(photo.id);
      photo.liked = result.liked;
      photo.likeCount = result.likeCount;
      if (selectedPhoto?.id === photo.id) selectedPhoto = photo;
      renderGallery();
      updateLightboxHeart(photo);
    } catch (error) {
      console.error("Heart update failed", error);
      showToast("That heart could not be saved. Please try again.");
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  function updateLightboxHeart(photo) {
    const isCloudPhoto = Boolean(photo && photo.originalPath);
    els.fullPhotoHeartButton.hidden = !isCloudPhoto;
    if (!isCloudPhoto) return;
    els.fullPhotoHeartButton.classList.toggle("is-liked", Boolean(photo.liked));
    els.fullPhotoHeartButton.setAttribute("aria-label", photo.liked ? "Remove heart" : "Heart this photo");
    els.fullPhotoHeartCount.textContent = String(photo.likeCount || 0);
  }

  async function openGalleryPhoto(photo) {
    selectedPhoto = photo;
    els.fullPhoto.src = photo.thumbUrl;
    els.fullPhotoLabel.textContent = `Captured by ${photo.guestName || "Guest"}`;
    updateLightboxHeart(photo);
    els.photoDialog.showModal();
    try {
      photo.originalUrl = photo.originalUrl || await weddingCloud.getOriginalUrl(photo.originalPath);
      if (selectedPhoto?.id === photo.id) els.fullPhoto.src = photo.originalUrl;
    } catch (error) {
      console.error("Full photo unavailable", error);
    }
  }

  function openPhoto(photo, number) {
    selectedPhoto = photo;
    const url = makePhotoUrl(photo);
    els.fullPhoto.src = url;
    els.fullPhoto.dataset.objectUrl = url;
    els.fullPhotoLabel.textContent = `Frame ${String(number).padStart(2, "0")} · ${new Date(photo.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    updateLightboxHeart(null);
    els.photoDialog.showModal();
  }

  function closePhoto() {
    els.photoDialog.close();
    if (els.fullPhoto.dataset.objectUrl) URL.revokeObjectURL(els.fullPhoto.dataset.objectUrl);
    els.fullPhoto.removeAttribute("src");
    delete els.fullPhoto.dataset.objectUrl;
    updateLightboxHeart(null);
    selectedPhoto = null;
  }

  async function shareSelectedPhoto() {
    if (!selectedPhoto) return;
    try {
      let blob = selectedPhoto.blob;
      if (!blob) {
        const url = selectedPhoto.originalUrl || await weddingCloud.getOriginalUrl(selectedPhoto.originalPath);
        const response = await fetch(url);
        if (!response.ok) throw new Error("Photo download failed");
        blob = await response.blob();
      }
      const file = new File([blob], `nicky-gina-${selectedPhoto.capturedAt || selectedPhoto.createdAt || Date.now()}.jpg`, { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Nicky & Gina Wedding Camera" });
      } else {
        const link = document.createElement("a");
        const url = URL.createObjectURL(file);
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast("Photo downloaded.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") showToast("Sharing is unavailable right now.");
    }
  }

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      table[n] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipDateParts(date) {
    const year = Math.min(2107, Math.max(1980, date.getFullYear()));
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  async function createStoredZip(entries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const data = new Uint8Array(await entry.blob.arrayBuffer());
      const checksum = crc32(data);
      const stamp = zipDateParts(entry.date);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.byteLength, true);
      localView.setUint32(22, data.byteLength, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.byteLength, true);
      centralView.setUint32(24, data.byteLength, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint32(42, localOffset, true);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);
      centralSize += centralHeader.byteLength;
      localOffset += localHeader.byteLength + data.byteLength;
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  function photoTimestamp(photo) {
    if (Number.isFinite(Number(photo.capturedAt))) return Number(photo.capturedAt);
    if (typeof photo.createdAt?.toMillis === "function") return photo.createdAt.toMillis();
    if (Number.isFinite(Number(photo.createdAt))) return Number(photo.createdAt);
    return Date.now();
  }

  function filenamePart(value, fallback) {
    const cleaned = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return cleaned || fallback;
  }

  function originalFilename(photo, index) {
    const timestamp = photoTimestamp(photo);
    const date = new Date(timestamp);
    const dateText = Number.isNaN(date.getTime())
      ? "unknown-date"
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}-${String(date.getSeconds()).padStart(2, "0")}`;
    const guest = filenamePart(photo.guestName, "Guest");
    const id = filenamePart(String(photo.id || "").slice(-10), "photo");
    return `Nicky-Gina_${String(index + 1).padStart(4, "0")}_${dateText}_${guest}_${id}.jpg`;
  }

  async function fetchOriginalBlob(photo) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const url = await weddingCloud.getOriginalUrl(photo.originalPath);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Photo request returned ${response.status}`);
        return await response.blob();
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      }
    }
    throw lastError || new Error("Photo download failed");
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function downloadAllOriginals() {
    if (!isAlbumOwner() || isDownloadingAlbum || isPurgingAlbum) return;
    isDownloadingAlbum = true;
    els.downloadAllButton.disabled = true;
    els.downloadAllButton.textContent = "Preparing originals…";
    els.downloadAllStatus.textContent = "Connecting to the full album…";
    let directoryHandle = null;

    try {
      if (typeof window.showDirectoryPicker === "function") {
        directoryHandle = await window.showDirectoryPicker({ id: "nicky-gina-originals", mode: "readwrite" });
      }
      const cloud = weddingCloud || await initWeddingCloud();
      if (!cloud) throw new Error("Cloud album is unavailable");
      const records = (await cloud.listAllPhotos()).filter((photo) => photo.originalPath);
      if (!records.length) {
        els.downloadAllStatus.textContent = "There are no uploaded originals yet.";
        return;
      }

      if (directoryHandle) {
        for (let index = 0; index < records.length; index += 1) {
          els.downloadAllStatus.textContent = `Saving original ${index + 1} of ${records.length}…`;
          const blob = await fetchOriginalBlob(records[index]);
          const fileHandle = await directoryHandle.getFileHandle(originalFilename(records[index], index), { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
        els.downloadAllStatus.textContent = `${records.length} full-resolution originals saved to the selected folder.`;
      } else {
        const partCount = Math.ceil(records.length / DOWNLOAD_BATCH_SIZE);
        for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
          const start = partIndex * DOWNLOAD_BATCH_SIZE;
          const batch = records.slice(start, start + DOWNLOAD_BATCH_SIZE);
          const entries = [];
          for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
            const overallIndex = start + batchIndex;
            els.downloadAllStatus.textContent = `Preparing part ${partIndex + 1} of ${partCount}: photo ${overallIndex + 1} of ${records.length}…`;
            entries.push({
              name: originalFilename(batch[batchIndex], overallIndex),
              blob: await fetchOriginalBlob(batch[batchIndex]),
              date: new Date(photoTimestamp(batch[batchIndex]))
            });
          }
          const zip = await createStoredZip(entries);
          triggerBlobDownload(zip, `Nicky-Gina-Wedding-Originals-Part-${String(partIndex + 1).padStart(2, "0")}-of-${String(partCount).padStart(2, "0")}.zip`);
          if (partIndex + 1 < partCount) await new Promise((resolve) => setTimeout(resolve, 900));
        }
        els.downloadAllStatus.textContent = `${records.length} full-resolution originals prepared in ${partCount} ZIP ${partCount === 1 ? "file" : "files"}.`;
      }
      showToast("Album originals downloaded.");
    } catch (error) {
      if (error?.name === "AbortError") {
        els.downloadAllStatus.textContent = "Download cancelled.";
      } else {
        console.error("Album download failed", error);
        els.downloadAllStatus.textContent = "The download stopped. Check your connection and try again.";
        showToast("Album download could not be completed.");
      }
    } finally {
      isDownloadingAlbum = false;
      els.downloadAllButton.disabled = false;
      els.downloadAllButton.textContent = "Download all originals";
    }
  }

  async function clearLocalPhotos() {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Local photo deletion was aborted"));
    });
    photos = [];
    renderRoll();
    updateCameraUI();
  }

  async function deleteAllPhotos() {
    if (!isAlbumOwner() || isPurgingAlbum || isDownloadingAlbum) return;
    const phrase = window.prompt(
      "This permanently deletes every uploaded photo, thumbnail and heart from Firebase, plus photos stored by this app on this device.\n\nType DELETE ALL PHOTOS to continue."
    );
    if (phrase === null) {
      els.downloadAllStatus.textContent = "Deletion cancelled.";
      return;
    }
    if (phrase.trim() !== "DELETE ALL PHOTOS") {
      els.downloadAllStatus.textContent = "Nothing was deleted—the confirmation phrase did not match.";
      return;
    }
    if (!window.confirm("Final confirmation: permanently purge the wedding-camera album now? This cannot be undone.")) {
      els.downloadAllStatus.textContent = "Deletion cancelled.";
      return;
    }

    isPurgingAlbum = true;
    els.deleteAllButton.disabled = true;
    els.downloadAllButton.disabled = true;
    els.deleteAllButton.textContent = "Deleting photos…";
    els.downloadAllStatus.textContent = "Connecting to the full album…";

    try {
      while (isFlushingUploads) await new Promise((resolve) => setTimeout(resolve, 100));
      const cloud = weddingCloud || await initWeddingCloud();
      if (!cloud) throw new Error("Cloud album is unavailable");
      const localCount = photos.length;
      const result = await cloud.deleteAllPhotos(({ phase, deleted, total, storageDeleted }) => {
        els.downloadAllStatus.textContent = phase === "storage"
          ? `Deleting uploaded image file ${storageDeleted}…`
          : `Deleting server photo record ${deleted} of ${total}…`;
      });
      await clearLocalPhotos();
      galleryPhotos = [];
      renderGallery();
      els.downloadAllStatus.textContent = `Purge complete: ${result.storageDeleted} uploaded files, ${result.deleted} server photo records and ${localCount} local ${localCount === 1 ? "photo" : "photos"} deleted.`;
      showToast("Test photos permanently deleted.");
    } catch (error) {
      console.error("Album purge failed", error);
      els.downloadAllStatus.textContent = "The purge stopped before completion. Check the published Firebase rules and connection, then run it again.";
      showToast("Photo purge could not be completed.");
    } finally {
      isPurgingAlbum = false;
      els.deleteAllButton.disabled = false;
      els.downloadAllButton.disabled = false;
      els.deleteAllButton.textContent = "Delete all test photos";
    }
  }

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const register = (tool) => {
      try { void Promise.resolve(context.registerTool(tool)).catch(console.error); } catch (error) { console.error(error); }
    };
    register({
      name: "read_wedding_camera_status",
      title: "Read wedding camera status",
      description: "Read the guest name, current view, locally saved photo count, and remaining frames without changing the app.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => ({ guestName: guestName() || null, view: activeView, savedPhotos: photos.length, shotsRemaining: SHOT_LIMIT - photos.length })
    });
    register({
      name: "open_wedding_camera_view",
      title: "Open camera view",
      description: "Open the wedding camera, the guest's local My Roll, or the shared Our Night gallery.",
      inputSchema: {
        type: "object",
        properties: { view: { type: "string", enum: ["camera", "my_roll", "gallery"] } },
        required: ["view"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        if (!input || !["camera", "my_roll", "gallery"].includes(input.view)) throw new Error("view must be camera, my_roll, or gallery");
        if (!guestName()) throw new Error("A guest name must be entered in the visible app first");
        setView(input.view === "camera" ? "cameraView" : input.view === "my_roll" ? "rollView" : "galleryView");
        return { view: activeView };
      }
    });
  }

  els.enterButton.addEventListener("click", () => {
    if (guestName()) setView("cameraView");
    else setView("nameView");
  });

  els.guestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = els.guestName.value.trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      els.nameError.textContent = "Please enter at least two characters.";
      els.guestName.focus();
      return;
    }
    localStorage.setItem("ng_guest_name", name);
    els.nameError.textContent = "";
    setView("cameraView");
  });

  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.back)));

  els.enableCameraButton.addEventListener("click", startCamera);
  els.shutterButton.addEventListener("click", captureFromCamera);
  els.switchCameraButton.addEventListener("click", async () => {
    facingMode = facingMode === "environment" ? "user" : "environment";
    await startCamera();
  });
  els.libraryButton.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => processFile(els.fileInput.files?.[0]));
  els.retakeButton.addEventListener("click", () => { els.reviewDialog.close(); clearPendingPhoto(); });
  els.keepButton.addEventListener("click", keepPendingPhoto);
  els.closePhotoButton.addEventListener("click", closePhoto);
  els.sharePhotoButton.addEventListener("click", shareSelectedPhoto);
  els.downloadAllButton?.addEventListener("click", downloadAllOriginals);
  els.deleteAllButton?.addEventListener("click", deleteAllPhotos);
  els.fullPhotoHeartButton.addEventListener("click", () => {
    if (selectedPhoto?.originalPath) void toggleGalleryLike(selectedPhoto, els.fullPhotoHeartButton);
  });
  els.cameraInfoButton.addEventListener("click", () => els.infoDialog.showModal());
  els.closeInfoButton.addEventListener("click", () => els.infoDialog.close());
  els.reviewDialog.addEventListener("cancel", (event) => { event.preventDefault(); els.reviewDialog.close(); clearPendingPhoto(); });
  els.photoDialog.addEventListener("cancel", (event) => { event.preventDefault(); closePhoto(); });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && stream) stopCamera();
    else if (!document.hidden && activeView === "cameraView" && guestName()) startCamera();
  });

  window.addEventListener("online", () => {
    if (weddingCloud) {
      setCloudState("connected", "Cloud connected");
      void flushUploadQueue();
    } else {
      void initWeddingCloud();
    }
  });
  window.addEventListener("offline", () => setCloudState("offline", "Offline"));

  window.addEventListener("beforeunload", stopCamera);
  window.addEventListener("load", async () => {
    landingStarsController = createLandingStars(els.landingStars);
    landingStarsController.start();
    await loadPhotos();
    if (guestName()) els.guestName.value = guestName();
    updateOwnerTools();
    registerWebMCP();
    void initWeddingCloud();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
})();
