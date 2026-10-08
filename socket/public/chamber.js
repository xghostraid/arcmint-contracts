import {
  ACESFilmicToneMapping,
  AmbientLight,
  CatmullRomCurve3,
  CircleGeometry,
  Clock,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  GridHelper,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  BoxGeometry,
} from "./vendor/three.module.js";

const POSES = {
  home: { pos: [0.2, 0.38, 5.55], look: [0, 0.02, 0] },
  floor: { pos: [1.35, 1.02, 4.7], look: [0.02, 0.08, 0.1] },
  burns: { pos: [0.15, -1.85, 3.35], look: [0, -3.05, -0.2] },
  copy: { pos: [-1.15, 0.48, 2.85], look: [-1.85, 0.28, 0.85] },
};

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function metalMaterial(color, roughness) {
  return new MeshPhysicalMaterial({
    color,
    metalness: 1,
    roughness,
    clearcoat: 0.25,
    clearcoatRoughness: 0.55,
  });
}

function buildInstrument() {
  const group = new Group();
  const steel = metalMaterial(0x9aa3ab, 0.34);
  const dark = metalMaterial(0x23282e, 0.48);
  const filament = new MeshStandardMaterial({
    color: 0xf6f1e6,
    emissive: 0xf4ecdf,
    emissiveIntensity: 2.4,
    roughness: 0.35,
  });
  const cableMat = new MeshStandardMaterial({ color: 0x101216, roughness: 0.86, metalness: 0.15 });

  const body = new Mesh(new CylinderGeometry(0.74, 0.8, 1.28, 72), steel);
  body.rotation.x = Math.PI / 2;
  group.add(body);

  const collar = new Mesh(new CylinderGeometry(0.82, 0.82, 0.08, 72), dark);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = 0.42;
  group.add(collar);

  const lip = new Mesh(new TorusGeometry(0.74, 0.035, 18, 80), steel);
  lip.position.z = 0.66;
  group.add(lip);

  const face = new Mesh(new CylinderGeometry(0.6, 0.6, 0.06, 72), dark);
  face.rotation.x = Math.PI / 2;
  face.position.z = 0.62;
  group.add(face);

  const ring = new Mesh(new TorusGeometry(0.5, 0.011, 12, 96), filament);
  ring.position.z = 0.66;
  group.add(ring);

  for (const x of [-0.16, 0.16]) {
    const bore = new Mesh(new CylinderGeometry(0.055, 0.055, 0.14, 28), dark);
    bore.rotation.x = Math.PI / 2;
    bore.position.set(x, 0.14, 0.7);
    group.add(bore);
    const core = new Mesh(new CylinderGeometry(0.016, 0.016, 0.05, 12), filament);
    core.rotation.x = Math.PI / 2;
    core.position.set(x, 0.14, 0.64);
    group.add(core);
  }

  const groove = new Mesh(new TorusGeometry(0.78, 0.01, 8, 72), dark);
  groove.rotation.y = Math.PI / 2;
  group.add(groove);

  const cap = new Mesh(new CylinderGeometry(0.52, 0.66, 0.34, 56), steel);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = -0.78;
  group.add(cap);

  const curve = new CatmullRomCurve3([
    new Vector3(0, 0, -0.96),
    new Vector3(0.02, -0.42, -1.12),
    new Vector3(0.12, -1.05, -1.2),
    new Vector3(0.02, -1.85, -1.02),
  ]);
  group.add(new Mesh(new TubeGeometry(curve, 28, 0.042, 12, false), cableMat));

  return group;
}

function glassPlate(w, h) {
  const group = new Group();
  const frame = new Mesh(
    new BoxGeometry(w + 0.035, h + 0.035, 0.028),
    metalMaterial(0x6e767e, 0.42),
  );
  const pane = new Mesh(
    new BoxGeometry(w, h, 0.018),
    new MeshPhysicalMaterial({
      color: 0x8d98a4,
      metalness: 0,
      roughness: 0.08,
      transmission: 0.62,
      thickness: 0.35,
      ior: 1.45,
      transparent: true,
    }),
  );
  pane.position.z = 0.02;
  group.add(frame, pane);
  return group;
}

function showFallback(canvas) {
  document.body.classList.add("chamber-fallback");
  canvas.hidden = true;
  const still = document.querySelector(".still");
  if (still) still.hidden = false;
  canvas.dataset.ready = "1";
  canvas.dataset.fallback = "1";
}

export function mountChamber() {
  const canvas = document.querySelector("#chamber");
  if (!canvas) return;

  let renderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
  } catch {
    showFallback(canvas);
    return;
  }
  if (!renderer.getContext()) {
    showFallback(canvas);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x07080c, 1);

  const scene = new Scene();
  scene.background = new Color(0x07080c);
  scene.fog = new FogExp2(0x0b0e14, 0.042);
  const camera = new PerspectiveCamera(32, 1, 0.1, 80);

  const key = new DirectionalLight(0xfff3e4, 6.4);
  key.position.set(4.2, 3.4, 4.8);
  const rim = new DirectionalLight(0xb9c7d4, 3.4);
  rim.position.set(-4.5, 1.4, -3.2);
  scene.add(key, rim, new AmbientLight(0x1c2836, 0.42));

  const groundMat = new MeshStandardMaterial({ color: 0x12171e, roughness: 0.84, metalness: 0.62 });
  const ground = new Mesh(new CircleGeometry(90, 128), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.38;
  scene.add(ground);
  const floorGrid = new GridHelper(80, 20, 0x6d7c8a, 0x44515c);
  floorGrid.position.y = -1.36;
  const gridMats = Array.isArray(floorGrid.material) ? floorGrid.material : [floorGrid.material];
  for (const mat of gridMats) {
    mat.transparent = true;
    mat.opacity = 0.05;
  }
  scene.add(floorGrid);
  const lower = new Mesh(new CircleGeometry(9, 72), new MeshStandardMaterial({ color: 0x141820, roughness: 0.78, metalness: 0.62 }));
  lower.rotation.x = -Math.PI / 2;
  lower.position.set(0, -3.22, -0.2);
  scene.add(lower);
  for (const radius of [2.4, 4.6, 7.2]) {
    const ring = new Mesh(new TorusGeometry(radius, 0.008, 8, 120), metalMaterial(0x3c444c, 0.46));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -1.36;
    scene.add(ring);
  }

  const instrument = buildInstrument();
  scene.add(instrument);
  const glow = new PointLight(0xf6f0e4, 6, 4.5, 2);
  glow.position.set(0, 0.1, 0.9);
  instrument.add(glow);

  const anchors = {};
  function addPlate(name, position, w, h) {
    const anchor = new Group();
    anchor.position.set(position[0], position[1], position[2]);
    anchor.userData = { w, h, name };
    anchor.add(glassPlate(w, h));
    scene.add(anchor);
    anchors[name] = anchor;
  }

  addPlate("hero", [-2.62, -0.02, -0.05], 2.02, 1.78);
  addPlate("left", [-2.35, 1.28, -2.35], 1.2, 0.58);
  addPlate("paid", [2.35, 0.58, -0.35], 1.2, 0.58);
  addPlate("burned", [1.95, -0.55, 0.72], 1.2, 0.58);
  addPlate("floor", [0, 0.42, -6.45], 2.35, 0.92);
  addPlate("burns", [0.05, -2.62, -0.15], 2.25, 0.95);

  const grid = new Group();
  grid.position.set(0, -0.2, -7.15);
  scene.add(grid);
  const slabMat = metalMaterial(0x8b949c, 0.4);
  const slabGeo = new BoxGeometry(1.15, 0.07, 0.62);

  function setCoins(coins) {
    grid.clear();
    const list = Array.isArray(coins) ? coins.slice(0, 12) : [];
    list.forEach((coin, index) => {
      const slab = new Mesh(slabGeo, slabMat);
      const col = index % 4;
      const row = Math.floor(index / 4);
      slab.position.set((col - 1.5) * 1.4, 0, -row * 1.15);
      slab.userData.href = `/coin/${encodeURIComponent(coin.mint)}`;
      grid.add(slab);
    });
    const line = document.querySelector("[data-empty-line]");
    if (line && list.length === 0 && !line.textContent) line.textContent = "The floor is clear.";
    if (anchors.floor) anchors.floor.visible = list.length > 0;
  }

  const seed = document.querySelector("#coin-seed");
  if (seed) {
    try { setCoins(JSON.parse(seed.textContent || "[]")); } catch { setCoins([]); }
  }
  window.addEventListener("socket:coins", (event) => setCoins(event.detail || []));

  const plates = [...document.querySelectorAll(".plate")];
  const tmp = new Vector3();
  const lookTarget = new Vector3();
  let view = document.body.dataset.view || "home";
  let pose = POSES[view] || POSES.home;
  const orbit = { yaw: 0, pitch: 0, vy: 0, vp: 0 };
  let anim = null;
  let dragging = false;

  function spherical(pos, look, yaw, pitch) {
    const offset = new Vector3(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]);
    const radius = offset.length();
    const theta = Math.atan2(offset.x, offset.z) + yaw;
    const phi = Math.acos(Math.min(1, Math.max(-1, offset.y / radius))) + pitch;
    const clamped = Math.min(Math.PI - 0.22, Math.max(0.22, phi));
    return new Vector3(
      look[0] + radius * Math.sin(clamped) * Math.sin(theta),
      look[1] + radius * Math.cos(clamped),
      look[2] + radius * Math.sin(clamped) * Math.cos(theta),
    );
  }

  function applyPose() {
    const next = spherical(pose.pos, pose.look, orbit.yaw, orbit.pitch);
    camera.position.copy(next);
    lookTarget.set(pose.look[0], pose.look[1], pose.look[2]);
    aim();
  }

  function aim() {
    if (window.innerWidth < 740 && (view === "home" || view === "copy")) {
      const offset = camera.position.clone().sub(lookTarget);
      const dist = offset.length();
      camera.position.copy(lookTarget).add(offset.normalize().multiplyScalar(dist + 2.4));
      camera.lookAt(lookTarget.x, lookTarget.y - 1.05, lookTarget.z);
      return;
    }
    camera.lookAt(lookTarget);
  }

  function go(next, { intro = false } = {}) {
    view = POSES[next] ? next : "home";
    document.body.dataset.view = view === "copy" ? "home" : view;
    document.body.dataset.focus = view;
    pose = POSES[view];
    canvas.dataset.settled = "0";
    if (reduced) {
      orbit.yaw = 0;
      orbit.pitch = 0;
      applyPose();
      canvas.dataset.settled = "1";
      anim = null;
      return;
    }
    const to = new Vector3(pose.pos[0], pose.pos[1], pose.pos[2]);
    const toLook = new Vector3(pose.look[0], pose.look[1], pose.look[2]);
    const from = intro ? to.clone().add(to.clone().sub(toLook).normalize().multiplyScalar(1.35)) : camera.position.clone();
    const fromLook = lookTarget.clone();
    anim = {
      start: performance.now(),
      dur: intro ? 1600 : 1250,
      from,
      to,
      fromLook,
      toLook,
      fromYaw: orbit.yaw,
      fromPitch: orbit.pitch,
    };
  }

  document.querySelectorAll("[data-view-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const next = link.dataset.viewLink;
      const path = next === "home" ? "/" : `/${next}`;
      if (location.pathname !== path) history.pushState({ view: next }, "", path);
      go(next);
    });
  });
  window.addEventListener("popstate", () => {
    const next = location.pathname === "/floor" ? "floor" : location.pathname === "/burns" ? "burns" : "home";
    go(next);
  });
  window.addEventListener("socket:focus", (event) => {
    if (event.detail) go(event.detail);
  });

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    orbit.vy = 0;
    orbit.vp = 0;
    canvas.dataset.dragX = String(event.clientX);
    canvas.dataset.dragY = String(event.clientY);
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const prevX = Number(canvas.dataset.dragX);
    const prevY = Number(canvas.dataset.dragY);
    const dx = event.clientX - prevX;
    const dy = event.clientY - prevY;
    canvas.dataset.dragX = String(event.clientX);
    canvas.dataset.dragY = String(event.clientY);
    const scale = 0.0052;
    orbit.yaw += dx * scale;
    orbit.pitch = Math.max(-0.7, Math.min(0.7, orbit.pitch + dy * scale));
    if (Math.abs(dx) + Math.abs(dy) > 0.4) {
      orbit.vy = dx * scale;
      orbit.vp = dy * scale;
      orbit.movedAt = performance.now();
    }
    if (anim) anim = null;
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (performance.now() - (orbit.movedAt || 0) > 120) {
      orbit.vy = 0;
      orbit.vp = 0;
    }
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", endDrag);
  window.addEventListener("pointerup", endDrag);

  const clock = new Clock();
  let elapsed = reduced ? 1.4 : 0;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  resize();
  window.addEventListener("resize", resize);

  function showPlate(plate, left, top, plateW) {
    plate.style.width = `${plateW}px`;
    plate.style.minHeight = "0px";
    plate.style.left = `${left}px`;
    plate.style.top = `${top}px`;
    plate.style.transform = "none";
    plate.style.opacity = "1";
    plate.style.pointerEvents = "none";
  }

  function socketBand() {
    instrument.getWorldPosition(tmp);
    const projected = tmp.clone().project(camera);
    const sy = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    return { top: sy - 86, bottom: sy + 100 };
  }

  function stackPlate(plate, top, plateW) {
    plate.style.width = `${plateW}px`;
    plate.style.minHeight = "0px";
    const h = Math.max(plate.offsetHeight, 1);
    showPlate(plate, 12, top, plateW);
    return h;
  }

  function placePlates() {
    const active = document.body.dataset.focus || view;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width < 740) {
      const homeOn = active === "home" || active === "copy";
      const navBottom = document.querySelector(".nav")?.getBoundingClientRect().bottom ?? 76;
      for (const plate of plates) {
        plate.style.opacity = "0";
        plate.style.pointerEvents = "none";
      }
      const plateW = width - 24;
      if (homeOn) {
        const band = socketBand();
        const clearBottom = Math.max(navBottom + 8, band.bottom);
        let cursor = clearBottom + 12;
        for (const name of ["left", "paid", "burned"]) {
          const plate = plates.find((el) => el.dataset.anchor === name);
          cursor += stackPlate(plate, cursor, plateW) + 8;
        }
        const hero = plates.find((el) => el.dataset.anchor === "hero");
        stackPlate(hero, cursor, plateW);
      } else {
        const plate = plates.find((el) => el.dataset.room === active);
        if (plate) {
          plate.style.width = `${plateW}px`;
          const h = plate.offsetHeight;
          const band = socketBand();
          const top = Math.max(navBottom + 12, Math.min(band.bottom + 12, height - h - 12));
          showPlate(plate, 12, top, plateW);
        }
      }
      return;
    }
    const vFov = (camera.fov * Math.PI) / 180;
    for (const plate of plates) {
      const anchor = anchors[plate.dataset.anchor];
      const room = plate.dataset.room;
      const on = room === "home" ? (active === "home" || active === "copy") : room === active;
      if (!anchor || !on) {
        plate.style.opacity = "0";
        plate.style.pointerEvents = "none";
        continue;
      }
      if (plate.dataset.anchor === "floor" && plate.classList.contains("is-empty")) {
        const plateW = Math.min(width - 48, 840);
        plate.style.width = `${plateW}px`;
        plate.style.minHeight = "0px";
        plate.style.left = "0px";
        plate.style.top = "0px";
        const plateH = Math.max(plate.offsetHeight, 64);
        const y = Math.min(height - plateH / 2 - 28, height * 0.74);
        plate.style.transform = `translate(-50%, -50%) translate(${width * 0.62}px, ${y}px)`;
        plate.style.opacity = "1";
        plate.style.pointerEvents = "none";
        continue;
      }
      anchor.getWorldPosition(tmp);
      const dist = Math.max(0.4, camera.position.distanceTo(tmp));
      const projected = tmp.clone().project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      const px = (anchor.userData.h / (2 * Math.tan(vFov / 2) * dist)) * height;
      let plateW = Math.min(width - 28, Math.max(width < 740 ? 280 : 200, (anchor.userData.w / anchor.userData.h) * px));
      const emptyLine = plate.classList.contains("is-empty") || plate.querySelector(".space-line:not([hidden])");
      if (emptyLine) plateW = Math.min(width - 40, width < 740 ? width - 28 : 920);
      plate.style.width = `${plateW}px`;
      plate.style.minHeight = "0px";
      plate.style.left = "0px";
      plate.style.top = "0px";
      const plateH = Math.max(plate.offsetHeight, 72);
      const half = plateW / 2;
      const halfH = plateH / 2;
      const clampedX = Math.min(width - half - 12, Math.max(half + 12, x));
      const topLimit = 64 + halfH;
      const bottomLimit = Math.max(topLimit, height - 16 - halfH);
      const clampedY = Math.min(bottomLimit, Math.max(topLimit, y));
      plate.style.transform = `translate(-50%, -50%) translate(${clampedX}px, ${clampedY}px)`;
      plate.style.opacity = projected.z < 1 ? "1" : "0";
      plate.style.pointerEvents = "none";
    }
  }

  applyPose();
  go(view, { intro: true });

  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    if (!reduced) elapsed += dt;
    const heavy = reduced ? 1 : 0.045;
    const idleY = Math.sin(elapsed * 0.34) * 0.2 + Math.sin(elapsed * 0.13) * 0.04;
    const idleX = Math.sin(elapsed * 0.22) * 0.045;
    instrument.rotation.y += (idleY - instrument.rotation.y) * (reduced ? 1 : heavy);
    instrument.rotation.x += (idleX - instrument.rotation.x) * (reduced ? 1 : heavy);
    const lift = reduced ? 0 : Math.sin(elapsed * 0.42) * 0.03;
    instrument.position.y += (lift - instrument.position.y) * (reduced ? 1 : 0.04);
    if (!reduced) {
      const a = elapsed * 0.11;
      key.position.set(Math.cos(a) * 5.4, 3.3, Math.sin(a) * 5.4);
      rim.position.set(-Math.cos(a) * 4.2, 1.1, -Math.sin(a) * 3.6);
    }
    const gridTarget = view === "floor" ? 0.34 : 0.06;
    for (const mat of gridMats) {
      mat.opacity += (gridTarget - mat.opacity) * (reduced ? 1 : 0.08);
    }
    if (!dragging) {
      orbit.yaw += orbit.vy;
      orbit.pitch = Math.max(-0.7, Math.min(0.7, orbit.pitch + orbit.vp));
      orbit.vy *= 0.9;
      orbit.vp *= 0.9;
    }
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.start) / anim.dur);
      const e = 1 - (1 - k) ** 3;
      camera.position.lerpVectors(anim.from, anim.to, e);
      lookTarget.lerpVectors(anim.fromLook, anim.toLook, e);
      orbit.yaw = anim.fromYaw * (1 - e);
      orbit.pitch = anim.fromPitch * (1 - e);
      aim();
      if (k === 1) {
        anim = null;
        canvas.dataset.settled = "1";
      }
    } else {
      applyPose();
    }
    canvas.dataset.yaw = orbit.yaw.toFixed(4);
    placePlates();
    renderer.render(scene, camera);
    canvas.dataset.ready = "1";
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    showFallback(canvas);
  });
}
