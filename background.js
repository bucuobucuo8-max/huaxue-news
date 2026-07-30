/* =========================
   Three.js 深空网格涟漪背景
   可调变量集中在这里：幅度、速度、密度、亮度
   ========================= */
(function initTechBackground() {
  if (!window.THREE) return;

  const BG = {
    gridSize: 150,          // 网格平面尺寸
    gridSegments: 96,       // 顶点细分；过高会影响性能
    gridDensity: 0.16,      // 片元网格密度
    lineWidth: 0.035,       // 网格线宽
    baseBrightness: 0.55,   // 基础发光亮度
    sweepSpeed: 10.0,       // 流光扫过速度
    sweepWidth: 0.075,      // 流光宽度
    rippleAmp: 0.42,        // 涟漪顶点位移幅度
    rippleSpeed: 5.2,       // 涟漪扩散速度
    rippleFrequency: 0.46,  // 涟漪空间频率
    rippleFade: 0.9,        // 涟漪时间衰减
    rippleSharpness: 0.48,  // 涟漪光环锐度；越大越窄
    maxRipples: 8           // 同屏最大涟漪数量
  };

  const canvas = document.getElementById("bg-canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
  camera.position.set(0, 24, 34);
  camera.lookAt(0, 0, 0);

  const uniforms = {
    uTime: { value: 0 },
    uGridDensity: { value: BG.gridDensity },
    uLineWidth: { value: BG.lineWidth },
    uBaseBrightness: { value: BG.baseBrightness },
    uSweepSpeed: { value: BG.sweepSpeed },
    uSweepWidth: { value: BG.sweepWidth },
    uRippleAmp: { value: BG.rippleAmp },
    uRippleSpeed: { value: BG.rippleSpeed },
    uRippleFrequency: { value: BG.rippleFrequency },
    uRippleFade: { value: BG.rippleFade },
    uRippleSharpness: { value: BG.rippleSharpness },
    uRipples: { value: Array.from({ length: BG.maxRipples }, () => new THREE.Vector4(0, 0, -999, 0)) }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uRippleAmp;
      uniform float uRippleSpeed;
      uniform float uRippleFrequency;
      uniform float uRippleFade;
      uniform vec4 uRipples[${BG.maxRipples}];
      varying vec3 vWorld;
      varying float vRipple;

      void main() {
        vec3 p = position;
        float lift = 0.0;
        float glow = 0.0;
        for (int i = 0; i < ${BG.maxRipples}; i++) {
          vec4 r = uRipples[i];
          float age = uTime - r.z;
          if (age > 0.0) {
            float d = distance(p.xy, r.xy);
            float radius = age * uRippleSpeed;
            float envelope = exp(-age * uRippleFade) * r.w;
            lift += sin(d * uRippleFrequency - age * 7.0) * envelope * uRippleAmp;
            glow += exp(-abs(d - radius) * 2.4) * envelope;
          }
        }
        p.z += lift;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vRipple = glow;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uGridDensity;
      uniform float uLineWidth;
      uniform float uBaseBrightness;
      uniform float uSweepSpeed;
      uniform float uSweepWidth;
      uniform float uRippleSpeed;
      uniform float uRippleFade;
      uniform float uRippleSharpness;
      uniform vec4 uRipples[${BG.maxRipples}];
      varying vec3 vWorld;
      varying float vRipple;

      float gridLine(vec2 uv, float width) {
        vec2 g = abs(fract(uv) - 0.5);
        float d = min(g.x, g.y);
        return 1.0 - smoothstep(0.0, width, d);
      }

      void main() {
        vec2 coord = vWorld.xz * uGridDensity;
        float fine = gridLine(coord, uLineWidth);
        float major = gridLine(coord * 0.2, uLineWidth * 1.7);

        float sweepX = mod(uTime * uSweepSpeed, 170.0) - 85.0;
        float sweep = exp(-abs(vWorld.x - sweepX) * uSweepWidth);

        float rippleGlow = 0.0;
        for (int i = 0; i < ${BG.maxRipples}; i++) {
          vec4 r = uRipples[i];
          float age = uTime - r.z;
          if (age > 0.0) {
            float d = distance(vWorld.xz, r.xy);
            float radius = age * uRippleSpeed;
            float band = exp(-abs(d - radius) * uRippleSharpness);
            rippleGlow += band * exp(-age * uRippleFade) * r.w;
          }
        }

        vec3 deepBlue = vec3(0.05, 0.22, 0.48);
        vec3 cyan = vec3(0.25, 0.85, 1.00);
        vec3 violet = vec3(0.55, 0.42, 1.00);

        float lineEnergy = fine * 0.62 + major * 0.55;
        vec3 color = deepBlue * lineEnergy * uBaseBrightness;
        color += cyan * lineEnergy * sweep * 0.82;
        color += cyan * rippleGlow * 0.95;
        color += violet * major * 0.20;
        color += cyan * vRipple * 0.35;

        float alpha = clamp(lineEnergy * 0.72 + sweep * 0.18 + rippleGlow * 0.55, 0.0, 0.9);
        float fade = 1.0 - smoothstep(42.0, 86.0, length(vWorld.xz));
        gl_FragColor = vec4(color, alpha * fade);
      }
    `
  });

  const geometry = new THREE.PlaneGeometry(BG.gridSize, BG.gridSize, BG.gridSegments, BG.gridSegments);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);

  /* ===== 化学元素装饰：分子结构 + 化学式文字 ===== */
  const chemGroup = new THREE.Group();
  scene.add(chemGroup);

  // 创建文本精灵（化学式）
  function makeTextSprite(text, color = '#7dd3fc') {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const cx = cv.getContext('2d');
    cx.font = 'bold 64px "Segoe UI", sans-serif';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.shadowColor = color;
    cx.shadowBlur = 18;
    cx.fillStyle = color;
    cx.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(6, 3, 1);
    return sp;
  }

  // 创建苯环（6 个碳原子 + 连接键）
  function makeBenzeneRing(scale = 1) {
    const g = new THREE.Group();
    const radius = 2.0 * scale;
    const atomGeo = new THREE.SphereGeometry(0.28 * scale, 16, 12);
    const atomMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const bondGeo = new THREE.CylinderGeometry(0.06 * scale, 0.06 * scale, 1, 8);
    const bondMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending });

    const positions = [];
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const x = Math.cos(ang) * radius;
      const z = Math.sin(ang) * radius;
      positions.push(new THREE.Vector3(x, 0, z));
      const atom = new THREE.Mesh(atomGeo, atomMat);
      atom.position.set(x, 0, z);
      g.add(atom);
    }
    // 连接键
    for (let i = 0; i < 6; i++) {
      const a = positions[i];
      const b = positions[(i + 1) % 6];
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const len = a.distanceTo(b);
      const bond = new THREE.Mesh(bondGeo, bondMat);
      bond.scale.y = len;
      bond.position.copy(mid);
      bond.lookAt(b);
      bond.rotateX(Math.PI / 2);
      g.add(bond);
    }
    return g;
  }

  // 创建水分子 H₂O（一个氧 + 两个氢）
  function makeWaterMolecule(scale = 1) {
    const g = new THREE.Group();
    const oGeo = new THREE.SphereGeometry(0.45 * scale, 20, 16);
    const oMat = new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
    const hGeo = new THREE.SphereGeometry(0.22 * scale, 16, 12);
    const hMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const bondGeo = new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, 1, 8);
    const bondMat = new THREE.MeshBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending });

    const o = new THREE.Mesh(oGeo, oMat); g.add(o);
    const h1 = new THREE.Mesh(hGeo, hMat); h1.position.set(0.9 * scale, 0.6 * scale, 0); g.add(h1);
    const h2 = new THREE.Mesh(hGeo, hMat); h2.position.set(-0.9 * scale, 0.6 * scale, 0); g.add(h2);

    const b1 = new THREE.Mesh(bondGeo, bondMat);
    b1.position.set(0.45 * scale, 0.3 * scale, 0);
    b1.scale.y = 1.0 * scale; b1.rotation.z = -Math.PI / 4; g.add(b1);
    const b2 = new THREE.Mesh(bondGeo, bondMat);
    b2.position.set(-0.45 * scale, 0.3 * scale, 0);
    b2.scale.y = 1.0 * scale; b2.rotation.z = Math.PI / 4; g.add(b2);
    return g;
  }

  // 创建甲烷 CH₄（中心碳 + 四面体氢）
  function makeMethaneMolecule(scale = 1) {
    const g = new THREE.Group();
    const cGeo = new THREE.SphereGeometry(0.42 * scale, 20, 16);
    const cMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
    const hGeo = new THREE.SphereGeometry(0.2 * scale, 16, 12);
    const hMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const bondGeo = new THREE.CylinderGeometry(0.045 * scale, 0.045 * scale, 1, 8);
    const bondMat = new THREE.MeshBasicMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending });

    const c = new THREE.Mesh(cGeo, cMat); g.add(c);
    const dirs = [
      [1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]
    ];
    const hPos = [];
    dirs.forEach(d => {
      const x = d[0] * 0.8 * scale, y = d[1] * 0.8 * scale, z = d[2] * 0.8 * scale;
      hPos.push(new THREE.Vector3(x, y, z));
      const h = new THREE.Mesh(hGeo, hMat); h.position.set(x, y, z); g.add(h);
      const b = new THREE.Mesh(bondGeo, bondMat);
      b.position.set(x / 2, y / 2, z / 2);
      b.scale.y = 0.8 * scale;
      b.lookAt(new THREE.Vector3(x, y, z));
      b.rotateX(Math.PI / 2);
      g.add(b);
    });
    return g;
  }

  // 化学式文字列表
  const formulas = ['H₂O', 'C₆H₆', 'CO₂', 'NaCl', 'CH₄', 'NH₃', 'O₂', 'C₂H₆O', 'H₂SO₄', 'CaCO₃'];
  // 随机分布的化学元素
  const chemElements = [];
  const areaR = 42;

  // 生成与已放置元素保持最小间距的位置
  const placedPositions = [];
  function spreadPos(yMin, yMax, minDist) {
    for (let tries = 0; tries < 30; tries++) {
      const x = (Math.random() - 0.5) * areaR;
      const y = yMin + Math.random() * (yMax - yMin);
      const z = (Math.random() - 0.5) * areaR;
      let ok = true;
      for (const p of placedPositions) {
        const dx = x - p.x, dy = y - p.y, dz = z - p.z;
        if (Math.sqrt(dx*dx + dy*dy + dz*dz) < minDist) { ok = false; break; }
      }
      if (ok || tries === 29) {
        placedPositions.push({ x, y, z });
        return { x, y, z };
      }
    }
    const fx = (Math.random() - 0.5) * areaR;
    const fy = yMin + Math.random() * (yMax - yMin);
    const fz = (Math.random() - 0.5) * areaR;
    placedPositions.push({ x: fx, y: fy, z: fz });
    return { x: fx, y: fy, z: fz };
  }

  // 放置 5 个苯环
  for (let i = 0; i < 5; i++) {
    const ring = makeBenzeneRing(0.8 + Math.random() * 0.7);
    const pos = spreadPos(8, 22, 7);
    ring.position.set(pos.x, pos.y, pos.z);
    ring.rotation.x = Math.random() * Math.PI;
    ring.rotation.y = Math.random() * Math.PI;
    ring.userData = {
      floatSpeed: 0.3 + Math.random() * 0.3,
      floatPhase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.4,
      baseY: ring.position.y
    };
    chemGroup.add(ring);
    chemElements.push(ring);
  }

  // 放置 4 个水分子
  for (let i = 0; i < 4; i++) {
    const mol = makeWaterMolecule(0.8 + Math.random() * 0.5);
    const pos = spreadPos(6, 22, 7);
    mol.position.set(pos.x, pos.y, pos.z);
    mol.rotation.x = Math.random() * Math.PI;
    mol.userData = {
      floatSpeed: 0.2 + Math.random() * 0.35,
      floatPhase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
      baseY: mol.position.y
    };
    chemGroup.add(mol);
    chemElements.push(mol);
  }

  // 放置 3 个甲烷分子
  for (let i = 0; i < 3; i++) {
    const mol = makeMethaneMolecule(0.7 + Math.random() * 0.4);
    const pos = spreadPos(7, 21, 7);
    mol.position.set(pos.x, pos.y, pos.z);
    mol.userData = {
      floatSpeed: 0.25 + Math.random() * 0.3,
      floatPhase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.5,
      baseY: mol.position.y
    };
    chemGroup.add(mol);
    chemElements.push(mol);
  }

  // 放置化学式文字精灵
  formulas.forEach((f, i) => {
    const sp = makeTextSprite(f, ['#67e8f9', '#a78bfa', '#7dd3fc', '#fbbf24'][i % 4]);
    const pos = spreadPos(5, 23, 6);
    sp.position.set(pos.x, pos.y, pos.z);
    sp.userData = {
      floatSpeed: 0.15 + Math.random() * 0.2,
      floatPhase: Math.random() * Math.PI * 2,
      baseY: sp.position.y,
      rippleAffected: true
    };
    chemGroup.add(sp);
    chemElements.push(sp);
  });

  /* ===== 新增化学元素：DNA 双螺旋、CO₂、NaCl 晶格、电子轨道原子 ===== */

  // 创建 DNA 双螺旋
  function makeDNAHelix(scale = 1) {
    const g = new THREE.Group();
    const turns = 2.5;
    const segments = 24;
    const h = 5 * scale;
    const r = 1.2 * scale;
    const sGeo = new THREE.SphereGeometry(0.14 * scale, 12, 8);
    const sMatA = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const sMatB = new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const sMatT = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending });
    const bGeo = new THREE.CylinderGeometry(0.03 * scale, 0.03 * scale, 1, 6);
    const bMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending });

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const ang = t * turns * Math.PI * 2;
      const y = (t - 0.5) * h;
      const x1 = Math.cos(ang) * r, z1 = Math.sin(ang) * r;
      const x2 = Math.cos(ang + Math.PI) * r, z2 = Math.sin(ang + Math.PI) * r;

      const a = new THREE.Mesh(sGeo, sMatA); a.position.set(x1, y, z1); g.add(a);
      const b = new THREE.Mesh(sGeo, sMatB); b.position.set(x2, y, z2); g.add(b);

      if (i % 2 === 0) {
        const rung = new THREE.Mesh(bGeo, sMatT);
        const mid = new THREE.Vector3((x1+x2)/2, y, (z1+z2)/2);
        rung.position.copy(mid);
        rung.scale.y = r * 2;
        rung.lookAt(new THREE.Vector3(x2, y, z2));
        rung.rotateX(Math.PI / 2);
        g.add(rung);
      }
    }
    return g;
  }

  // 创建 CO₂ 分子（线性 O=C=O）
  function makeCO2Molecule(scale = 1) {
    const g = new THREE.Group();
    const cGeo = new THREE.SphereGeometry(0.4 * scale, 20, 16);
    const cMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
    const oGeo = new THREE.SphereGeometry(0.35 * scale, 20, 16);
    const oMat = new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
    const bGeo = new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, 1, 8);
    const bMat = new THREE.MeshBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending });

    const c = new THREE.Mesh(cGeo, cMat); g.add(c);
    const o1 = new THREE.Mesh(oGeo, oMat); o1.position.x = 1.5 * scale; g.add(o1);
    const o2 = new THREE.Mesh(oGeo, oMat); o2.position.x = -1.5 * scale; g.add(o2);
    const b1 = new THREE.Mesh(bGeo, bMat); b1.position.x = 0.75 * scale; b1.scale.y = 1.5 * scale; b1.rotation.z = Math.PI / 2; g.add(b1);
    const b2 = new THREE.Mesh(bGeo, bMat); b2.position.x = -0.75 * scale; b2.scale.y = 1.5 * scale; b2.rotation.z = Math.PI / 2; g.add(b2);
    return g;
  }

  // 创建 NaCl 晶格片段（立方体阵列）
  function makeNaClLattice(scale = 1) {
    const g = new THREE.Group();
    const naGeo = new THREE.SphereGeometry(0.3 * scale, 16, 12);
    const naMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const clGeo = new THREE.SphereGeometry(0.34 * scale, 16, 12);
    const clMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const bGeo = new THREE.CylinderGeometry(0.03 * scale, 0.03 * scale, 1, 6);
    const bMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending });

    const spacing = 1.0 * scale;
    const n = 2;
    for (let x = -n; x <= n; x += 2) {
      for (let y = -n; y <= n; y += 2) {
        for (let z = -n; z <= n; z += 2) {
          const isNa = ((x + y + z) / 2) % 2 === 0;
          const atom = new THREE.Mesh(isNa ? naGeo : clGeo, isNa ? naMat : clMat);
          atom.position.set(x * spacing * 0.5, y * spacing * 0.5, z * spacing * 0.5);
          g.add(atom);
        }
      }
    }
    return g;
  }

  // 创建带电子轨道的单个原子
  function makeAtomWithOrbit(scale = 1) {
    const g = new THREE.Group();
    const nucGeo = new THREE.SphereGeometry(0.35 * scale, 20, 16);
    const nucMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
    const nuc = new THREE.Mesh(nucGeo, nucMat); g.add(nuc);

    const eGeo = new THREE.SphereGeometry(0.1 * scale, 10, 8);
    const eMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
    const ringGeo = new THREE.TorusGeometry(0.8 * scale, 0.015 * scale, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending });

    const orbitTilts = [
      [0, 0, 0],
      [Math.PI / 3, 0, Math.PI / 4],
      [-Math.PI / 3, Math.PI / 3, 0]
    ];
    orbitTilts.forEach((tilt, i) => {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.set(tilt[0], tilt[1], tilt[2]);
      g.add(ring);
      // 电子
      const e = new THREE.Mesh(eGeo, eMat);
      e.userData = { orbitTilt: tilt, orbitSpeed: 1.5 + i * 0.5, orbitPhase: Math.random() * Math.PI * 2, orbitR: 0.8 * scale };
      g.add(e);
    });
    return g;
  }

  // 放置 3 个 DNA 双螺旋
  for (let i = 0; i < 3; i++) {
    const dna = makeDNAHelix(0.9 + Math.random() * 0.4);
    const pos = spreadPos(9, 21, 8);
    dna.position.set(pos.x, pos.y, pos.z);
    dna.userData = {
      floatSpeed: 0.2 + Math.random() * 0.25,
      floatPhase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
      baseY: dna.position.y,
      rippleAffected: true
    };
    chemGroup.add(dna);
    chemElements.push(dna);
  }

  // 放置 4 个 CO₂ 分子
  for (let i = 0; i < 4; i++) {
    const mol = makeCO2Molecule(0.8 + Math.random() * 0.4);
    const pos = spreadPos(6, 22, 7);
    mol.position.set(pos.x, pos.y, pos.z);
    mol.rotation.y = Math.random() * Math.PI;
    mol.userData = {
      floatSpeed: 0.2 + Math.random() * 0.3,
      floatPhase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.4,
      baseY: mol.position.y,
      rippleAffected: true
    };
    chemGroup.add(mol);
    chemElements.push(mol);
  }

  // 放置 3 个 NaCl 晶格
  for (let i = 0; i < 3; i++) {
    const lat = makeNaClLattice(0.7 + Math.random() * 0.3);
    const pos = spreadPos(7, 21, 8);
    lat.position.set(pos.x, pos.y, pos.z);
    lat.userData = {
      floatSpeed: 0.15 + Math.random() * 0.2,
      floatPhase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.2,
      baseY: lat.position.y,
      rippleAffected: true
    };
    chemGroup.add(lat);
    chemElements.push(lat);
  }

  // 放置 6 个带电子轨道的原子
  for (let i = 0; i < 6; i++) {
    const atom = makeAtomWithOrbit(0.7 + Math.random() * 0.5);
    const pos = spreadPos(5, 23, 6);
    atom.position.set(pos.x, pos.y, pos.z);
    atom.userData = {
      floatSpeed: 0.25 + Math.random() * 0.35,
      floatPhase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.6,
      baseY: atom.position.y,
      rippleAffected: true,
      hasElectrons: true
    };
    chemGroup.add(atom);
    chemElements.push(atom);
  }

  // 为所有化学元素记录基础 XZ 坐标（用于涟漪偏移计算，避免漂移）
  chemElements.forEach(el => {
    el.userData.baseX = el.position.x;
    el.userData.baseZ = el.position.z;
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let rippleIndex = 0;
  let lastRippleAt = 0;

  function addRipple(clientX, clientY) {
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;

    const now = performance.now();
    // 鼠标快速移动时节流，避免同屏涟漪过多
    if (now - lastRippleAt < 70) return;
    lastRippleAt = now;

    uniforms.uRipples.value[rippleIndex].set(hit.x, hit.z, clock.getElapsedTime(), 1.0);
    rippleIndex = (rippleIndex + 1) % BG.maxRipples;
  }

  window.addEventListener("mousemove", (event) => addRipple(event.clientX, event.clientY), { passive: true });
  window.addEventListener("touchmove", (event) => {
    const t = event.touches && event.touches[0];
    if (t) addRipple(t.clientX, t.clientY);
  }, { passive: true });

  const clock = new THREE.Clock();

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    uniforms.uTime.value = t;
    mesh.rotation.z = Math.sin(t * 0.08) * 0.018;

    // 读取当前涟漪状态
    const ripples = uniforms.uRipples.value;

    // 化学元素浮动 + 旋转 + 涟漪影响
    chemElements.forEach(el => {
      const ud = el.userData;

      // 基础浮动
      let yOff = 0;
      if (ud.floatSpeed) {
        yOff = Math.sin(t * ud.floatSpeed + ud.floatPhase) * 1.2;
      }

      // 涟漪影响：位移 + 推力（方向朝页面中心）
      if (ud.rippleAffected) {
        const bx = ud.baseX;
        const bz = ud.baseZ;
        let xOff = 0, zOff = 0;
        for (let i = 0; i < ripples.length; i++) {
          const r = ripples[i];
          const age = t - r.z;
          if (age > 0 && age < 4) {
            const dx = bx - r.x;
            const dz = bz - r.y;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const radius = age * BG.rippleSpeed;
            const bandDist = Math.abs(dist - radius);
            // 涟漪环宽度范围内受影响
            if (bandDist < 3.5) {
              const envelope = Math.exp(-age * BG.rippleFade) * r.w;
              const band = Math.exp(-bandDist * 0.6) * envelope;
              // 垂直起伏
              yOff += Math.sin(dist * BG.rippleFrequency - age * 7.0) * band * 1.8;
              // 水平推力：朝向页面中心 (0,0)
              const dirLen = Math.sqrt(bx * bx + bz * bz);
              if (dirLen > 0.01) {
                const push = band * 0.8;
                xOff -= (bx / dirLen) * push;
                zOff -= (bz / dirLen) * push;
              }
            }
          }
        }
        el.position.x = bx + xOff;
        el.position.z = bz + zOff;
      } else {
        el.position.x = ud.baseX;
        el.position.z = ud.baseZ;
      }

      el.position.y = ud.baseY + yOff;

      // 旋转
      if (ud.rotSpeed) {
        el.rotation.y += ud.rotSpeed * 0.01;
        el.rotation.x += ud.rotSpeed * 0.006;
      }

      // 电子轨道动画
      if (ud.hasElectrons) {
        el.children.forEach(child => {
          const cd = child.userData;
          if (cd && cd.orbitR !== undefined) {
            const ang = t * cd.orbitSpeed + cd.orbitPhase;
            const x = Math.cos(ang) * cd.orbitR;
            const z = Math.sin(ang) * cd.orbitR;
            // 应用轨道倾斜
            const tilt = cd.orbitTilt;
            const cy = x * Math.sin(tilt[0]) + z * Math.sin(tilt[2]);
            const cx = x * Math.cos(tilt[0]) + z * Math.sin(tilt[1]);
            const cz = z * Math.cos(tilt[2]) - x * Math.sin(tilt[1]);
            child.position.set(cx, cy, cz);
          }
        });
      }
    });

    renderer.render(scene, camera);
  }
  animate();
})();
