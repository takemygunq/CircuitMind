<div align="center">

<img src="public/brand/mark.svg" alt="CircuitMind" width="84" />

# CircuitMind

### An AI electronics designer

Describe a device in plain words — the AI picks the board and parts, draws the wiring, calculates the values,<br/>
checks everything for mistakes and writes the firmware.

<p>
  <img src="docs/media/ui/badge-en-0.svg" height="28" alt="Next.js 16" />
  <img src="docs/media/ui/badge-en-1.svg" height="28" alt="TypeScript strict" />
  <img src="docs/media/ui/badge-en-2.svg" height="28" alt="Tailwind 4" />
  <img src="docs/media/ui/badge-en-3.svg" height="28" alt="models Claude · GPT · Gemini · Ollama" />
  <img src="docs/media/ui/badge-en-4.svg" height="28" alt="UI RU · EN · UK" />
</p>

<img src="docs/media/tour.gif" alt="A tour of CircuitMind: project, diagram, simulation, pinout, schematic, overview, code" width="100%" />

<sub>A real session, recorded: diagram → live simulation → pinout → schematic → overview → firmware.</sub>

<p><a href="README.ru.md">Русская версия</a> · <a href="LICENSE">MIT</a></p>

</div>

---

## Why this one?

Asking a chatbot "wire an ESP32 to a DHT22 and an OLED" gets you a paragraph that may or may not be electrically sane.
CircuitMind treats the model as an engineer who has to **hand in a checkable design**:

- The AI never draws SVG. It returns **JSON through tool use**, which is validated (Zod), checked by a deterministic
  **Electrical Rules Check** (40 rules: 5 V into a 3.3 V pin, LED without a resistor, missing flyback diode, ADC2 with Wi-Fi…),
  sent back for repair up to 3 times, and only then drawn by our own rendering engine.
- Boards and parts come from a **local library**; the model refers to them by id and cannot invent pins.
- Resistor values and currents are computed by **deterministic calculators**, not guessed by the model.
- A missing board is **generated, linted and saved** to the library (marked "unverified") before it is ever drawn.

## Screens

<table>
  <tr>
    <td width="50%"><img src="docs/media/home.jpg" alt="Home: describe a device" /></td>
    <td width="50%"><img src="docs/media/diagram.jpg" alt="Diagram: cards with pins and wires" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Describe the device — the AI plans the build</sub></td>
    <td align="center"><sub>Diagram: a card per part, wires between pin rows</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/media/simulation.jpg" alt="Simulation running on the diagram" /></td>
    <td width="50%"><img src="docs/media/pinout.jpg" alt="Logical pinouts for every component" /></td>
  </tr>
  <tr>
    <td align="center"><sub>One click runs a DC simulation over the same wires</sub></td>
    <td align="center"><sub>Pinout of the board and every component, masonry layout</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/media/schematic.jpg" alt="Auto-generated schematic" /></td>
    <td width="50%"><img src="docs/media/overview.jpg" alt="Overview: ERC, calculations, bill of materials" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Schematic with real symbols; wires never overlap</sub></td>
    <td align="center"><sub>ERC, calculations, power budget and BOM as tiles</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/media/code.jpg" alt="Firmware editor" /></td>
    <td width="50%"><img src="docs/media/parts.jpg" alt="Parts catalogue" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Firmware: generate, edit and explain through the chat, compile in a sandbox</sub></td>
    <td align="center"><sub>Parts catalogue with pinouts, offers and alternates</sub></td>
  </tr>
</table>

## Features

- <img src="docs/media/ui/loop.svg" width="22" height="22" align="absmiddle" alt="" /> **Agentic design loop** — search the library → calculate → build the project → ERC → repair. Streamed live to the chat.
- <img src="docs/media/ui/workspace.svg" width="22" height="22" align="absmiddle" alt="" /> **One workspace** — project list on the left, project chat next to it, views on the right (diagram, pinout, schematic, overview, firmware). Projects **autosave**.
- <img src="docs/media/ui/sim.svg" width="22" height="22" align="absmiddle" alt="" /> **Diagram + simulation** — cards with photos and pin rows; a MNA DC solver shows currents flowing, overloaded and burnt parts. Arduino Uno/Nano firmware can run in an AVR emulator against the same circuit.
- <img src="docs/media/ui/pin.svg" width="22" height="22" align="absmiddle" alt="" /> **Pinouts for every component** — logical pinout pills in the style of a parts catalogue, with data from the catalogue when available.
- <img src="docs/media/ui/schematic.svg" width="22" height="22" align="absmiddle" alt="" /> **Schematic** — symbols for resistors, LEDs, diodes, transistors, MOSFETs, potentiometers, relays and more; power and ground as proper symbols; non-overlapping nets.
- <img src="docs/media/ui/calc.svg" width="22" height="22" align="absmiddle" alt="" /> **Calculations** — E12/E24 resistor values, dividers, MOSFET drive, current budget, battery life.
- <img src="docs/media/ui/code.svg" width="22" height="22" align="absmiddle" alt="" /> **Firmware** — deterministic pin block + AI-written body, linted; Arduino C++ and MicroPython; compile for AVR boards in a **Docker sandbox** (no network, read-only root).
- <img src="docs/media/ui/export.svg" width="22" height="22" align="absmiddle" alt="" /> **Export** — SVG/PNG diagrams, BOM as CSV, project as JSON (and import).
- <img src="docs/media/ui/parts.svg" width="22" height="22" align="absmiddle" alt="" /> **Parts catalogue** — search, categories, part pages with pinout, shops and alternates (optional import, see below).
- <img src="docs/media/ui/lang.svg" width="22" height="22" align="absmiddle" alt="" /> **Three languages** — Russian, English, Ukrainian (a test checks that the dictionaries match).

## Models

Pick the model in the app (**Models** in the sidebar). Keys are encrypted (AES-256-GCM) and stay on the server.

| Provider | What you need |
|---|---|
| **Anthropic / OpenAI / Gemini** | An API key |
| **OpenRouter** | Sign in from the Models page (OAuth) — the key is created for you |
| **Ollama** | Local models that support tool calling: `ollama pull llama3.2`, `ollama serve` |
| **Claude Code / Codex CLI / Gemini CLI** | Your subscription: install the CLI and log in (tool calls are emulated through JSON — less reliable than an API) |
| **Demo** | Nothing — scripted answers to try the interface |

Without any selection the server uses `ANTHROPIC_API_KEY` from the environment. The CLI bridges run the installed program
with no tools and no access to your files. Using a subscription through third-party apps is governed by the provider's
terms — check them yourself.

## Quick start

Requirements: **Node.js 24+** and **pnpm** (`corepack enable`). Docker is optional (firmware compile).

```bash
git clone <your-fork-url> circuitmind
cd circuitmind
pnpm install
cp .env.example .env        # add ANTHROPIC_API_KEY, or connect a provider in the app later
pnpm dev                    # http://localhost:3000
```

No key at hand? Try the whole interface with scripted answers:

```bash
CIRCUITMIND_MOCK_AI=1 pnpm dev
```

Then open **Models** in the sidebar to connect a provider, and press **New project**.

## Deploy

### Docker (recommended)

```bash
docker compose up -d --build        # http://localhost:3000
```

or without compose:

```bash
docker build -t circuitmind .
docker run -d --name circuitmind -p 3000:3000 \
  -v circuitmind-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  circuitmind
```

Everything stateful lives in the **`/data` volume**: provider settings, the encryption key and saved projects.
Back it up and keep it private.

### Without Docker

```bash
pnpm install --frozen-lockfile
pnpm build
CIRCUITMIND_DATA_DIR=/var/lib/circuitmind pnpm start    # or: node .next/standalone/server.js
```

Put it behind a reverse proxy (Caddy, nginx) with TLS.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Used when no provider is selected in the app |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model for the environment key |
| `CIRCUITMIND_DATA_DIR` | `./data` | Settings, encrypted keys, saved projects |
| `CIRCUITMIND_MOCK_AI` | – | `1` = scripted demo answers, no network |
| `CIRCUITMIND_ALLOW_REMOTE_SETTINGS` | – | `1` = allow the Models page and saved projects from non-localhost |
| `COMPILER_IMAGE` | `circuitmind-compiler` | Docker image used to compile firmware |

> **Security.** The Models page changes where keys go and which programs run (CLI bridges), so by default the settings
> and saved-project APIs only answer on `localhost` and from the app's own pages. If you expose the app to the internet,
> put it behind **your own authentication** first and only then set `CIRCUITMIND_ALLOW_REMOTE_SETTINGS=1`.
> There are no user accounts in the app itself.

### Firmware compile (optional)

Compilation runs in a one-shot Docker container (no network, read-only root, limits). Build the image once:

```bash
docker build -t circuitmind-compiler docker/compiler
# more cores:  --build-arg CORES="arduino:avr rp2040:rp2040"
```

The app needs access to the Docker daemon to start it (when the app itself runs in a container, mount the socket —
understand the security implications first). Compile is available for Arduino Uno/Nano; other boards get generated and
linted code but no build.

### Parts catalogue (optional)

The repository ships with a small built-in list. To fill the full catalogue (≈6000 parts with images, pinouts, offers and
alternates) run the importer — **only if you have permission from the catalogue owner to download it**:

```bash
node scripts/import-schematik.mjs          # resumable; ~30–60 minutes, polite request rate
```

It writes `library/catalogue/schematik.jsonl` and thumbnails into `public/parts/catalogue/` (both git-ignored).

## Tech

- **Next.js 16** (App Router), **React 19**, **TypeScript** strict, **Tailwind 4**, **Zustand**, **Zod 4**, **Vitest**
- A **custom SVG engine** (realistic boards and parts, orthogonal router, schematic layout) — no diagram library
- MNA DC solver, E-series calculators, ERC with 40 rules, **avr8js** emulator, **Monaco** editor
- One adapter interface for every model provider; tool use is translated for OpenAI-compatible APIs and Gemini, and emulated for CLI bridges

```
src/core/      pure logic: schemas, ERC, calculators, simulation, schematic model (fully unit-tested)
src/diagram/   SVG engine: boards, parts, wires, schematic
src/ai/        agents (design, code, board generation) and provider adapters
src/server/    storage, rate limits, compile sandbox, providers store
src/components UI
library/       boards and components as JSON
```

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Notes

- AI answers are only as good as the model; the ERC catches a lot, but **check the design before powering real hardware** — especially anything with mains voltage.
- Part names, brands and illustrations from the imported catalogue belong to their respective owners.

## License

[MIT](LICENSE) — covers the code. Imported catalogue data and images are not part of the repository and keep their owners' rights.
