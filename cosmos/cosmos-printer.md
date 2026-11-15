# Cosmos printer

**Scope:** Send print jobs (raster images and plain text) to an Electricks Cosmos wallet printer over Bluetooth Low Energy without the Cosmos app. This is an independently observed, partial protocol for one physical Cosmos (advertised as `LuckP_L2_D323_BLE`). Its firmware version was not recorded. It does not cover the Cosmos app's own traffic (no PacketLogger trace was captured), battery or paper-status decoding, or the purpose of the secondary GATT services. Findings were collected on 2026-11-11 (nRF Connect, iPhone) and 2026-11-14 (LightBlue, macOS, and a test page in Aura Browser on iPhone).

**Evidence labels:** *Hardware-confirmed* means observed with the physical Cosmos. *Host-confirmed* means the job builder passed deterministic local tests against a simulated printer. *Public-source* means taken from published reverse-engineering of other printers that use the same LuckPrinter SDK, not observed on this Cosmos. *Implementation choice* is a suggested sender policy, not a device guarantee. Test another Cosmos and firmware version before treating these observations as universal.

## Identification

**Hardware-confirmed:** The tested unit advertises the name `LuckP_L2_D323_BLE`. This matches the LuckPrinter (Xiamen Print Future / "Luck Jingle") L2 family, so the Cosmos appears to use a LuckPrinter print engine with Electricks software on top. Connect without bonding. Identify the printer by the `FF00` service and its three characteristics, not by name alone. The Electricks MagiScript documentation shows Atom device IDs in the form `Cosmos-XXXXXX`; that name was **not** seen in this unit's advertisement, so do not filter on it.

## GATT inventory

**Hardware-confirmed** (nRF Connect on iPhone and LightBlue on macOS):

| Role | Service UUID | Characteristic UUID | Observed property |
| --- | --- | --- | --- |
| Status reply | `FF00` | `FF01` | Notify |
| **Print data / commands** | `FF00` | `FF02` | Write; write without response |
| Flow control | `FF00` | `FF03` | Notify |
| Unknown (receipt-printer layout) | `18F0` | `2AF0` | Notify |
| Unknown (receipt-printer layout) | `18F0` | `2AF1` | Write; write without response |
| Unknown | `E7810A71-73AE-499D-8C15-FAA9AEF0C3F2` | `BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F` | Notify; write; write without response |
| Unknown | `49535343-FE7D-4AE5-8FA9-9FAFD205E455` | not recorded | not recorded |

16-bit UUIDs use the Bluetooth base: `0000FF00-0000-1000-8000-00805F9B34FB` and so on. Web Bluetooth needs the full 128-bit form.

All working jobs in this handoff used only `FF00`. Writes to `FF02` worked both as ATT write with response (LightBlue) and through Aura Browser's `Aura.bluetooth.write`. The `18F0`, `E7810A71…` and `49535343…` services were not exercised for printing. Do not assign them purposes from their UUIDs. nRF Connect labels `2AF0` "Electric Current Specification" only because of its assigned number.

## Minimal print sequence

This sequence was **hardware-confirmed** with LightBlue on macOS (one command per write, seconds apart):

1. Enable notifications on `FF01` and `FF03` (write `01 00` to each CCCD through GATT discovery). On subscribe, `FF03` sent `01 0A` and `02 C8 00` (see Flow control).
2. Write `00 00 00 00 00 00 00 00 00 00 00 00` (12 zero bytes, wake) to `FF02`.
3. Write `10 FF F1 03` (start job) to `FF02`.
4. Write the job body to `FF02`: raster blocks and/or text, then a feed.
5. Write `10 FF F1 45` (end job) to `FF02`.
6. Expect `AA` on `FF01`. It arrived 18 ms after the end-job write in the first run, and about 5 s after it when a long raster was sent quickly.

**Hardware-confirmed negative result (2026-11-11):** A feed (`1B 4A FF`, sent three times) and the status request, written to `FF02` with no start-job command, produced no paper movement. The printer accepts data outside a job without error but does not run it, so the start and end commands are required.

**Public-source:** The LuckPrinter SDK has two start/end pairs. "Lujiang" models (LuckP series, DP series, L12, L13) use `10 FF F1 03` / `10 FF F1 45`. "AiYin" models (D11s, D12) use `10 FF FE 01` / `10 FF FE 45`. A printer given the wrong pair accepts the data silently and never prints. This Cosmos answered to the Lujiang pair. The `FE` pair was not tested on it. The same sources describe waiting for `0xAA` or `"OK"` after the end command.

**Public-source caution, not reproduced here:** On a PeriPage P21 (same command family), a job that was started and never ended jammed the printer until a power cycle, and a job with more than about 8 s between start and end was dropped. On this Cosmos, a hand-typed job that took about 30 s from start to end still returned `AA` and printed. Always send the end command (for example in a `finally` block), and do not rely on long gaps.

## Commands observed on FF02

| Bytes | Meaning | Evidence |
| --- | --- | --- |
| `00` × 12 | Wake / pre-roll | Hardware-confirmed accepted; not shown to be required |
| `10 FF F1 03` | Start job (Lujiang) | Hardware-confirmed |
| `10 FF F1 45` | End job; printer answers `AA` on `FF01` | Hardware-confirmed |
| `10 FF 40` | Status request; answered `00` on `FF01` | Hardware-confirmed (outside a job); meaning of `00` assumed "OK" |
| `10 FF 10 00 nn` | Density, `nn` = 0 light, 1 normal, 2 dark | `02` hardware-confirmed accepted; visible effect not measured; values public-source |
| `1D 76 30 00 xL xH yL yH` + data | GS v 0 raster block | Hardware-confirmed (see Raster) |
| `1B 4A nn` | Feed `nn` dot rows (8 rows ≈ 1 mm), inside a job | Hardware-confirmed paper movement; length per row not measured |
| ASCII bytes, `0A` | Print text in the built-in font, new line | Hardware-confirmed (see Text) |
| `1D 21 nn` | ESC/POS character size | Hardware-confirmed **not supported**: `nn` printed as a character |
| `1B 45 01`, `1B 47 01`, `1B 61 01` | ESC/POS bold, double strike, center | Hardware-confirmed accepted silently; no visible change observed |

## Raster format

**Hardware-confirmed:** `1D 76 30 00 xL xH yL yH` followed by `(xL + 256·xH) × (yL + 256·yH)` bytes printed a solid block. Tested headers: `1D 76 30 00 04 00 20 00` + 128 × `FF` (32 × 32 dots) and `1D 76 30 00 0C 00 0E 00` + 168 × `FF` (96 × 14 dots). Width and height are little-endian. Each byte is 8 horizontal dots, most significant bit first, `1` = black. Several separate GS v 0 blocks in one job printed one after another.

**Public-source:** The print line for this family is 384 dots (48 bytes per row) at 203 dpi (8 dots/mm), so the full width is 48 mm. The full 384-dot width was **host-confirmed only**: the test page sends `1D 76 30 00 30 00 03 00` + 144 bytes (three full-width rows, 152 bytes per write). A full-width print's edge-to-edge alignment on this unit was not measured.

**Hardware-confirmed failure mode:** When characters were lost from hand-typed raster writes, the printer did not reject them. Misaligned bytes printed as random characters ("EC▓" groups), so a raster header that is not exactly right makes the printer read the rest of the write as text. Build each write from complete, checked blocks.

## Text mode

**Hardware-confirmed:** Inside a job, plain ASCII bytes print in one fixed, small built-in serif font (about 2 mm tall). `48 45 4C 4C 4F 0A` printed `HELLO` and a new line. The ESC/POS size command `1D 21 nn` is not supported: with `nn` = `33` and `55`, the printer printed `3HELLO` and `UHELLO` at the normal size. Bold, double-strike and centering commands gave no extra characters and no visible change. For large, bold or handwritten-style output, render the text to a bitmap and send it as raster. The Cosmos app's fonts and hand-drawn clocks are almost certainly raster for the same reason, but this was not captured.

## Flow control (FF03)

**Hardware-confirmed observations:**

- On subscribing to `FF03`, the printer sent `01 0A` and `02 C8 00`.
- When a test page sent 94 raster writes (152 bytes each) in 1,035 ms through Aura Browser, `FF03` sent a long series of `01 01` during and after the transfer. `AA` arrived about 5 s after the end-job write, and the user reported that the printer "froze". The output was not inspected.

**Working interpretation (not proven):** `01 NN` grants `NN` more packets to the sender (10 at connect, then 1 for each packet the printer has processed). `02 LL HH` reports a 200-byte maximum packet size. Under this reading, the fast transfer overran the printer's buffer. The PeriPage P21 notes (public-source) also describe BLE input overflow with no error, where the end of the job is lost but the job still "succeeds".

**Implementation choice (host-confirmed only):** Keep a credit counter. Set it from `01 NN` notifications (add `NN`). Before each write to `FF02`, wait until the counter is above 0, then subtract 1. If no credit arrives for 3 s, send anyway and log it. If the printer never reports credits, wait 25 ms between writes. Keep each write at 200 bytes or less. A simulated printer (10 credits at connect, 1 credit returned 20 ms after each write) never had more than 10 packets outstanding and completed with `AA`. This policy is **not yet hardware-confirmed**.

## Suggested job builder

**Implementation choice:**

```text
render text to a 1-bit bitmap, width 384 dots, height H rows
connect, verify FF00/FF01/FF02/FF03, subscribe FF01 and FF03, reset credits
wait credit; write 00 × 12
wait credit; write 10 FF 10 00 <density 0..2>
wait credit; write 10 FF F1 03                      ; job is now open
for each group of up to 3 rows:
    wait credit; write 1D 76 30 00 30 00 <n> 00 + n × 48 bytes
for each 255 rows of feed:
    wait credit; write 1B 4A <rows>
finally:
    wait credit; write 10 FF F1 45                  ; always close the job
    wait up to 10 s for AA (or "OK") on FF01
```

Treat `AA` as "job done", not as proof that every row printed. Reject the job before it starts if the bitmap width is not 384 or a block exceeds the packet size. Do not interleave two jobs.

## Connection and reconnect

**Hardware-confirmed:** The printer accepts one BLE connection at a time. LightBlue (Mac), nRF Connect and the Cosmos app each block the others. The Electricks app, PeekSmith app and Atom can also take the printer.

**Hardware-confirmed, cause unknown:** During testing in Aura Browser, the connection dropped at random times. Aura Browser closes BLE connections when the iPhone locks or the page is left (observed with other Aura pages, not isolated for the Cosmos). An idle timeout in the printer is possible but not measured.

**Implementation choices (not hardware-confirmed):** On reconnect, discover and verify GATT again, subscribe again and reset the credit counter. While connected and idle, send `10 FF 40` every 15 s as a keep-alive (the printer answers `00` and prints nothing). Log each connection's duration and page hide/show events to find the cause of drops. Use manual connect only; do not auto-connect.

## Known gaps

No verified meaning for `FF01` values other than `00` and `AA`, battery or paper-out status, `2AF0`/`2AF1`, `BEF8D6C9…` or `49535343…` traffic, full-width alignment, density effect, measured feed length, firmware version, or the Cosmos app's real startup sequence is available. Whether the `10 FF FE 01` pair also works, whether the 12 wake bytes are needed, and whether the credit policy prevents the freeze on hardware are untested. Print orientation is unclear: a raster block appeared at the opposite side of the paper from the start of a text line in one photo. Confirm with an asymmetric test image before relying on left/right placement.

## Provenance

Hardware observations: GATT screenshots in nRF Connect (iPhone, 2026-11-11); LightBlue write history, `FF01`/`FF03` notification values and print photos (macOS, 2026-11-14); the Aura Browser log from the Cosmos Print test page (2026-11-14). Public sources: [0xMH/fichero-printer PROTOCOL.md](https://github.com/0xMH/fichero-printer/blob/main/docs/PROTOCOL.md) (LuckPrinter SDK device classes, Lujiang vs AiYin start/end pairs, `AA`/"OK" completion); [ChiaraCannolee/thermal-pocket-printer-basic](https://github.com/ChiaraCannolee/thermal-pocket-printer-basic) (DP-L1S, `FF00`/`FF02`/`FF01`, `10 FF F1 03` sequence, 384-dot width); [SwapnanilDhol/minixprint](https://github.com/SwapnanilDhol/minixprint) (Lujiang job layout, GS v 0 header); [Techbrunch/peripage-p21](https://github.com/Techbrunch/peripage-p21) (unterminated-job jam, 8 s starvation, BLE overflow); [Electricks MagiScript Cosmos API](https://developers.electricks.info/docs/magiscript/api/cosmos) (Atom-side commands and `Cosmos-XXXXXX` device IDs). Reference sender: `cosmos/index.html` in the aura-tricks repository.
