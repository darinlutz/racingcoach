# Lighting hardware: the 3 m proof of concept

Low voltage only: the power supply is a sealed desktop brick with an IEC inlet, so nothing here touches mains wiring.
Plug it into the wall last, after every connection is checked with the multimeter.

## Parts (verified 2026-11)

| Part | Model | Facts that matter |
|---|---|---|
| Controller | QuinLED Dig-Quad v4 (v4r1), pre-assembled, **Ethernet (ABE)** | 5-24 V in, 30 A continuous (50 A peak), input terminals 20 A, outputs 10 A, 5 onboard fuses, 4 level-shifted data outputs (GPIO 2, 4, 12, 14), ESP32 8 MB/2 MB PSRAM, ships with WLED |
| Strip | BTF-LIGHTING FCOB WS2814 RGBW 4000K, 24 V, 784 LEDs/m, **14 ICs/m**, 10 mm, IP30, 9.8 ft (3 m) | max 20 W/m; each IC drives 56 LEDs; cut every 71.4 mm; **3 m = 42 pixels** |
| Power supply | Mean Well GST120A24-**P1M** | 24 V, 5 A, 120 W, ripple ≤ 180 mV; IEC C14 inlet (cord not included); 5.5 × **2.5** mm barrel, center positive, 16 AWG cord 1.2 m; −V tied to mains earth; shuts down on overload, overvoltage, overtemperature |
| Also | C13 cord; 5.5 × 2.5 mm barrel socket to screw terminals (≥ 5 A); 18 AWG red/black; 22 AWG data wire; ferrules; optional 5 A inline blade fuse; aluminum channels (inner width ≥ 11-12 mm) with diffusers; ventilated enclosure; Cat6 | |

Sources: quinled.info (Dig-Quad v4 specifications and pinout), quinled.shop (v4r1), the Mean Well GST120A datasheet
(2025-01-10), BTF-LIGHTING's listings and manual. Not verified from the maker: the strip's color order and whether it has
a backup data pad. Check both on the bench.

## Power

3 m × 20 W/m = 60 W at most = 2.5 A at 24 V. The supply at 80 % (96 W) runs about 4.8 m. Feeding one end is normally
enough for 3 m: with everything at full white, measure the voltage at the far end; at least about 22.8 V is fine,
lower means also feeding the far end (power injection, same 18 AWG pair from the controller's output terminals).

## Wiring, in this order, unplugged

1. **Supply to controller.** Screw the barrel socket's + and − to 16-18 AWG with ferrules, into the Dig-Quad's large
   input terminals: + to V+, − to GND. Plug the barrel in (supply still unplugged from the wall), then check with the
   multimeter that the polarity at the terminals is right before anything else.
2. **Controller to strip.** From output 1: V+ (18 AWG) to the strip's +24 V pad, GND (18 AWG) to its GND pad, and the
   data (22 AWG, under 1-2 m) to DIN, at the end the arrows point **away** from. If the strip has a fourth pad (BIN,
   a backup data line), follow BTF's diagram for it rather than guess. Optional: the 5 A blade fuse in the +24 V lead.
3. **Channels.** Stick the strip into the aluminum (it also cools it), keep bends wider than the strip allows, and
   leave slack at the soldered end.
4. **Network.** Ethernet into the Dig-Quad. Plug the supply into the wall.

## WLED

1. Find the controller in the router's client list (or WLED's own access point, WLED-AP, on first start) and open it.
2. **Config > Ethernet**: type **QuinLED Dig-Uno/Quad v4**, save, reboot; it's then on Ethernet.
3. In the router, make a **DHCP reservation** for its MAC address (WLED's Info page shows it), so its address never
   changes. Put that address in the agent's config.json.
4. **Config > LED Preferences**: output 1 on GPIO 2, LED type the RGBW one (**SK6812/WS2814 RGBW** where listed),
   **length 42**, then set the color order by testing (pure red, green, blue and white should each show as that).
   Turn the **automatic brightness limiter off** (its math assumes 5 V strips; the agent caps brightness per zone).
5. **Segments**: segment 0 is the whole 42 pixels (the cockpit zone). More zones later are more segments.
6. **Config > WiFi**: AP opens **Never** once Ethernet works. **Config > Security**: set a settings PIN, and turn off
   OTA updates when not updating.

From the Mac, with the agent installed:

```bash
curl http://<address>/json/info
racingcoach-lighting controller-test main
racingcoach-lighting test pit-limiter on
```

## Six or more zones

Each Dig-Quad output takes one strip (10 A per output, 30 A for the board); a strip can also be split into segments.
Six zones means a second Dig-Quad, or segments on the four outputs. Each 120 W supply covers about 4.8 m of this
strip; for more, add supplies (one per controller, never two supplies on one strip's + without their own fuse and a
common ground) or a larger Mean Well desktop brick, not an open-frame supply that needs mains wiring.
