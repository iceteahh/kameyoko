# Kameyoko — Kamehameha Camera

Stand in front of your MacBook camera, strike the Kamehameha form, and fire a beam.
Two players can duel: when beams collide you get a **beam struggle**, and whoever pumps harder wins.

Runs entirely in the browser: MediaPipe pose + hand tracking on the GPU, Three.js shaders for the energy, synthesized audio. No video leaves your machine.

## Run

```bash
npm install          # also copies the MediaPipe WASM runtime into public/
npm run dev          # opens http://localhost:5173
```

Use Chrome, Edge or Safari. On first run macOS asks for camera permission for the browser
(System Settings → Privacy & Security → Camera).

Models download from Google's CDN on first start. To work offline, run `npm run fetch-models` once.

**No camera handy?** Open `http://localhost:5173/?demo` for a scripted two-player duel, or
`?demo=solo` for a single player who powers up to Super Saiyan, then fires at the camera.

## How to play

| Step | Pose | What's checked |
|---|---|---|
| Stance | Feet wide, knees bent | Ankle spread ≥ 1.4× shoulder width and knee angle. Only scored when your legs are in frame; it's a power bonus, not a requirement |
| **KA-ME-HA-ME…** | Cup both hands together and pull them back to your hip, elbows bent | Wrists together, hands below chest, elbows bent. Hold it to charge (≈2.5 s to full) |
| **HA!** | Thrust both arms forward, wrists together, palms open | Elbows straight, hands at chest height, arms reaching out |
| **Super Saiyan power-up** *(optional)* | Goku's power-up: deep horse stance (feet wide, knees bent), fists clenched and pulled in to your hips, elbows bent back, and scream | Wide bent-knee stance (when your legs are in frame), fists apart at hip height, elbows bent. Hold ≈2.5 s to transform |

- Stand about **2 m** from the camera so your whole body fits.
- **Solo**: the beam follows your arms. Thrust sideways and it flies to the screen edge; thrust at the camera and it blasts toward the viewer.
- **Duel**: player 1 stands on the **left**, player 2 on the **right**. Beams auto-aim at the opponent, so it works whether you face each other or the camera. A beam that reaches an opponent who isn't firing is a KO. Counter-fire in time and the beams clash.
- **Super Saiyan**: power up from the ready pose, then go straight into the Kamehameha. Once transformed you keep a golden flame aura and spiky hair, and your Kamehameha gets stronger: it charges 1.6× faster, the beam is 30% wider and crackles with lightning, and it pushes 35% harder in a struggle. It lasts until the round ends, you're KO'd, or you leave the frame. In a duel, powering up is a gamble: you can't fire while you do it.
- **Beam struggle**: keep the thrust pose and **pump your arms** (pull back a little, punch forward, repeat). Push power comes from your pump rate, the charge you fired with, and your form (stance and open palms). When the clash point reaches someone's hands, they lose the round.

The side panels show a live checklist of your form, your charge, and your push meter.

### Keys

| Key | Action |
|---|---|
| D | Overlay: skeleton → skeleton + live pose scores → off |
| P | Toggle 1 / 2 players (use 1 if people in the background keep joining) |
| M / V | Sound / voice callouts |
| Space | Pause |
| F | Fullscreen |
| R | Reset scores |
| K | Record landmarks (no video) to a JSON file for debugging |

## How it works

```
camera ─► MediaPipe Pose (2 people) + Hand (4 hands) ─► Tracker ─► analyzePose ─► GestureController ─► Game ─► Effects / HUD / Sfx
           tracking/detector.ts                         tracker.ts   gesture/       gesture/             game/     render/ ui/ audio/
                                                        (slots,      analyze.ts     controller.ts        game.ts
                                                        smoothing,   (form scores)  (idle→charge→fire)   struggle.ts
                                                        hand match)
```

- **Tracker**: the left person is P1 and the right is P2. Identities persist as people move. Landmarks are smoothed with a One Euro filter, and each detected hand is attached to the nearest wrist.
- **Form analysis** uses MediaPipe's metric 3D *world* landmarks. Joint angles therefore hold up when arms point straight at the camera, and every threshold is a ratio of your own shoulder width, torso, or arm length, so distance from the camera doesn't matter.
- **Rendering**: effects are drawn on black into an HDR target, bloomed, then added over the mirrored camera feed in one composite pass. Only the energy glows, not the room. That pass also handles screen shake, flash, and chromatic aberration.
- **Tuning** lives in `src/config.ts`: charge speed, thresholds, beam speed, struggle speed, Super Saiyan timing and boosts, and colors.

## Develop

```bash
npm test             # vitest: pose classifier, state machine, struggle, tracker, full demo duel
npm run typecheck
npm run build        # outputs dist/ (serve over http(s); getUserMedia needs a secure context)
```

## Troubleshooting

- **"Camera permission denied"**: enable your browser under System Settings → Privacy & Security → Camera, then reload.
- **Pose isn't detected**: step back, improve lighting, and make sure your shoulders and hands are in frame. Press `D` twice to see live scores: `charge` / `fire` / `power` (a pose triggers at 0.55), plus `ext`, `together`, `height`, `moved` and `release` for the thrust.
- **Charged but no beam**: the bottom hint says what's missing (wrists apart, hands too low or high). A release fires when your hands leave the hip with wrists together at chest height, or when your arms are thrust out.
- **A gesture misfires**: press `K`, do the move, press `K` again. A landmark-only JSON lands in Downloads. Put it in `tests/fixtures/` (named `*.fire.json` or `*.charge-only.json`) and `npm test` replays it through the real pipeline.
- **Low FPS**: choose the *Lite* model or turn off finger tracking on the start screen.

## License

Kameyoko's code is [MIT](LICENSE). Third-party components (three.js under MIT; the MediaPipe runtime and models under Apache-2.0) are listed with their full license texts in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), which is also copied into every build.

Unofficial fan project, not affiliated with or endorsed by Bird Studio, Shueisha, Toei Animation or Bandai Namco. Dragon Ball and related names are trademarks of their respective owners.
