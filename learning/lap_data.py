"""Synthetic lap telemetry and helpers shared by the day scripts."""

import torch

SPEED, BRAKE, THROTTLE, STEER, DIST = range(5)  # channel indicies
SAMPLES = 6000  # one lap: 6000 samples, channels above

results = []  # every printed line, shown again as a label in a figure


def report(msg):
    print(msg)
    results.append(msg)


def make_lap():
    """One lap of random data, [6000, 5], with a real LapDistPct and braking zone."""
    lap = torch.rand(SAMPLES, 5)

    # Real LapDistPct climbs 0 -> 1 across the lap, pure randome vlaues make "first" meaningless
    # overwrie that channel with a monotonic ramp
    lap[:, DIST] = torch.linspace(0, 1, SAMPLES)

    # Random bbrake is > 0.05 almost everywhere, so fake a real braking zone:
    # off the brake, then a ramp starting near 0.145 into the corner
    lap[:, BRAKE] = ((lap[:, DIST] - 0.145) * 20).clamp(0, 1) * (lap[:, DIST] < 0.17)
    return lap


def make_laps(count=20):
    """A string of laps, [count, 6000, 5], each braking at a slightly different point."""
    laps = torch.rand(count, SAMPLES, 5)
    laps[:, :, DIST] = torch.linspace(0, 1, SAMPLES)

    # give each lap a slightly different brake point (0.140-0.150) so the bonus shows variation
    bp = 0.140 + 0.010 * torch.rand(count, 1)
    laps[:, :, BRAKE] = ((laps[:, :, DIST] - bp) * 20).clamp(0, 1) * (laps[:, :, DIST] < 0.17)
    return laps


def area_mask(dist, start=0.12, end=0.18):
    """Slice one track area the way TrackConfig does."""
    return (dist >= start) & (dist <= end)
