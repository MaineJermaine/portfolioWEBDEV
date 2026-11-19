// ---------- Art room ----------
// The art-portfolio side of the site: a cozy apartment drawn live with Three.js.
// Everything is built from code (rounded boxes, cylinders, canvas textures), so there
// are no model files to download. The artworks listed in assets/art/art.json hang in
// the frames, in the order of SLOTS below; each frame resizes to fit its artwork.
//
// Room layout (looking down, north = the wall you face when you arrive):
//   north: couch + gallery wall (3 frames)    east: bed + one big frame and two small
//   south: desk (1 frame) + dresser (2)       west: window, bookshelf, easel (1 canvas)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const W = 6, D = 5.2, H = 2.75;              // room size in metres: x, z, y
const HX = W / 2, HZ = D / 2;
const HOME = new THREE.Vector3(0, 1.48, 0.4); // where you stand when you arrive
const TAU = Math.PI * 2;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(hover: none)').matches;

// Frame slots. wall: n/e/s/w; u = position along the wall (x on n/s, z on e/w); y = centre height;
// w/h = the largest the frame may be (it shrinks to the artwork's shape).
const SLOTS = [
  { wall: 'n', u: 0,     y: 1.64, w: 0.98, h: 0.8,  style: 'black', light: true, where: 'Above the couch' },
  { wall: 'n', u: -0.92, y: 1.6,  w: 0.5,  h: 0.66, style: 'black', where: 'Gallery wall, left' },
  { wall: 'n', u: 0.92,  y: 1.6,  w: 0.5,  h: 0.66, style: 'black', where: 'Gallery wall, right' },
  { wall: 'e', u: 0.2,   y: 1.68, w: 1.2,  h: 0.74, style: 'oak', light: true, where: 'Above the bed' },
  { wall: 'e', u: -1.34, y: 1.58, w: 0.42, h: 0.56, style: 'walnut', where: 'Bedside, left' },
  { wall: 'e', u: 1.72,  y: 1.58, w: 0.42, h: 0.56, style: 'walnut', where: 'Bedside, right' },
  { wall: 's', u: 1.45,  y: 1.6,  w: 1.05, h: 0.64, style: 'brass', where: 'Above the dresser' },
  { wall: 's', u: 2.48,  y: 1.62, w: 0.4,  h: 0.52, style: 'brass', where: 'By the dresser' },
  { wall: 's', u: -0.4,  y: 1.66, w: 0.74, h: 0.52, style: 'white', where: 'Above the desk' },
  { easel: true, w: 0.62, h: 0.78, where: 'On the easel' },
];
const FRAME_STYLES = {
  black:  { color: 0x1c1a18, width: 0.026, rough: 0.45 },
  walnut: { color: 0x5b3a25, width: 0.034, rough: 0.55 },
  oak:    { color: 0xb3875a, width: 0.046, rough: 0.6 },
  brass:  { color: 0xc89a4c, width: 0.022, rough: 0.32, metal: 0.85 },
  white:  { color: 0xf0ebe2, width: 0.03, rough: 0.55 },
};

// deterministic randomness, so the room looks the same on every visit
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261119);
const pick = a => a[Math.floor(rnd() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapAngle = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const pad = n => String(n).padStart(2, '0');

export function createRoom({ mount, art, lightbox, onUniverse }) {
  const host = mount.querySelector('.room-canvas');
  const tipEl = mount.querySelector('.room-tip');
  const hintEl = mount.querySelector('.room-hint');
  const framesEl = mount.querySelector('.room-frames');
  const nowEl = mount.querySelector('.room-now');
  const labelEl = mount.querySelector('.room-label');

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, touch ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;          // the room doesn't move: render shadows once
  host.appendChild(renderer.domElement);
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x140e0a);
  const camera = new THREE.PerspectiveCamera(64, 1, 0.03, 40);
  camera.rotation.order = 'YXZ';

  // ---------- canvas textures ----------
  function tex(w, h, draw, { repeat, color = true } = {}) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    t.anisotropy = ANISO;
    return t;
  }
  function grain(g, w, h, amt) {
    const d = g.getImageData(0, 0, w, h), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const n = (rnd() - 0.5) * amt;
      p[i] += n; p[i + 1] += n; p[i + 2] += n;
    }
    g.putImageData(d, 0, 0);
  }

  const floorTex = tex(1024, 1024, (g, w, h) => {
    const rows = 10, ph = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * w * 0.6;
      while (x < w) {
        const len = w * (0.3 + rnd() * 0.45), k = 0.82 + rnd() * 0.32;
        g.fillStyle = `rgb(${(176 * k) | 0},${(122 * k) | 0},${(80 * k) | 0})`;
        g.fillRect(x, r * ph, len, ph);
        for (let i = 0; i < 16; i++) {                       // grain
          const y = r * ph + rnd() * ph;
          g.strokeStyle = `rgba(70,38,18,${0.04 + rnd() * 0.09})`;
          g.lineWidth = 0.6 + rnd() * 1.6;
          g.beginPath(); g.moveTo(x, y);
          g.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 7, x + len * 0.7, y + (rnd() - 0.5) * 7, x + len, y + (rnd() - 0.5) * 5);
          g.stroke();
        }
        g.fillStyle = 'rgba(38,22,10,0.6)';
        g.fillRect(x, r * ph, 2, ph);                       // end joint
        x += len;
      }
      g.fillStyle = 'rgba(38,22,10,0.65)';
      g.fillRect(0, r * ph, w, 2);                          // long joint
    }
    grain(g, w, h, 14);
  }, { repeat: [1, 1] });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;

  const wallTex = tex(512, 512, (g, w, h) => {
    g.fillStyle = '#ececec'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 9);
    const v = g.createLinearGradient(0, 0, 0, h);          // soft shading into ceiling + floor corners
    v.addColorStop(0, 'rgba(0,0,0,0.2)'); v.addColorStop(0.07, 'rgba(0,0,0,0.05)'); v.addColorStop(0.16, 'rgba(0,0,0,0)');
    v.addColorStop(0.86, 'rgba(0,0,0,0)'); v.addColorStop(0.96, 'rgba(0,0,0,0.12)'); v.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  });
  wallTex.wrapS = THREE.RepeatWrapping;

  const fabricTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`; g.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.04})`; g.fillRect(x, 0, 1, h); }
    grain(g, w, h, 24);
  }, { repeat: [3, 3] });

  const knitTex = tex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, w, h);
    const cw = 16, ch = 14;
    for (let y = 0; y < h; y += ch) for (let x = 0; x < w; x += cw) {
      g.fillStyle = '#f2f2f2';
      g.beginPath(); g.ellipse(x + cw * 0.3, y + ch / 2, cw * 0.2, ch * 0.5, 0.55, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(x + cw * 0.7, y + ch / 2, cw * 0.2, ch * 0.5, -0.55, 0, TAU); g.fill();
    }
    grain(g, w, h, 22);
  }, { repeat: [5, 5] });

  const woodTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const y = rnd() * h;
      g.strokeStyle = `rgba(60,40,25,${0.05 + rnd() * 0.12})`;
      g.lineWidth = 0.5 + rnd() * 2;
      g.beginPath(); g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 10, w * 0.7, y + (rnd() - 0.5) * 10, w, y);
      g.stroke();
    }
    grain(g, w, h, 12);
  });

  const rugTex = tex(1024, 680, (g, w, h) => {
    g.fillStyle = '#e8dbc3'; g.fillRect(0, 0, w, h);
    const band = (inset, width, color) => {
      g.strokeStyle = color; g.lineWidth = width;
      g.strokeRect(inset + width / 2, inset + width / 2, w - 2 * inset - width, h - 2 * inset - width);
    };
    band(16, 30, '#b35a3b'); band(58, 8, '#33435a'); band(76, 14, '#d29b48');
    g.save();
    g.beginPath(); g.rect(102, 102, w - 204, h - 204); g.clip();
    const s = 92;
    for (let j = -1; j * s < h; j++) for (let i = -1; i * s < w; i++) {
      const x = 102 + i * s, y = 102 + j * s;
      g.globalAlpha = 0.5;
      g.fillStyle = (i + j) % 2 ? '#c2694a' : '#3c4c63';
      g.beginPath(); g.moveTo(x + s / 2, y + 14); g.lineTo(x + s - 14, y + s / 2); g.lineTo(x + s / 2, y + s - 14); g.lineTo(x + 14, y + s / 2); g.closePath(); g.fill();
      g.globalAlpha = 0.8; g.fillStyle = '#e8dbc3';
      g.fillRect(x + s / 2 - 4, y + s / 2 - 4, 8, 8);
    }
    g.restore();
    g.globalAlpha = 1;
    g.fillStyle = '#d29b48';                                // centre medallion
    g.beginPath(); g.ellipse(w / 2, h / 2, 120, 84, 0, 0, TAU); g.fill();
    g.fillStyle = '#e8dbc3';
    g.beginPath(); g.ellipse(w / 2, h / 2, 96, 62, 0, 0, TAU); g.fill();
    g.fillStyle = '#b35a3b';
    g.beginPath(); g.ellipse(w / 2, h / 2, 54, 32, 0, 0, TAU); g.fill();
    grain(g, w, h, 34);
  });

  const viewTex = tex(2048, 1024, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, '#080d29'); sky.addColorStop(0.55, '#1b1d46'); sky.addColorStop(0.85, '#43305a'); sky.addColorStop(1, '#6e4459');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) {                         // stars
      g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.75})`;
      const r = rnd() < 0.92 ? 1 : 2;
      g.fillRect(rnd() * w, rnd() * h * 0.5, r, r);
    }
    const mx = w * 0.56, my = h * 0.3;                      // moon
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 170);
    halo.addColorStop(0, 'rgba(255,244,220,0.5)'); halo.addColorStop(1, 'rgba(255,244,220,0)');
    g.fillStyle = halo; g.fillRect(mx - 170, my - 170, 340, 340);
    g.fillStyle = '#f6efdc'; g.beginPath(); g.arc(mx, my, 34, 0, TAU); g.fill();
    g.fillStyle = 'rgba(200,190,170,0.35)';
    g.beginPath(); g.arc(mx - 9, my - 6, 8, 0, TAU); g.arc(mx + 12, my + 9, 6, 0, TAU); g.fill();
    const skyline = (base, minH, maxH, color, lit, winA) => {
      let x = -20;
      while (x < w) {
        const bw = 40 + rnd() * 110, bh = minH + rnd() * (maxH - minH);
        g.fillStyle = color;
        g.fillRect(x, base - bh, bw, h - base + bh);
        if (rnd() < 0.25) g.fillRect(x + bw * 0.4, base - bh - 18, 4, 18);       // antenna
        for (let wy = base - bh + 10; wy < h; wy += 16) for (let wx = x + 8; wx < x + bw - 8; wx += 13) {
          if (rnd() < lit) { g.fillStyle = `rgba(255,${190 + (rnd() * 40) | 0},${110 + (rnd() * 50) | 0},${winA * (0.5 + rnd() * 0.5)})`; g.fillRect(wx, wy, 6, 8); }
        }
        x += bw + rnd() * 6;
      }
    };
    skyline(h * 0.6, h * 0.04, h * 0.16, '#211c3b', 0.12, 0.5);
    skyline(h * 0.66, h * 0.06, h * 0.24, '#0f0d1d', 0.22, 0.95);
  });

  const lanternTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 12) { g.fillStyle = 'rgba(120,80,40,0.35)'; g.fillRect(0, y, w, 2); }
    grain(g, w, h, 16);
  });

  const radial = (stops) => tex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(([o, c]) => r.addColorStop(o, c));
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
  const glowTex = radial([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.5)'], [0.5, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
  const blobTex = radial([[0, 'rgba(0,0,0,0.9)'], [0.55, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]);
  const rectShadowTex = tex(256, 256, (g, w, h) => {       // soft rectangle (contact + drop shadows)
    g.shadowColor = 'rgba(0,0,0,1)'; g.shadowBlur = 34; g.shadowOffsetX = 1000;
    g.fillStyle = '#000'; g.fillRect(44 - 1000, 44, w - 88, h - 88);
  });
  const washTex = tex(256, 256, (g, w, h) => {             // picture-light wash, bright at the top
    const r = g.createRadialGradient(w / 2, h * 0.06, 0, w / 2, h * 0.06, w * 0.47);   // fades out before every edge
    r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(0.4, 'rgba(255,255,255,0.3)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });

  // ---------- materials ----------
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
  const M = {
    floor: std(0xffffff, { map: floorTex, roughness: 0.5 }),
    ceiling: std(0xf4efe7, { roughness: 1 }),
    wallSage: std(0x7d8e70, { map: wallTex, roughness: 0.95 }),
    wallCream: std(0xe9dbc4, { map: wallTex, roughness: 0.95 }),
    trim: std(0xf2ece2, { roughness: 0.55 }),
    walnut: std(0x6e4a32, { map: woodTex, roughness: 0.55 }),
    walnutLight: std(0x80583c, { map: woodTex, roughness: 0.5 }),
    oak: std(0xc39a6b, { map: woodTex, roughness: 0.6 }),
    oakLight: std(0xd8b78c, { map: woodTex, roughness: 0.65 }),
    black: std(0x1d1c1b, { roughness: 0.45, metalness: 0.3 }),
    brass: std(0xc99b52, { roughness: 0.3, metalness: 0.9 }),
    couch: std(0xa8553a, { map: fabricTex, roughness: 0.95 }),
    mustard: std(0xcf9a3a, { map: fabricTex, roughness: 0.95 }),
    cream: std(0xeee3cf, { map: fabricTex, roughness: 0.95 }),
    knit: std(0xece1cc, { map: knitTex, roughness: 1 }),
    knitMustard: std(0xc8933c, { map: knitTex, roughness: 1 }),
    headboard: std(0x4c6a66, { map: fabricTex, roughness: 0.85 }),
    sheet: std(0xf3efe7, { map: fabricTex, roughness: 0.95 }),
    duvet: std(0xd8c1a2, { map: fabricTex, roughness: 0.95 }),
    sage: std(0x8d9c79, { map: fabricTex, roughness: 0.95 }),
    terracotta: std(0xb5623e, { roughness: 0.85 }),
    ceramic: std(0xeee8dc, { roughness: 0.3 }),
    ceramicBlue: std(0x34485a, { roughness: 0.3 }),
    shade: new THREE.MeshStandardMaterial({ color: 0xf2e2c4, emissive: 0xffa458, emissiveIntensity: 0.42, roughness: 1, side: THREE.DoubleSide }),
    lantern: new THREE.MeshStandardMaterial({ color: 0xf6e7cf, map: lanternTex, emissive: 0xffb470, emissiveMap: lanternTex, emissiveIntensity: 1.5, roughness: 1 }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    soil: std(0x3a2a1e, { roughness: 1 }),
    leaves: [std(0x3f6b35, { roughness: 0.55 }), std(0x4e7f3d, { roughness: 0.55 }), std(0x2f5a2c, { roughness: 0.55 })],
    snake: [std(0x2d5236, { roughness: 0.5 }), std(0x3c6743, { roughness: 0.5 })],
    matBoard: std(0xf3eee4, { roughness: 0.9 }),
    canvasEdge: std(0xefe9dd, { map: fabricTex, roughness: 0.95 }),
    curtain: std(0xe0d0b3, { map: fabricTex, roughness: 0.95, side: THREE.DoubleSide }),
    keyboard: std(0x2a2a2c, { roughness: 0.6 }),
    candle: std(0xf3ead8, { roughness: 0.7, emissive: 0xffa040, emissiveIntensity: 0.12 }),
    rug: std(0xffffff, { map: rugTex, roughness: 1 }),
    glass: new THREE.MeshBasicMaterial({ color: 0xbfd3ff, transparent: true, opacity: 0.05, depthWrite: false }),
    paper: std(0xf4efe3, { roughness: 0.9 }),
    books: [0xa8553a, 0xcf9a3a, 0x4c6a66, 0x33435a, 0xe6dcc8, 0x7a3b3b, 0x8d9c79, 0x2b2a28, 0xc9b28a, 0x5d4a7a]
      .map(c => std(c, { roughness: 0.75 })),
    paints: [0xd94a3a, 0xf2c14e, 0x3a7bd5, 0x4fa36a, 0xf3f0e8, 0x7a4fa3].map(c => std(c, { roughness: 0.3 })),
  };

  // ---------- geometry helpers ----------
  function rbox(w, h, d, r) {
    r = Math.min(r, Math.min(w, h, d) / 2 - 0.0005);
    return r > 0.002 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
  }
  function add(geo, material, x, y, z, parent = scene, cast = true) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const B = (w, h, d, material, x, y, z, parent, r = 0, cast) => add(rbox(w, h, d, r), material, x, y, z, parent, cast);
  const C = (rt, rb, h, material, x, y, z, parent, seg = 24, open = false) =>
    add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), material, x, y, z, parent);
  const S = (r, material, x, y, z, parent, sx = 1, sy = 1, sz = 1) => {
    const m = add(new THREE.SphereGeometry(r, 20, 14), material, x, y, z, parent);
    m.scale.set(sx, sy, sz);
    return m;
  };
  const group = (x, y, z, ry = 0, parent = scene) => {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = ry;
    parent.add(g);
    return g;
  };
  const noPick = o => { o.raycast = () => {}; return o; };
  // soft contact shadow on the floor under furniture
  function blob(x, z, w, d, opacity = 0.5, round = false) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: round ? blobTex : rectShadowTex, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.007, z);
    m.renderOrder = 1;
    scene.add(noPick(m));
  }
  const glows = [];
  function glow(x, y, z, size, color, opacity, parent = scene, twinkle = 0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.set(x, y, z);
    s.scale.set(size, size, 1);
    parent.add(noPick(s));
    glows.push({ s, base: opacity, size, twinkle, phase: rnd() * TAU });
    return s;
  }
  // a wall plane's texture runs along the wall in metres, and once from floor to ceiling
  function wallUV(mesh, axis) {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry, p = geo.attributes.position, uv = geo.attributes.uv, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      uv.setXY(i, (axis === 'x' ? v.x : v.z) / H, v.y / H);
    }
    uv.needsUpdate = true;
  }

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0xffe0bd, 0x4a3a2c, 0.9));

  const LANTERN = new THREE.Vector3(0.15, 2.28, -0.55);
  // the paper lantern lights every direction and casts the furniture shadows. Shadows are only
  // rendered once (the room never moves), so a point light's 6-sided shadow map costs nothing per frame.
  const lanternLight = new THREE.PointLight(0xffc48a, 6.5, 0, 2);
  lanternLight.position.copy(LANTERN).add(new THREE.Vector3(0, -0.1, 0));
  lanternLight.castShadow = true;
  lanternLight.shadow.mapSize.set(1024, 1024);
  lanternLight.shadow.bias = -0.002;
  lanternLight.shadow.normalBias = 0.02;
  lanternLight.shadow.camera.near = 0.3;
  scene.add(lanternLight);

  const moon = new THREE.DirectionalLight(0x8fa6ff, 1.3);        // steep, so it pools on the floor by the window
  moon.position.set(-HX - 4, 6.2, 1.1);
  moon.target.position.set(0, 0, 0.1);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  // must cover the whole room: anything outside the shadow map counts as lit, even behind a wall
  Object.assign(moon.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 22 });
  moon.shadow.camera.updateProjectionMatrix();
  moon.shadow.bias = -0.0005;
  moon.shadow.normalBias = 0.03;
  scene.add(moon, moon.target);

  function lamp(x, y, z, intensity, color = 0xffad62) {
    const l = new THREE.PointLight(color, intensity, 0, 2);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  }

  // ---------- the room itself ----------
  function shell() {
    const floorGeo = new THREE.PlaneGeometry(W, D);
    const uv = floorGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 2.4, uv.getY(i) * D / 2.4);
    const floor = add(floorGeo, M.floor, 0, 0, 0, scene, false);
    floor.rotation.x = -Math.PI / 2;
    const ceil = add(new THREE.PlaneGeometry(W, D), M.ceiling, 0, H, 0, scene, true);   // casts: keeps moonlight out over the walls
    ceil.rotation.x = Math.PI / 2;

    const wall = (material, w, h, x, y, z, ry, axis) => {
      const m = add(new THREE.PlaneGeometry(w, h), material, x, y, z, scene, true);
      m.rotation.y = ry;
      wallUV(m, axis);
      return m;
    };
    wall(M.wallSage, W, H, 0, H / 2, -HZ, 0, 'x');                    // north (accent wall)
    wall(M.wallCream, D, H, HX, H / 2, 0, -Math.PI / 2, 'z');         // east
    wall(M.wallCream, W, H, 0, H / 2, HZ, Math.PI, 'x');              // south
    // west wall, built around the window opening
    const z0 = WIN.z0, z1 = WIN.z1, y0 = WIN.y0, y1 = WIN.y1;
    const west = (za, zb, ya, yb) => wall(M.wallCream, zb - za, yb - ya, -HX, (ya + yb) / 2, (za + zb) / 2, Math.PI / 2, 'z');
    // the pieces overlap slightly so moonlight can't leak through the seams (overlaps are invisible:
    // the texture is mapped from world position)
    west(-HZ, z0, 0, H); west(z1, HZ, 0, H); west(z0 - 0.02, z1 + 0.02, 0, y0); west(z0 - 0.02, z1 + 0.02, y1, H);

    // trim: skirting boards + crown moulding
    for (const [len, x, z, ry] of [[W, 0, -HZ, 0], [W, 0, HZ, Math.PI], [D, HX, 0, -Math.PI / 2], [D, -HX, 0, Math.PI / 2]]) {
      const g = group(x, 0, z, ry);
      B(len, 0.1, 0.018, M.trim, 0, 0.05, 0.009, g, 0.003);
      B(len, 0.055, 0.04, M.trim, 0, H - 0.0275, 0.02, g, 0.004, false);
    }
  }

  const WIN = { z0: -0.5, z1: 0.9, y0: 0.9, y1: 2.25, depth: 0.16 };
  function windowAndCurtains() {
    const { z0, z1, y0, y1, depth } = WIN, zc = (z0 + z1) / 2, wz = z1 - z0, wy = y1 - y0;
    const xr = -HX - depth / 2;
    B(depth, 0.02, wz + 0.04, M.wallCream, xr, y1 + 0.01, zc);        // reveal
    B(depth, 0.02, wz + 0.04, M.wallCream, xr, y0 - 0.01, zc);
    B(depth, wy, 0.02, M.wallCream, xr, (y0 + y1) / 2, z0 - 0.01);
    B(depth, wy, 0.02, M.wallCream, xr, (y0 + y1) / 2, z1 + 0.01);
    const xf = -HX - 0.09, bar = 0.045;                                // painted frame + mullions
    B(0.05, bar, wz, M.trim, xf, y1 - bar / 2, zc);
    B(0.05, bar, wz, M.trim, xf, y0 + bar / 2, zc);
    B(0.05, wy, bar, M.trim, xf, (y0 + y1) / 2, z0 + bar / 2);
    B(0.05, wy, bar, M.trim, xf, (y0 + y1) / 2, z1 - bar / 2);
    B(0.04, wy, 0.03, M.trim, xf, (y0 + y1) / 2, zc);
    B(0.04, 0.03, wz, M.trim, xf, y0 + wy * 0.64, zc);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(wz, wy), M.glass);
    glass.position.set(xf - 0.01, (y0 + y1) / 2, zc);
    glass.rotation.y = Math.PI / 2;
    scene.add(noPick(glass));
    B(0.26, 0.035, wz + 0.16, M.trim, -HX + 0.03, y0 - 0.0175, zc, scene, 0.006);   // sill
    // the night outside
    const view = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ map: viewTex, toneMapped: false }));
    view.position.set(-HX - 1.3, 1.5, zc);
    view.rotation.y = Math.PI / 2;
    scene.add(noPick(view));
    // a little plant on the sill, catching the moonlight
    const pg = group(-HX + 0.06, y0, z1 - 0.22);
    C(0.055, 0.045, 0.09, M.terracotta, 0, 0.045, 0, pg, 18);
    for (let i = 0; i < 7; i++) {
      const l = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.12, 6), M.leaves[i % 3]);
      l.position.set((rnd() - 0.5) * 0.04, 0.14, (rnd() - 0.5) * 0.04);
      l.rotation.set((rnd() - 0.5) * 0.7, 0, (rnd() - 0.5) * 0.7);
      l.castShadow = true;
      pg.add(l);
    }

    // curtains on a rod
    const rod = C(0.012, 0.012, 2.7, M.brass, -HX + 0.11, 2.46, zc, scene, 12);
    rod.rotation.x = Math.PI / 2;
    for (const z of [zc - wz / 2 - 0.62 + 0.35, zc + wz / 2 + 0.62 - 0.35]) {
      const width = 0.62, g = new THREE.PlaneGeometry(width, 2.38, 56, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / width + 0.5, v = p.getY(i) / 2.38 + 0.5;
        p.setZ(i, (Math.sin(u * TAU * 5.5) * 0.032 + 0.032) * (0.75 + 0.25 * v));
      }
      g.computeVertexNormals();
      const m = add(g, M.curtain, -HX + 0.075, 2.44 - 1.19, z);
      m.rotation.y = Math.PI / 2;
      for (let k = 0; k < 8; k++) C(0.018, 0.018, 0.012, M.brass, -HX + 0.11, 2.46, z - width / 2 + k * width / 7, scene, 10).rotation.z = Math.PI / 2;
    }
  }

  function couchArea() {
    const g = group(0, 0, -HZ + 0.47);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(0.024, 0.016, 0.1, M.walnut, sx * 0.94, 0.05, sz * 0.36, g, 10);
    B(2.1, 0.22, 0.9, M.couch, 0, 0.21, 0, g, 0.05);
    for (let i = -1; i <= 1; i++) B(0.565, 0.15, 0.66, M.couch, i * 0.57, 0.39, 0.08, g, 0.065);
    B(2.1, 0.5, 0.16, M.couch, 0, 0.55, -0.37, g, 0.06);
    for (let i = -1; i <= 1; i++) B(0.565, 0.44, 0.2, M.couch, i * 0.57, 0.66, -0.27, g, 0.09).rotation.x = -0.14;
    for (const sx of [-1, 1]) B(0.2, 0.36, 0.9, M.couch, sx * 0.95, 0.47, 0, g, 0.085);
    const p1 = B(0.4, 0.4, 0.13, M.mustard, -0.6, 0.67, -0.1, g, 0.06); p1.rotation.set(-0.3, 0.15, 0.12);
    const p2 = B(0.36, 0.36, 0.12, M.cream, 0.62, 0.66, -0.11, g, 0.055); p2.rotation.set(-0.3, -0.2, -0.1);
    const p3 = B(0.34, 0.34, 0.12, M.sage, 0.3, 0.64, -0.13, g, 0.055); p3.rotation.set(-0.32, -0.05, 0.05);
    B(0.27, 0.05, 0.62, M.knit, 0.95, 0.672, 0.04, g, 0.024);           // throw over the right arm
    B(0.05, 0.4, 0.62, M.knit, 1.072, 0.49, 0.04, g, 0.024);
    blob(0, -HZ + 0.5, 2.5, 1.2, 0.55);

    // rug + coffee table
    const rug = add(new THREE.PlaneGeometry(2.7, 1.8), M.rug, 0, 0.004, -1.2, scene, false);
    rug.rotation.x = -Math.PI / 2;
    const t = group(0, 0, -1.02);
    C(0.46, 0.46, 0.045, M.walnut, 0, 0.43, 0, t, 48);
    C(0.42, 0.42, 0.02, M.walnut, 0, 0.11, 0, t, 40);
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.4; C(0.022, 0.016, 0.41, M.walnut, Math.cos(a) * 0.32, 0.205, Math.sin(a) * 0.32, t, 10); }
    blob(0, -1.02, 1.25, 1.25, 0.4, true);
    C(0.042, 0.038, 0.095, M.ceramicBlue, 0.16, 0.5, 0.1, t, 20);         // mug
    const handle = add(new THREE.TorusGeometry(0.026, 0.007, 8, 16), M.ceramicBlue, 0.205, 0.5, 0.1, t);
    handle.rotation.y = 0;
    B(0.25, 0.03, 0.18, M.books[3], -0.15, 0.468, -0.04, t, 0.004).rotation.y = 0.22;
    B(0.22, 0.026, 0.16, M.books[1], -0.15, 0.496, -0.04, t, 0.004).rotation.y = -0.08;
    B(0.19, 0.022, 0.14, M.books[4], -0.15, 0.52, -0.04, t, 0.004).rotation.y = 0.12;
    C(0.034, 0.034, 0.07, M.candle, 0.07, 0.488, -0.18, t, 18);
    candleFlame = glow(0.07, 0.545, -0.18, 0.09, 0xffa040, 0.9, t);
    glow(0.07, 0.54, -0.18, 0.5, 0xff8a30, 0.12, t);

    // floor lamp, left of the couch
    const lg = group(-1.45, 0, -2.15);
    C(0.15, 0.16, 0.025, M.black, 0, 0.0125, 0, lg, 32);
    C(0.012, 0.012, 1.47, M.brass, 0, 0.75, 0, lg, 10);
    C(0.17, 0.23, 0.3, M.shade, 0, 1.56, 0, lg, 40, true).castShadow = false;
    glow(0, 1.5, 0, 0.28, 0xffd29a, 0.9, lg);
    glow(0, 1.56, 0, 1.4, 0xff9a4a, 0.14, lg);
    lamp(-1.45, 1.5, -2.15, 5.5);
    blob(-1.45, -2.15, 0.5, 0.5, 0.5, true);

    // fiddle-leaf fig, right of the couch
    plant(1.5, -2.2, 1.25);
    // snake plant in the corner
    const sg = group(2.6, 0, -2.25);
    C(0.16, 0.13, 0.32, M.ceramic, 0, 0.16, 0, sg, 28);
    C(0.15, 0.15, 0.01, M.soil, 0, 0.31, 0, sg, 20);
    for (let i = 0; i < 11; i++) {
      const hgt = 0.45 + rnd() * 0.45;
      const l = new THREE.Mesh(new THREE.ConeGeometry(0.04, hgt, 5), pick(M.snake));
      l.scale.z = 0.32;
      const a = rnd() * TAU, r = rnd() * 0.08;
      l.position.set(Math.cos(a) * r, 0.31 + hgt / 2, Math.sin(a) * r);
      l.rotation.set((rnd() - 0.5) * 0.4, rnd() * TAU, (rnd() - 0.5) * 0.4);
      l.castShadow = true;
      sg.add(l);
    }
    blob(2.6, -2.25, 0.55, 0.55, 0.5, true);
  }

  function plant(x, z, height) {
    const g = group(x, 0, z);
    C(0.19, 0.15, 0.36, M.terracotta, 0, 0.18, 0, g, 32);
    C(0.2, 0.2, 0.04, M.terracotta, 0, 0.36, 0, g, 32);
    C(0.18, 0.18, 0.01, M.soil, 0, 0.375, 0, g, 24);
    C(0.018, 0.024, height, M.walnut, 0.02, 0.36 + height / 2, 0, g, 8);
    const leafGeo = new THREE.SphereGeometry(1, 12, 8);
    for (let i = 0; i < 34; i++) {
      const m = new THREE.Mesh(leafGeo, pick(M.leaves));
      const y = 0.36 + height * (0.35 + rnd() * 0.68), a = rnd() * TAU, r = 0.08 + rnd() * 0.24 * (1 - (y - 0.36) / (height * 1.6));
      m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      const s = 0.07 + rnd() * 0.05;
      m.scale.set(s * 0.8, s * 1.5, s * 0.1);
      m.rotation.order = 'YXZ';
      m.rotation.set(-0.5 - rnd() * 0.6, -a + Math.PI / 2, (rnd() - 0.5) * 0.6);
      m.castShadow = true;
      g.add(m);
    }
    blob(x, z, 0.7, 0.7, 0.5, true);
  }

  function bedArea() {
    const bx = HX - 1.08, bz = 0.2;
    B(2.12, 0.26, 1.72, M.walnut, bx, 0.21, bz, scene, 0.02);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(0.03, 0.03, 0.08, M.walnut, bx + sx * 0.98, 0.04, bz + sz * 0.78, scene, 10);
    B(0.08, 1.05, 1.82, M.headboard, HX - 0.05, 0.62, bz, scene, 0.04);
    for (let i = 0; i < 6; i++) B(0.06, 0.84, 0.29, M.headboard, HX - 0.11, 0.66, bz - 0.75 + i * 0.3, scene, 0.028);
    B(2.0, 0.24, 1.6, M.sheet, bx - 0.04, 0.46, bz, scene, 0.06);
    B(1.5, 0.3, 1.74, M.duvet, 1.6, 0.47, bz, scene, 0.08);
    B(0.2, 0.08, 1.7, M.sheet, 2.42, 0.6, bz, scene, 0.035);
    for (const s of [-1, 1]) {
      const p = B(0.16, 0.44, 0.68, M.sheet, HX - 0.27, 0.77, bz + s * 0.38, scene, 0.075);
      p.rotation.z = -0.5;
    }
    const c = B(0.12, 0.34, 0.46, M.mustard, HX - 0.46, 0.74, bz, scene, 0.055);
    c.rotation.z = -0.38;
    B(0.5, 0.33, 1.78, M.knitMustard, 1.15, 0.475, bz, scene, 0.06);    // throw across the foot
    blob(bx, bz, 2.5, 2.05, 0.55);
    nightstand(-0.95);
    nightstand(1.37);
    // fairy lights strung above the headboard
    const pts = [], z0 = -0.8, z1 = 1.2, swags = 3;
    for (let i = 0; i <= 90; i++) {
      const t = i / 90, z = z0 + (z1 - z0) * t, f = (t * swags) % 1;
      pts.push(new THREE.Vector3(HX - 0.03, 2.34 - 0.17 * Math.sin(Math.PI * f), z));
    }
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2a2018 }));
    scene.add(noPick(wire));
    for (let i = 2; i < pts.length - 1; i += 3) {
      const p = pts[i];
      add(new THREE.SphereGeometry(0.011, 8, 6), M.bulb, p.x - 0.01, p.y - 0.012, p.z, scene, false);
      glow(p.x - 0.02, p.y - 0.012, p.z, 0.11, 0xffc070, 0.75, scene, 1);
    }
    lamp(HX - 0.3, 2.15, 0.2, 1.1, 0xffc27a);
  }

  function nightstand(z) {
    const x = HX - 0.24, g = group(x, 0, z);
    B(0.42, 0.5, 0.44, M.oak, 0, 0.3, 0, g, 0.015);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(0.015, 0.012, 0.05, M.oak, sx * 0.17, 0.025, sz * 0.18, g, 8);
    B(0.012, 0.17, 0.38, M.oakLight, -0.214, 0.43, 0, g, 0.004);
    B(0.012, 0.17, 0.38, M.oakLight, -0.214, 0.22, 0, g, 0.004);
    S(0.012, M.brass, -0.225, 0.43, 0, g);
    S(0.012, M.brass, -0.225, 0.22, 0, g);
    S(0.075, M.ceramic, 0, 0.625, 0.04, g, 1, 1.1, 1);
    C(0.01, 0.01, 0.12, M.brass, 0, 0.74, 0.04, g, 8);
    C(0.095, 0.14, 0.17, M.shade, 0, 0.86, 0.04, g, 32, true).castShadow = false;
    glow(0, 0.83, 0.04, 0.2, 0xffd29a, 0.85, g);
    glow(0, 0.86, 0.04, 0.9, 0xff9a4a, 0.12, g);
    lamp(x, 0.83, z + 0.04, 1.8);
    B(0.2, 0.03, 0.15, pick(M.books), -0.05, 0.565, -0.12, g, 0.004).rotation.y = 0.3;
    blob(x, z, 0.6, 0.62, 0.45);
  }

  let screen = null;
  function deskArea() {
    const dx = -0.4, dz = HZ - 0.32;
    B(1.3, 0.035, 0.6, M.oak, dx, 0.74, dz, scene, 0.008);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.03, 0.72, 0.03, M.black, dx + sx * 0.6, 0.36, dz + sz * 0.26);
    B(1.2, 0.025, 0.02, M.black, dx, 0.12, dz + 0.26);
    // monitor showing the dev world: click it to go back to the universe
    const stand = [
      B(0.2, 0.012, 0.15, M.black, dx, 0.763, dz + 0.12, scene, 0.004),
      B(0.03, 0.2, 0.025, M.black, dx, 0.86, dz + 0.15),
      B(0.66, 0.4, 0.028, M.black, dx, 1.08, dz + 0.12, scene, 0.008),
    ];
    stand.forEach(m => { m.userData.action = 'universe'; });     // the whole monitor is the link
    screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.36), new THREE.MeshBasicMaterial({ map: screenTex(), toneMapped: false }));
    screen.position.set(dx, 1.085, dz + 0.105);
    screen.rotation.y = Math.PI;
    screen.userData.action = 'universe';
    scene.add(screen);
    glow(dx, 1.08, dz + 0.09, 1.1, 0x6a5cff, 0.08);
    B(0.4, 0.016, 0.13, M.keyboard, dx, 0.766, dz - 0.12, scene, 0.004);
    B(0.06, 0.02, 0.1, M.keyboard, dx + 0.3, 0.768, dz - 0.12, scene, 0.009);
    // sketchbooks, a pencil cup and a succulent
    B(0.24, 0.02, 0.3, M.books[7], dx - 0.47, 0.768, dz - 0.04, scene, 0.003).rotation.y = 0.1;
    B(0.22, 0.016, 0.28, M.books[0], dx - 0.47, 0.786, dz - 0.04, scene, 0.003).rotation.y = -0.06;
    B(0.21, 0.004, 0.27, M.paper, dx - 0.46, 0.797, dz - 0.05, scene, 0).rotation.y = 0.02;
    C(0.035, 0.032, 0.1, M.ceramic, dx - 0.5, 0.807, dz + 0.2, scene, 16);
    for (let i = 0; i < 5; i++) {
      const p = C(0.004, 0.004, 0.17, M.paints[i], dx - 0.5 + (rnd() - 0.5) * 0.03, 0.88, dz + 0.2 + (rnd() - 0.5) * 0.03, scene, 6);
      p.rotation.set((rnd() - 0.5) * 0.35, 0, (rnd() - 0.5) * 0.35);
    }
    const sp = group(dx - 0.33, 0.757, dz + 0.2);
    C(0.04, 0.032, 0.06, M.terracotta, 0, 0.03, 0, sp, 14);
    for (let i = 0; i < 9; i++) {
      const l = S(0.018, M.leaves[1], (rnd() - 0.5) * 0.04, 0.07, (rnd() - 0.5) * 0.04, sp, 0.6, 1.4, 0.6);
      l.rotation.set((rnd() - 0.5) * 1.2, 0, (rnd() - 0.5) * 1.2);
    }
    // desk lamp: base, two arms, head
    const lg = group(dx + 0.5, 0.757, dz + 0.12, 0.5);
    C(0.07, 0.08, 0.02, M.black, 0, 0.01, 0, lg, 24);
    const a1 = B(0.018, 0.36, 0.018, M.black, 0, 0.18, 0.04, lg); a1.rotation.x = -0.25;
    const a2 = B(0.018, 0.3, 0.018, M.black, 0, 0.38, -0.08, lg); a2.rotation.x = 1.05;
    const head = C(0.025, 0.075, 0.11, M.black, 0, 0.3, -0.2, lg, 24, true); head.rotation.x = -0.5;
    glow(0, 0.27, -0.22, 0.16, 0xffd29a, 0.9, lg);
    const dl = new THREE.SpotLight(0xffc27a, 5, 0, 0.8, 0.7, 2);
    dl.position.set(dx + 0.5 - 0.1, 0.757 + 0.29, dz + 0.02);
    dl.target.position.set(dx + 0.15, 0.75, dz - 0.15);
    scene.add(dl, dl.target);
    blob(dx, dz, 1.45, 0.75, 0.35);

    // chair, pulled out a little
    const ch = group(dx + 0.05, 0, dz - 0.66, 0.18);
    B(0.46, 0.045, 0.44, M.oak, 0, 0.455, 0, ch, 0.015);
    B(0.42, 0.04, 0.4, M.sage, 0, 0.495, 0, ch, 0.018);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(0.018, 0.014, 0.44, M.oak, sx * 0.19, 0.22, sz * 0.18, ch, 8);
    for (const sx of [-1, 1]) B(0.025, 0.5, 0.025, M.oak, sx * 0.19, 0.7, -0.2, ch);
    const back = B(0.44, 0.15, 0.025, M.oak, 0, 0.86, -0.205, ch, 0.01); back.rotation.x = -0.08;
    blob(dx + 0.05, dz - 0.66, 0.65, 0.65, 0.35, true);
  }

  function screenTex() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 600;
    const g = c.getContext('2d');
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const draw = img => {
      g.fillStyle = '#07070a'; g.fillRect(0, 0, 1024, 600);
      if (img) {
        const sw = img.width * 0.24, sh = sw * 600 / 1024;
        g.drawImage(img, img.width / 2 - sw / 2, img.height / 2 - sh * 0.62, sw, sh, 0, 0, 1024, 600);
      }
      const v = g.createLinearGradient(0, 0, 0, 600);
      v.addColorStop(0, 'rgba(7,7,10,0.1)'); v.addColorStop(0.55, 'rgba(7,7,10,0.25)'); v.addColorStop(1, 'rgba(7,7,10,0.92)');
      g.fillStyle = v; g.fillRect(0, 0, 1024, 600);
      g.fillStyle = 'rgba(13,13,11,0.9)'; g.fillRect(0, 0, 1024, 44);
      ['#ff5b1f', '#5a5750', '#5a5750'].forEach((col, i) => { g.fillStyle = col; g.fillRect(22 + i * 22, 16, 12, 12); });
      g.fillStyle = '#9a958a'; g.font = '500 20px "JetBrains Mono", ui-monospace, monospace';
      g.fillText('azri.b.aidir // universe', 104, 29);
      g.fillStyle = '#ebe7dd'; g.font = '800 76px Archivo, system-ui, sans-serif';
      g.fillText('DEV WORLD', 48, 482);
      g.fillStyle = '#ff5b1f'; g.font = '700 28px "JetBrains Mono", ui-monospace, monospace';
      g.fillText('▸ CLICK TO ENTER THE UNIVERSE', 52, 540);
      t.needsUpdate = true;
    };
    draw(null);
    const img = new Image();
    img.onload = () => (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => draw(img));
    img.src = 'assets/bg/universe-2k.webp';
    return t;
  }

  function dresserArea() {
    const rx = 1.45, rz = HZ - 0.24;
    B(1.25, 0.74, 0.46, M.walnut, rx, 0.45, rz, scene, 0.015);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(0.022, 0.015, 0.08, M.walnut, rx + sx * 0.57, 0.04, rz + sz * 0.19, scene, 8);
    for (let row = 0; row < 3; row++) for (const sx of [-1, 1]) {
      const y = 0.2 + row * 0.235;
      B(0.59, 0.21, 0.012, M.walnutLight, rx + sx * 0.305, y, rz - 0.232, scene, 0.005);
      S(0.013, M.brass, rx + sx * 0.305, y, rz - 0.245);
    }
    // on top: a trailing pothos, books, a candle jar
    const pg = group(rx - 0.42, 0.82, rz - 0.02);
    C(0.085, 0.065, 0.13, M.ceramic, 0, 0.065, 0, pg, 20);
    const leaf = new THREE.SphereGeometry(1, 10, 6);
    for (let v = 0; v < 6; v++) {
      const a = -Math.PI / 2 + (v - 2.5) * 0.45, len = 6 + Math.floor(rnd() * 8);
      for (let k = 0; k < len; k++) {
        const out = Math.min(0.1 + k * 0.03, 0.2), y = 0.13 - Math.max(0, k - 3) * 0.045;
        const m = new THREE.Mesh(leaf, pick(M.leaves));
        m.position.set(Math.cos(a) * out + (rnd() - 0.5) * 0.03, y, Math.sin(a) * out * 0.9 - (k > 3 ? 0.04 : 0));
        m.scale.set(0.035, 0.03, 0.01);
        m.rotation.set(rnd() * 2, rnd() * TAU, rnd());
        m.castShadow = true;
        pg.add(m);
      }
    }
    B(0.2, 0.04, 0.15, M.books[2], rx + 0.1, 0.84, rz, scene, 0.004).rotation.y = -0.1;
    B(0.18, 0.035, 0.14, M.books[8], rx + 0.1, 0.877, rz, scene, 0.004).rotation.y = 0.12;
    S(0.035, M.brass, rx + 0.1, 0.93, rz);
    C(0.045, 0.045, 0.09, M.ceramicBlue, rx + 0.42, 0.865, rz - 0.04, scene, 20);
    glow(rx + 0.42, 0.92, rz - 0.04, 0.08, 0xffa040, 0.85);
    glow(rx + 0.42, 0.92, rz - 0.04, 0.45, 0xff8a30, 0.1);
    blob(rx, rz, 1.45, 0.65, 0.45);
  }

  function bookshelf() {
    const x = -HX + 0.175, z = -1.95, w = 0.95, h = 1.9, d = 0.34;
    for (const s of [-1, 1]) B(d, h, 0.025, M.walnut, x, h / 2, z + s * (w / 2 - 0.0125));
    B(0.015, h, w, M.walnut, -HX + 0.0125, h / 2, z);
    const shelves = [0.06, 0.43, 0.8, 1.17, 1.54, h - 0.0125];
    shelves.forEach(y => B(d, 0.025, w - 0.05, M.walnut, x, y, z));
    const unit = new THREE.BoxGeometry(1, 1, 1), front = x + d / 2 - 0.015;
    for (let si = 0; si < shelves.length - 1; si++) {
      const y0 = shelves[si] + 0.0125, room = shelves[si + 1] - shelves[si] - 0.04;
      let zc = z - w / 2 + 0.04;
      const zEnd = z + w / 2 - 0.04;
      while (zc < zEnd - 0.03) {
        const r = rnd();
        if (r < 0.1) { zc += 0.06 + rnd() * 0.08; continue; }                   // a gap
        if (r < 0.2 && zEnd - zc > 0.2) {                                       // a little object
          if (rnd() < 0.5) {
            C(0.045, 0.035, 0.07, M.terracotta, front - 0.12, y0 + 0.035, zc + 0.06, scene, 14);
            S(0.06, pick(M.leaves), front - 0.12, y0 + 0.11, zc + 0.06, scene, 1, 0.8, 1);
          } else {
            S(0.045, pick([M.ceramic, M.ceramicBlue, M.brass]), front - 0.12, y0 + 0.07, zc + 0.06, scene, 0.8, 1.5, 0.8);
          }
          zc += 0.14; continue;
        }
        if (r < 0.3 && zEnd - zc > 0.25) {                                      // a stack lying flat
          let yy = y0;
          for (let k = 0; k < 3 + Math.floor(rnd() * 3); k++) {
            const bh = 0.025 + rnd() * 0.02, bw = 0.17 + rnd() * 0.06;
            const m = new THREE.Mesh(unit, pick(M.books));
            m.scale.set(0.2 + rnd() * 0.04, bh, bw);
            m.position.set(front - 0.11, yy + bh / 2, zc + 0.12);
            m.rotation.y = (rnd() - 0.5) * 0.2;
            m.castShadow = m.receiveShadow = true;
            scene.add(m);
            yy += bh;
          }
          zc += 0.25; continue;
        }
        const t = 0.022 + rnd() * 0.035, bh = Math.min(room, 0.18 + rnd() * 0.12), dep = 0.16 + rnd() * 0.07;
        const m = new THREE.Mesh(unit, pick(M.books));
        m.scale.set(dep, bh, t);
        m.position.set(front - dep / 2, y0 + bh / 2, zc + t / 2);
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
        zc += t + 0.002;
      }
    }
    blob(x, z, 0.6, 1.2, 0.5);
  }

  let easel = null;
  function easelArea() {
    const ex = -2.2, ez = 1.55, ry = Math.atan2(HOME.x - ex, HOME.z - ez) - 0.12;
    easel = group(ex, 0, ez, ry);
    for (const s of [-1, 1]) {
      const l = B(0.034, 1.72, 0.03, M.oakLight, s * 0.17, 0.85, 0.09, easel, 0.006);
      l.rotation.z = -s * 0.15; l.rotation.x = -0.09;
    }
    const back = B(0.034, 1.62, 0.03, M.oakLight, 0, 0.78, -0.27, easel, 0.006);
    back.rotation.x = 0.34;
    const mast = B(0.04, 1.85, 0.032, M.oakLight, 0, 0.95, 0.03, easel, 0.006);
    mast.rotation.x = -0.1;
    B(0.7, 0.03, 0.085, M.oakLight, 0, 0.86, 0.12, easel, 0.006);
    blob(ex, ez, 0.85, 0.85, 0.4, true);
    // stool with a palette and a jar of brushes
    const st = group(ex + 0.5, 0, ez + 0.42, 0.4);
    C(0.17, 0.17, 0.035, M.oak, 0, 0.6, 0, st, 28);
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3, l = C(0.016, 0.014, 0.6, M.oak, Math.cos(a) * 0.12, 0.3, Math.sin(a) * 0.12, st, 8);
      l.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    }
    C(0.12, 0.12, 0.008, M.oakLight, -0.03, 0.622, 0, st, 28);
    M.paints.forEach((p, i) => {
      const a = i / M.paints.length * Math.PI * 1.4 - 0.4;
      S(0.017, p, -0.03 + Math.cos(a) * 0.08, 0.628, Math.sin(a) * 0.08, st, 1, 0.35, 1);
    });
    C(0.035, 0.032, 0.09, M.glass, 0.09, 0.662, 0.06, st, 14);
    for (let i = 0; i < 4; i++) {
      const b = C(0.004, 0.003, 0.2, M.oak, 0.09 + (rnd() - 0.5) * 0.02, 0.73, 0.06 + (rnd() - 0.5) * 0.02, st, 6);
      b.rotation.set((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4);
    }
    blob(ex + 0.5, ez + 0.42, 0.45, 0.45, 0.4, true);
  }

  function lantern() {
    C(0.004, 0.004, H - LANTERN.y - 0.2, M.black, LANTERN.x, (H + LANTERN.y + 0.2) / 2, LANTERN.z, scene, 6);
    C(0.04, 0.04, 0.015, M.trim, LANTERN.x, H - 0.008, LANTERN.z, scene, 16);
    const l = S(0.24, M.lantern, LANTERN.x, LANTERN.y, LANTERN.z, scene, 1, 0.86, 1);
    l.castShadow = false;
    glow(LANTERN.x, LANTERN.y, LANTERN.z, 1.5, 0xff9e52, 0.16);
  }

  let candleFlame = null;
  shell();
  windowAndCurtains();
  couchArea();
  bedArea();
  deskArea();
  dresserArea();
  bookshelf();
  easelArea();
  lantern();

  // ---------- frames ----------
  const frameMats = {};
  for (const [k, s] of Object.entries(FRAME_STYLES)) frameMats[k] = std(s.color, { roughness: s.rough, metalness: s.metal || 0, map: s.metal ? null : woodTex });
  const shadowMat = new THREE.MeshBasicMaterial({ map: rectShadowTex, transparent: true, opacity: 0.5, depthWrite: false });
  const washMat = new THREE.MeshBasicMaterial({ map: washTex, color: 0xffc27a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });

  const slots = SLOTS.map((s, i) => {
    let g;
    if (s.easel) {
      g = new THREE.Group();
      g.position.set(0, 0.875, 0.14);
      g.rotation.x = -0.1;
      easel.add(g);
    } else {
      const P = { n: [s.u, -HZ, 0], s: [s.u, HZ, Math.PI], e: [HX, s.u, -Math.PI / 2], w: [-HX, s.u, Math.PI / 2] }[s.wall];
      g = group(P[0], s.y, P[1], P[2]);
    }
    return { def: s, g, w: s.w, h: s.h, cy: 0, art: null, artMesh: null, glowAmt: 0 };
  });

  function placeholderTex(aspect) {
    const h = 512, w = Math.round(h * aspect);
    return tex(w, h, (g) => {
      g.fillStyle = '#efe8da'; g.fillRect(0, 0, w, h);
      grain(g, w, h, 10);
      g.strokeStyle = 'rgba(90,80,64,0.35)'; g.lineWidth = 2; g.setLineDash([10, 8]);
      g.strokeRect(24, 24, w - 48, h - 48);
      g.setLineDash([]);
      g.fillStyle = 'rgba(90,80,64,0.55)'; g.textAlign = 'center';
      g.font = `600 ${Math.round(Math.min(w, h) * 0.075)}px "JetBrains Mono", ui-monospace, monospace`;
      g.fillText('ART', w / 2, h / 2 - 6);
      g.font = `500 ${Math.round(Math.min(w, h) * 0.05)}px "JetBrains Mono", ui-monospace, monospace`;
      g.fillText('coming soon', w / 2, h / 2 + Math.min(w, h) * 0.08);
    });
  }

  function clearGroup(g) {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const o = g.children[i];
      g.remove(o);
      o.traverse(n => { if (n.geometry) n.geometry.dispose(); });
    }
  }

  // build one frame; texture null = empty placeholder. aspect = width / height of the art.
  function buildFrame(i, texture, aspect) {
    const slot = slots[i], s = slot.def, g = slot.g;
    clearGroup(g);
    let aw, ah;
    const fit = (bw, bh) => {
      aw = bw; ah = bh;
      if (aspect) { if (aw / ah > aspect) aw = ah * aspect; else ah = aw / aspect; }
    };
    const artMat = new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.3, roughness: 0.6 });
    if (s.easel) {                                     // a stretched canvas, no frame
      fit(s.w, s.h);
      const side = M.canvasEdge;
      const cv = add(new THREE.BoxGeometry(aw, ah, 0.024), [side, side, side, side, artMat, side], 0, ah / 2, 0, g);
      slot.artMesh = cv;
      B(0.08, 0.04, 0.05, M.oakLight, 0, ah + 0.01, -0.01, g, 0.006);   // top clamp
      slot.w = aw; slot.h = ah; slot.cy = ah / 2;
    } else {
      const st = FRAME_STYLES[s.style], fw = st.width, dep = 0.035, mat = Math.min(s.w, s.h) * 0.11;
      fit(s.w - 2 * (fw + mat), s.h - 2 * (fw + mat));
      const OW = aw + 2 * (fw + mat), OH = ah + 2 * (fw + mat);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(OW + 0.16, OH + 0.16), shadowMat);
      sh.position.set(0.0, -0.03, 0.002);
      g.add(noPick(sh));                               // a decal: shouldn't enlarge the click area
      B(OW - fw, OH - fw, 0.01, M.matBoard, 0, 0, 0.008, g, 0, false);
      const fm = frameMats[s.style];
      B(OW, fw, dep, fm, 0, OH / 2 - fw / 2, dep / 2, g, 0.004, false);
      B(OW, fw, dep, fm, 0, -OH / 2 + fw / 2, dep / 2, g, 0.004, false);
      B(fw, OH - 2 * fw + 0.002, dep, fm, -OW / 2 + fw / 2, 0, dep / 2, g, 0.004, false);
      B(fw, OH - 2 * fw + 0.002, dep, fm, OW / 2 - fw / 2, 0, dep / 2, g, 0.004, false);
      const am = new THREE.Mesh(new THREE.PlaneGeometry(aw, ah), artMat);
      am.position.z = 0.0145;
      am.receiveShadow = true;
      g.add(am);
      slot.artMesh = am;
      if (s.light) {                                   // brass picture light washing the art
        const by = OH / 2 + 0.075;
        const barGeo = new THREE.CylinderGeometry(0.014, 0.014, Math.max(0.3, OW * 0.55), 16);
        const bar = add(barGeo, M.brass, 0, by, 0.12, g, false);
        bar.rotation.z = Math.PI / 2;
        B(0.014, 0.014, 0.12, M.brass, 0, by, 0.06, g, 0, false);
        B(0.04, 0.03, 0.012, M.brass, 0, by - 0.005, 0.006, g, 0, false);
        const wash = new THREE.Mesh(new THREE.PlaneGeometry(OW * 1.9, OH * 1.6), washMat);
        wash.position.set(0, by - OH * 0.75, 0.0045);
        g.add(noPick(wash));
        artMat.emissiveIntensity = 0.42;
      }
      slot.w = OW; slot.h = OH; slot.cy = 0;
    }
    slot.baseGlow = artMat.emissiveIntensity;
    g.traverse(o => { o.userData.slot = i; });
    renderer.shadowMap.needsUpdate = true;
  }

  // the artwork area of a frame slot, before the frame shrinks to fit a piece
  function innerSize(s) {
    if (s.easel) return [s.w, s.h];
    const edge = 2 * (FRAME_STYLES[s.style].width + Math.min(s.w, s.h) * 0.11);
    return [s.w - edge, s.h - edge];
  }
  slots.forEach((slot, i) => {
    const [w, h] = innerSize(slot.def);
    buildFrame(i, placeholderTex(w / h), null);
  });

  // Which piece hangs where. "frame": n in art.json pins a piece to frame n; the rest go, in list
  // order, to the free frame whose shape is closest to theirs (so wide pieces land in wide frames).
  function hang(items) {
    const taken = new Set(), rest = [];
    items.forEach(it => {
      const f = Number(it.a.frame) - 1;
      if (Number.isInteger(f) && f >= 0 && f < slots.length && !taken.has(f)) { taken.add(f); it.slot = f; }
      else rest.push(it);
    });
    rest.forEach(it => {
      let best = -1, bd = Infinity;
      slots.forEach((s, i) => {
        if (taken.has(i)) return;
        const [w, h] = innerSize(s.def), d = Math.abs(Math.log(w / h / it.aspect));
        if (d < bd - 1e-6) { bd = d; best = i; }
      });
      if (best >= 0) { taken.add(best); it.slot = best; }
    });
  }

  let artList = [];
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      try { if (new URL(src, location.href).origin !== location.origin) img.crossOrigin = 'anonymous'; } catch (e) {}
      img.decoding = 'async';
      img.onload = () => res(img); img.onerror = () => rej(new Error('Could not load ' + src));
      img.src = src;
    });
  }
  Promise.resolve(art).then(list => {
    artList = Array.isArray(list) ? list : [];
    // the smaller "thumb" copy is plenty for a frame; "file" (full size) is for the lightbox
    return Promise.all(artList.map(a => loadImage(a.thumb || a.file).then(
      img => ({ a, img, aspect: img.naturalWidth / img.naturalHeight }),
      err => { console.warn('art room:', err.message); return null; })));
  }).then(items => {
    items = items.filter(Boolean);
    hang(items);
    items.forEach(({ a, img, slot }) => {
      if (slot == null) return;          // more pieces than frames: still in the gallery + full-size view
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = ANISO;
      slots[slot].art = a;
      buildFrame(slot, t, c.width / c.height);
    });
    buildHud();
    activeHud = -1;                      // refresh the "now viewing" title
    if (focused != null) showLabel(focused);
  });

  // ---------- HUD: one button per frame ----------
  function buildHud() {
    framesEl.innerHTML = '';
    slots.forEach((slot, i) => {
      const a = slot.art;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = pad(i + 1);
      b.className = a ? '' : 'empty';
      b.title = a ? (a.title || 'Untitled') : 'Empty frame';
      b.setAttribute('aria-label', a ? `Go to frame ${i + 1}: ${a.title || 'Untitled'}` : `Go to frame ${i + 1} (empty)`);
      b.addEventListener('click', () => focusSlot(i));
      framesEl.appendChild(b);
    });
  }
  buildHud();

  // ---------- museum label for the frame you walked up to ----------
  const L = {
    no: labelEl.querySelector('.rl-no'), title: labelEl.querySelector('.rl-title'),
    meta: labelEl.querySelector('.rl-meta'), note: labelEl.querySelector('.rl-note'), full: labelEl.querySelector('.rl-full'),
  };
  function showLabel(i) {
    const a = slots[i].art, s = slots[i].def;
    L.no.textContent = `${pad(i + 1)} / ${pad(slots.length)} · ${s.where}`;
    L.title.textContent = a ? (a.title || 'Untitled') : 'Empty frame';
    L.meta.textContent = a ? [a.category, a.year, a.medium, a.size].filter(Boolean).join(' · ') : 'Artwork coming soon';
    L.note.textContent = a ? (a.note || '') : '';
    L.note.hidden = !L.note.textContent;
    L.full.hidden = !a;
    labelEl.hidden = false;
  }
  labelEl.querySelector('.rl-back').addEventListener('click', () => stepBack());
  labelEl.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => step(Number(b.dataset.step))));
  L.full.addEventListener('click', () => openFull(focused));
  function openFull(i) {
    const a = i != null && slots[i].art;
    if (!a || !lightbox) return;
    // the viewer steps through every piece; the camera follows to whichever frame holds it
    lightbox.open(artList, artList.indexOf(a), {
      onChange: j => { const s = slots.findIndex(sl => sl.art === artList[j]); if (s >= 0) focusSlot(s, true); },
    });
  }

  // ---------- camera: look around, walk up to frames ----------
  const camPos = HOME.clone();
  const view = { yaw: 0, pitch: -0.1, zoom: 1 };   // zoom multiplies the field of view (1 = normal)
  const vel = { yaw: 0, pitch: 0 };
  let anim = null, focused = null, drag = null, suppressClick = false, running = false;

  function lookAt(from, to) {
    const d = to.clone().sub(from);
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
  }
  function moveTo(pos, yaw, pitch, dur = 1200, done, zoom = 1) {
    anim = { p0: camPos.clone(), p1: pos.clone(), y0: view.yaw, dy: wrapAngle(yaw - view.yaw), x0: view.pitch, dx: pitch - view.pitch,
             z0: view.zoom, dz: zoom - view.zoom, t0: performance.now(), dur: reduceMotion ? 1 : dur, done };
    vel.yaw = vel.pitch = 0;
  }
  function slotCentre(i) {
    const slot = slots[i];
    slot.g.updateMatrixWorld(true);
    const c = slot.g.localToWorld(new THREE.Vector3(0, slot.cy, 0));
    const n = new THREE.Vector3(0, 0, 1).transformDirection(slot.g.matrixWorld);
    n.y = 0; n.normalize();
    return { c, n };
  }
  function focusSlot(i, keepLightbox) {
    if (!slots[i] || diving) return;
    const slot = slots[i], { c, n } = slotCentre(i);
    const v = baseFov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    const dist = clamp(Math.max((slot.h / 0.46) / (2 * Math.tan(v / 2)), (slot.w / 0.55) / (2 * Math.tan(hf / 2))), 0.9, 2.3);
    const pos = c.clone().addScaledVector(n, dist);
    pos.x = clamp(pos.x, -HX + 0.35, HX - 0.35);
    pos.z = clamp(pos.z, -HZ + 0.35, HZ - 0.35);
    pos.y = clamp(c.y, 1.2, 1.7);
    const { yaw, pitch } = lookAt(pos, c);
    focused = i;
    showLabel(i);
    hideHint();
    if (!keepLightbox && lightbox && lightbox.isOpen()) lightbox.close();
    moveTo(pos, yaw, pitch, 1300);
  }
  function stepBack() {
    if (focused == null) return;
    const { c } = slotCentre(focused);
    const { yaw, pitch } = lookAt(HOME, c);
    focused = null;
    labelEl.hidden = true;
    moveTo(HOME, yaw, clamp(pitch, -0.2, 0.25), 1100);
  }
  function step(dir) {
    const from = focused != null ? focused : nearestSlot();
    focusSlot((from + (focused != null ? dir : 0) + slots.length) % slots.length);
  }
  function nearestSlot() {
    const f = new THREE.Vector3(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    let best = 0, bd = -Infinity;
    slots.forEach((s, i) => {
      const d = slotCentre(i).c.sub(camPos).setY(0).normalize().dot(f);
      if (d > bd) { bd = d; best = i; }
    });
    return best;
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  ray.camera = camera;
  const ndc = new THREE.Vector2();
  let pointer = null, hoverSlot = null, hoverAction = null, needPick = false;
  function pickAt(x, y) {
    const r = host.getBoundingClientRect();
    ndc.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(scene.children, true)[0];
    if (!hit) return {};
    return { slot: hit.object.userData.slot, action: hit.object.userData.action };
  }
  function updateHover() {
    if (!pointer || drag || anim || diving || leftViaScreen) { setHover(null, null); return; }
    const { slot, action } = pickAt(pointer.x, pointer.y);
    setHover(slot ?? null, action || null);
  }
  function setHover(slot, action) {
    hoverSlot = slot; hoverAction = action;
    const on = slot != null || action;
    host.classList.toggle('pointing', !!on);
    if (!on || touch) { tipEl.hidden = true; return; }
    const a = slot != null ? slots[slot].art : null;
    tipEl.textContent = action === 'universe' ? '▸ Back to the universe'
      : `${pad(slot + 1)} · ${a ? (a.title || 'Untitled') : 'Empty frame'}${focused === slot && a ? ' · full size ⤢' : ''}`;
    tipEl.hidden = false;
    tipEl.style.transform = `translate(${pointer.x + 16}px, ${pointer.y + 14}px)`;
  }
  function activate(slot, action) {
    if (action === 'universe') { diveIntoScreen(); return; }
    if (slot == null) return;
    if (focused === slot) openFull(slot);
    else focusSlot(slot);
  }

  // ---------- leaving through the monitor ----------
  // The camera flies into the desk monitor until its screen (which shows the universe) fills the
  // view, then hands over; the page flashes and the universe zooms back out of that same view.
  let diving = false, leftViaScreen = false;
  function diveIntoScreen() {
    if (diving || !screen) return;
    diving = true;
    if (lightbox && lightbox.isOpen()) lightbox.close();
    focused = null;
    labelEl.hidden = true;
    setHover(null, null);
    hideHint();
    screen.updateMatrixWorld(true);
    const c = screen.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
    const v = baseFov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    const d = Math.min(0.18 / Math.tan(v / 2), 0.31 / Math.tan(hf / 2)) * 0.85;   // the 0.62 × 0.36 m screen overfills the view
    const pos = c.clone().addScaledVector(n, d);
    const { yaw, pitch } = lookAt(pos, c);
    moveTo(pos, yaw, pitch, 1500, () => {
      diving = false;
      leftViaScreen = true;
      if (onUniverse) onUniverse();
    });
  }

  // ---------- input ----------
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || diving) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, last: performance.now(), captured: false };
    suppressClick = false;
  });
  el.addEventListener('pointermove', e => {
    pointer = { x: e.clientX, y: e.clientY };
    needPick = true;
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (!drag.captured) {
      if (drag.moved < 6) return;
      el.setPointerCapture(e.pointerId);
      drag.captured = suppressClick = true;
      host.classList.add('dragging');
      anim = null;
      hideHint();
    }
    const k = (camera.fov * Math.PI / 180) / host.clientHeight, now = performance.now(), dt = Math.max(8, now - drag.last) / 1000;
    view.yaw = wrapAngle(view.yaw + dx * k);
    view.pitch = clamp(view.pitch + dy * k, -1.2, 1.2);
    vel.yaw = vel.yaw * 0.5 + (dx * k / dt) * 0.5;
    vel.pitch = vel.pitch * 0.5 + (dy * k / dt) * 0.5;
    drag.last = now;
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.captured && e.type === 'pointerup') {
      const { slot, action } = pickAt(e.clientX, e.clientY);
      if (slot != null || action) activate(slot, action);
      else if (focused != null) stepBack();
    }
    if (drag.captured && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (performance.now() - drag.last > 90) vel.yaw = vel.pitch = 0;
    host.classList.remove('dragging');
    drag = null;
    needPick = true;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('pointerleave', () => { pointer = null; setHover(null, null); });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (diving) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1;
    const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
    anim = null; vel.yaw = vel.pitch = 0;
    view.yaw = wrapAngle(view.yaw - d * 0.0016);
    hideHint();
  }, { passive: false });
  addEventListener('keydown', e => {
    if (!running || diving || (lightbox && lightbox.isOpen()) || e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') { stepBack(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); }
  });

  // ---------- hint ----------
  let hintTimer = 0;
  function showHint(text, ms) {
    hintEl.querySelector('span').textContent = text;
    hintEl.classList.remove('gone');
    clearTimeout(hintTimer);
    if (ms) hintTimer = setTimeout(hideHint, ms);
  }
  function hideHint() { hintEl.classList.add('gone'); }

  // ---------- frame loop ----------
  function resize() {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    baseFov = w < h ? 82 : 70;
    camera.fov = baseFov * view.zoom;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', () => { if (running) resize(); });

  let last = performance.now(), activeHud = -1, baseFov = 70;
  const t0 = last;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000), t = (now - t0) / 1000;
    last = now;
    if (anim && anim.wait) { anim.wait--; anim.t0 = now; }
    if (anim) {
      const a = clamp((now - anim.t0) / anim.dur, 0, 1), e = easeInOut(a);
      camPos.lerpVectors(anim.p0, anim.p1, e);
      view.yaw = wrapAngle(anim.y0 + anim.dy * e);
      view.pitch = anim.x0 + anim.dx * e;
      view.zoom = anim.z0 + anim.dz * e;
      if (a >= 1) { const done = anim.done; anim = null; needPick = true; if (done) done(); }
    } else if (!drag && Math.abs(vel.yaw) + Math.abs(vel.pitch) > 0.002) {
      view.yaw = wrapAngle(view.yaw + vel.yaw * dt);
      view.pitch = clamp(view.pitch + vel.pitch * dt, -1.2, 1.2);
      const f = Math.exp(-dt * 4);
      vel.yaw *= f; vel.pitch *= f;
      needPick = true;
    }
    if (!anim && view.zoom !== 1) {                  // an arrival zoom cut short by a drag: settle back
      view.zoom += (1 - view.zoom) * Math.min(1, dt * 5);
      if (Math.abs(1 - view.zoom) < 0.002) view.zoom = 1;
    }
    camera.position.copy(camPos);
    camera.rotation.set(view.pitch, view.yaw, 0);
    const fov = baseFov * view.zoom;
    if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }

    if (!reduceMotion) {
      for (const gl of glows) {
        if (!gl.twinkle) continue;
        const k = 0.75 + 0.25 * Math.sin(t * 2.2 + gl.phase) * Math.sin(t * 0.7 + gl.phase * 2);
        gl.s.material.opacity = gl.base * k;
      }
      if (candleFlame) {
        const f = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3 + 1);
        candleFlame.scale.set(0.08 * f, 0.1 * f, 1);
      }
    }
    if (needPick) { needPick = false; updateHover(); }
    slots.forEach((s, i) => {                        // hovered frame brightens a little
      if (!s.artMesh) return;
      s.glowAmt += ((hoverSlot === i ? 1 : 0) - s.glowAmt) * 0.15;
      const mats = Array.isArray(s.artMesh.material) ? [s.artMesh.material[4]] : [s.artMesh.material];
      mats.forEach(m => { m.emissiveIntensity = s.baseGlow + 0.25 * s.glowAmt; });
    });
    const act = focused != null ? focused : nearestSlot();
    if (act !== activeHud) {
      activeHud = act;
      [...framesEl.children].forEach((b, i) => b.classList.toggle('active', i === act));
      const a = slots[act].art;
      nowEl.textContent = `${pad(act + 1)} · ${a ? (a.title || 'Untitled') : 'Empty frame'}`;
    }
    renderer.render(scene, camera);
    if (!host.classList.contains('ready')) host.classList.add('ready');
  }

  renderer.shadowMap.needsUpdate = true;
  let shownHint = false;
  return {
    // opts.arrive === 'lantern': coming from the universe's core, so open looking into the paper
    // lantern (zoomed right in, filling the view) and pull back to the usual view of the couch
    start(opts = {}) {
      if (running) return;
      running = true;
      if (leftViaScreen) {                         // last left through the monitor: arrive fresh, facing the gallery
        leftViaScreen = false;
        anim = null;
        camPos.copy(HOME);
        view.yaw = 0; view.pitch = -0.1;
        vel.yaw = vel.pitch = 0;
        activeHud = -1;
      }
      if (opts.arrive === 'lantern' && !reduceMotion) {
        focused = null;
        labelEl.hidden = true;
        camPos.copy(HOME);
        vel.yaw = vel.pitch = 0;
        const { yaw, pitch } = lookAt(HOME, LANTERN);
        view.yaw = yaw; view.pitch = pitch; view.zoom = 0.22;
        moveTo(HOME, 0, -0.1, 1900, null, 1);
        anim.wait = 2;          // start the clock once frames are really drawing (the first compiles shaders)
      }
      resize();
      last = performance.now();
      renderer.setAnimationLoop(loop);
      if (!shownHint) {
        shownHint = true;
        showHint(touch ? 'Swipe to look around · Tap a frame' : 'Drag to look around · Click a frame · ← → to browse', 9000);
      }
    },
    stop() {
      if (!running) return;
      running = false;
      if (diving) { diving = false; anim = null; }   // switched away mid-flight: don't hand over later
      renderer.setAnimationLoop(null);
      setHover(null, null);
      if (lightbox && lightbox.isOpen()) lightbox.close();
    },
    leaveViaScreen: diveIntoScreen,
  };
}
