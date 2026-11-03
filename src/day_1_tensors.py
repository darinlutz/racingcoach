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

laps = torch.rand(20,6000,5) # a sting of 20 laps
laps[:, :, DIST] = torch.linspace(0, 1, 6000)

# give each lap a slightly different brake point
bp = 0.140 + 0.010 * torch.rand(20,1)






