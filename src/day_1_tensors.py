import torch

# one lap: 6000 samples (60 Hz x 100 s), channels = Speed, Brake, Throttle, Steering, LapDistPct

lap = torch.rand(6000, 5)
mean = lap.mean(dim=0)  # shape [5]
std = lap.std(dim=0)  # shape [5]
norm = (lap - mean) / std  # shape [6000, 5] op [5] -> broadcasts per channel

laps = torch.rand(20, 6000, 5) # a sting of 20 laps
norm_all = (laps - laps.mean(dim=(0,1)))/ laps.std(dim=(0,1))

#slice one track area the way TrackConfig does
dist = lap[:, 4]
in_area = (dist >= 0.12) & (dist <= 0.18)
max_brake = lap[in_area,1].max()

print("lilNicca")

