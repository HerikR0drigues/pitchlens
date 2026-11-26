# Technical notes

How Pitchlens finds data inside the running game, and how to fix it after a game patch.

> Everything here was found on **Football Manager 27 (Steam, Windows, build 27.0.x, Nov 2026)**.
> Offsets can change with game updates. The app only ever **reads** memory.

## Architecture

```
fm.exe (game_plugin.dll)  --ReadProcessMemory-->  fmreader.py  -->  scout.py (127.0.0.1:8770)  -->  web/ (HTML/CSS/JS)
```

| File | Role |
|---|---|
| `fmreader.py` | Opens `fm.exe` with `PROCESS_VM_READ \| PROCESS_QUERY_INFORMATION`, finds every player object and decodes it. Pure `ctypes`, no dependencies. |
| `scout.py` | Tiny `http.server` bound to `127.0.0.1`. Routes: `/` (UI), `/api/players`, `/api/refresh`, `/api/player?uid=N`, `/api/face?uid=N`, `/api/ping`. Starts reading the save as soon as it starts. |
| `faces.py` | Player photos from the user's own face pack: finds `Documents\Sports Interactive\Football Manager 27\graphics` (via the Windows *Documents* known folder, so OneDrive redirection works), indexes image files named `<unique ID>.png/.jpg` inside folders whose name contains *face*, *player*, *portrait*, *people*, *person* or *cut* (~1 s for 500k files). Logos and kits are skipped because they also use numeric names. The photos built into FM27 live inside Unity asset bundles and are not read. |
| `web/` | `index.html`, `style.css`, `app.js`, `i18n.js`. No build step, no CDN, works offline. |
| `Pitchlens.exe` · `launcher/` | The desktop window (C#, WinForms + WebView2, GUI subsystem so no console). Starts `pythonw Pitchlens.pyw --server --port N` hidden, waits for `/api/ping`, shows the UI, calls `/api/quit` on close, creates Desktop/Start Menu shortcuts on the first run. Rebuild with `launcher\build.bat` (uses the `csc.exe` that ships with Windows). |
| `runtime/` | Microsoft WebView2 SDK 1.0.4370.26 (`Core`, `WinForms`, x64 `WebView2Loader.dll`) from NuGet, signed by Microsoft, BSD-style license. |
| `Pitchlens.pyw` | Server mode for the window: logs to `%LOCALAPPDATA%\Pitchlens`, stops on `/api/quit` or when the page stops pinging `/api/ping?alive=1` for 3 min. Without `--server` it opens the default browser. |
| `tools/` | Research scripts used to map the memory (`memscan.py`, `find_attrs.py`, `modules.py`) and `screenshots.py` for the README images. |

A full read of ~80k players takes 15–35 s; afterwards everything is filtered in the browser.

## How the data was found

1. **Scan the heap.** Enumerate committed, readable `MEM_PRIVATE` regions with `VirtualQueryEx` and read them in
   64 MB chunks (~5 GB in ~25 s with `bytes.find`).
2. **Anchor on a known player.** Take a player's unique ID from the Pre-Game Editor and his CA/PA from the game.
   The UID appears **twice in a row** (`+0x0C` and `+0x10`) and CA/PA sit **before** the object start.
3. **The vtable identifies the class.** The qword at `+0x00` is the vtable pointer of the player class; counting
   that pointer in the heap finds every player (~80–90k).
4. **Strings** are stored as `[uint32 length][UTF-8 bytes]`; follow pointers and test that shape.
5. **Dates** are `uint16 day_of_year` + `uint16 year` (e.g. `6d 01 eb 07` = day 365 of 2027).
   Some dates keep flags in the high bits of the day: use `day & 0x1FF`.
6. **Flags** were found with labelled samples: e.g. 400 players from women's leagues vs 400 from men's leagues,
   then look for the bit that separates both groups 100% (`+0x19 & 0x10`).
7. **ASLR**: absolute addresses change every run, so vtables are stored as an **RVA** relative to
   `game_plugin.dll` (`EnumProcessModulesEx` + `GetModuleInformation`).
8. **Money** is stored in **pounds sterling (GBP)** as `int32`; the UI converts to the user's currency.

## Memory map

Offsets are relative to the object start (where the vtable pointer is).

### Player — vtable `game_plugin.dll + 0x4E89908`

| Offset | Type | Field |
|---|---|---|
| `-0x138` | 15 × uint8 | position familiarity 1–20 (order: GK, SW, DL, DC, DR, DM, ML, MC, MR, AML, AMC, AMR, ST, WBL, WBR) |
| `-0x129` | 54 × uint8 | attributes 1–100; displayed value = `(v + 2) // 5` (order in `fmreader.ATTRIBUTES`) |
| `-0x24` | int16 | current ability (CA) |
| `-0x22` | int16 | potential ability (PA; negative = editor range, resolved in a running save) |
| `+0x00` | ptr | vtable |
| `+0x0C`, `+0x10` | uint32 | unique ID (repeated — used as a sanity check) |
| `+0x19` | uint8 | flags; `& 0x10` = female |
| `+0x50` / `+0x58` / `+0x60` | ptr | first name / last name / common name → entry → `+0x00` string |
| `+0x68` | ptr | nation |
| `+0x80` | ptr | city of birth (`+0x18` name) |
| `+0x88` | uint16 + uint16 | date of birth (day of year, year) |
| `+0xA8` | ptr | contract (**NULL = free agent**) |

### Contract — vtable `game_plugin.dll + 0x4C5DFA8`

| Offset | Field |
|---|---|
| `+0x08` | back pointer to the player |
| `+0x10` | club |
| `+0x44` | start date (day & 0x1FF, year) — the newest start shared by 3+ contracts ≈ today's in-game date |
| `+0x48` | end date (day, year) |
| `+0x20` | int32 wage per week (GBP) |
| `+0x54` | squad status: `1` star player, `2` important, `3` regular starter, `4` squad player, `7` fringe (others not mapped yet) |
| `+0x57` | status: `0x01` transfer listed, `0x02` loan listed |
| `+0x68`, `+0x70` | clause vector (begin, end); 8-byte entries `[int32 value][uint16 arg][uint16 type]`. Types seen: `0x08` sell-on % (arg), `0x0E` wage rise on promotion, `0x10` / `0x12` minimum fee release clause (foreign / domestic clubs), `0x20` appearance bonus, `0x26` unused-sub bonus |

Contracts are found by their own vtable (`game_plugin.dll + 0x4C5DFA8`) in the same heap pass as the players. A player can
own a second contract object that **starts in the future**: with the same club it is an agreed renewal, with another club
it is a **pre-contract** already signed (shown as `→ Club`). Placeholder records with an end year of 1900 are ignored.

### Loan record — vtable `game_plugin.dll + 0x4F2A0F8`

`+0x08` player, `+0x10` club, `+0x48` end date, `+0xC0` int32 future fee (GBP). There may be more than one per player.

### Club — vtable `game_plugin.dll + 0x4E42F38`

| Offset | Field |
|---|---|
| `+0x0C`, `+0x10` | club unique ID |
| `+0x30` | names block: `+0xC0` full name, `+0xC8` short name. The same pointer leads to the finances block (`->+0x150`, balance at `+0x0C`, GBP). |
| `+0x50` / `+0x60` | current / previous division (competition: `+0x40` name, `+0x48` short name) |
| `+0x78` | stadium (`+0x40` name) |

### Nation

`+0x18` name, `+0x20` short name, `+0x28` three-letter code, `+0x30` adjective.

## Role ratings and similar players

Computed in the browser (`web/roles.js`) from the 54 attributes, which the list API sends as one compact string per
player (`chr(48 + value)`). Role ratings are Pitchlens' own formula, not the game's: weighted average (key attributes x5,
preferable x3, the rest of the group x1) scaled to 0-100, multiplied by position familiarity (natural 100%,
accomplished 95%, unconvincing 85%, otherwise 70%). Similar players = smallest distance between attribute profiles.

## After a game patch

1. Run `py scout.py`. If the stored RVA finds fewer than 20k objects, `FMReader.discover_vtable()` searches for the most
   common pointer into `game_plugin.dll` with the `[vtable][int][uid][uid]` shape and plausible CA/PA, and uses it.
2. If fields look wrong, redo step 2 above with `tools/memscan.py near <UID> <CA> <PA>` and
   `tools/memscan.py ptrs|strs <ADDRESS>`, then update the constants at the top of `fmreader.py` and this file.
3. Sanity checks: famous players' CA/PA, a known free agent, a known female player, a player you know is transfer listed.

## Known limitations

- Windows only (WinAPI). Tested with the Steam build of FM27.
- A few attributes may be off by 1–2 points compared with the game screen (rounding of the internal 1–100 scale).
- The in-game date is estimated from contract start dates; you can override the year in the sidebar.
