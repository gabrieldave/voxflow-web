/**
 * Fn (Globe) keycap in Three.js. Renders at display rate only while something moves
 * (press travel, LED, tilt), then stops the loop. Paused when off-screen.
 * Motion uses critically damped springs (Apple "response"/"damping" model);
 * the release gets a touch of bounce because it carries the key's momentum.
 */
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Scene,
  Shape,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

class Spring {
  v = 0;
  constructor(public x: number, public target: number, public response: number, public damping = 1) {}
  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(this.target)) return;
    const w = (2 * Math.PI) / this.response;
    const k = w * w;
    const c = 2 * this.damping * w;
    const n = Math.ceil(dt / (1 / 480));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -k * (this.x - this.target) - c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.v)) this.snap();
  }
  get settled() {
    return Math.abs(this.x - this.target) < 1e-4 && Math.abs(this.v) < 1e-3;
  }
  snap() {
    this.x = this.target;
    this.v = 0;
  }
}

const REST_Y = 0.06; // key bottom at −0.17, well floor at −0.30
const TRAVEL = 0.11;

function roundedRect<T extends Shape | Path>(p: T, w: number, h: number, r: number): T {
  const x = -w / 2;
  const y = -h / 2;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

export class Keycap3D {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(28, 1, 0.1, 50);
  private key = new Group();
  private led: Mesh<RoundedBoxGeometry, MeshStandardMaterial>;
  private gap: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private under = new PointLight(0xffffff, 0, 3, 1.6);
  private legendMat: MeshBasicMaterial;
  private legendCanvas = document.createElement("canvas");

  private press = new Spring(0, 0, 0.09, 1);
  private tiltX = new Spring(0, 0, 0.6, 1);
  private tiltY = new Spring(0, 0, 0.6, 1);
  private glow = new Spring(0.15, 0.15, 0.12, 1);
  private color = new Color("#597399");
  private colorTarget = new Color("#597399");

  private running = false;
  private visible = true;
  private live = false;
  private last = 0;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();

    this.camera.position.set(0, 3.25, 4.35);
    this.camera.lookAt(0, -0.12, 0);

    // Machined deck: anodised slab with a chamfered cavity cut for the key.
    const outer = roundedRect(new Shape(), 2.9, 2.4, 0.3);
    outer.holes.push(roundedRect(new Path(), 1.84, 1.84, 0.22));
    const deckGeo = new ExtrudeGeometry(outer, {
      depth: 0.26,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.035,
      bevelSegments: 4,
      curveSegments: 24,
    });
    deckGeo.rotateX(-Math.PI / 2);
    const deck = new Mesh(
      deckGeo,
      new MeshPhysicalMaterial({ color: "#45474e", metalness: 0.9, roughness: 0.32, clearcoat: 0.2, clearcoatRoughness: 0.4 })
    );
    deck.position.y = -0.295; // top face (incl. bevel) sits at y = 0
    this.scene.add(deck);

    // Soft contact shadow, like a product shot on a dark sweep
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 256;
    const sg = shadowCanvas.getContext("2d")!;
    const grad = sg.createRadialGradient(128, 128, 20, 128, 128, 128);
    grad.addColorStop(0, "rgba(0,0,0,0.75)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 256, 256);
    const shadow = new Mesh(
      new PlaneGeometry(4.4, 3.8),
      new MeshBasicMaterial({ map: new CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.34;
    this.scene.add(shadow);

    // Well floor: dark, tinted by the LED
    this.gap = new Mesh(
      new PlaneGeometry(1.84, 1.84),
      new MeshStandardMaterial({ color: "#040405", roughness: 1, metalness: 0, emissive: new Color("#597399"), emissiveIntensity: 0.05 })
    );
    this.gap.rotation.x = -Math.PI / 2;
    this.gap.position.y = -0.3;
    this.scene.add(this.gap);

    this.led = new Mesh(
      new RoundedBoxGeometry(1.7, 0.03, 1.7, 2, 0.012),
      new MeshStandardMaterial({ color: "#0a0a0c", emissive: new Color("#597399"), emissiveIntensity: 0.2, roughness: 0.6 })
    );
    this.led.position.y = -0.285;
    this.scene.add(this.led);

    // Keycap
    const cap = new Mesh(
      new RoundedBoxGeometry(1.56, 0.46, 1.56, 6, 0.15),
      new MeshPhysicalMaterial({ color: "#1a1a1e", roughness: 0.44, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3 })
    );
    this.key.add(cap);

    this.legendCanvas.width = this.legendCanvas.height = 512;
    const tex = new CanvasTexture(this.legendCanvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    this.legendMat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const legend = new Mesh(new PlaneGeometry(1.24, 1.24), this.legendMat);
    legend.rotation.x = -Math.PI / 2;
    legend.position.y = 0.2315;
    this.key.add(legend);
    this.key.position.y = REST_Y;
    this.scene.add(this.key);

    this.under.position.set(0, -0.2, 0);
    this.scene.add(this.under);

    // Studio rig: key light, two cool rims that trace the cap and chamfer, faint top fill
    const keyLight = new DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(2.2, 4, 2.6);
    this.scene.add(keyLight);
    const rimL = new DirectionalLight(0xb9c8ff, 2.8);
    rimL.position.set(-3, 1.8, -3.2);
    this.scene.add(rimL);
    const rimR = new DirectionalLight(0xdfe6ff, 1.7);
    rimR.position.set(3.2, 1.2, -2.6);
    this.scene.add(rimR);
    const top = new DirectionalLight(0xffffff, 0.35);
    top.position.set(0, 6, 0);
    this.scene.add(top);

    this.drawLegend();
    document.fonts?.ready.then(() => {
      this.drawLegend();
      this.wake();
    });

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible) this.wake();
    }).observe(canvas);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.wake();
    });
    this.resize();
  }

  private drawLegend() {
    const g = this.legendCanvas.getContext("2d")!;
    const s = 512;
    g.clearRect(0, 0, s, s);
    const ink = "rgba(238,240,246,0.94)";
    g.fillStyle = ink;
    g.strokeStyle = ink;

    // Apple Magic Keyboard layout: "fn" top-right + crisp wireframe Globe bottom-left
    g.font = '600 84px "Plus Jakarta Sans", -apple-system, "Helvetica Neue", Arial, sans-serif';
    g.textAlign = "right";
    g.textBaseline = "top";
    g.fillText("fn", s * 0.86, s * 0.11);

    // Wireframe Globe (bottom-left)
    g.save();
    g.translate(s * 0.33, s * 0.67);
    const R = 104;
    g.lineWidth = 11.5;
    g.lineCap = "round";
    g.lineJoin = "round";

    // Outer circle
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.stroke();

    // Inner meridian ellipse
    g.beginPath();
    g.ellipse(0, 0, R * 0.5, R, 0, 0, Math.PI * 2);
    g.stroke();

    // Central vertical meridian & equator
    g.beginPath();
    g.moveTo(0, -R);
    g.lineTo(0, R);
    g.moveTo(-R, 0);
    g.lineTo(R, 0);
    g.stroke();

    // Upper and lower latitude parallels
    const latY = R * 0.52;
    const latHalfW = Math.sqrt(R * R - latY * latY);
    g.beginPath();
    g.moveTo(-latHalfW, -latY);
    g.lineTo(latHalfW, -latY);
    g.moveTo(-latHalfW, latY);
    g.lineTo(latHalfW, latY);
    g.stroke();

    g.restore();
    this.legendMat.map!.needsUpdate = true;
  }

  private resize() {
    const p = this.canvas.parentElement!;
    const w = p.clientWidth;
    const h = p.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.wake();
  }

  setPressed(down: boolean) {
    this.press.target = down ? 1 : 0;
    this.press.damping = down ? 1 : 0.72;
    this.press.response = down ? 0.07 : 0.16;
    if (this.reduced) this.press.snap();
    this.wake();
  }

  setLive(on: boolean) {
    this.live = on;
    this.wake();
  }

  setLevel(level: number) {
    if (!Number.isFinite(level)) return;
    this.glow.target = 0.2 + Math.max(0, Math.min(1, level)) * 1.4;
    this.wake();
  }

  setIdleGlow(v: number) {
    this.glow.target = v;
    this.wake();
  }

  setColor(hex: string) {
    this.colorTarget.set(hex);
    this.wake();
  }

  /** −1…1 pointer position over the stage */
  tilt(nx: number, ny: number) {
    if (this.reduced) return;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    const x = Math.max(-1, Math.min(1, nx));
    const y = Math.max(-1, Math.min(1, ny));
    this.tiltY.target = x * 0.16;
    this.tiltX.target = y * 0.1;
    this.wake();
  }

  wake() {
    if (this.running || !this.visible) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    const springs = [this.press, this.tiltX, this.tiltY, this.glow];
    springs.forEach((s) => s.step(dt));

    this.color.lerp(this.colorTarget, 1 - Math.exp(-Math.max(dt, 0) * 14));
    const glow = Math.max(0, this.glow.x);

    this.key.position.y = REST_Y - this.press.x * TRAVEL;
    this.scene.rotation.x = Number.isFinite(this.tiltX.x) ? this.tiltX.x : 0;
    this.scene.rotation.y = Number.isFinite(this.tiltY.x) ? this.tiltY.x : 0;
    if (!Number.isFinite(this.key.position.y)) this.key.position.y = REST_Y;

    this.led.material.emissive.copy(this.color);
    this.led.material.emissiveIntensity = glow;
    this.gap.material.emissive.copy(this.color);
    this.gap.material.emissiveIntensity = glow * 0.25;
    this.under.color.copy(this.color);
    this.under.intensity = glow * 1.6;

    this.renderer.render(this.scene, this.camera);

    const colorDone = Math.abs(this.color.r - this.colorTarget.r) + Math.abs(this.color.g - this.colorTarget.g) + Math.abs(this.color.b - this.colorTarget.b) < 0.003;
    if (this.visible && (this.live || !springs.every((s) => s.settled) || !colorDone)) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
    }
  };
}
