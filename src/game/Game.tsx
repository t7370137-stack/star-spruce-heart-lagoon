import { useEffect, useRef, useState } from "react";

type Keys = Set<string>;

type Actor = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hp: number;
  max: number;
  facing: 1 | -1;
  alive: boolean;
  hurt: number;
  atk: number;
  cd: number;
  stagger: number;
  phase: number;
  landed: boolean;
};

const SAVE_KEY = "putnik-demo-v1";
const WORLD = 3400;
const GROUND = 560;

function loadImg(src: string) {
  const img = new Image();
  img.src = src;
  return img;
}

function aabb(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState({ hp: 100, st: 100, mp: 60, boss: 0, bossMax: 1, toast: "", bossOn: false });
  const held = useRef<Keys>(new Set());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imgs = {
      bg: loadImg("/sprites/bg.jpg"),
      fire: loadImg("/sprites/fire.png"),
      idle: [1, 2, 3, 4].map((i) => loadImg(`/sprites/idle-${i}.png`)),
      run: [1, 2, 3, 4].map((i) => loadImg(`/sprites/run-${i}.png`)),
      atk: [1, 2, 3, 4].map((i) => loadImg(`/sprites/attack-${i}.png`)),
      dodge: [1, 2, 3, 4].map((i) => loadImg(`/sprites/dodge-${i}.png`)),
      knight: [1, 2, 3, 4].map((i) => loadImg(`/sprites/knight-${i}.png`)),
      boss: [1, 2, 3, 4].map((i) => loadImg(`/sprites/boss-${i}.png`)),
    };

    const saved = (() => {
      try {
        return JSON.parse(localStorage.getItem(SAVE_KEY) || "null") as { bossDead?: boolean } | null;
      } catch {
        return null;
      }
    })();

    const player = {
      x: 180,
      y: GROUND,
      vx: 0,
      vy: 0,
      w: 36,
      h: 78,
      hp: 100,
      max: 100,
      st: 100,
      mp: 60,
      facing: 1 as 1 | -1,
      grounded: true,
      atk: 0,
      dodge: 0,
      parry: 0,
      iframes: 0,
      hurt: 0,
      dead: 0,
      anim: 0,
    };

    const knights: Actor[] = [780, 1280, 1760].map((x) => ({
      x,
      y: GROUND,
      vx: 40,
      vy: 0,
      w: 40,
      h: 84,
      hp: 70,
      max: 70,
      facing: -1,
      alive: true,
      hurt: 0,
      atk: 0,
      cd: 0.6,
      stagger: 0,
      phase: 0,
      landed: false,
    }));

    const boss: Actor = {
      x: 2920,
      y: GROUND,
      vx: 0,
      vy: 0,
      w: 90,
      h: 170,
      hp: saved?.bossDead ? 0 : 480,
      max: 480,
      facing: -1,
      alive: !saved?.bossDead,
      hurt: 0,
      atk: 0,
      cd: 1.2,
      stagger: 0,
      phase: 1,
      landed: false,
    };

    const waves: { x: number; w: number; life: number; dmg: number }[] = [];
    let cam = 0;
    let toast = "";
    let toastT = 0;
    let bossOn = false;
    let shake = 0;
    let t = 0;
    let last = performance.now();
    let acc = 0;
    let running = true;
    let swingHit = false;
    let hudTick = 0;
    const keys: Keys = new Set();

    const audio = { ctx: null as AudioContext | null };
    const unlock = () => {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC || audio.ctx) return;
      audio.ctx = new AC();
      void audio.ctx.resume();
    };
    window.__putnikUnlock = unlock;
    const beep = (f: number, dur = 0.08, type: OscillatorType = "square", gain = 0.04) => {
      if (!audio.ctx) return;
      const o = audio.ctx.createOscillator();
      const g = audio.ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.value = gain;
      o.connect(g);
      g.connect(audio.ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audio.ctx.currentTime + dur);
      o.stop(audio.ctx.currentTime + dur);
    };

    const say = (s: string) => {
      toast = s;
      toastT = 2.4;
    };

    const rest = () => {
      player.hp = player.max;
      player.st = 100;
      player.mp = 60;
      player.dead = 0;
      player.x = 180;
      player.vx = 0;
      player.vy = 0;
      if (boss.alive) {
        knights.forEach((k, i) => {
          k.alive = true;
          k.hp = k.max;
          k.x = [780, 1280, 1760][i];
          k.atk = 0;
        });
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify({ bossDead: !boss.alive, version: 1 }));
      say("Пламя принимает тебя.");
      beep(220, 0.25, "sine", 0.06);
    };

    const hurtPlayer = (dmg: number) => {
      if (player.iframes > 0 || player.dead > 0) return;
      if (player.parry > 0) return;
      player.hp = Math.max(0, player.hp - dmg);
      player.iframes = 0.45;
      player.hurt = 0.25;
      player.vx = -player.facing * 180;
      shake = 8;
      beep(90, 0.12, "sawtooth", 0.05);
      if (player.hp <= 0) {
        player.dead = 1.6;
        say("Ты ещё идёшь.");
      }
    };

    const step = (dt: number) => {
      t += dt;
      const down = (c: string) => keys.has(c) || held.current.has(c);
      const left = down("KeyA") || down("ArrowLeft");
      const right = down("KeyD") || down("ArrowRight");
      const jump = down("KeyW") || down("ArrowUp");

      if (player.dead > 0) {
        player.dead -= dt;
        if (player.dead <= 0) rest();
      } else {
        if (player.dodge <= 0 && player.atk <= 0) {
          const dir = (right ? 1 : 0) - (left ? 1 : 0);
          player.vx = dir * 250;
          if (dir) player.facing = dir as 1 | -1;
        } else if (player.dodge > 0) {
          player.vx = player.facing * 540;
          player.dodge -= dt;
        } else {
          player.vx *= 0.8;
          player.atk -= dt;
        }
        if (jump && player.grounded && player.st > 12 && player.dodge <= 0) {
          player.vy = -560;
          player.grounded = false;
          player.st -= 12;
        }
        player.vy += 1700 * dt;
        player.x += player.vx * dt;
        player.y += player.vy * dt;
        if (player.y >= GROUND) {
          player.y = GROUND;
          player.vy = 0;
          player.grounded = true;
        }
        player.x = Math.max(40, Math.min(WORLD - 60, player.x));
        player.st = Math.min(100, player.st + 22 * dt);
        player.mp = Math.min(60, player.mp + 4 * dt);
        player.iframes = Math.max(0, player.iframes - dt);
        player.hurt = Math.max(0, player.hurt - dt);
        player.parry = Math.max(0, player.parry - dt);
        player.anim += dt;
        if (player.x < 260 && (down("KeyE") || down("KeyF"))) rest();
        if (!bossOn && player.x > 2300 && boss.alive) {
          bossOn = true;
          say("Лорд погибших королей");
          beep(70, 0.4, "triangle", 0.07);
        }
      }

      const pbox = { x: player.x - 18, y: player.y - 78, w: 36, h: 78 };
      const swinging = player.atk > 0.12 && player.atk < 0.32;
      const hit = swinging
        ? { x: player.facing === 1 ? player.x + 8 : player.x - 78, y: player.y - 70, w: 70, h: 40 }
        : null;

      const tickFoe = (e: Actor, speed: number, reach: number, dmg: number, isBoss: boolean) => {
        if (!e.alive) return;
        e.hurt = Math.max(0, e.hurt - dt);
        e.stagger = Math.max(0, e.stagger - dt);
        e.cd = Math.max(0, e.cd - dt);
        e.atk = Math.max(0, e.atk - dt);
        const dx = player.x - e.x;
        e.facing = dx >= 0 ? 1 : -1;
        if (e.stagger <= 0 && e.atk <= 0 && player.dead <= 0) {
          if (Math.abs(dx) > reach) e.x += Math.sign(dx) * speed * dt;
          else if (e.cd <= 0) {
            e.atk = isBoss && e.phase >= 2 && Math.random() < 0.45 ? 0.9 : 0.55;
            e.landed = false;
            e.cd = isBoss ? (e.phase >= 3 ? 0.85 : 1.25) : 1.35;
            if (isBoss && e.phase >= 2 && e.atk > 0.7) {
              waves.push({ x: e.x, w: 30, life: 1.1, dmg: 22 });
            }
          }
        }
        const striking = e.atk > 0.12 && e.atk < 0.34;
        if (striking && player.parry > 0 && Math.abs(dx) < reach + 20) {
          e.stagger = 1.1;
          e.atk = 0;
          e.landed = true;
          player.st = Math.min(100, player.st + 28);
          say("Парирование");
          beep(520, 0.08, "square", 0.05);
          shake = 5;
        } else if (striking) {
          const box = {
            x: e.facing === 1 ? e.x : e.x - reach,
            y: e.y - e.h * 0.7,
            w: reach,
            h: 36,
          };
          if (!e.landed && aabb(pbox, box)) {
            e.landed = true;
            hurtPlayer(dmg);
          }
        }
        if (player.atk <= 0) swingHit = false;
        if (hit && !swingHit && aabb(hit, { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h })) {
          swingHit = true;
          const dealt = 16 + (player.mp > 20 && down("KeyL") ? 0 : 0);
          e.hp -= dealt;
          e.hurt = 0.15;
          shake = 4;
          beep(180, 0.05, "square", 0.04);
          player.atk = 0.12;
          if (e.hp <= 0) {
            e.alive = false;
            if (isBoss) {
              say("Корона рассыпалась.");
              localStorage.setItem(SAVE_KEY, JSON.stringify({ bossDead: true, version: 1 }));
              beep(330, 0.5, "sine", 0.06);
            }
          }
        }
        if (isBoss) {
          const ratio = e.hp / e.max;
          e.phase = ratio < 0.3 ? 3 : ratio < 0.6 ? 2 : 1;
        }
      };

      knights.forEach((k) => tickFoe(k, player.dead > 0 ? 0 : 70, 62, 14, false));
      if (bossOn) tickFoe(boss, boss.phase >= 3 ? 110 : 55, 110, boss.phase >= 3 ? 26 : 20, true);

      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        w.life -= dt;
        w.w += 280 * dt;
        const box = { x: w.x - w.w, y: GROUND - 30, w: w.w * 2, h: 30 };
        if (aabb(pbox, box)) hurtPlayer(w.dmg);
        if (w.life <= 0) waves.splice(i, 1);
      }

      if (down("KeyL") && player.mp >= 22 && player.dead <= 0 && player.dodge <= 0) {
        player.mp -= 22;
        player.iframes = 0.35;
        player.x += player.facing * 150;
        beep(640, 0.1, "sine", 0.04);
        keys.delete("KeyL");
        held.current.delete("KeyL");
      }

      cam += (player.x - 420 - cam) * Math.min(1, dt * 4);
      cam = Math.max(0, Math.min(WORLD - 1280, cam));
      toastT = Math.max(0, toastT - dt);
      shake = Math.max(0, shake - dt * 18);

      hudTick++;
      if (hudTick % 6 === 0) {
        setHud({
          hp: player.hp,
          st: player.st,
          mp: player.mp,
          boss: Math.max(0, boss.hp),
          bossMax: boss.max,
          toast: toastT > 0 ? toast : "",
          bossOn: bossOn && boss.alive,
        });
      }
    };

    const drawSprite = (
      img: HTMLImageElement,
      x: number,
      feet: number,
      h: number,
      face: number,
      alpha = 1,
    ) => {
      if (!img.complete || !img.naturalWidth) return;
      const w = (img.naturalWidth / img.naturalHeight) * h;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, feet);
      ctx.scale(face, 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, -w / 2, -h, w, h);
      ctx.restore();
    };

    const render = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.floor(cw * dpr) || canvas.height !== Math.floor(ch * dpr)) {
        canvas.width = Math.floor(cw * dpr);
        canvas.height = Math.floor(ch * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sx = (Math.random() - 0.5) * shake;
      const sy = (Math.random() - 0.5) * shake;
      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      ctx.translate(sx, sy);
      const scale = ch / 720;
      ctx.scale(scale, scale);
      const viewW = cw / scale;
      if (imgs.bg.complete) {
        ctx.drawImage(imgs.bg, -cam * 0.25, 0, viewW + 400, 720);
      } else {
        ctx.fillStyle = "#0c0a0d";
        ctx.fillRect(0, 0, viewW, 720);
      }
      ctx.translate(-cam, 0);
      ctx.fillStyle = "#120e10";
      ctx.fillRect(0, GROUND, WORLD, 200);
      ctx.fillStyle = "#2a221c";
      for (let i = 0; i < 18; i++) ctx.fillRect(i * 200 + 40, GROUND - 8 - (i % 3) * 6, 90, 10);
      drawSprite(imgs.fire, 150, GROUND + 8, 150, 1);
      ctx.fillStyle = "#efe6dc";
      ctx.font = "14px Manrope, sans-serif";
      ctx.fillText("Костёр  ·  E", 90, GROUND - 150);

      const seq = (n: number, u: number) => Math.min(n - 1, Math.max(0, Math.floor(u * n)));
      const air = !player.grounded;
      let set = imgs.idle;
      let fi = seq(4, (t * 2.2) % 1);
      if (player.dodge > 0) {
        set = imgs.dodge;
        fi = seq(4, 1 - player.dodge / 0.22);
      } else if (player.hurt > 0) {
        set = imgs.atk;
        fi = 0;
      } else if (player.parry > 0) {
        set = imgs.atk;
        fi = 1;
      } else if (player.atk > 0) {
        set = imgs.atk;
        fi = seq(4, 1 - player.atk / 0.42);
      } else if (air) {
        set = imgs.dodge;
        fi = player.vy < 0 ? 0 : 3;
      } else if (Math.abs(player.vx) > 30) {
        set = imgs.run;
        fi = seq(4, (t * 8) % 1);
      }
      const pAlpha = player.iframes > 0 && player.dodge <= 0 && Math.floor(t * 20) % 2 === 0 ? 0.45 : 1;
      if (player.dead <= 0) drawSprite(set[fi] ?? set[0], player.x, player.y + 6, 168, player.facing, pAlpha);
      if (player.atk > 0.1 && player.atk < 0.32) {
        ctx.save();
        ctx.translate(player.x, player.y - 48);
        ctx.scale(player.facing, 1);
        ctx.strokeStyle = "rgba(160,200,255,0.85)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(18, 0, 46, -1.1, 0.7);
        ctx.stroke();
        ctx.restore();
      }
      if (player.parry > 0) {
        ctx.strokeStyle = "#c5d0e0";
        ctx.strokeRect(player.x - 28, player.y - 90, 56, 90);
      }

      knights.forEach((k) => {
        if (!k.alive) return;
        const kFrame = k.atk > 0 ? seq(4, 1 - k.atk / 0.55) : k.stagger > 0 ? 0 : seq(4, (t * 5) % 1);
        const img = imgs.knight[kFrame] ?? imgs.knight[0];
        drawSprite(img, k.x, k.y + 4, 160, k.facing, k.hurt > 0 ? 0.7 : 1);
      });
      if (boss.alive) {
        const span = boss.atk > 0.6 ? 0.9 : 0.55;
        const bFrame = boss.atk > 0 ? seq(4, 1 - boss.atk / span) : seq(4, (t * 2.5) % 1);
        const img = imgs.boss[bFrame] ?? imgs.boss[0];
        drawSprite(img, boss.x, boss.y + 10, 300, boss.facing, boss.hurt > 0 ? 0.75 : 1);
      } else if (bossOn) {
        ctx.fillStyle = "#9a9088";
        ctx.fillText("Корона молчит.", boss.x - 40, GROUND - 40);
      }
      waves.forEach((w) => {
        ctx.strokeStyle = `rgba(224,122,61,${Math.max(0, w.life)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(w.x, GROUND - 6, w.w, 12, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    };

    const onKey = (e: KeyboardEvent, add: boolean) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (add) {
        if (!keys.has(e.code)) {
          if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyK") {
            if (player.st >= 24 && player.dodge <= 0 && player.atk <= 0 && player.dead <= 0) {
              if (e.code.startsWith("Shift")) {
                player.dodge = 0.22;
                player.iframes = 0.28;
                player.st -= 24;
              } else {
                player.parry = 0.22;
                player.st -= 16;
              }
            }
          }
          if (e.code === "KeyJ" || e.code === "Space") {
            if (player.atk <= 0 && player.dodge <= 0 && player.st >= 16 && player.dead <= 0) {
              player.atk = 0.42;
              player.st -= 16;
              beep(140, 0.06, "square", 0.03);
            }
          }
        }
        keys.add(e.code);
      } else keys.delete(e.code);
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    const clear = () => keys.clear();
    window.addEventListener("blur", clear);

    window.__controlsTest = {
      getYaw: () => player.facing,
      getSpeed: () => Math.abs(player.vx),
      getX: () => player.x,
      setKeys: (codes: string[]) => {
        keys.clear();
        codes.forEach((c) => keys.add(c));
        if (!startedRef) {
          /* sim always runs */
        }
      },
    };

    let raf = 0;
    const loop = (now: number) => {
      if (!running) return;
      let delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += delta;
      while (acc >= 1 / 60) {
        step(1 / 60);
        acc -= 1 / 60;
      }
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", clear);
      delete window.__controlsTest;
      delete window.__putnikUnlock;
    };
  }, []);

  const press = (code: string, on: boolean) => {
    if (on) held.current.add(code);
    else held.current.delete(code);
    if (on && (code === "KeyJ" || code === "ShiftLeft" || code === "KeyK" || code === "KeyE" || code === "KeyL")) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
    }
  };

  return (
    <div className="stage">
      <canvas ref={canvasRef} />
      <div className="hud">
        <div>
          <div className="bars">
            <div className="bar-row">
              <span>Жизнь</span>
              <div className="track"><div className="fill fill-hp" style={{ width: `${hud.hp}%` }} /></div>
            </div>
            <div className="bar-row">
              <span>Сила</span>
              <div className="track"><div className="fill fill-st" style={{ width: `${hud.st}%` }} /></div>
            </div>
            <div className="bar-row">
              <span>Осколок</span>
              <div className="track"><div className="fill fill-mp" style={{ width: `${(hud.mp / 60) * 100}%` }} /></div>
            </div>
          </div>
        </div>
        {hud.toast ? <div className="toast">{hud.toast}</div> : <span />}
        {hud.bossOn ? (
          <div className="boss-wrap">
            <div className="boss-name">Лорд погибших королей</div>
            <div className="track"><div className="fill fill-hp" style={{ width: `${(hud.boss / hud.bossMax) * 100}%` }} /></div>
          </div>
        ) : <span />}
      </div>
      {!started && (
        <div className="overlay">
          <div className="card">
            <div className="eyebrow">Руины и заброшенный замок</div>
            <h1>Пламя Путника</h1>
            <p className="lede">
              Он не герой. Он просто идёт дальше. Пройди двор, срази стражу и дойди до лорда, который не умер.
            </p>
            <div className="keys">
              <span className="chip">A D — шаг</span>
              <span className="chip">W — прыжок</span>
              <span className="chip">J — удар</span>
              <span className="chip">K — парирование</span>
              <span className="chip">Shift — уклон</span>
              <span className="chip">L — рывок осколка</span>
              <span className="chip">E — костёр</span>
            </div>
            <button
              className="play"
              type="button"
              onClick={() => {
                window.__putnikUnlock?.();
                setStarted(true);
              }}
            >
              Идти дальше
            </button>
          </div>
        </div>
      )}
      <div className="touch">
        <div className="pad">
          <button type="button" onPointerDown={() => press("KeyA", true)} onPointerUp={() => press("KeyA", false)} onPointerLeave={() => press("KeyA", false)}>A</button>
          <button type="button" onPointerDown={() => press("KeyD", true)} onPointerUp={() => press("KeyD", false)} onPointerLeave={() => press("KeyD", false)}>D</button>
        </div>
        <div className="acts">
          <button type="button" onPointerDown={() => press("KeyK", true)}>Пар</button>
          <button type="button" onPointerDown={() => press("ShiftLeft", true)}>Укл</button>
          <button type="button" onPointerDown={() => press("KeyJ", true)}>Удар</button>
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      getX: () => number;
      setKeys: (codes: string[]) => void;
    };
    __putnikUnlock?: () => void;
  }
}

const startedRef = true;
