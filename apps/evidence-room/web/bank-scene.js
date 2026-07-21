import * as THREE from "/three.module.js";

const copper = 0xd66f32;
const copperHot = 0xed8a4c;
const iron = 0x21130e;
const ironRaised = 0x43271a;
const wood = 0x5a301f;

function mesh(geometry, material, position, rotation = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(...position);
  item.rotation.set(...rotation);
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

export function createBankDesk(canvas) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    document.documentElement.classList.add("no-webgl");
    queueMicrotask(() => canvas.dispatchEvent(new CustomEvent("bank-scene-ready")));
    return { setDrawerOpen() {}, setBatchActive() {}, setProgress() {}, setLightOn() {}, destroy() {} };
  }

  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.58;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080605);
  scene.fog = new THREE.FogExp2(0x080605, 0.018);

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 80);
  const cameraTarget = new THREE.Vector3(0, -1.05, 0.15);
  const bulbWorldPosition = new THREE.Vector3(0, 4.14, 0.9);
  const bulbScreenPosition = new THREE.Vector3();
  const drawerPaperWorldPosition = new THREE.Vector3();
  const drawerPaperScreenPosition = new THREE.Vector3();
  let lastBulbX = Number.NaN;
  let lastBulbY = Number.NaN;
  let lastDrawerX = Number.NaN;
  let lastDrawerY = Number.NaN;

  const warm = new THREE.MeshStandardMaterial({ color: wood, roughness: 0.72, metalness: 0.12 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: iron, roughness: 0.48, metalness: 0.72 });
  const raisedMetal = new THREE.MeshStandardMaterial({ color: ironRaised, roughness: 0.4, metalness: 0.66 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x563322, roughness: 0.78, metalness: 0.08 });
  const brass = new THREE.MeshStandardMaterial({ color: copper, roughness: 0.28, metalness: 0.82 });

  const tableTop = mesh(new THREE.BoxGeometry(17.2, 0.52, 10.4), warm, [0, -1.65, 0.55]);
  scene.add(tableTop);
  scene.add(mesh(new THREE.BoxGeometry(22, 9, 0.35), darkMetal, [0, 2.6, -6.2]));
  const deskBlotter = new THREE.MeshStandardMaterial({ color: 0x120d0a, roughness: 0.92, metalness: 0.03 });
  scene.add(mesh(new THREE.BoxGeometry(11.6, 0.09, 6.15), deskBlotter, [0, -1.34, 0.2]));
  const grainMaterial = new THREE.MeshStandardMaterial({ color: 0x2c160f, roughness: 0.95, metalness: 0 });
  for (let index = -7; index <= 7; index += 1) {
    scene.add(mesh(new THREE.BoxGeometry(0.018, 0.015, 10.1), grainMaterial, [index * 1.08, -1.375, 0.55]));
  }

  // A readable physical desk, not an abstract floor plane. The front apron and
  // legs keep the HTML controls visually anchored to the same piece of furniture.
  scene.add(mesh(new THREE.BoxGeometry(18, 1.05, 0.62), legMaterial, [0, -2.08, 4.75]));
  scene.add(mesh(new THREE.BoxGeometry(0.86, 4.6, 0.86), legMaterial, [-8.1, -3.7, 4.25]));
  scene.add(mesh(new THREE.BoxGeometry(0.86, 4.6, 0.86), legMaterial, [8.1, -3.7, 4.25]));

  const tableEdge = mesh(new THREE.BoxGeometry(17.2, 0.28, 0.34), brass, [0, -1.34, 5.72]);
  scene.add(tableEdge);
  scene.add(mesh(new THREE.BoxGeometry(0.28, 0.28, 10.4), brass, [-8.58, -1.34, 0.55]));
  scene.add(mesh(new THREE.BoxGeometry(0.28, 0.28, 10.4), brass, [8.58, -1.34, 0.55]));

  const deskDrawer = new THREE.Group();
  const drawerWood = new THREE.MeshStandardMaterial({ color: 0x3b2117, roughness: 0.74, metalness: 0.08 });
  const drawerLining = new THREE.MeshStandardMaterial({ color: 0x160d09, roughness: 0.94, metalness: 0.02 });
  deskDrawer.add(mesh(new THREE.BoxGeometry(4.9, 0.16, 2.8), drawerWood, [0, 0, 0]));
  deskDrawer.add(mesh(new THREE.BoxGeometry(4.5, 0.05, 2.35), drawerLining, [0, 0.11, -0.08]));
  deskDrawer.add(mesh(new THREE.BoxGeometry(0.2, 0.56, 2.8), drawerWood, [-2.35, 0.26, 0]));
  deskDrawer.add(mesh(new THREE.BoxGeometry(0.2, 0.56, 2.8), drawerWood, [2.35, 0.26, 0]));
  deskDrawer.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 2.65), brass, [-2.35, 0.57, 0]));
  deskDrawer.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 2.65), brass, [2.35, 0.57, 0]));
  deskDrawer.add(mesh(new THREE.BoxGeometry(4.9, 0.56, 0.2), drawerWood, [0, 0.26, -1.3]));
  deskDrawer.add(mesh(new THREE.BoxGeometry(5.25, 0.82, 0.3), drawerWood, [0, 0.18, 1.48]));
  const drawerHandle = mesh(new THREE.TorusGeometry(0.5, 0.075, 12, 36, Math.PI), brass, [0, 0.12, 1.66], [0, 0, Math.PI]);
  deskDrawer.add(drawerHandle);
  const handleScrewGeometry = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 16);
  deskDrawer.add(mesh(handleScrewGeometry, brass, [-0.5, 0.12, 1.65], [Math.PI / 2, 0, 0]));
  deskDrawer.add(mesh(handleScrewGeometry, brass, [0.5, 0.12, 1.65], [Math.PI / 2, 0, 0]));
  deskDrawer.position.set(0, -2.12, 4.22);
  scene.add(deskDrawer);

  const vaultGroup = new THREE.Group();
  for (let index = 0; index < 4; index += 1) {
    const drawer = new THREE.Group();
    const drawerMaterial = raisedMetal.clone();
    const x = (index - 1.5) * 2.45;
    drawer.add(mesh(new THREE.BoxGeometry(2.12, 1.18, 1.25), drawerMaterial, [0, 0, 0]));
    drawer.add(mesh(new THREE.BoxGeometry(1.7, 0.12, 0.1), brass, [0, -0.38, 0.68]));
    const lock = mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.13, 24), brass, [0.67, 0.08, 0.69], [Math.PI / 2, 0, 0]);
    drawer.add(lock);
    drawer.position.set(x, -0.55, -3.15);
    vaultGroup.add(drawer);
  }
  // The four interactive boxes are rendered as paper controls in the shared
  // tabletop plane, so no second set of upright WebGL boxes is shown behind them.

  const dialGroup = new THREE.Group();
  const dial = mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.16, 48), darkMetal, [0, 0, 0]);
  const ring = mesh(new THREE.TorusGeometry(0.68, 0.08, 12, 48), brass, [0, 0.1, 0], [Math.PI / 2, 0, 0]);
  const needle = mesh(new THREE.BoxGeometry(0.07, 0.08, 0.62), new THREE.MeshStandardMaterial({ color: copperHot, emissive: 0x4b1708 }), [0, 0.18, -0.22]);
  dialGroup.add(dial, ring, needle);

  // The visible hanging bulb is the single light source for the whole desk.
  const bulbGroup = new THREE.Group();
  bulbGroup.position.set(0, 0, 0.9);
  bulbGroup.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 5.2, 12), darkMetal, [0, 7.35, 0]));
  bulbGroup.add(mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.48, 20), brass, [0, 4.62, 0]));
  const bulbGlass = new THREE.MeshPhysicalMaterial({ color: 0xffc28e, emissive: 0xff7a38, emissiveIntensity: 5, roughness: 0.18, transmission: 0.1, transparent: true, opacity: 0.94 });
  bulbGroup.add(mesh(new THREE.SphereGeometry(0.42, 28, 20), bulbGlass, [0, 4.14, 0]));
  scene.add(bulbGroup);

  const topLight = new THREE.SpotLight(0xffa66c, 105, 34, Math.PI / 3.15, 0.72, 1.25);
  topLight.position.set(0, 4.2, 0.9);
  topLight.target.position.set(0, -1.25, 0.15);
  topLight.castShadow = true;
  topLight.shadow.mapSize.set(1024, 1024);
  scene.add(topLight, topLight.target);
  const drawerLight = new THREE.PointLight(copperHot, 34, 13, 2);
  drawerLight.position.set(0, -1.55, 4.7);
  scene.add(drawerLight);
  const bulbLight = new THREE.PointLight(0xffa264, 135, 30, 1.45);
  bulbLight.position.set(0, 4.05, 0.9);
  bulbLight.castShadow = true;
  scene.add(bulbLight);
  const ambientLight = new THREE.HemisphereLight(0xb16b43, 0x261108, 4.1);
  scene.add(ambientLight);
  const legLight = new THREE.PointLight(0xff8f4e, 54, 18, 1.8);
  legLight.position.set(0, -0.8, 7.5);
  scene.add(legLight);

  let drawerOpen = false;
  let drawerDepth = 0;
  let pointerX = 0;
  let pointerY = 0;
  let batchActive = false;
  let lightOn = true;
  let firstFrameRendered = false;
  let destroyed = false;
  let cameraBaseY = 8;

  function syncBulbHitTarget() {
    bulbScreenPosition.copy(bulbWorldPosition).project(camera);
    const x = (bulbScreenPosition.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-bulbScreenPosition.y * 0.5 + 0.5) * canvas.clientHeight;
    if (Math.abs(x - lastBulbX) > 0.5 || Number.isNaN(lastBulbX)) {
      document.documentElement.style.setProperty("--bulb-x", `${x.toFixed(1)}px`);
      lastBulbX = x;
    }
    if (Math.abs(y - lastBulbY) > 0.5 || Number.isNaN(lastBulbY)) {
      document.documentElement.style.setProperty("--bulb-y", `${y.toFixed(1)}px`);
      lastBulbY = y;
    }
  }

  function syncDrawerPaperTarget() {
    drawerPaperWorldPosition.set(0, -1.92, deskDrawer.position.z - 0.38);
    drawerPaperScreenPosition.copy(drawerPaperWorldPosition).project(camera);
    const x = (drawerPaperScreenPosition.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-drawerPaperScreenPosition.y * 0.5 + 0.5) * canvas.clientHeight;
    if (Math.abs(x - lastDrawerX) > 0.5 || Number.isNaN(lastDrawerX)) {
      document.documentElement.style.setProperty("--drawer-x", `${x.toFixed(1)}px`);
      lastDrawerX = x;
    }
    if (Math.abs(y - lastDrawerY) > 0.5 || Number.isNaN(lastDrawerY)) {
      document.documentElement.style.setProperty("--drawer-y", `${y.toFixed(1)}px`);
      lastDrawerY = y;
    }
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    if (camera.aspect < 0.85) {
      camera.position.set(0, 12.1, 16.9);
      cameraBaseY = 12.1;
      camera.fov = 57;
    } else if (camera.aspect < 1.35) {
      const layoutWidth = Math.min(760, width * 0.88);
      const frame = THREE.MathUtils.clamp((width / layoutWidth) / (1040 / 760), 0.84, 1.18);
      camera.position.set(0, 10.8 * frame, 15.35 * frame);
      cameraBaseY = 10.8 * frame;
      camera.fov = 50;
    } else {
      const layoutWidth = Math.min(950, width * 0.76);
      const frame = THREE.MathUtils.clamp((width / layoutWidth) / (1440 / 950), 0.86, 1.34);
      camera.position.set(0, 11.55 * frame, 15.85 * frame);
      cameraBaseY = 11.55 * frame;
      camera.fov = 48;
    }
    camera.updateProjectionMatrix();
    camera.lookAt(cameraTarget);
    syncBulbHitTarget();
    syncDrawerPaperTarget();
  }

  function render() {
    if (destroyed) return;
    const targetDepth = drawerOpen ? 2.45 : 0;
    drawerDepth = reducedMotion ? targetDepth : THREE.MathUtils.lerp(drawerDepth, targetDepth, 0.095);
    deskDrawer.position.z = 4.22 + drawerDepth;
    drawerLight.intensity = lightOn ? 30 + drawerDepth * 6 : 0;
    drawerLight.position.z = 4.7 + drawerDepth;
    if (!reducedMotion) {
      camera.position.x += (pointerX * 0.34 - camera.position.x) * 0.018;
      camera.position.y += (cameraBaseY - pointerY * 0.14 - camera.position.y) * 0.018;
      camera.lookAt(cameraTarget);
      vaultGroup.position.y = Math.sin(performance.now() * 0.0012) * (batchActive ? 0.018 : 0.006);
    }
    syncBulbHitTarget();
    syncDrawerPaperTarget();
    renderer.render(scene, camera);
    if (!firstFrameRendered) {
      firstFrameRendered = true;
      canvas.dataset.sceneReady = "true";
      canvas.dispatchEvent(new CustomEvent("bank-scene-ready"));
    }
  }

  function onPointer(event) {
    pointerX = (event.clientX / innerWidth) * 2 - 1;
    pointerY = (event.clientY / innerHeight) * 2 - 1;
  }

  function setDrawerOpen(open) {
    drawerOpen = Boolean(open);
    canvas.dataset.drawer = drawerOpen ? "open" : "closed";
  }
  function setLightOn(on) {
    lightOn = Boolean(on);
    topLight.intensity = lightOn ? 105 : 0;
    bulbLight.intensity = lightOn ? 135 : 0;
    ambientLight.intensity = lightOn ? 4.1 : 1.05;
    legLight.intensity = lightOn ? 54 : 8;
    bulbGlass.emissiveIntensity = lightOn ? 5 : 0.03;
    bulbGlass.color.setHex(lightOn ? 0xffc28e : 0x3b2920);
    canvas.dataset.light = lightOn ? "on" : "off";
  }
  function setBatchActive(active) {
    batchActive = Boolean(active);
    vaultGroup.children.forEach((item) => {
      item.children[0].material.emissive = new THREE.Color(batchActive ? 0x2c0e05 : 0x000000);
      item.children[0].material.emissiveIntensity = batchActive ? 0.5 : 0;
    });
  }
  function setProgress(progress) { needle.rotation.y = THREE.MathUtils.degToRad(Number(progress || 0) * -350); }
  function destroy() {
    destroyed = true;
    renderer.setAnimationLoop(null);
    renderer.dispose();
    removeEventListener("resize", resize);
    removeEventListener("pointermove", onPointer);
    globalThis.visualViewport?.removeEventListener("resize", resize);
  }

  resize();
  canvas.dataset.drawer = "closed";
  canvas.dataset.light = "on";
  addEventListener("resize", resize);
  addEventListener("pointermove", onPointer, { passive: true });
  globalThis.visualViewport?.addEventListener("resize", resize, { passive: true });
  renderer.setAnimationLoop(render);
  return { setDrawerOpen, setBatchActive, setProgress, setLightOn, destroy };
}
