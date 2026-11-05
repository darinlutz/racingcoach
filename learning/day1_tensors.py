import torch

from lap_data import BRAKE, DIST, SPEED, area_mask, make_lap, make_laps, report

torch.manual_seed(0)

lap = make_lap()  # one lap of data

mean = lap.mean(dim=0)  # shape [5]
std = lap.std(dim=0)  # shape [5]
norm = (lap - mean) / std  # shape [6000, 5] op [5] -> broadcasts per channel

laps = make_laps(20)  # a string of 20 laps
norm_all = (laps - laps.mean(dim=(0, 1))) / laps.std(dim=(0, 1))

# slice one track area the way TrackConfig does
dist = lap[:, DIST]
in_area = area_mask(dist)
max_brake = lap[in_area, BRAKE].max()
report(f"max brake in area: {max_brake:.3f}")

# ---------------------------------------------------------------------------
# Exercise 1: LapDistPct where Brake first exceeds 0.05 inside the area
# ---------------------------------------------------------------------------
area = lap[in_area]                        # [N, 5], rows kept in lap order
hits = area[:, BRAKE] > 0.05                # [N] bool
if hits.any():
    first_idx = hits.int().argmax()        # argmax on 0/1 returns the FIRST 1
    brake_point = area[first_idx, DIST]
    report(f"Ex1: brake first > 0.05 at LapDistPct {brake_point:.4f} (area row {first_idx.item()})")
else:
    report("Ex1: brake never exceeds 0.05 in this area")


# ---------------------------------------------------------------------------
# Exercise 2: per-lap max speed for all 20 laps in one line
# ---------------------------------------------------------------------------
max_speed_per_lap = laps[:, :, SPEED].amax(dim=1)  # [20, 6000] -> [20]
report(f"Ex2: shape {tuple(max_speed_per_lap.shape)}  ->  {max_speed_per_lap[:5].tolist()} ...")
# Same thing: laps[..., SPEED].max(dim=1).values  (.max(dim) returns values AND indices)

# Bonus: per-lap brake point in the area for all 20 laps at once, no loop
d = laps[:, :, DIST]
mask = area_mask(d) & (laps[:, :, BRAKE] > 0.05)                  # [20, 6000]
first = mask.int().argmax(dim=1)                                  # [20] first True per lap
brake_pts = d.gather(1, first.unsqueeze(1)).squeeze(1)            # [20]
brake_pts[~mask.any(dim=1)] = float("nan")                          # laps with no hit
report(f"Bonus: per-lap brake points {brake_pts[:5].tolist()} ...")


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
    report(f"Ex3 error: {e}")

# The fix if you really wanted per-sample centering: keep the reduced dim.
fixed = lap - lap.mean(dim=1, keepdim=True)  # [6000,5] - [6000,1] -> OK
report(f"Ex3 fixed with keepdim: {tuple(fixed.shape)}")

# A sneakier failure: no error, wrong answer.
col = torch.rand(6000, 1)
row = torch.rand(6000)
silent = col - row                          # [6000,1] - [6000] -> [6000, 6000] !
report(f"Ex3 silent trap: [6000,1] - [6000] gives {tuple(silent.shape)}, "
       f"{silent.numel() * 4 / 1e6:.0f} MB, no error raised")
