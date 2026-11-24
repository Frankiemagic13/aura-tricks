/* Cube Mirror – realistic 3D photo renderer (three.js). Used by cube/ and cube/view/. */
/* ---------- realistic photo renderer (three.js, WebGL) ---------- */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const W = 1080, H = 1440;
const STICKER = { U:'#f3f3ee', D:'#ffd200', F:'#009b48', B:'#0046ad', R:'#c41230', L:'#ff6a00' };
const LOCAL_N = { F:[0,0,1], B:[0,0,-1], R:[1,0,0], L:[-1,0,0], U:[0,1,0], D:[0,-1,0] };   // three.js: y up
const STK_ROT = { F:[0,0], B:[0,Math.PI], R:[0,Math.PI/2], L:[0,-Math.PI/2], U:[-Math.PI/2,0], D:[Math.PI/2,0] };

function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function valueNoise(seed){
  const r = rng(seed), N = 256, g = new Float32Array(N*N); for (let i=0;i<g.length;i++) g[i] = r();
  const at = (x,y) => g[((y & 255) << 8) | (x & 255)];
  return (x,y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x-xi, yf = y-yi;
    const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf);
    const a = at(xi,yi), b = at(xi+1,yi), c = at(xi,yi+1), d = at(xi+1,yi+1);
    return a + (b-a)*u + (c-a)*v + (a-b-c+d)*u*v; };
}

const texCache = {};
function tableTexture(kind){
  if (texCache[kind]) return texCache[kind];
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
  const n = valueNoise(7), n2 = valueNoise(99);
  for (let y=0; y<S; y++) for (let x=0; x<S; x++){
    let r, g, b;
    if (kind === 'wood'){
      const plank = Math.floor(y / (S/4)), py = y % (S/4);
      const warp = n(x*0.004 + plank*31, py*0.02)*5 + n(x*0.02, py*0.08)*0.8;
      const ring = py*0.09 + warp*3;
      const f = ring - Math.floor(ring);
      const grain = Math.pow(Math.abs(Math.sin(f*Math.PI)), 6);
      const tone = 0.86 + n(x*0.002+plank*7, plank*3.1)*0.18 + (n2(x*0.9, y*0.9)-.5)*0.06;
      const k = tone * (1 - grain*0.16);
      r = 150*k; g = 101*k; b = 64*k;
      const eg = Math.min(py, S/4 - 1 - py);                                  // soft gap between planks
      if (eg < 7) { const q = 0.6 + 0.4 * (eg / 7); r *= q; g *= q; b *= q; }
    } else if (kind === 'dark'){
      const k = 0.9 + (n2(x*0.7, y*0.7)-.5)*0.25 + n(x*0.01,y*0.01)*0.08;
      r = 34*k; g = 35*k; b = 38*k;
    } else {
      const k = 0.94 + (n2(x*0.7, y*0.7)-.5)*0.06 + n(x*0.006,y*0.006)*0.05;
      r = 236*k; g = 233*k; b = 227*k;
    }
    const i = (y*S + x)*4; d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.repeat.set(kind === 'wood' ? 22.5 : 25, kind === 'wood' ? 22.5 : 25);
  return texCache[kind] = t;
}
function contactShadowTexture(){
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
  const g = c.createRadialGradient(128,128,10,128,128,128);
  g.addColorStop(0,'rgba(0,0,0,.85)'); g.addColorStop(.45,'rgba(0,0,0,.45)'); g.addColorStop(1,'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(cv);
}
function stickerShape(s, r){
  const h = s/2, sh = new THREE.Shape();
  sh.moveTo(-h+r,-h); sh.lineTo(h-r,-h); sh.quadraticCurveTo(h,-h,h,-h+r); sh.lineTo(h,h-r); sh.quadraticCurveTo(h,h,h-r,h);
  sh.lineTo(-h+r,h); sh.quadraticCurveTo(-h,h,-h,h-r); sh.lineTo(-h,-h+r); sh.quadraticCurveTo(-h,-h,-h+r,-h);
  return sh;
}

let renderer = null, env = null;
const bodyGeo = new RoundedBoxGeometry(0.975, 0.975, 0.975, 4, 0.085);
const stkGeo = new THREE.ShapeGeometry(stickerShape(0.84, 0.11), 6);
const bodyMat = new THREE.MeshPhysicalMaterial({ color:'#121212', roughness:0.42, clearcoat:0.25, clearcoatRoughness:0.5 });
const stkMats = {};
for (const f in STICKER) stkMats[f] = new THREE.MeshPhysicalMaterial({ color:STICKER[f], roughness:0.4, clearcoat:0.35, clearcoatRoughness:0.35, envMapIntensity:0.45 });

function setup(){
  if (renderer) return;
  const cv = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas:cv, antialias:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  const pm = new THREE.PMREMGenerator(renderer);
  env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
}

function buildScene(state, kind, r){
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.background = new THREE.Color(kind === 'white' ? '#cfcac2' : kind === 'dark' ? '#111214' : '#3a2617');
  scene.fog = new THREE.Fog(scene.background, 30, 90);
  // table
  const table = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ map:tableTexture(kind), roughness: kind==='wood' ? 0.58 : 0.8, envMapIntensity: kind==='wood' ? 0.5 : 0.3 }));
  table.rotation.x = -Math.PI/2; table.rotation.z = (r()-.5)*0.6; table.position.y = -1.488; table.receiveShadow = true;
  scene.add(table);
  const cs = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshBasicMaterial({ map:contactShadowTexture(), transparent:true, depthWrite:false, opacity:0.6 }));
  cs.rotation.x = -Math.PI/2; cs.position.y = -1.485; scene.add(cs);

  // cube (from the live state); a small random twist per piece so it is not perfect
  const cube = new THREE.Group();
  for (const c of state){
    const R = c.R, f = [1,-1,1];
    const m = new THREE.Matrix4().set(
      f[0]*R[0][0]*f[0], f[0]*R[0][1]*f[1], f[0]*R[0][2]*f[2], c.p[0],
      f[1]*R[1][0]*f[0], f[1]*R[1][1]*f[1], f[1]*R[1][2]*f[2], -c.p[1],
      f[2]*R[2][0]*f[0], f[2]*R[2][1]*f[1], f[2]*R[2][2]*f[2], c.p[2],
      0,0,0,1);
    const jit = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((r()-.5)*0.012, (r()-.5)*0.012, (r()-.5)*0.012));
    const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(m).multiply(jit);
    const body = new THREE.Mesh(bodyGeo, bodyMat); body.castShadow = true; body.receiveShadow = true; g.add(body);
    for (const face in c.cols){
      if (!c.cols[face]) continue;
      const s = new THREE.Mesh(stkGeo, stkMats[c.cols[face]] || stkMats[face]);   // material by the real colour
      const n = LOCAL_N[face]; s.position.set(n[0]*0.4885, n[1]*0.4885, n[2]*0.4885);
      s.rotation.set(STK_ROT[face][0], STK_ROT[face][1], 0); s.receiveShadow = true;
      g.add(s);
    }
    cube.add(g);
  }
  cube.rotation.y = (r()-.5)*0.25;
  if (window.__cubeYellowTop && window.__cubeYellowTop()) cube.rotation.z = Math.PI;
  scene.add(cube);

  // light: soft window light from the left + fill
  const key = new THREE.DirectionalLight('#fff4e6', 2.2);
  key.position.set(-6 + r()*2, 9, 4 + r()*2); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 8; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left:-5, right:5, top:5, bottom:-5, near:1, far:30 });
  scene.add(key);
  const fill = new THREE.DirectionalLight('#fff8f0', 0.9); fill.position.set(7, 3, 5); scene.add(fill);
  scene.add(new THREE.HemisphereLight('#dfe8ff', kind==='wood' ? '#5a3c25' : '#444', 0.9));

  // phone camera: hand-held, slightly random
  const cam = new THREE.PerspectiveCamera(44, W/H, 0.1, 100);
  const az = (36 + (r()-.5)*10) * Math.PI/180, el = (36 + (r()-.5)*8) * Math.PI/180, dist = 11 + r()*1.2;
  cam.position.set(Math.sin(az)*Math.cos(el)*dist, Math.sin(el)*dist - 1.0, Math.cos(az)*Math.cos(el)*dist);
  cam.lookAt(0, -0.35, 0);
  cam.rotateZ((r()-.5)*0.05);
  return { scene, cam };
}

function blurCopy(src, scale){
  const w = Math.max(1, Math.round(W*scale)), h = Math.max(1, Math.round(H*scale));
  const a = document.createElement('canvas'); a.width = w; a.height = h;
  const ac = a.getContext('2d'); ac.imageSmoothingQuality = 'high'; ac.drawImage(src, 0, 0, w, h);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const oc = out.getContext('2d'); oc.imageSmoothingQuality = 'high'; oc.drawImage(a, 0, 0, W, H);
  return out;
}

async function render(state, kind){
  setup();
  const r = rng(Date.now() & 0xffffffff);
  const { scene, cam } = buildScene(state, kind || 'wood', r);
  renderer.render(scene, cam);

  // post: depth of field (sharp on the cube, soft far away), vignette, grain
  const sharp = renderer.domElement;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.drawImage(blurCopy(sharp, 0.08), 0, 0);
  const mid = document.createElement('canvas'); mid.width = W; mid.height = H;
  const mc = mid.getContext('2d');
  mc.drawImage(blurCopy(sharp, 0.22), 0, 0);
  let m = mc.createRadialGradient(W*.5, H*.55, H*.18, W*.5, H*.55, H*.62);
  m.addColorStop(0,'rgba(0,0,0,1)'); m.addColorStop(1,'rgba(0,0,0,0)');
  mc.globalCompositeOperation = 'destination-in'; mc.fillStyle = m; mc.fillRect(0,0,W,H);
  ctx.drawImage(mid, 0, 0);
  const top = document.createElement('canvas'); top.width = W; top.height = H;
  const tc = top.getContext('2d');
  tc.drawImage(sharp, 0, 0);
  m = tc.createRadialGradient(W*.5, H*.56, H*.20, W*.5, H*.56, H*.42);
  m.addColorStop(0,'rgba(0,0,0,1)'); m.addColorStop(1,'rgba(0,0,0,0)');
  tc.globalCompositeOperation = 'destination-in'; tc.fillStyle = m; tc.fillRect(0,0,W,H);
  ctx.drawImage(top, 0, 0);

  const vg = ctx.createRadialGradient(W*.45, H*.45, H*.25, W*.5, H*.5, H*.85);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,.38)');
  ctx.fillStyle = vg; ctx.fillRect(0,0,W,H);
  const img = ctx.getImageData(0,0,W,H), d = img.data;
  for (let i=0; i<d.length; i+=4){ const g = (r()-.5)*10; d[i]+=g+1.5; d[i+1]+=g; d[i+2]+=g-1.5; }
  ctx.putImageData(img, 0, 0);
  scene.traverse(o => { if (o.geometry && o.geometry !== bodyGeo && o.geometry !== stkGeo) o.geometry.dispose(); });
  return out;
}
// warm up (shaders, textures) so the first volume press is fast
window.CubePhotoGL = { render };
setTimeout(() => { try { setup(); tableTexture(typeof cal !== 'undefined' ? cal.photoBg : 'wood'); } catch(e){} }, 1500);
