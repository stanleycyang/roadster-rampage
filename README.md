# Roadster Rampage

An endless synthwave highway. You drive a stylized two-door supercar, weave through traffic, and hold jump to light the cold-gas thrusters and fly.

No manufacturer logos or trademarked assets. The car, city, and soundtrack are original and built in code.

## Run

```bash
npm install
npm run dev
```

The dev server listens on [http://127.0.0.1:47331](http://127.0.0.1:47331).

A static build:

```bash
npm run build
npm run preview
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer | A D or Left Right | Left / Right |
| Throttle | W or Up | Gas |
| Brake | S or Down | Brake |
| Jump, then hold to glide | Space | Jump |
| Barrel roll in the air | Q E, or tap steer | Tap steer |
| Pause | P or Esc | Pause |
| Mute | M | Sound |
| Quality | High / Medium button | same |

The car cruises on its own. Throttle pushes toward top speed. Brake drops you back so you can line up a vault. In the air, steering still moves you, and a tap rolls the car for style points.

## How a run works

Five lanes of cars, trucks, and buses. A near miss or a clean jump over traffic builds a combo. Coins, boost canisters, shields, magnet coins, and Ludicrous Mode (time slows, the night glows) show up as the highway gets meaner. Ramps, neon tunnels, rain, a police chase, and a rocket launch on the horizon arrive the farther you go.

A crash ends the run with a slow-motion replay, then a score screen. Best score, distance, and combo are saved in this browser.

The sky shifts from sunset toward night as distance climbs, then comes back around.

## Picture

The car is an original model: a low, wide, long-nose coupe with a teardrop roof, glass targa panel, full-width lamp bars, and multi-spoke wheels. There are no manufacturer logos. Paint is a deep metallic red clearcoat under a studio environment light (three.js `RoomEnvironment`), with a soft shadowed sun, wet puddles in the asphalt, filmic tone mapping, and a little depth of field on High.

**High** turns on ambient occlusion, depth of field, and a sharper shadow. **Medium** keeps the lighting and bloom and is the one to use when a laptop needs 60fps. The button sits next to Sound. A slow machine drops to Medium on its own.
