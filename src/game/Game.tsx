import { useEffect, useRef, useState } from "react";

// ============================================================
//  ПЕПЕЛ И ЭХО — Часть 1
//  Процедурная мрачная экшн-платформер-арена
// ============================================================

// ---------- Константы мира ----------
const SAVE_KEY = "ash-and-echo-v1";
const WORLD_W = 3600;          // ширина арены
const GROUND_Y = 560;          // уровень земли в мировых координатах
const VIEW_H = 720;            // логическая высота кадра
const FIXED_DT = 1 / 60;

// ---------- Палитра (совпадает с concepts) ----------
const C = {
  bg: "#0c0a0d",
  bgFar: "#171319",
  bgMid: "#1e1820",
  ground: "#15100f",
  groundEdge: "#2a221c",
  fg: "#efe6dc",
  muted: "#9a9088",
  ember: "#e07a3d",
  emberHot: "#ffb066",
  steel: "#c5d0e0",
  steelDim: "#6a7484",
  blood: "#8f2d3a",
  rot: "#7a8a3a",
  bone: "#d8cfc0",
  shadow: "#08070a",
};

// ---------- Типы ----------
type Facing = 1 | -1;

interface Box { x: number; y: number; w: number; h: number }

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; max: number;
  color: string;
  size: number;
  grav: number;
}

interface Damage {
  x: number; y: number;
  vx: number; vy: number;
  life: number; max: number;
  text: string;
  color: string;
}

type EnemyKind = "knight" | "rotter";

interface Enemy {
  kind: EnemyKind;
  x: number; y: number;
  vx: number; vy: number;
  w: number; h: number;
  hp: number; max: number;
  facing: Facing;
  alive: boolean;
  hurt: number;
  atk: number;       // таймер атаки (растёт к 0)
  atkSpan: number;   // длительность атаки
  cd: number;        // кулдаун до следующей атаки
  stagger: number;   // стан после парирования
  hitThisSwing: boolean; // для мультихита игрока
  homeX: number;     // точка привязки
  aggro: boolean;
  phase: number;     // 1 = телеграф, 2 = удар — для читаемости
}

interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;   // нажатие (edge)
  parry: boolean;    // нажатие (edge)
  dodge: boolean;    // нажатие (edge)
  echo: boolean;     // нажатие (edge)
  interact: boolean; // нажатие (edge)
}

// ---------- Утилиты ----------
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const aabb = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ============================================================
//  Компонент
// ============================================================
export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState({
    hp: 100, hpMax: 100,
    st: 100, mp: 60, mpMax: 60,
    echo: 0,
    toast: "",
    area: "Руины и заброшенный замок",
  });

  // Ввод — один источник, куда пишут и клавиатура, и тач
  const input = useRef<InputState & { raw: Set<string> }>({
    left: false, right: false, jump: false,
    attack: false, parry: false, dodge: false, echo: false, interact: false,
    raw: new Set(),
  });
  const pressOnce = useRef<Set<keyof InputState>>(new Set());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ----- Звук -----
    let audio: AudioContext | null = null;
    const unlockAudio = () => {
      if (audio) return;
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      audio = new AC();
      void audio.resume();
    };
    (window as unknown as { __ashUnlock?: () => void }).__ashUnlock = unlockAudio;

    const beep = (freq: number, dur = 0.08, type: OscillatorType = "square", gain = 0.04) => {
      if (!audio) return;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g); g.connect(audio.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.stop(audio.currentTime + dur);
    };

    // ----- Сохранение -----
    interface Save { echo: number; deaths: number; obelisk: boolean }
    const loadSave = (): Save => {
      try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null") as Partial<Save> | null;
        return { echo: s?.echo ?? 0, deaths: s?.deaths ?? 0, obelisk: s?.obelisk ?? false };
      } catch {
        return { echo: 0, deaths: 0, obelisk: false };
      }
    };
    const writeSave = (s: Save) => {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    };
    let save = loadSave();

    // ----- Игрок -----
    const player = {
      x: 180, y: GROUND_Y, vx: 0, vy: 0,
      w: 34, h: 78,
      hp: 100, hpMax: 100,
      st: 100, stMax: 100,
      mp: 60, mpMax: 60,
      facing: 1 as Facing,
      grounded: true,
      atk: 0, atkSpan: 0.42,
      dodge: 0, dodgeSpan: 0.24,
      parry: 0, parrySpan: 0.22,
      iframes: 0, hurt: 0, dead: 0,
      anim: 0, echo: save.echo,
      comboStep: 0, comboWindow: 0,
      echoCd: 0, echoThrow: 0,
      trail: [] as { x: number; y: number; life: number }[],
    };

    // ----- Враги -----
    const spawnEnemy = (kind: EnemyKind, x: number): Enemy => {
      const base: Enemy = {
        kind, x, y: GROUND_Y, vx: 0, vy: 0,
        w: kind === "knight" ? 42 : 34,
        h: kind === "knight" ? 84 : 54,
        hp: kind === "knight" ? 90 : 55,
        max: kind === "knight" ? 90 : 55,
        facing: -1 as Facing,
        alive: true, hurt: 0,
        atk: 0, atkSpan: kind === "knight" ? 0.7 : 0.45,
        cd: rand(0.4, 1.1),
        stagger: 0, hitThisSwing: false,
        homeX: x, aggro: false,
        phase: 0,
      };
      return base;
    };

    const enemies: Enemy[] = [
      spawnEnemy("knight", 900),
      spawnEnemy("rotter", 1240),
      spawnEnemy("rotter", 1420),
      spawnEnemy("knight", 1780),
      spawnEnemy("rotter", 2050),
      spawnEnemy("knight", 2380),
      spawnEnemy("rotter", 2600),
      spawnEnemy("knight", 2950),
    ];

    // ----- Мир: обелиск (чекпоинт) -----
    const obelisk = { x: 300, active: save.obelisk };

    // ----- Эффекты -----
    const particles: Particle[] = [];
    const damages: Damage[] = [];
    let cam = 0;
    let shake = 0;
    let t = 0;
    let toastText = "";
    let toastT = 0;
    let running = true;
    let raf = 0;
    let hudTick = 0;

    const say = (s: string) => { toastText = s; toastT = 2.6; };

    const addParticles = (x: number, y: number, n: number, color: string, spread = 120, up = true) => {
      for (let i = 0; i < n; i++) {
        particles.push({
          x: x + rand(-6, 6), y: y + rand(-6, 6),
          vx: rand(-spread, spread), vy: up ? rand(-spread * 1.2, -20) : rand(-20, spread * 0.4),
          life: rand(0.3, 0.7), max: 0.7,
          color, size: rand(1, 3), grav: up ? 420 : 120,
        });
      }
    };

    const addDamage = (x: number, y: number, text: string, color: string) => {
      damages.push({ x, y, vx: rand(-16, 16), vy: -60, life: 0.8, max: 0.8, text, color });
    };

    // ----- Урон -----
    const hurtPlayer = (dmg: number) => {
      if (player.iframes > 0 || player.dead > 0 || player.parry > 0) return;
      player.hp = Math.max(0, player.hp - dmg);
      player.iframes = 0.45;
      player.hurt = 0.25;
      player.vx = -player.facing * 180;
      shake = 9;
      beep(90, 0.12, "sawtooth", 0.05);
      addParticles(player.x, player.y - 40, 8, C.blood, 140, true);
      addDamage(player.x, player.y - 90, `-${dmg}`, C.blood);
      if (player.hp <= 0) {
        player.dead = 1.8;
        say("Ты ещё идёшь…");
      }
    };

    // ----- Отдых у обелиска -----
    const restAtObelisk = () => {
      player.hp = player.hpMax;
      player.st = player.stMax;
      player.mp = player.mpMax;
      player.dead = 0;
      player.x = obelisk.x + 60;
      player.vx = 0; player.vy = 0;
      obelisk.active = true;
      enemies.forEach((e) => { e.alive = true; e.hp = e.max; e.x = e.homeX; e.aggro = false; e.atk = 0; e.stagger = 0; });
      save = { echo: player.echo, deaths: save.deaths, obelisk: true };
      writeSave(save);
      say("Обелиск помнит тебя.");
      beep(220, 0.3, "sine", 0.06);
      addParticles(obelisk.x, GROUND_Y - 40, 24, C.steel, 90, true);
    };

    // ----- Игровой шаг -----
    const step = (dt: number) => {
      t += dt;
      const inp = input.current;

      // ---- Игрок ----
      if (player.dead > 0) {
        player.dead -= dt;
        if (player.dead <= 0) {
          save.deaths += 1;
          writeSave(save);
          restAtObelisk();
        }
      } else {
        const canAct = player.atk <= 0 && player.dodge <= 0;

        if (canAct) {
          const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
          player.vx = dir * 260;
          if (dir) player.facing = dir as Facing;
        } else if (player.dodge > 0) {
          player.vx = player.facing * 560;
          player.dodge -= dt;
        } else if (player.atk > 0) {
          // лёгкое скольжение при ударе
          player.vx *= 0.82;
          player.atk -= dt;
          if (player.atk <= 0) player.comboWindow = 0.25;
        }

        if (player.comboWindow > 0) {
          player.comboWindow -= dt;
          if (player.comboWindow <= 0) player.comboStep = 0;
        }

        // Прыжок
        if (inp.jump && player.grounded && player.st > 12 && player.dodge <= 0) {
          player.vy = -580;
          player.grounded = false;
          player.st -= 12;
          pressOnce.current.delete("jump");
          addParticles(player.x, player.y, 6, C.muted, 60, false);
        }

        // Физика
        player.vy += 1750 * dt;
        player.x += player.vx * dt;
        player.y += player.vy * dt;
        if (player.y >= GROUND_Y) {
          if (!player.grounded) addParticles(player.x, GROUND_Y, 5, C.muted, 70, false);
          player.y = GROUND_Y;
          player.vy = 0;
          player.grounded = true;
        }
        player.x = clamp(player.x, 40, WORLD_W - 60);
        player.st = Math.min(player.stMax, player.st + 24 * dt);
        player.mp = Math.min(player.mpMax, player.mp + 5 * dt);
        player.iframes = Math.max(0, player.iframes - dt);
        player.hurt = Math.max(0, player.hurt - dt);
        player.parry = Math.max(0, player.parry - dt);
        player.echoCd = Math.max(0, player.echoCd - dt);
        player.echoThrow -= dt;
        player.anim += dt;

        // Действия (edge)
        if (pressOnce.current.has("attack") && player.atk <= 0 && player.dodge <= 0 && player.st >= 16) {
          player.atk = 0.4;
          player.comboStep = Math.min(2, player.comboStep + 1);
          player.comboWindow = 0.35;
          player.st -= 14;
          beep(150 + player.comboStep * 40, 0.06, "square", 0.03);
          addParticles(
            player.x + player.facing * 40,
            player.y - 48,
            4,
            C.steel,
            120,
            true
          );
        }
        if (pressOnce.current.has("parry") && player.parry <= 0 && player.st >= 16 && player.dodge <= 0) {
          player.parry = player.parrySpan;
          player.st -= 16;
          beep(520, 0.05, "triangle", 0.03);
        }
        if (pressOnce.current.has("dodge") && player.dodge <= 0 && player.st >= 24 && player.atk <= 0) {
          player.dodge = player.dodgeSpan;
          player.iframes = 0.3;
          player.st -= 24;
          beep(640, 0.06, "sine", 0.03);
        }
        if (pressOnce.current.has("echo") && player.echoCd <= 0 && player.mp >= 22 && player.dead <= 0) {
          player.mp -= 22;
          player.echoCd = 0.7;
          player.echoThrow = 0.18;
          beep(700, 0.09, "sine", 0.04);
          addParticles(player.x + player.facing * 40, player.y - 52, 12, C.steel, 200, true);
        }
        // взаимодействие с обелиском
        if (pressOnce.current.has("interact") && Math.abs(player.x - obelisk.x) < 90) {
          restAtObelisk();
        }

        // След рывка
        if (player.dodge > 0) {
          player.trail.push({ x: player.x, y: player.y, life: 0.22 });
          if (player.trail.length > 10) player.trail.shift();
        }
      }
      pressOnce.current.clear();

      // ---- Хитбоксы игрока ----
      const pBox: Box = { x: player.x - 18, y: player.y - 78, w: 36, h: 78 };
      const swinging = player.atk > 0.12 && player.atk < 0.34;
      const dmgThisSwing = 14 + player.comboStep * 6; // растёт с комбо
      const hitBox: Box | null = swinging
        ? {
            x: player.facing === 1 ? player.x + 10 : player.x - 80,
            y: player.y - 70,
            w: 70,
            h: 44,
          }
        : null;

      // ---- Враги ----
      for (const e of enemies) {
        if (!e.alive) continue;
        e.hurt = Math.max(0, e.hurt - dt);
        e.stagger = Math.max(0, e.stagger - dt);
        e.cd = Math.max(0, e.cd - dt);
        e.atk = Math.max(0, e.atk - dt);

        const dx = player.x - e.x;
        const dist = Math.abs(dx);
        if (!e.aggro && dist < 340) e.aggro = true;
        if (e.aggro) e.facing = dx >= 0 ? 1 : -1;

        // ИИ
        if (e.stagger <= 0 && e.atk <= 0 && player.dead <= 0 && e.aggro) {
          const reach = e.kind === "knight" ? 66 : 54;
          const speed = e.kind === "knight" ? 72 : 130;
          if (dist > reach) {
            e.x += Math.sign(dx) * speed * dt;
            if (e.kind === "rotter" && Math.random() < 0.02) {
              e.vx = Math.sign(dx) * 260; // рывок
            }
          } else if (e.cd <= 0) {
            e.atk = e.atkSpan;
            e.cd = e.kind === "knight" ? rand(1.2, 1.8) : rand(0.9, 1.4);
            e.phase = 1;
            e.hitThisSwing = false;
            if (e.kind === "knight") {
              beep(120, 0.1, "sawtooth", 0.04);
            }
          }
        }
        // «рывок» гниющиx: быстрое смещение
        if (e.kind === "rotter" && e.vx !== 0) {
          e.x += e.vx * dt;
          e.vx *= 0.86;
          if (Math.abs(e.vx) < 10) e.vx = 0;
        }
        e.x = clamp(e.x, 40, WORLD_W - 40);

        // ---- Разрешение удара врага ----
        if (e.atk > 0) {
          const span = e.atkSpan;
          const strikeStart = span * 0.35;
          const strikeEnd = span * 0.62;
          if (e.atk < span - strikeStart && e.atk > span - strikeEnd) {
            const reach = e.kind === "knight" ? 70 : 56;
            const box: Box = {
              x: e.facing === 1 ? e.x : e.x - reach,
              y: e.y - e.h * 0.75,
              w: reach,
              h: 42,
            };
            if (!e.hitThisSwing && aabb(pBox, box)) {
              e.hitThisSwing = true;
              if (player.parry > 0) {
                e.stagger = 1.2;
                e.atk = 0;
                player.st = Math.min(player.stMax, player.st + 30);
                shake = 6;
                say("Парирование");
                beep(560, 0.08, "square", 0.05);
                addParticles(e.x, e.y - e.h * 0.6, 10, C.steel, 160, true);
                addDamage(e.x, e.y - e.h - 10, "ПАРИРОВАНО", C.steel);
              } else {
                hurtPlayer(e.kind === "knight" ? 16 : 11);
              }
            }
          }
        }

        // ---- Удар игрока по врагу ----
        if (hitBox && !e.hitThisSwing && aabb(hitBox, { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h })) {
          e.hitThisSwing = true;
          e.hp -= dmgThisSwing;
          e.hurt = 0.18;
          e.x += player.facing * 6;
          shake = 4;
          beep(200, 0.05, "square", 0.04);
          addParticles(e.x, e.y - e.h * 0.6, 10, C.ember, 140, true);
          addDamage(e.x, e.y - e.h - 6, `${dmgThisSwing}`, C.emberHot);
          if (e.hp <= 0) {
            e.alive = false;
            const gained = e.kind === "knight" ? 18 : 9;
            player.echo += gained;
            save.echo = player.echo;
            writeSave(save);
            addDamage(e.x, e.y - e.h - 20, `+${gained} эхо`, C.steel);
            addParticles(e.x, e.y - e.h * 0.5, 24, C.ember, 180, true);
            beep(320, 0.18, "triangle", 0.05);
          }
        }
        // сброс флага после окончания окна удара
        if (!swinging) e.hitThisSwing = false;
      }

      // ---- Частицы/цифры ----
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (let i = damages.length - 1; i >= 0; i--) {
        const d = damages[i];
        d.life -= dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vy *= 0.92;
        if (d.life <= 0) damages.splice(i, 1);
      }
      for (let i = player.trail.length - 1; i >= 0; i--) {
        player.trail[i].life -= dt;
        if (player.trail[i].life <= 0) player.trail.splice(i, 1);
      }

      // ---- Камера/тряска/тост ----
      cam += (player.x - 420 - cam) * Math.min(1, dt * 4);
      cam = clamp(cam, 0, WORLD_W - 1280);
      shake = Math.max(0, shake - dt * 22);
      toastT = Math.max(0, toastT - dt);

      // ---- HUD ----
      hudTick++;
      if (hudTick % 5 === 0) {
        setHud({
          hp: player.hp, hpMax: player.hpMax,
          st: player.st, mp: player.mp, mpMax: player.mpMax,
          echo: player.echo,
          toast: toastT > 0 ? toastText : "",
          area: player.x > 2000 ? "Пепельные пустоши" : "Руины и заброшенный замок",
        });
      }
    };

    // ============================================================
    //  Рендер (процедурный, пиксельно-силуэтный)
    // ============================================================
    const drawShadow = (x: number, feet: number, w: number) => {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.ellipse(x, feet, w, w * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawPlayer = (alpha: number) => {
      const px = player.x;
      const py = player.y;
      const f = player.facing;

      // след рывка
      for (const tr of player.trail) {
        ctx.globalAlpha = (tr.life / 0.22) * 0.35;
        ctx.fillStyle = C.steel;
        ctx.fillRect(tr.x - 10, tr.y - 78, 20, 78);
      }
      ctx.globalAlpha = 1;

      drawShadow(px, py + 3, 22);

      // тело-силуэт с плащом
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.scale(f, 1);

      // ноги
      const stride = Math.abs(player.vx) > 30 && player.grounded ? Math.sin(t * 16) : 0;
      ctx.fillStyle = "#1a1620";
      ctx.fillRect(-9, -30 + stride * 2, 8, 30);
      ctx.fillRect(1, -30 - stride * 2, 8, 30);

      // торс
      ctx.fillStyle = "#221c26";
      ctx.fillRect(-14, -64, 28, 36);

      // плащ — развевается
      const cloakWave = Math.sin(t * 3) * 3;
      ctx.fillStyle = "#14101a";
      ctx.beginPath();
      ctx.moveTo(-16, -66);
      ctx.lineTo(-30 - cloakWave, -20);
      ctx.lineTo(-24, -4);
      ctx.lineTo(10, -6);
      ctx.lineTo(16, -64);
      ctx.closePath();
      ctx.fill();

      // капюшон
      ctx.fillStyle = "#2a232e";
      ctx.beginPath();
      ctx.arc(0, -72, 11, 0, Math.PI * 2);
      ctx.fill();

      // светящийся осколок в груди
      ctx.fillStyle = "rgba(150,180,255,0.85)";
      ctx.fillRect(-2, -58, 4, 4);
      ctx.fillStyle = "rgba(150,180,255,0.25)";
      ctx.fillRect(-6, -62, 12, 12);

      // меч
      const swing = player.atk > 0 ? (1 - player.atk / player.atkSpan) : 0;
      const armAngle = player.atk > 0 ? -1.1 + swing * 2.2 : (player.parry > 0 ? -0.4 : -0.2);
      ctx.save();
      ctx.translate(10, -56);
      ctx.rotate(armAngle);
      ctx.fillStyle = "#0a080c";
      ctx.fillRect(0, -2, 40, 4);
      ctx.fillStyle = "rgba(200,220,255,0.75)";
      ctx.fillRect(38, -1.5, 8, 3);
      ctx.restore();

      // искры на мече
      if (player.atk > 0.1 && player.atk < 0.34) {
        ctx.strokeStyle = "rgba(180,210,255,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(14, -56, 42, -1.0 + swing * 2.2, 0.9 + swing * 2.2);
        ctx.stroke();
      }

      // парирование — вспышка щита
      if (player.parry > 0) {
        ctx.strokeStyle = "rgba(197,208,224,0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(-24, -80, 48, 84);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = C.steel;
        ctx.fillRect(-24, -80, 48, 84);
      }
      ctx.globalAlpha = alpha;
      ctx.restore();
    };

    const drawEnemy = (e: Enemy) => {
      const f = e.facing;
      drawShadow(e.x, e.y + 3, e.w * 0.6);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(f, 1);

      const hurtAlpha = e.hurt > 0 ? 0.75 : 1;
      const telegraph = e.atk > 0 && e.atk > e.atkSpan * 0.6;

      if (e.kind === "knight") {
        // ноги
        ctx.fillStyle = "#241e20";
        ctx.fillRect(-12, -34, 9, 34);
        ctx.fillRect(3, -34, 9, 34);
        // торс-броня
        ctx.fillStyle = "#2c2426";
        ctx.fillRect(-16, -70, 32, 38);
        // шлем
        ctx.fillStyle = "#3a3030";
        ctx.fillRect(-9, -84, 18, 16);
        // рога
        ctx.fillStyle = "#4a3c30";
        ctx.fillRect(-12, -90, 4, 10);
        ctx.fillRect(8, -90, 4, 10);
        // щит
        ctx.fillStyle = "#20181a";
        ctx.fillRect(14, -66, 14, 30);
        // меч
        const swing = e.atk > 0 ? 1 - e.atk / e.atkSpan : 0;
        const ang = e.atk > 0 ? -1 + swing * 2 : -0.15;
        ctx.save();
        ctx.translate(-14, -60);
        ctx.rotate(-ang);
        ctx.fillStyle = "#0a080c";
        ctx.fillRect(-38, -2, 38, 4);
        ctx.restore();
        // телеграф — красный отблеск
        if (telegraph) {
          ctx.strokeStyle = "rgba(224,122,61,0.7)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, -60, 32, -0.8, 0.8);
          ctx.stroke();
        }
      } else {
        // Гниющий — низкий, быстрый, покрыт мхом
        ctx.fillStyle = "#1c1c14";
        ctx.fillRect(-13, -22, 8, 22);
        ctx.fillRect(5, -22, 8, 22);
        // тело сгорбленное
        ctx.fillStyle = "#2a2818";
        ctx.beginPath();
        ctx.moveTo(-16, -22);
        ctx.lineTo(-10, -50);
        ctx.lineTo(10, -52);
        ctx.lineTo(16, -22);
        ctx.closePath();
        ctx.fill();
        // мох
        ctx.fillStyle = "#4a5024";
        ctx.fillRect(-12, -50, 6, 6);
        ctx.fillRect(4, -48, 5, 5);
        // глаза
        ctx.fillStyle = "rgba(224,160,60,0.85)";
        ctx.fillRect(-6, -44, 3, 3);
        ctx.fillRect(2, -44, 3, 3);
        // когти-руки
        const swing = e.atk > 0 ? 1 - e.atk / e.atkSpan : 0;
        ctx.save();
        ctx.translate(-10, -34);
        ctx.rotate(-(e.atk > 0 ? -0.8 + swing * 1.6 : -0.1));
        ctx.fillStyle = "#100e0a";
        ctx.fillRect(-22, -2, 22, 4);
        ctx.restore();
        if (telegraph) {
          ctx.strokeStyle = "rgba(150,180,80,0.7)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, -34, 22, -0.8, 0.8);
          ctx.stroke();
        }
      }

      // полоса HP над врагом, если ранен
      if (e.hp < e.max) {
        const w = e.kind === "knight" ? 44 : 34;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(-w / 2, -e.h - 14, w, 4);
        ctx.fillStyle = C.blood;
        ctx.fillRect(-w / 2, -e.h - 14, w * (e.hp / e.max), 4);
      }
      ctx.globalAlpha = hurtAlpha;
      ctx.restore();
    };

    const drawObelisk = () => {
      const x = obelisk.x;
      drawShadow(x, GROUND_Y + 3, 22);
      // основание
      ctx.fillStyle = "#1a1620";
      ctx.fillRect(x - 18, GROUND_Y - 12, 36, 12);
      // столб
      ctx.fillStyle = "#221c26";
      ctx.fillRect(x - 8, GROUND_Y - 110, 16, 100);
      // светящийся кристалл
      const glow = 0.6 + Math.sin(t * 3) * 0.25;
      ctx.fillStyle = `rgba(197,208,224,${glow})`;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y - 130);
      ctx.lineTo(x - 8, GROUND_Y - 112);
      ctx.lineTo(x, GROUND_Y - 100);
      ctx.lineTo(x + 8, GROUND_Y - 112);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(197,208,224,${glow * 0.25})`;
      ctx.beginPath();
      ctx.arc(x, GROUND_Y - 114, 30, 0, Math.PI * 2);
      ctx.fill();
      // подпись
      ctx.fillStyle = C.fg;
      ctx.font = "13px Manrope, sans-serif";
      ctx.fillText("Обелиск · E", x - 44, GROUND_Y - 150);
      // искры
      if (Math.random() < 0.2) addParticles(x, GROUND_Y - 114, 1, C.steel, 20, true);
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

      const scale = ch / VIEW_H;
      ctx.scale(scale, scale);
      const viewW = cw / scale;

      // небо
      const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
      grad.addColorStop(0, "#0a0810");
      grad.addColorStop(0.55, "#160f14");
      grad.addColorStop(1, "#1c1210");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, viewW, VIEW_H);

      // луна
      const moonX = viewW - 220;
      ctx.fillStyle = "rgba(224,160,120,0.18)";
      ctx.beginPath();
      ctx.arc(moonX, 130, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(224,160,120,0.5)";
      ctx.beginPath();
      ctx.arc(moonX, 130, 34, 0, Math.PI * 2);
      ctx.fill();

      // дальний слой — башни (параллакс 0.25)
      ctx.save();
      ctx.translate(-cam * 0.25, 0);
      ctx.fillStyle = C.bgFar;
      for (let i = 0; i < 20; i++) {
        const bx = i * 260 + 40;
        const bh = 180 + ((i * 53) % 160);
        ctx.fillRect(bx, VIEW_H - 200 - bh, 90, bh + 200);
        // шпиль
        ctx.beginPath();
        ctx.moveTo(bx + 45, VIEW_H - 220 - bh);
        ctx.lineTo(bx + 20, VIEW_H - 200 - bh);
        ctx.lineTo(bx + 70, VIEW_H - 200 - bh);
        ctx.closePath();
        ctx.fill();
        // окно-огонёк
        if (i % 3 === 0) {
          ctx.fillStyle = "rgba(224,122,61,0.5)";
          ctx.fillRect(bx + 42, VIEW_H - 220 - bh + 60, 6, 10);
          ctx.fillStyle = C.bgFar;
        }
      }
      ctx.restore();

      // средний слой — руины (параллакс 0.6)
      ctx.save();
      ctx.translate(-cam * 0.6, 0);
      ctx.fillStyle = C.bgMid;
      for (let i = 0; i < 16; i++) {
        const bx = i * 320 + 100;
        const bh = 100 + ((i * 37) % 120);
        ctx.fillRect(bx, VIEW_H - 180 - bh, 70, bh + 180);
        // арки
        ctx.fillStyle = C.bg;
        ctx.fillRect(bx + 18, VIEW_H - 160 - bh + 40, 34, 60);
        ctx.fillStyle = C.bgMid;
      }
      ctx.restore();

      // земля
      ctx.save();
      ctx.translate(-cam, 0);
      ctx.fillStyle = C.ground;
      ctx.fillRect(0, GROUND_Y, WORLD_W, 200);
      ctx.fillStyle = C.groundEdge;
      ctx.fillRect(0, GROUND_Y, WORLD_W, 4);
      // камни на земле
      ctx.fillStyle = "#231c18";
      for (let i = 0; i < 40; i++) {
        const rx = i * 90 + 20;
        ctx.fillRect(rx, GROUND_Y + 10 + (i % 4) * 6, 22 + (i % 3) * 6, 6);
      }

      drawObelisk();

      // враги
      for (const e of enemies) if (e.alive) drawEnemy(e);

      // игрок
      if (player.dead <= 0 || Math.floor(t * 12) % 2 === 0) {
        const alpha = player.iframes > 0 && player.dodge <= 0 ? 0.5 : 1;
        drawPlayer(alpha);
      }

      // частицы
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      // цифры урона
      for (const d of damages) {
        ctx.globalAlpha = Math.max(0, d.life / d.max);
        ctx.fillStyle = d.color;
        ctx.font = "bold 15px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(d.text, d.x, d.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
      ctx.restore();

      // виньетка
      const vg = ctx.createRadialGradient(viewW / 2, VIEW_H / 2, VIEW_H * 0.3, viewW / 2, VIEW_H / 2, VIEW_H);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, viewW, VIEW_H);

      // пепел — падающие точки
      ctx.fillStyle = "rgba(200,180,160,0.35)";
      for (let i = 0; i < 30; i++) {
        const ax = ((i * 137 + t * 20) % viewW);
        const ay = ((i * 91 + t * 12) % VIEW_H);
        ctx.fillRect(ax, ay, 1.5, 1.5);
      }

      ctx.restore();
    };

    // ============================================================
    //  Цикл
    // ============================================================
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      if (!running) return;
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += delta;
      while (acc >= FIXED_DT) {
        step(FIXED_DT);
        acc -= FIXED_DT;
      }
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // ============================================================
    //  Ввод
    // ============================================================
    const setKey = (code: string, down: boolean) => {
      const inp = input.current;
      const raw = inp.raw;
      const wasDown = raw.has(code);
      if (down) raw.add(code); else raw.delete(code);

      const edge = down && !wasDown;
      switch (code) {
        case "KeyA": case "ArrowLeft": inp.left = down; break;
        case "KeyD": case "ArrowRight": inp.right = down; break;
        case "KeyW": case "ArrowUp": case "Space":
          inp.jump = down; if (edge) pressOnce.current.add("jump"); break;
        case "KeyJ":
          inp.attack = down; if (edge) pressOnce.current.add("attack"); break;
        case "KeyK":
          inp.parry = down; if (edge) pressOnce.current.add("parry"); break;
        case "ShiftLeft": case "ShiftRight":
          inp.dodge = down; if (edge) pressOnce.current.add("dodge"); break;
        case "KeyL":
          inp.echo = down; if (edge) pressOnce.current.add("echo"); break;
        case "KeyE": case "KeyF":
          inp.interact = down; if (edge) pressOnce.current.add("interact"); break;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      setKey(e.code, true);
    };
    const onKeyUp = (e: KeyboardEvent) => setKey(e.code, false);
    const onBlur = () => {
      input.current.raw.clear();
      const inp = input.current;
      inp.left = inp.right = inp.jump = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // публичный хук для тач-управления (из JSX)
    (window as unknown as { __ashSetKey?: (code: string, down: boolean) => void }).__ashSetKey = setKey;

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      delete (window as unknown as { __ashSetKey?: unknown }).__ashSetKey;
      delete (window as unknown as { __ashUnlock?: unknown }).__ashUnlock;
    };
  }, []);

  // ---------- Тач-кнопки ----------
  const touch = (code: string, down: boolean) => {
    const fn = (window as unknown as { __ashSetKey?: (c: string, d: boolean) => void }).__ashSetKey;
    if (fn) fn(code, down);
  };
  const btn = (code: string, label: string) => (
    <button
      type="button"
      onPointerDown={(ev) => { ev.preventDefault(); touch(code, true); }}
      onPointerUp={(ev) => { ev.preventDefault(); touch(code, false); }}
      onPointerLeave={() => touch(code, false)}
      onPointerCancel={() => touch(code, false)}
    >
      {label}
    </button>
  );

  const hpPct = (hud.hp / hud.hpMax) * 100;
  const stPct = hud.st;
  const mpPct = (hud.mp / hud.mpMax) * 100;

  return (
    <div className="stage">
      <canvas ref={canvasRef} />
      <div className="hud">
        <div>
          <div className="bars">
            <div className="bar-row">
              <span>Жизнь</span>
              <div className="track"><div className="fill fill-hp" style={{ width: `${hpPct}%` }} /></div>
            </div>
            <div className="bar-row">
              <span>Сила</span>
              <div className="track"><div className="fill fill-st" style={{ width: `${stPct}%` }} /></div>
            </div>
            <div className="bar-row">
              <span>Эхо</span>
              <div className="track"><div className="fill fill-mp" style={{ width: `${mpPct}%` }} /></div>
            </div>
            <div className="bar-row" style={{ color: C.steel, fontSize: "0.7rem", letterSpacing: "0.16em" }}>
              <span>Осколки</span>
              <span style={{ textTransform: "none", letterSpacing: "0.04em", color: C.fg }}>
                {hud.echo}
              </span>
            </div>
          </div>
        </div>
        {hud.toast ? <div className="toast">{hud.toast}</div> : <span />}
        <div className="boss-wrap" style={{ opacity: 0.7 }}>
          <div className="boss-name">{hud.area}</div>
        </div>
      </div>

      {!started && (
        <div className="overlay">
          <div className="card">
            <div className="eyebrow">Пепел и Эхо · Разлом</div>
            <h1>Последний из Осколков</h1>
            <p className="lede">
              Он не герой. Он просто идёт дальше. Руины помнят его шаги, а обелиски хранят его эхо.
            </p>
            <div className="keys">
              <span className="chip">A / D — шаг</span>
              <span className="chip">W — прыжок</span>
              <span className="chip">J — удар</span>
              <span className="chip">K — парирование</span>
              <span className="chip">Shift — уклон</span>
              <span className="chip">L — эхо-рывок</span>
              <span className="chip">E — обелиск</span>
            </div>
            <button
              className="play"
              type="button"
              onClick={() => {
                const unlock = (window as unknown as { __ashUnlock?: () => void }).__ashUnlock;
                if (unlock) unlock();
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
          {btn("KeyA", "A")}
          {btn("KeyD", "D")}
          {btn("KeyW", "W")}
        </div>
        <div className="acts">
          {btn("KeyK", "Пар")}
          {btn("ShiftLeft", "Укл")}
          {btn("KeyL", "Эхо")}
          {btn("KeyJ", "Удар")}
        </div>
      </div>
    </div>
  );
}
