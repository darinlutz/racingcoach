import torch

torch.manual_seed(0)

SPEED, BRAKE, THROTTLE, STEER, DIST = range(5)  # channel indicies

# one lap:  6000 samples, channgles above

lap = torch.rand(6000, 5)  # one lap of data

# Real LapDistPct climbs 0 -> 1 across the lap, pure randome vlaues make "first" meaningless
# overwrie that channel with a monotonic ramp

lap[:, DIST] = torch.linspace(0, 1, 6000)

#Random bbrake is > 0.05 almost everywhere, so fake a real braking zone:
# off the brake, then a ramp starting near 0.145 into the corner

lap[:, BRAKE] = ((lap[:, DIST] - 0.145) * 20).clamp(0, 1) * (lap[:, DIST] < 0.17)

mean = lap.mean(dim=0)  # shape [5]
std = lap.std(dim=0)  # shape [5]
norm = (lap - mean) / std  # shape [6000, 5] op [5] -> broadcasts per channel

laps = torch.rand(20,6000,5) # a string of 20 laps
laps[:, :, DIST] = torch.linspace(0, 1, 6000)


# give each lap a slightly different brake point (0.140-0.150) so the bonus shows variation
bp = 0.140 + 0.010 * torch.rand(20, 1)
laps[:, :, BRAKE] = ((laps[:, :, DIST] - bp) * 20).clamp(0, 1) * (laps[:, :, DIST] < 0.17)
norm_all = (laps - laps.mean(dim=(0, 1))) / laps.std(dim=(0, 1))

# slice one track area the way TrackConfig does
dist = lap[:, DIST]
in_area = (dist >= 0.12) & (dist <= 0.18)
max_brake = lap[in_area, BRAKE].max()
print(f"max brake in area: {max_brake:.3f}")

# ---------------------------------------------------------------------------
# Exercise 1: LapDistPct where Brake first exceeds 0.05 inside the area
# ---------------------------------------------------------------------------
area = lap[in_area]                        # [N, 5], rows kept in lap order
hits = area[:, BRAKE] > 0.05                # [N] bool
if hits.any():
    first_idx = hits.int().argmax()        # argmax on 0/1 returns the FIRST 1
    brake_point = area[first_idx, DIST]
    print(f"Ex1: brake first > 0.05 at LapDistPct {brake_point:.4f} (area row {first_idx.item()})")
else:
    print("Ex1: brake never exceeds 0.05 in this area")


# ---------------------------------------------------------------------------
# Exercise 2: per-lap max speed for all 20 laps in one line
# ---------------------------------------------------------------------------
max_speed_per_lap = laps[:, :, SPEED].amax(dim=1)  # [20, 6000] -> [20]
print(f"Ex2: shape {tuple(max_speed_per_lap.shape)}  ->  {max_speed_per_lap[:5].tolist()} ...")
# Same thing: laps[..., SPEED].max(dim=1).values  (.max(dim) returns values AND indices)

# Bonus: per-lap brake point in the area for all 20 laps at once, no loop
d = laps[:, :, DIST]
mask = (d >= 0.12) & (d <= 0.18) & (laps[:, :, BRAKE] > 0.05)    # [20, 6000]
first = mask.int().argmax(dim=1)                                  # [20] first True per lap
brake_pts = d.gather(1, first.unsqueeze(1)).squeeze(1)            # [20]
brake_pts[~mask.any(dim=1)] = float("nan")                          # laps with no hit
print(f"Bonus: per-lap brake points {brake_pts[:5].tolist()} ...")


# ---------------------------------------------------------------------------
# Exercise 3: break broadcasting on purpose and read the error
# ---------------------------------------------------------------------------
# Broadcasting lines shapes up from the RIGHT. Each pair of dims must be equal or 1.
#  [6000, 5] - [5]      -> OK  (5 == 5, missing dim treated as 1)
#  [6000, 5] - [6000]  -> FAIL (5 vs 6000 on the last dim)
per_sample_mean = lap.mean(dim=1)          # [6000]  -- wrong axis: mean across channels
try:
    bad = lap - per_sample_mean
except RuntimeError as e:
    print(f"Ex3 error: {e}")

# The fix if you really wanted per-sample centering: keep the reduced dim.
fixed = lap - lap.mean(dim=1, keepdim=True)  # [6000,5] - [6000,1] -> OK
print(f"Ex3 fixed with keepdim: {tuple(fixed.shape)}")

# A sneakier failure: no error, wrong answer.
col = torch.rand(6000, 1)
row = torch.rand(6000)
silent = col - row                          # [6000,1] - [6000] -> [6000, 6000] !
print(f"Ex3 silent trap: [6000,1] - [6000] gives {tuple(silent.shape)}, "
      f"{silent.numel() * 4 / 1e6:.0f} MB, no error raised")

