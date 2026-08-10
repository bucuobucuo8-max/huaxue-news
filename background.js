/* Three.js deep-space meteor and chemistry atmosphere. */
(function initMeteorChemistrySpace() {
  if (!window.THREE) return;

  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;

  const compact = window.matchMedia("(max-width: 760px)").matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SETTINGS = {
    stars: compact ? 280 : 620,
    chemicalObjects: compact ? 13 : 24,
    trailSegments: compact ? 36 : 64
  };

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !compact,
    powerPreference: "high-performance"
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.65));
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020611, 0.018);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 180);
  camera.position.set(0, 2.5, 27);
  camera.lookAt(0, 1.5, -8);

  const clock = new THREE.Clock();
  const palette = [0x62d9ff, 0xa8f4ff, 0xb39aff, 0xf2d58b];

  canvas.dataset.backgroundEffect = "cursor-meteor-trail";

  function createStarField() {
    const positions = new Float32Array(SETTINGS.stars * 3);
    const colors = new Float32Array(SETTINGS.stars * 3);
    const sizes = new Float32Array(SETTINGS.stars);
    const phases = new Float32Array(SETTINGS.stars);

    for (let index = 0; index < SETTINGS.stars; index++) {
      positions[index * 3] = (Math.random() - 0.5) * 90;
      positions[index * 3 + 1] = -18 + Math.random() * 55;
      positions[index * 3 + 2] = -65 + Math.random() * 72;
      const color = new THREE.Color(palette[index % palette.length]);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sizes[index] = 0.65 + Math.random() * 1.55;
      phases[index] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vPulse;
        uniform float uTime;

        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vColor = color;
          vPulse = 0.58 + 0.42 * sin(uTime * (0.55 + aSize * 0.22) + aPhase);
          gl_PointSize = aSize * vPulse * (62.0 / max(1.0, -viewPosition.z));
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vPulse;

        void main() {
          vec2 center = gl_PointCoord - 0.5;
          float distanceToCenter = length(center);
          float glow = 1.0 - smoothstep(0.04, 0.5, distanceToCenter);
          glow += (1.0 - smoothstep(0.0, 0.12, distanceToCenter)) * 0.7;
          gl_FragColor = vec4(vColor, glow * vPulse * 0.52);
        }
      `
    });

    const points = new THREE.Points(geometry, material);
    points.userData.material = material;
    points.renderOrder = -2;
    scene.add(points);
    return points;
  }

  function meshMaterial(color, opacity, wireframe) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      wireframe: Boolean(wireframe),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true
    });
    mat.userData.baseOpacity = opacity;
    return mat;
  }

  function lineMaterial(color, opacity) {
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true
    });
    mat.userData.baseOpacity = opacity;
    return mat;
  }

  function connect(group, from, to, color, opacity) {
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    const bond = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, from.distanceTo(to), 5),
      meshMaterial(color, opacity, false)
    );
    bond.position.copy(midpoint);
    bond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    group.add(bond);
  }

  function makeMolecule(color) {
    const group = new THREE.Group();
    const positions = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1.25, 0.48, 0.28),
      new THREE.Vector3(-1.12, 0.65, -0.38),
      new THREE.Vector3(0.12, -1.16, 0.72),
      new THREE.Vector3(-0.15, 0.32, 1.25)
    ];
    positions.forEach((position, index) => {
      const atom = new THREE.Mesh(
        new THREE.IcosahedronGeometry(index ? 0.19 : 0.32, 1),
        meshMaterial(index === 2 ? 0xf2d58b : color, index ? 0.27 : 0.41, true)
      );
      atom.position.copy(position);
      group.add(atom);
      if (index) connect(group, positions[0], position, color, 0.18);
    });
    return group;
  }

  function makeOrbital(color, isDOrbital) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 1),
      meshMaterial(0xf2d58b, 0.40, true)
    ));

    const lobeDirections = isDOrbital
      ? [[1, 1], [-1, -1], [-1, 1], [1, -1]]
      : [[0, 1], [0, -1]];

    lobeDirections.forEach(([x, y]) => {
      const lobe = new THREE.Mesh(
        new THREE.SphereGeometry(0.66, 10, 7),
        meshMaterial(color, 0.15, true)
      );
      lobe.scale.set(isDOrbital ? 0.48 : 0.62, 1.15, 0.48);
      lobe.position.set(x * 0.58, y * 0.66, 0);
      if (isDOrbital) lobe.rotation.z = x * y > 0 ? -Math.PI / 4 : Math.PI / 4;
      group.add(lobe);
    });

    for (let orbitIndex = 0; orbitIndex < 3; orbitIndex++) {
      const points = [];
      for (let step = 0; step <= 64; step++) {
        const angle = step / 64 * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * 1.65, 0, Math.sin(angle) * 0.68));
      }
      const orbit = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        lineMaterial(color, 0.15)
      );
      orbit.rotation.set(orbitIndex * 0.9, orbitIndex * 0.52, orbitIndex * 0.68);
      group.add(orbit);
    }
    return group;
  }

  function makeFormulaSilhouette(color) {
    const group = new THREE.Group();
    const ring = [];
    for (let index = 0; index < 6; index++) {
      const angle = index * Math.PI / 3;
      ring.push(new THREE.Vector3(Math.cos(angle) * 1.12, Math.sin(angle) * 1.12, 0));
    }
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ring.concat([ring[0]])),
      lineMaterial(color, 0.27)
    ));
    connect(group, ring[0], ring[0].clone().add(new THREE.Vector3(1.08, 0.6, 0)), color, 0.2);
    connect(group, ring[3], ring[3].clone().add(new THREE.Vector3(-1.0, -0.65, 0)), color, 0.18);
    return group;
  }

  function collectMaterials(object) {
    const materials = [];
    object.traverse((child) => {
      if (child.material) materials.push(child.material);
    });
    return materials;
  }

  const chemicalGroup = new THREE.Group();
  const chemicalObjects = [];
  const occupied = [];
  scene.add(chemicalGroup);

  function chemistryPosition() {
    let candidate;
    for (let attempt = 0; attempt < 45; attempt++) {
      candidate = new THREE.Vector3(
        (Math.random() - 0.5) * (compact ? 32 : 56),
        -8 + Math.random() * 25,
        -40 + Math.random() * 42
      );
      if (occupied.every((other) => other.distanceTo(candidate) > 4.4)) break;
    }
    occupied.push(candidate.clone());
    return candidate;
  }

  for (let index = 0; index < SETTINGS.chemicalObjects; index++) {
    const color = palette[index % palette.length];
    let object;
    if (index % 3 === 0) object = makeMolecule(color);
    else if (index % 3 === 1) object = makeOrbital(color, index % 2 === 0);
    else object = makeFormulaSilhouette(color);

    const position = chemistryPosition();
    const scale = 0.55 + Math.random() * 0.72;
    object.position.copy(position);
    object.scale.setScalar(scale);
    object.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    object.userData = {
      basePosition: position.clone(),
      baseScale: scale,
      phase: Math.random() * Math.PI * 2,
      floatSpeed: 0.13 + Math.random() * 0.18,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 0.002,
        (Math.random() - 0.5) * 0.0028,
        (Math.random() - 0.5) * 0.0017
      ),
      materials: collectMaterials(object)
    };
    chemicalGroup.add(object);
    chemicalObjects.push(object);
  }

  function makeHeadTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 96;
    textureCanvas.height = 96;
    const context = textureCanvas.getContext("2d");
    const gradient = context.createRadialGradient(48, 48, 0, 48, 48, 46);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.12, "rgba(190,245,255,.95)");
    gradient.addColorStop(0.42, "rgba(65,185,255,.42)");
    gradient.addColorStop(1, "rgba(75,100,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 96, 96);
    return new THREE.CanvasTexture(textureCanvas);
  }

  const headTexture = makeHeadTexture();
  const cursorTrails = [];

  function makeMeteorTrailMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0x75ddff) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec2 vUv;

        void main() {
          float distanceFromCore = abs(vUv.y - 0.5) * 2.0;
          float core = 1.0 - smoothstep(0.0, 0.22, distanceFromCore);
          float halo = 1.0 - smoothstep(0.05, 1.0, distanceFromCore);
          float tailFade = mix(1.0, 0.68, vUv.x);
          float softJoin = smoothstep(0.0, 0.08, vUv.x) * smoothstep(0.0, 0.08, 1.0 - vUv.x);
          vec3 color = mix(uColor, vec3(0.72, 0.50, 1.0), vUv.x * 0.55);
          float alpha = (core * 1.0 + halo * 0.55) * tailFade * softJoin * uOpacity;
          gl_FragColor = vec4(color * 2.6, min(1.0, alpha * 1.9));
        }
      `
    });
  }

  function makeCursorTrail() {
    const group = new THREE.Group();
    const trailMaterial = makeMeteorTrailMaterial();
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), trailMaterial);
    trail.renderOrder = 20;
    group.add(trail);

    group.userData = {
      active: false,
      age: 0,
      life: reducedMotion ? 0.4 : 1.15,
      brightness: 1,
      trail,
      trailMaterial
    };
    group.visible = false;
    group.renderOrder = 20;
    scene.add(group);
    cursorTrails.push(group);
    return group;
  }

  for (let index = 0; index < SETTINGS.trailSegments; index++) {
    makeCursorTrail();
  }

  const cursorHeadMaterial = new THREE.SpriteMaterial({
    map: headTexture,
    color: 0xe4fbff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
  const cursorHead = new THREE.Sprite(cursorHeadMaterial);
  cursorHead.scale.setScalar(0.27);
  cursorHead.visible = false;
  cursorHead.renderOrder = 22;
  scene.add(cursorHead);

  const stars = createStarField();

  const pointerNdc = new THREE.Vector2();
  const pointerRaycaster = new THREE.Raycaster();
  const cursorPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -4);
  const cursorWorld = new THREE.Vector3();
  const lastCursorWorld = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  let hasCursorPoint = false;
  let cursorTrailIndex = 0;
  let lastTrailAt = 0;
  let cursorPulse = 0;

  function cursorInfluence(position) {
    if (cursorPulse <= 0) return 0;
    const distance = Math.hypot(position.x - cursorWorld.x, position.y - cursorWorld.y);
    return Math.max(0, 1 - distance / 5) * cursorPulse;
  }

  function addCursorTrail(clientX, clientY) {
    pointerNdc.x = clientX / window.innerWidth * 2 - 1;
    pointerNdc.y = -(clientY / window.innerHeight * 2 - 1);
    pointerRaycaster.setFromCamera(pointerNdc, camera);
    if (!pointerRaycaster.ray.intersectPlane(cursorPlane, hitPoint)) return;

    if (!hasCursorPoint) {
      lastCursorWorld.copy(hitPoint);
      cursorWorld.copy(hitPoint);
      hasCursorPoint = true;
      return;
    }

    const now = performance.now();
    const movement = hitPoint.distanceTo(lastCursorWorld);
    if (movement < 0.02 || now - lastTrailAt < 10) return;
    lastTrailAt = now;

    const group = cursorTrails[cursorTrailIndex];
    cursorTrailIndex = (cursorTrailIndex + 1) % cursorTrails.length;
    const data = group.userData;
    const tailDirection = lastCursorWorld.clone().sub(hitPoint).normalize();
    const visualLength = movement + 0.32;
    const brightness = Math.min(1, 0.85 + movement * 1.8);

    group.visible = true;
    group.position.copy(hitPoint);
    data.active = true;
    data.age = 0;
    data.brightness = brightness;
    data.trail.position.copy(tailDirection).multiplyScalar(visualLength * 0.5);
    data.trail.rotation.z = Math.atan2(tailDirection.y, tailDirection.x);
    data.trail.scale.set(visualLength, 0.16 + Math.min(movement * 0.18, 0.14), 1);
    data.trailMaterial.uniforms.uOpacity.value = brightness;
    cursorHead.position.copy(hitPoint);
    cursorHead.scale.setScalar(0.3 + brightness * 0.16);
    cursorHeadMaterial.opacity = Math.min(1, brightness * 1.3);
    cursorHead.visible = true;

    lastCursorWorld.copy(hitPoint);
    cursorWorld.copy(hitPoint);
    cursorPulse = 1;
  }

  window.addEventListener("pointermove", (event) => {
    addCursorTrail(event.clientX, event.clientY);
  }, { passive: true });

  window.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) hasCursorPoint = false;
  }, { passive: true });

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width < 620 ? 57 : 50;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  let animationFrame;
  function animate() {
    animationFrame = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    stars.userData.material.uniforms.uTime.value = time;

    stars.rotation.y = time * 0.0018;
    chemicalGroup.rotation.y = Math.sin(time * 0.035) * 0.022;

    cursorPulse = Math.max(0, cursorPulse - delta * 1.8);
    let activeTrailCount = 0;
    cursorTrails.forEach((trailGroup) => {
      const data = trailGroup.userData;
      if (!data.active) return;
      data.age += delta;
      const fade = Math.max(0, 1 - data.age / data.life);
      const opacity = Math.pow(fade, 1.1) * data.brightness;
      data.trailMaterial.uniforms.uOpacity.value = opacity;
      activeTrailCount++;
      if (fade <= 0) {
        data.active = false;
        trailGroup.visible = false;
      }
    });
    cursorHeadMaterial.opacity = Math.pow(cursorPulse, 1.35);
    cursorHead.visible = cursorPulse > 0.01;
    canvas.dataset.activeCursorTrails = String(activeTrailCount);

    chemicalObjects.forEach((object) => {
      const data = object.userData;
      const influence = cursorInfluence(data.basePosition);
      const breath = 0.92 + Math.sin(time * (0.34 + data.floatSpeed) + data.phase) * 0.09;
      object.position.set(
        data.basePosition.x + Math.sin(time * 0.11 + data.phase) * 0.28,
        data.basePosition.y + Math.sin(time * data.floatSpeed + data.phase) * 0.58,
        data.basePosition.z
      );
      object.scale.setScalar(data.baseScale * (1 + influence * 0.06));
      object.rotation.x += data.spin.x;
      object.rotation.y += data.spin.y;
      object.rotation.z += data.spin.z;
      data.materials.forEach((mat) => {
        mat.opacity = Math.min(0.66, mat.userData.baseOpacity * breath * (1 + influence * 1.1));
      });
    });

    renderer.render(scene, camera);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(animationFrame);
    else {
      clock.getDelta();
      animate();
    }
  });

  animate();
})();
