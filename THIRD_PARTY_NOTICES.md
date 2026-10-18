# Credits & third-party notices

Roadster Rampage is created by [Stanley (@stanleycyang)](https://github.com/stanleycyang).

Development and documentation assisted by Codex.

## Open-source tools

| Component | Version | License |
| --- | --- | --- |
| [Three.js](https://github.com/mrdoob/three.js) | 0.186.1 | MIT |
| [Vite](https://github.com/vitejs/vite) | 8.3.4 | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 6.0.3 | Apache-2.0 |
| [@types/three](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/three) | 0.186.0 | MIT |

Three.js provides rendering and postprocessing, including RoomEnvironment. Vite builds the game and supplies the module-preload helper. TypeScript and the type definitions are development tools.

The browser distribution includes the Three.js and Vite core MIT notices in [`public/third-party-notices.txt`](public/third-party-notices.txt). Development dependencies retain their upstream licenses and notices, including Vite's bundled-dependency notices, Rolldown's `THIRD-PARTY-LICENSE`, and TypeScript's `ThirdPartyNoticeText.txt`. Keep those files when redistributing the tools themselves.

## Fonts

The interface uses **Orbitron** and **Rajdhani**, served by Google Fonts under the SIL Open Font License 1.1:

- Orbitron — Copyright 2018 The Orbitron Project Authors, with Reserved Font Name "Orbitron". [License](public/licenses/Orbitron-OFL.txt) · [Upstream](https://github.com/google/fonts/tree/main/ofl/orbitron).
- Rajdhani — Copyright (c) 2014, Indian Type Foundry. [License](public/licenses/Rajdhani-OFL.txt) · [Upstream](https://github.com/google/fonts/tree/main/ofl/rajdhani).

## Game assets

Vehicle meshes, scenery, and gameplay textures are constructed in code. The music and sound effects are synthesized with the Web Audio API. Documentation screenshots show the running game.

## Distribution

Roadster Rampage is available under the [MIT License](LICENSE). Third-party components remain under their respective licenses.

Vite copies `public/credits.html`, `public/third-party-notices.txt`, and `public/licenses/` into `dist/`. Keep these notices with hosted builds and downloadable copies. Refresh component versions and notices when updating dependencies or fonts.
