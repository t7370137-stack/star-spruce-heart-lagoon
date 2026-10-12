import { i as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-_oY4LMf3.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var SAVE_KEY = "putnik-demo-v1";
var WORLD = 3400;
var GROUND = 560;
function loadImg(src) {
	const img = new Image();
	img.src = src;
	return img;
}
function aabb(a, b) {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function Game() {
	const canvasRef = (0, import_react.useRef)(null);
	const [started, setStarted] = (0, import_react.useState)(false);
	const [hud, setHud] = (0, import_react.useState)({
		hp: 100,
		st: 100,
		mp: 60,
		boss: 0,
		bossMax: 1,
		toast: "",
		bossOn: false
	});
	const held = (0, import_react.useRef)(/* @__PURE__ */ new Set());
	(0, import_react.useEffect)(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const imgs = {
			bg: loadImg("/sprites/bg.jpg"),
			fire: loadImg("/sprites/fire.png"),
			idle: [
				1,
				2,
				3,
				4
			].map((i) => loadImg(`/sprites/idle-${i}.png`)),
			run: [
				1,
				2,
				3,
				4
			].map((i) => loadImg(`/sprites/run-${i}.png`)),
			atk: [
				1,
				2,
				3,
				4
			].map((i) => loadImg(`/sprites/attack-${i}.png`)),
			knight: [
				1,
				2,
				3,
				4
			].map((i) => loadImg(`/sprites/knight-${i}.png`)),
			boss: [
				1,
				2,
				3,
				4
			].map((i) => loadImg(`/sprites/boss-${i}.png`))
		};
		const saved = (() => {
			try {
				return JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
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
			facing: 1,
			grounded: true,
			atk: 0,
			dodge: 0,
			parry: 0,
			iframes: 0,
			hurt: 0,
			dead: 0,
			anim: 0
		};
		const knights = [
			780,
			1280,
			1760
		].map((x) => ({
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
			cd: .6,
			stagger: 0,
			phase: 0,
			landed: false
		}));
		const boss = {
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
			landed: false
		};
		const waves = [];
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
		const keys = /* @__PURE__ */ new Set();
		const audio = { ctx: null };
		const unlock = () => {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC || audio.ctx) return;
			audio.ctx = new AC();
			audio.ctx.resume();
		};
		window.__putnikUnlock = unlock;
		const beep = (f, dur = .08, type = "square", gain = .04) => {
			if (!audio.ctx) return;
			const o = audio.ctx.createOscillator();
			const g = audio.ctx.createGain();
			o.type = type;
			o.frequency.value = f;
			g.gain.value = gain;
			o.connect(g);
			g.connect(audio.ctx.destination);
			o.start();
			g.gain.exponentialRampToValueAtTime(1e-4, audio.ctx.currentTime + dur);
			o.stop(audio.ctx.currentTime + dur);
		};
		const say = (s) => {
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
			if (boss.alive) knights.forEach((k, i) => {
				k.alive = true;
				k.hp = k.max;
				k.x = [
					780,
					1280,
					1760
				][i];
				k.atk = 0;
			});
			localStorage.setItem(SAVE_KEY, JSON.stringify({
				bossDead: !boss.alive,
				version: 1
			}));
			say("Пламя принимает тебя.");
			beep(220, .25, "sine", .06);
		};
		const hurtPlayer = (dmg) => {
			if (player.iframes > 0 || player.dead > 0) return;
			if (player.parry > 0) return;
			player.hp = Math.max(0, player.hp - dmg);
			player.iframes = .45;
			player.hurt = .25;
			player.vx = -player.facing * 180;
			shake = 8;
			beep(90, .12, "sawtooth", .05);
			if (player.hp <= 0) {
				player.dead = 1.6;
				say("Ты ещё идёшь.");
			}
		};
		const step = (dt) => {
			t += dt;
			const down = (c) => keys.has(c) || held.current.has(c);
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
					if (dir) player.facing = dir;
				} else if (player.dodge > 0) {
					player.vx = player.facing * 540;
					player.dodge -= dt;
				} else {
					player.vx *= .8;
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
				player.x = Math.max(40, Math.min(3340, player.x));
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
					beep(70, .4, "triangle", .07);
				}
			}
			const pbox = {
				x: player.x - 18,
				y: player.y - 78,
				w: 36,
				h: 78
			};
			const hit = player.atk > .12 && player.atk < .32 ? {
				x: player.facing === 1 ? player.x + 8 : player.x - 78,
				y: player.y - 70,
				w: 70,
				h: 40
			} : null;
			const tickFoe = (e, speed, reach, dmg, isBoss) => {
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
						e.atk = isBoss && e.phase >= 2 && Math.random() < .45 ? .9 : .55;
						e.landed = false;
						e.cd = isBoss ? e.phase >= 3 ? .85 : 1.25 : 1.35;
						if (isBoss && e.phase >= 2 && e.atk > .7) waves.push({
							x: e.x,
							w: 30,
							life: 1.1,
							dmg: 22
						});
					}
				}
				const striking = e.atk > .12 && e.atk < .34;
				if (striking && player.parry > 0 && Math.abs(dx) < reach + 20) {
					e.stagger = 1.1;
					e.atk = 0;
					e.landed = true;
					player.st = Math.min(100, player.st + 28);
					say("Парирование");
					beep(520, .08, "square", .05);
					shake = 5;
				} else if (striking) {
					const box = {
						x: e.facing === 1 ? e.x : e.x - reach,
						y: e.y - e.h * .7,
						w: reach,
						h: 36
					};
					if (!e.landed && aabb(pbox, box)) {
						e.landed = true;
						hurtPlayer(dmg);
					}
				}
				if (player.atk <= 0) swingHit = false;
				if (hit && !swingHit && aabb(hit, {
					x: e.x - e.w / 2,
					y: e.y - e.h,
					w: e.w,
					h: e.h
				})) {
					swingHit = true;
					const dealt = 16 + (player.mp > 20 && down("KeyL") ? 0 : 0);
					e.hp -= dealt;
					e.hurt = .15;
					shake = 4;
					beep(180, .05, "square", .04);
					player.atk = .12;
					if (e.hp <= 0) {
						e.alive = false;
						if (isBoss) {
							say("Корона рассыпалась.");
							localStorage.setItem(SAVE_KEY, JSON.stringify({
								bossDead: true,
								version: 1
							}));
							beep(330, .5, "sine", .06);
						}
					}
				}
				if (isBoss) {
					const ratio = e.hp / e.max;
					e.phase = ratio < .3 ? 3 : ratio < .6 ? 2 : 1;
				}
			};
			knights.forEach((k) => tickFoe(k, player.dead > 0 ? 0 : 70, 62, 14, false));
			if (bossOn) tickFoe(boss, boss.phase >= 3 ? 110 : 55, 110, boss.phase >= 3 ? 26 : 20, true);
			for (let i = waves.length - 1; i >= 0; i--) {
				const w = waves[i];
				w.life -= dt;
				w.w += 280 * dt;
				if (aabb(pbox, {
					x: w.x - w.w,
					y: 530,
					w: w.w * 2,
					h: 30
				})) hurtPlayer(w.dmg);
				if (w.life <= 0) waves.splice(i, 1);
			}
			if (down("KeyL") && player.mp >= 22 && player.dead <= 0 && player.dodge <= 0) {
				player.mp -= 22;
				player.iframes = .35;
				player.x += player.facing * 150;
				beep(640, .1, "sine", .04);
				keys.delete("KeyL");
				held.current.delete("KeyL");
			}
			cam += (player.x - 420 - cam) * Math.min(1, dt * 4);
			cam = Math.max(0, Math.min(2120, cam));
			toastT = Math.max(0, toastT - dt);
			shake = Math.max(0, shake - dt * 18);
			hudTick++;
			if (hudTick % 6 === 0) setHud({
				hp: player.hp,
				st: player.st,
				mp: player.mp,
				boss: Math.max(0, boss.hp),
				bossMax: boss.max,
				toast: toastT > 0 ? toast : "",
				bossOn: bossOn && boss.alive
			});
		};
		const drawSprite = (img, x, feet, h, face, alpha = 1) => {
			if (!img.complete || !img.naturalWidth) return;
			const w = img.naturalWidth / img.naturalHeight * h;
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
			const sx = (Math.random() - .5) * shake;
			const sy = (Math.random() - .5) * shake;
			ctx.clearRect(0, 0, cw, ch);
			ctx.save();
			ctx.translate(sx, sy);
			const scale = ch / 720;
			ctx.scale(scale, scale);
			const viewW = cw / scale;
			if (imgs.bg.complete) ctx.drawImage(imgs.bg, -cam * .25, 0, viewW + 400, 720);
			else {
				ctx.fillStyle = "#0c0a0d";
				ctx.fillRect(0, 0, viewW, 720);
			}
			ctx.translate(-cam, 0);
			ctx.fillStyle = "#120e10";
			ctx.fillRect(0, GROUND, WORLD, 200);
			ctx.fillStyle = "#2a221c";
			for (let i = 0; i < 18; i++) ctx.fillRect(i * 200 + 40, 552 - i % 3 * 6, 90, 10);
			drawSprite(imgs.fire, 150, 568, 150, 1);
			ctx.fillStyle = "#efe6dc";
			ctx.font = "14px Manrope, sans-serif";
			ctx.fillText("Костёр  ·  E", 90, 410);
			const frame = Math.floor(t * 6) % 4;
			const pAlpha = player.iframes > 0 && Math.floor(t * 20) % 2 === 0 ? .45 : 1;
			const set = player.atk > 0 ? imgs.atk : Math.abs(player.vx) > 30 ? imgs.run : imgs.idle;
			if (player.dead <= 0) drawSprite(set[frame] ?? set[0], player.x, player.y + 6, 168, player.facing, pAlpha);
			if (player.parry > 0) {
				ctx.strokeStyle = "#c5d0e0";
				ctx.strokeRect(player.x - 28, player.y - 90, 56, 90);
			}
			knights.forEach((k) => {
				if (!k.alive) return;
				const img = imgs.knight[k.atk > 0 ? 2 : frame] ?? imgs.knight[0];
				drawSprite(img, k.x, k.y + 4, 160, k.facing, k.hurt > 0 ? .7 : 1);
			});
			if (boss.alive) {
				const img = imgs.boss[boss.atk > .4 ? 2 : frame] ?? imgs.boss[0];
				drawSprite(img, boss.x, boss.y + 10, 300, boss.facing, boss.hurt > 0 ? .75 : 1);
			} else if (bossOn) {
				ctx.fillStyle = "#9a9088";
				ctx.fillText("Корона молчит.", boss.x - 40, 520);
			}
			waves.forEach((w) => {
				ctx.strokeStyle = `rgba(224,122,61,${Math.max(0, w.life)})`;
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.ellipse(w.x, 554, w.w, 12, 0, 0, Math.PI * 2);
				ctx.stroke();
			});
			ctx.restore();
		};
		const onKey = (e, add) => {
			if ([
				"Space",
				"ArrowUp",
				"ArrowDown",
				"ArrowLeft",
				"ArrowRight"
			].includes(e.code)) e.preventDefault();
			if (add) {
				if (!keys.has(e.code)) {
					if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyK") {
						if (player.st >= 24 && player.dodge <= 0 && player.atk <= 0 && player.dead <= 0) {
							if (e.code.startsWith("Shift")) {
								player.dodge = .22;
								player.iframes = .28;
								player.st -= 24;
							} else {
								player.parry = .22;
								player.st -= 16;
							}
						}
					}
					if (e.code === "KeyJ" || e.code === "Space") {
						if (player.atk <= 0 && player.dodge <= 0 && player.st >= 16 && player.dead <= 0) {
							player.atk = .42;
							player.st -= 16;
							beep(140, .06, "square", .03);
						}
					}
				}
				keys.add(e.code);
			} else keys.delete(e.code);
		};
		const kd = (e) => onKey(e, true);
		const ku = (e) => onKey(e, false);
		window.addEventListener("keydown", kd);
		window.addEventListener("keyup", ku);
		const clear = () => keys.clear();
		window.addEventListener("blur", clear);
		window.__controlsTest = {
			getYaw: () => player.facing,
			getSpeed: () => Math.abs(player.vx),
			getX: () => player.x,
			setKeys: (codes) => {
				keys.clear();
				codes.forEach((c) => keys.add(c));
				if (!startedRef) {}
			}
		};
		let raf = 0;
		const loop = (now) => {
			if (!running) return;
			let delta = Math.min(.05, (now - last) / 1e3);
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
	const press = (code, on) => {
		if (on) held.current.add(code);
		else held.current.delete(code);
		if (on && (code === "KeyJ" || code === "ShiftLeft" || code === "KeyK" || code === "KeyE" || code === "KeyL")) window.dispatchEvent(new KeyboardEvent("keydown", { code }));
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "stage",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", { ref: canvasRef }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "hud",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "bars",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "bar-row",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Жизнь" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "track",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "fill fill-hp",
										style: { width: `${hud.hp}%` }
									})
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "bar-row",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Сила" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "track",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "fill fill-st",
										style: { width: `${hud.st}%` }
									})
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "bar-row",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Осколок" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "track",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "fill fill-mp",
										style: { width: `${hud.mp / 60 * 100}%` }
									})
								})]
							})
						]
					}) }),
					hud.toast ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "toast",
						children: hud.toast
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
					hud.bossOn ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "boss-wrap",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "boss-name",
							children: "Лорд погибших королей"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "track",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "fill fill-hp",
								style: { width: `${hud.boss / hud.bossMax * 100}%` }
							})
						})]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {})
				]
			}),
			!started && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "overlay",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "card",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "eyebrow",
							children: "Руины и заброшенный замок"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "Пламя Путника" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "lede",
							children: "Он не герой. Он просто идёт дальше. Пройди двор, срази стражу и дойди до лорда, который не умер."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "keys",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "chip",
									children: "A D — шаг"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "chip",
									children: "W — прыжок"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "chip",
									children: "J — удар"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "chip",
									children: "K — парирование"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "chip",
									children: "Shift — уклон"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "chip",
									children: "L — рывок осколка"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "chip",
									children: "E — костёр"
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "play",
							type: "button",
							onClick: () => {
								window.__putnikUnlock?.();
								setStarted(true);
							},
							children: "Идти дальше"
						})
					]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "touch",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "pad",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onPointerDown: () => press("KeyA", true),
						onPointerUp: () => press("KeyA", false),
						onPointerLeave: () => press("KeyA", false),
						children: "A"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onPointerDown: () => press("KeyD", true),
						onPointerUp: () => press("KeyD", false),
						onPointerLeave: () => press("KeyD", false),
						children: "D"
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "acts",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onPointerDown: () => press("KeyK", true),
							children: "Пар"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onPointerDown: () => press("ShiftLeft", true),
							children: "Укл"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onPointerDown: () => press("KeyJ", true),
							children: "Удар"
						})
					]
				})]
			})
		]
	});
}
var startedRef = true;
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Game, {});
}
//#endregion
export { Home as component };
