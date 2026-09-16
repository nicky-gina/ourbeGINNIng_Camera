(() => {
  "use strict";

  const SHOT_LIMIT = 12;
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

  const guestName = () => localStorage.getItem("ng_guest_name") || "";

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
        request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Could not load local roll", error);
      photos = [];
      showToast("My Roll is unavailable in this browser.");
    }
    renderRoll();
  }

  async function storePhoto(photo) {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(photo);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
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
    window.scrollTo(0, 0);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
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
        blob: pendingPhoto
      };
      await storePhoto(photo);
      els.reviewDialog.close();
      clearPendingPhoto();
      renderRoll();
      updateCameraUI();
      if (navigator.vibrate) navigator.vibrate(35);
      showToast(`Frame ${String(photos.length).padStart(2, "0")} added to My Roll.`);
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
    [els.rollCountBadge, els.rollCountBadgeRoll].forEach((badge) => {
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
      button.append(img, label);
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

  function openPhoto(photo, number) {
    selectedPhoto = photo;
    const url = makePhotoUrl(photo);
    els.fullPhoto.src = url;
    els.fullPhoto.dataset.url = url;
    els.fullPhotoLabel.textContent = `Frame ${String(number).padStart(2, "0")} · ${new Date(photo.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    els.photoDialog.showModal();
  }

  function closePhoto() {
    els.photoDialog.close();
    if (els.fullPhoto.dataset.url) URL.revokeObjectURL(els.fullPhoto.dataset.url);
    els.fullPhoto.removeAttribute("src");
    delete els.fullPhoto.dataset.url;
    selectedPhoto = null;
  }

  async function shareSelectedPhoto() {
    if (!selectedPhoto) return;
    const file = new File([selectedPhoto.blob], `nicky-gina-${selectedPhoto.createdAt}.jpg`, { type: "image/jpeg" });
    try {
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
      description: "Open either the wedding camera or the guest's locally stored My Roll view.",
      inputSchema: {
        type: "object",
        properties: { view: { type: "string", enum: ["camera", "my_roll"] } },
        required: ["view"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        if (!input || !["camera", "my_roll"].includes(input.view)) throw new Error("view must be camera or my_roll");
        if (!guestName()) throw new Error("A guest name must be entered in the visible app first");
        setView(input.view === "camera" ? "cameraView" : "rollView");
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
  els.cameraInfoButton.addEventListener("click", () => els.infoDialog.showModal());
  els.closeInfoButton.addEventListener("click", () => els.infoDialog.close());
  els.reviewDialog.addEventListener("cancel", (event) => { event.preventDefault(); els.reviewDialog.close(); clearPendingPhoto(); });
  els.photoDialog.addEventListener("cancel", (event) => { event.preventDefault(); closePhoto(); });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && stream) stopCamera();
    else if (!document.hidden && activeView === "cameraView" && guestName()) startCamera();
  });

  window.addEventListener("beforeunload", stopCamera);
  window.addEventListener("load", async () => {
    landingStarsController = createLandingStars(els.landingStars);
    landingStarsController.start();
    await loadPhotos();
    if (guestName()) els.guestName.value = guestName();
    registerWebMCP();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
})();
