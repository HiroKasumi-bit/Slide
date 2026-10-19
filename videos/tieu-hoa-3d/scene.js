// scene.js — 3D digestive system for the HyperFrames "three" adapter.
// Anatomy: "Digestive-system" by Genesis1 (Sketchfab), CC BY 4.0 — assets/models/digestive-system.glb.
// Everything is a pure function of time t (seconds): renderAt(t) is called on every
// hf-seek, so any frame can be rendered in any order.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const W = 1920;
const H = 1080;

// Shot boundaries (seconds) — read everywhere, never re-typed as literals
export const SHOT = { intro: 0, mouth: 6, esophagus: 13, stomach: 20, small: 31, villi: 43, large: 54, recap: 64, end: 72 };

// ---------------------------------------------------------------- helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const range = (t, a, b) => smooth((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const window01 = (t, a, b, fade = 0.5) => Math.min(range(t, a, a + fade), 1 - range(t, b - fade, b));

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(8);

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04131a);
scene.fog = new THREE.FogExp2(0x04131a, 0.03);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, W / H, 0.03, 300);

scene.add(new THREE.HemisphereLight(0x9ff5ff, 0x240c10, 1.1));
const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
key.position.set(3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x5fe8ff, 2.2);
rim.position.set(-4, 2, -3);
scene.add(rim);

// Gradient dome + floating dust for depth
const dome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 16),
    new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {},
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vP; void main(){ float k = clamp(vP.y*0.5+0.5, 0.0, 1.0); vec3 c = mix(vec3(0.01,0.05,0.07), vec3(0.03,0.16,0.19), k); gl_FragColor = vec4(c,1.0); }',
    }),
);
scene.add(dome);

const dustGeo = new THREE.BufferGeometry();
const dustCount = 700;
const dustBase = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
    dustBase[i * 3] = (rand() - 0.5) * 16;
    dustBase[i * 3 + 1] = (rand() - 0.5) * 10;
    dustBase[i * 3 + 2] = (rand() - 0.5) * 12 - 2;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustBase.slice(), 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x7ff0ff, size: 0.025, transparent: true, opacity: 0.55, depthWrite: false }));
scene.add(dust);

// ---------------------------------------------------------------- swept tubes
// A tube whose radius can change per frame: r(s, theta) with s in [0,1] along the curve.
function makeSweep(curve, segs, radial) {
    const pts = curve.getSpacedPoints(segs);
    const frames = curve.computeFrenetFrames(segs, false);
    const count = (segs + 1) * (radial + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const idx = [];
    for (let i = 0; i < segs; i++) {
        for (let j = 0; j < radial; j++) {
            const a = i * (radial + 1) + j;
            const b = (i + 1) * (radial + 1) + j;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    geo.setIndex(idx);
    geo.userData = { pts, frames, segs, radial };
    return geo;
}

function updateSweep(geo, radius) {
    const { pts, frames, segs, radial } = geo.userData;
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    let k = 0;
    for (let i = 0; i <= segs; i++) {
        const s = i / segs;
        const p = pts[i];
        const N = frames.normals[i];
        const B = frames.binormals[i];
        for (let j = 0; j <= radial; j++) {
            const th = (j / radial) * Math.PI * 2;
            const c = Math.cos(th);
            const sn = Math.sin(th);
            const nx = c * N.x + sn * B.x;
            const ny = c * N.y + sn * B.y;
            const nz = c * N.z + sn * B.z;
            const r = radius(s, th);
            pos[k] = p.x + nx * r; pos[k + 1] = p.y + ny * r; pos[k + 2] = p.z + nz * r;
            nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
            k += 3;
        }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
}

const organ = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.38, metalness: 0, envMapIntensity: 0.5, emissive: color, emissiveIntensity: 0.05, ...extra,
});

function blob(radius, scale, noise, seed, detail = 5) {
    const g = new THREE.SphereGeometry(radius, 16 * detail, 12 * detail);
    const r = mulberry32(seed);
    const ph = [r() * 6, r() * 6, r() * 6];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const v = v3(p.getX(i), p.getY(i), p.getZ(i));
        const n = Math.sin(v.x * 5 + ph[0]) * Math.sin(v.y * 4 + ph[1]) * Math.sin(v.z * 6 + ph[2]);
        v.multiplyScalar(1 + noise * n);
        p.setXYZ(i, v.x * scale[0], v.y * scale[1], v.z * scale[2]);
    }
    g.computeVertexNormals();
    return g;
}

// ---------------------------------------------------------------- anatomy (GLB model)
const body = new THREE.Group();
scene.add(body);

// Model units → scene units (the camera shots, labels and particles below were authored
// for a body ~6 units tall with the mouth at y≈2.6 and the anus at y≈-2.3)
const K = 0.0701;
const M = (x, y, z) => v3(x * K, y * K - 2.6, z * K + 0.55);
const toScene = new THREE.Matrix4().makeTranslation(0, -2.6, 0.55).multiply(new THREE.Matrix4().makeScale(K, K, K));

// Hologram silhouette (fresnel rim, additive) replaces the model's grey skin
const holoMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0x3fe0d0) }, uAlpha: { value: 0.55 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2); gl_FragColor = vec4(uColor * f * 1.4, f * uAlpha); }',
});

// The organs bulge where the food is (peristalsis) and glow softly around it
const organUniforms = {
    uBolus: { value: v3(0, -99, 0) },
    uBulge: { value: 0 },
    uBulgeR: { value: 0.08 },
    uGlow: { value: 0 },
};
let organMat = null;
const gltf = await new GLTFLoader().loadAsync('assets/models/digestive-system.glb');
gltf.scene.updateMatrixWorld(true);
const meshes = [];
gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
for (const o of meshes) {
    const geo = o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toScene, o.matrixWorld));
    const isSkin = o.material.name === 'Material_1';
    let mat = holoMat;
    if (!isSkin) {
        mat = o.material;
        mat.roughness = 0.5;
        mat.envMapIntensity = 0.45;
        mat.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, organUniforms);
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nuniform vec3 uBolus; uniform float uBulge; uniform float uBulgeR; varying vec3 vWorld;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat bd = distance(transformed, uBolus);\ntransformed += objectNormal * uBulge * exp(-bd * bd / (uBulgeR * uBulgeR));\nvWorld = transformed;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nuniform vec3 uBolus; uniform float uGlow; uniform float uBulgeR; varying vec3 vWorld;')
                .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat gd = distance(vWorld, uBolus);\ntotalEmissiveRadiance += vec3(1.0, 0.62, 0.25) * uGlow * exp(-gd * gd / (uBulgeR * uBulgeR * 6.0));');
        };
        organMat = mat;
    }
    const mesh = new THREE.Mesh(geo, mat);
    if (isSkin) mesh.renderOrder = 2;
    body.add(mesh);
}

// Centre-lines through the model's organs (model units, measured on the mesh)
const path = (pts) => new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => M(x, y, z)));
const esoCurve = path([[0, 74.5, -0.4], [0, 73, -1.8], [0, 71, -2.9], [0, 68, -6.3], [0, 64, -8.7], [0, 58, -10.9], [0.2, 52, -12.7],
    [0.3, 46, -10.8], [1.2, 42.5, -8.3], [2.0, 40.5, -6.8], [2.5, 39.5, -5.6]]);
const stoCurve = path([[2.5, 39.5, -5.6], [4.5, 37.5, -5.8], [5.5, 35, -5.65], [5, 32.5, -5.6], [3, 31, -5.5], [0.5, 31.2, -5.7],
    [-1.5, 32.5, -6.5], [-2.8, 33.5, -7.0]]);
const siCurve = path([[-2.8, 33.5, -7.0], [-4.2, 33, -5.6], [-5.3, 31.5, -5.1], [-5.5, 30, -5.0], [-5, 26, -4.5], [-2, 25.5, -6.0],
    [2, 25, -5.6], [6, 24.5, -5.2], [7, 22, -6.0], [3, 21.5, -4.6], [-2, 22, -3.8], [-7, 21, -5.6], [-6, 18.5, -5.1], [-1, 18.5, -4.6],
    [4, 18, -5.5], [8, 17, -6.7], [6, 14.5, -8.0], [1, 15.5, -5.1], [-4, 14.5, -6.1], [-7, 13.5, -7.5]]);
const colonCurve = path([[-7, 13.5, -7.5], [-9.6, 17, -7.3], [-9.8, 20, -7.4], [-9.6, 25, -7.1], [-9.5, 28, -6.7], [-5, 28.5, -4.8],
    [0, 28.5, -3.2], [5, 28.5, -4.6], [9.5, 28, -7.4], [9.6, 25, -9.3], [9.8, 20, -9.6], [9.6, 16, -8.7], [9, 13.5, -8.2], [5, 12.5, -8.0],
    [2, 12, -8.9], [0.5, 10.5, -12.2], [0.2, 8, -13.7], [0.2, 5.5, -14.3], [0.1, 4.2, -14.4]]);

// ---------------------------------------------------------------- food: bolus, trail, chyme, secretions
// The food is inside the organs, so it is drawn through them (x-ray style) with a halo
const bolus = new THREE.Mesh(blob(0.055, [1, 0.9, 1], 0.12, 21, 4), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xff9a3c, emissiveIntensity: 0.5, roughness: 0.45, depthTest: false, transparent: true }));
bolus.renderOrder = 5;
scene.add(bolus);
const halo = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
halo.renderOrder = 4;
scene.add(halo);

const TRAIL = 40;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ color: 0xffc45a, size: 0.03, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
trail.renderOrder = 4;
scene.add(trail);

// Chyme / enzyme particles that swirl in the stomach
const CHYME = 90;
const chyme = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffd38a, emissive: 0xffa53c, emissiveIntensity: 1.2, depthTest: false, transparent: true }), CHYME);
chyme.renderOrder = 5;
const chymeSeed = Array.from({ length: CHYME }, () => [rand() * 6.28, rand() * 6.28, 0.6 + rand() * 0.8, rand()]);
const enzymeColors = [new THREE.Color(0xb48cff), new THREE.Color(0x7dffb0), new THREE.Color(0xffd38a)];
for (let i = 0; i < CHYME; i++) chyme.setColorAt(i, enzymeColors[i % 3]);
scene.add(chyme);

// Bile (green) and pancreatic juice (yellow) droplets flowing into the duodenum
const DROPS = 40;
const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.1, depthTest: false, transparent: true }), DROPS);
drops.renderOrder = 5;
const bilePath = path([[-6, 34, -4], [-6.5, 31.5, -5.2], [-5.3, 31, -5.1]]);
const pancPath = path([[6, 31.5, -7.4], [1, 31, -7.4], [-4.5, 31.5, -6]]);
for (let i = 0; i < DROPS; i++) drops.setColorAt(i, new THREE.Color(i % 2 ? 0x8cff6a : 0xffd84d));
scene.add(drops);

// Recap sparks that race along the whole tract
const SPARKS = 6;
const sparks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffc04a, emissiveIntensity: 2, depthTest: false, transparent: true }), SPARKS);
sparks.renderOrder = 5;
scene.add(sparks);

// ---------------------------------------------------------------- villi close-up (separate set far away)
const villi = new THREE.Group();
villi.position.set(40, 0, 0);
scene.add(villi);
const wallGeo = new THREE.PlaneGeometry(10, 6, 140, 80);
wallGeo.rotateX(-Math.PI / 2);
{
    const p = wallGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        p.setY(i, 0.35 * Math.sin(x * 1.2) * Math.cos(z * 0.9) + 0.12 * Math.sin(z * 3.1));
    }
    wallGeo.computeVertexNormals();
}
villi.add(new THREE.Mesh(wallGeo, organ(0xa9474e, { roughness: 0.55 })));
const wallHeight = (x, z) => 0.35 * Math.sin(x * 1.2) * Math.cos(z * 0.9) + 0.12 * Math.sin(z * 3.1);

const villusGeo = new THREE.CapsuleGeometry(0.11, 0.62, 6, 14);
villusGeo.translate(0, 0.42, 0);
const VILLI = 150;
const villusMesh = new THREE.InstancedMesh(villusGeo, organ(0xd8716c, { emissiveIntensity: 0.06, roughness: 0.5 }), VILLI);
const villusSeed = [];
for (let i = 0; i < VILLI; i++) {
    const x = -4 + (i % 15) * 0.56 + (rand() - 0.5) * 0.2;
    const z = -2.4 + Math.floor(i / 15) * 0.5 + (rand() - 0.5) * 0.2;
    villusSeed.push([x, z, rand() * 6.28, 0.8 + rand() * 0.4]);
}
villi.add(villusMesh);
// capillaries glowing under the surface
for (let k = 0; k < 4; k++) {
    const z = -2 + k * 1.3;
    const c = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => v3(-5 + i * 0.9, wallHeight(-5 + i * 0.9, z) - 0.05, z + 0.15 * Math.sin(i))));
    const g = makeSweep(c, 120, 8);
    updateSweep(g, () => 0.04);
    villi.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: k % 2 ? 0xff4a5a : 0x5a7dff, emissive: k % 2 ? 0xff2a3a : 0x3a5aff, emissiveIntensity: 0.9 })));
}
const NUTRI = 160;
const nutri = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.05, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.3 }), NUTRI);
const nutriSeed = [];
const nutriColors = [new THREE.Color(0x7dffb0), new THREE.Color(0xffe066), new THREE.Color(0xffa04a)]; // amino acid, đường đơn, acid béo
for (let i = 0; i < NUTRI; i++) {
    const target = villusSeed[Math.floor(rand() * VILLI)];
    nutriSeed.push([target, (rand() - 0.5) * 1.6, 1.4 + rand() * 1.4, (rand() - 0.5) * 1.2, rand() * 9]);
    nutri.setColorAt(i, nutriColors[i % 3]);
}
villi.add(nutri);

// ---------------------------------------------------------------- timeline helpers
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = v3(0, 1, 0);

// Where the bolus is (curve + s), per time — the single source for food, waves and camera
function foodAt(t) {
    if (t < SHOT.mouth + 0.3) return null;
    if (t < 12.4) return { curve: null, pos: M(0, 74.5, -0.4), scale: 1 + 0.12 * Math.sin(t * 9) };
    if (t < SHOT.stomach) return { curve: esoCurve, s: range(t, 12.4, 19.6), scale: 1 };
    if (t < SHOT.small) {
        const s = t < 24 ? range(t, 20, 24) * 0.55 : t < 28 ? 0.55 + 0.05 * Math.sin((t - 24) * 2.4) : lerp(0.55, 1, range(t, 28, 30.8));
        return { curve: stoCurve, s, scale: lerp(1, 0.55, range(t, 23, 28)) };
    }
    if (t < SHOT.villi) return { curve: siCurve, s: range(t, 31.2, 42.8), scale: 0.55 };
    if (t < SHOT.large) return null;
    if (t < SHOT.recap) return { curve: colonCurve, s: range(t, 54.4, 62.4) * 0.995, scale: lerp(0.95, 0.8, range(t, 54, 62)), exit: range(t, 62.4, 63.6) };
    return null;
}

function updateOrgans(t, food, p) {
    // The wall swells around the food as it moves (peristalsis); in the mouth it pulses with chewing
    organUniforms.uBolus.value.copy(p || v3(0, -99, 0));
    const inTube = food && food.curve;
    organUniforms.uBulge.value = food ? (inTube ? 0.022 : 0.012 * (1 + Math.sin(t * 9))) * (1 - (food.exit || 0)) : 0;
    organUniforms.uBulgeR.value = food && food.curve === stoCurve ? 0.12 : 0.075;
    organUniforms.uGlow.value = food ? (food.curve === stoCurve ? 0.3 : 0.55) : 0;
}

function foodPos(t, food) {
    if (!food) return null;
    const p = food.curve ? food.curve.getPointAt(clamp(food.s)) : food.pos.clone();
    if (food.exit) p.y -= food.exit * 0.15;
    return p;
}

function updateFood(t, food) {
    if (!food) { bolus.visible = false; halo.visible = false; trail.visible = false; return; }
    bolus.visible = true;
    halo.visible = true;
    trail.visible = true;
    const posAt = (tt) => {
        const f = foodAt(tt);
        if (!f) return null;
        return f.curve ? f.curve.getPointAt(clamp(f.s)) : f.pos.clone();
    };
    const p = foodPos(t, food);
    bolus.position.copy(p);
    bolus.scale.setScalar(food.scale * (1 - (food.exit || 0)));
    halo.position.copy(p);
    halo.scale.setScalar(food.scale * (1 - (food.exit || 0)) * (1 + 0.12 * Math.sin(t * 5)));
    halo.material.color.setHex(t > SHOT.large ? 0xb07040 : t > SHOT.small ? 0xb8ff6a : 0xffb04a);
    bolus.rotation.set(t * 1.3, t * 0.9, 0);
    const color = t > SHOT.large ? 0xa0673a : t > SHOT.small ? 0xd8ff7a : 0xffd27a;
    bolus.material.color.setHex(color);
    bolus.material.emissive.setHex(t > SHOT.large ? 0x5a3010 : t > SHOT.small ? 0x9cff3c : 0xff9a3c);
    const arr = trailGeo.attributes.position.array;
    for (let i = 0; i < TRAIL; i++) {
        const q = posAt(t - i * 0.035) || p;
        arr[i * 3] = q.x; arr[i * 3 + 1] = q.y; arr[i * 3 + 2] = q.z;
    }
    trailGeo.attributes.position.needsUpdate = true;
}

function updateChyme(t) {
    const k = window01(t, 22.5, 31, 1.2);
    chyme.visible = k > 0;
    const c = stoCurve.getPointAt(0.4);
    for (let i = 0; i < CHYME; i++) {
        const [a, b, sp, r0] = chymeSeed[i];
        const ang = a + t * sp;
        const rr = 0.04 + r0 * 0.08;
        tmpP.set(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang * 0.7 + b) * rr * 0.9, c.z + Math.sin(ang) * rr * 0.6);
        tmpS.setScalar(k * (0.6 + r0 * 0.8));
        chyme.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    chyme.instanceMatrix.needsUpdate = true;

    const d = window01(t, 31.5, 37.5, 0.8);
    drops.visible = d > 0;
    for (let i = 0; i < DROPS; i++) {
        const path = i % 2 ? bilePath : pancPath;
        const s = ((t * 0.45 + i / DROPS * 4) % 1);
        tmpP.copy(path.getPointAt(s));
        tmpS.setScalar(d * Math.sin(Math.PI * s) * 1.2);
        drops.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    drops.instanceMatrix.needsUpdate = true;
}

// Whole-tract path for the recap sparks
const tract = [esoCurve, stoCurve, siCurve, colonCurve];
const tractLen = tract.map((c) => c.getLength());
const tractTotal = tractLen.reduce((a, b) => a + b, 0);
function tractPoint(u) {
    let d = clamp(u) * tractTotal;
    for (let i = 0; i < tract.length; i++) {
        if (d <= tractLen[i] || i === tract.length - 1) return tract[i].getPointAt(clamp(d / tractLen[i]));
        d -= tractLen[i];
    }
}
function updateSparks(t) {
    const k = window01(t, SHOT.recap + 0.5, SHOT.end + 1, 0.6);
    sparks.visible = k > 0;
    for (let i = 0; i < SPARKS; i++) {
        const u = ((t - SHOT.recap) * 0.16 - i * 0.035);
        tmpP.copy(tractPoint(clamp(u)));
        tmpS.setScalar(k * (u > 0 && u < 1 ? 1 - i * 0.12 : 0));
        sparks.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    sparks.instanceMatrix.needsUpdate = true;
}

function updateVilli(t) {
    const live = t >= SHOT.villi && t < SHOT.large;
    villi.visible = live;
    body.visible = !live;
    if (!live) return;
    const lt = t - SHOT.villi;
    for (let i = 0; i < VILLI; i++) {
        const [x, z, ph, h] = villusSeed[i];
        tmpP.set(x, wallHeight(x, z), z);
        tmpQ.setFromEuler(new THREE.Euler(0.18 * Math.sin(t * 1.4 + ph), 0, 0.14 * Math.cos(t * 1.1 + ph)));
        tmpS.set(1, h, 1);
        villusMesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    villusMesh.instanceMatrix.needsUpdate = true;
    tmpQ.identity();
    for (let i = 0; i < NUTRI; i++) {
        const [target, ox, oy, oz, delay] = nutriSeed[i];
        const [x, z, , h] = target;
        const tip = v3(x, wallHeight(x, z) + 0.42 + 0.31 * h * 2, z);
        const f = clamp((lt - delay * 0.9) / 3.2);
        let s = 1;
        if (f <= 0) { tmpP.set(x + ox, tip.y + oy, z + oz); }
        else if (f < 0.7) { const k = smooth(f / 0.7); tmpP.set(lerp(x + ox, tip.x, k), lerp(tip.y + oy, tip.y, k), lerp(z + oz, tip.z, k)); }
        else { const k = (f - 0.7) / 0.3; tmpP.set(tip.x, tip.y - k * 0.9, tip.z); s = 1 - k; }
        tmpP.y += 0.04 * Math.sin(t * 3 + i);
        tmpS.setScalar(s * window01(lt, 0, SHOT.large - SHOT.villi, 0.6));
        nutri.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    nutri.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- camera
// [time, position, lookAt, cut?] — a cut jumps instead of gliding from the previous key
const CAM = [
    [0, [4.6, 1.4, 6.3], [-1.6, 0.3, 0]],
    [5.6, [-2.0, 1.0, 6.8], [-1.5, 0.3, 0]],
    [7.4, [1.15, 2.98, 1.6], [0, 2.66, 0.3]],
    [12.4, [0.7, 2.82, 1.35], [0, 2.62, 0.3]],
    [14.2, [1.0, 2.3, 1.7], [0, 2.05, 0.12]],
    [19.6, [0.95, 0.95, 1.8], [0.05, 0.78, 0.12]],
    [21.4, [2.0, -0.32, 1.25], [0.24, -0.2, 0.12]],
    [30.4, [1.3, -0.55, 1.7], [0.12, -0.26, 0.14]],
    [32.2, [-1.25, -0.15, 2.05], [-0.18, -0.38, 0.2]],
    [36.2, [-0.4, -0.8, 2.5], [0, -1.0, 0.3]],
    [42.8, [0.55, -1.55, 2.3], [0, -1.4, 0.3]],
    [SHOT.villi, [40.2, 2.9, 3.6], [40, 0.2, -0.6], true],
    [53.8, [41.3, 1.5, 2.4], [40.3, 0.4, -0.2]],
    [SHOT.large, [-2.1, -0.9, 3.4], [-0.6, -1.1, 0.3], true],
    [58.8, [2.1, -1.1, 3.1], [0.6, -1.3, 0.3]],
    [63.6, [0.7, -2.0, 2.5], [0, -2.2, 0.1]],
    [65.4, [1.9, 0.0, 6.4], [1.5, 0.1, 0]],
    [SHOT.end, [0.4, 0.5, 8.6], [1.7, 0.25, 0]],
];
function cameraAt(t) {
    let i = 0;
    while (i < CAM.length - 1 && t >= CAM[i + 1][0]) i++;
    const a = CAM[i];
    const b = CAM[Math.min(i + 1, CAM.length - 1)];
    const k = b === a || b[3] ? 0 : smooth((t - a[0]) / (b[0] - a[0]));
    camera.position.set(lerp(a[1][0], b[1][0], k), lerp(a[1][1], b[1][1], k), lerp(a[1][2], b[1][2], k));
    camera.lookAt(lerp(a[2][0], b[2][0], k), lerp(a[2][1], b[2][1], k), lerp(a[2][2], b[2][2], k));
    // gentle hand-held drift
    camera.position.x += 0.02 * Math.sin(t * 0.7);
    camera.position.y += 0.015 * Math.sin(t * 0.9 + 1);
}

// ---------------------------------------------------------------- labels (3D anchors → screen)
const LABELS = [
    ['mieng', M(0, 74.2, 4.6), [[SHOT.mouth, 12.8], [SHOT.recap + 1, SHOT.end]]],
    ['nuocbot', M(4.6, 73, 0), [[7.2, 12.6], [SHOT.recap + 1.2, SHOT.end]]],
    ['thucquan', M(0.1, 60, -10.5), [[13.6, 19.6], [SHOT.recap + 1.4, SHOT.end]]],
    ['daday', M(7.5, 35, -4), [[20.6, 30.6], [SHOT.recap + 1.6, SHOT.end]]],
    ['gan', M(-9, 38, -1.5), [[31.4, 34.6], [SHOT.recap + 1.8, SHOT.end]]],
    ['tuimat', M(-7, 31.2, -4.5), [[31.6, 34.6]]],
    ['tuy', M(7.5, 31.5, -6.5), [[31.8, 36], [SHOT.recap + 2, SHOT.end]]],
    ['ruotnon', M(4, 20, -3.5), [[36.4, 42.8], [SHOT.recap + 2.2, SHOT.end]]],
    ['ruotgia', M(-10.8, 22, -6), [[54.2, 60], [SHOT.recap + 2.4, SHOT.end]]],
    ['tructrang', M(0.6, 8, -12.6), [[58.4, 63.6]]],
    ['haumon', M(0.1, 4.2, -14.4), [[60.6, 63.8], [SHOT.recap + 2.6, SHOT.end]]],
].map(([id, anchor, windows]) => ({ el: document.getElementById('l-' + id), anchor, windows }));

function updateLabels(t) {
    for (const L of LABELS) {
        const a = Math.max(...L.windows.map(([s, e]) => window01(t, s, e, 0.45)));
        const p = L.anchor.clone().project(camera);
        const visible = a > 0.001 && p.z < 1;
        L.el.style.opacity = visible ? a.toFixed(3) : '0';
        if (visible) L.el.style.transform = `translate(${((p.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * H).toFixed(1)}px)`;
    }
}

// ---------------------------------------------------------------- post-processing + render
const composer = new EffectComposer(renderer);
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.45, 0.4, 0.9));
composer.addPass(new OutputPass());

export function renderAt(t) {
    tmpQ.identity();
    const food = foodAt(t);
    cameraAt(t);
    updateOrgans(t, food, foodPos(t, food));
    updateFood(t, food);
    updateChyme(t);
    updateSparks(t);
    updateVilli(t);
    holoMat.uniforms.uAlpha.value = lerp(0.5, 0.28, window01(t, SHOT.mouth, SHOT.recap, 1.2));
    const dp = dust.geometry.attributes.position.array;
    for (let i = 0; i < dustCount; i++) dp[i * 3 + 1] = dustBase[i * 3 + 1] + ((t * 0.05 + i * 0.37) % 1) * 0.4;
    dust.geometry.attributes.position.needsUpdate = true;
    camera.updateMatrixWorld();
    updateLabels(t);
    composer.render();
}
