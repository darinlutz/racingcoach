import matplotlib.pyplot as plt
import torch
from torchvision.models import resnet18, ResNet18_Weights


torch.manual_seed(0)

results = []  # every printed line, shown again as a label in the figure at the end


def report(msg):
    print(msg)
    results.append(msg)

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
mask = (d >= 0.12) & (d <= 0.18) & (laps[:, :, BRAKE] > 0.05)    # [20, 6000]
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



model = resnet18(weights=ResNet18_Weights.DEFAULT)
data = torch.rand(1, 3, 64, 64)
labels = torch.rand(1, 1000)
prediction = model(data) # forward pass

loss = (prediction - labels).sum()
loss.backward() # backward pass

optim = torch.optim.SGD(model.parameters(), lr=1e-2, momentum=0.9)

optim.step() #gradient descent


# autograd lilNicca
w = torch.tensor(2.0, requires_grad=True)
b = torch.tensor(0.5, requires_grad=True)
x, y_true = torch.tensor(3.0), torch.tensor(10.0)

y = w * x + b                  # 6.5
loss = (y - y_true) ** 2       # 12.25
loss.backward()
report(f"Autograd: w.grad = {w.grad.item():g}, b.grad = {b.grad.item():g}  (expect -21, -7)")
print(loss.grad_fn, loss.grad_fn.next_functions)  # walk the graph


# ---------------------------------------------------------------------------
# Show the results as a label, and the autograd graph under it
# ---------------------------------------------------------------------------
def graph_levels(root):
    """Walk grad_fn -> next_functions and give each node its depth from the loss."""
    depth, edges, todo = {root: 0}, [], [root]
    while todo:
        node = todo.pop(0)
        for child, _ in node.next_functions:
            if child is None:          # a constant input (x, y_true) has no node
                continue
            edges.append((node, child))
            if child not in depth or depth[child] < depth[node] + 1:
                depth[child] = depth[node] + 1
                todo.append(child)
    return depth, edges


def node_label(node):
    name = type(node).__name__
    if name == "AccumulateGrad":       # a leaf tensor: say which one
        leaf = node.variable
        who = "w" if leaf is w else "b" if leaf is b else "leaf"
        return f"AccumulateGrad\n{who} = {leaf.item():g}, grad = {leaf.grad.item():g}"
    return name


depth, edges = graph_levels(loss.grad_fn)
rows = {}
for node, level in depth.items():
    rows.setdefault(level, []).append(node)
pos = {}
for level, nodes in rows.items():
    for i, node in enumerate(nodes):
        pos[node] = ((i + 1) / (len(nodes) + 1), -level)

fig = plt.figure(figsize=(15, 9))
fig.text(0.03, 0.97, "\n".join(results), va="top", ha="left", fontsize=9, family="monospace", wrap=True)

# Right: loss as a function of w (b, x, y_true held fixed), with the tangent at w = 2.
# The tangent's slope is exactly w.grad, which is what backward() computed.
with torch.no_grad():
    ws = torch.linspace(-1, 6, 200)
    losses = (ws * x + b - y_true) ** 2
    slope = w.grad.item()
    w0, l0 = w.item(), loss.item()
    tangent = l0 + slope * (ws - w0)

plot = fig.add_axes([0.57, 0.07, 0.4, 0.55])
plot.plot(ws, losses, label="loss(w) = (3w + 0.5 - 10)**2", color="#1f77b4", linewidth=2)
plot.plot(ws, tangent, "--", color="#d62728", label=f"tangent at w = {w0:g}, slope = w.grad = {slope:g}")
plot.scatter([w0], [l0], color="#d62728", zorder=3)
plot.annotate(f"  w = {w0:g}, loss = {l0:g}", (w0, l0), va="bottom")
w_min = (y_true - b).item() / x.item()     # where loss = 0
plot.axvline(w_min, color="gray", linewidth=0.8, linestyle=":")
plot.annotate(f" minimum at w = {w_min:.3g}", (w_min, 0), va="bottom", color="gray")
plot.set_ylim(-5, losses.max().item() * 1.05)
plot.set_xlabel("w")
plot.set_ylabel("loss")
plot.set_title("Loss vs w: the gradient is the slope of the tangent")
plot.grid(True, alpha=0.3)
plot.legend(loc="upper center")

ax = fig.add_axes([0.02, 0.03, 0.5, 0.62])
ax.set_title(f"Autograd graph of loss = (w*x + b - y_true)**2 = {loss.item():g}")
for parent, child in edges:
    (x0, y0), (x1, y1) = pos[parent], pos[child]
    ax.annotate("", xy=(x1, y1 + 0.18), xytext=(x0, y0 - 0.18),
                arrowprops=dict(arrowstyle="->", color="gray"))
for node, (px, py) in pos.items():
    leaf = type(node).__name__ == "AccumulateGrad"
    ax.text(px, py, node_label(node), ha="center", va="center", fontsize=10,
            bbox=dict(boxstyle="round,pad=0.5", fc="#d8f0d8" if leaf else "#dce8f8", ec="gray"))
ax.set_xlim(0, 1)
ax.set_ylim(-max(depth.values()) - 0.5, 0.5)
ax.axis("off")
plt.show()



# Wednesday — linear regression and optimizers
# Synthetic first: brake point (m before the corner) rises with entry speed.

torch.manual_seed(0)
speed = torch.rand(200, 1) * 150 + 100            # 100–250 km/h
brake_m = 0.9 * speed - 40 + torch.randn(200, 1) * 5
x = (speed - speed.mean()) / speed.std()
y = brake_m

# 1) from scratch
w = torch.zeros(1, requires_grad=True)
b = torch.zeros(1, requires_grad=True)
for step in range(500):
    loss = ((x * w + b - y) ** 2).mean()
    loss.backward()
    with torch.no_grad():
        w -= 0.1 * w.grad
        b -= 0.1 * b.grad
        w.grad.zero_(); b.grad.zero_()

# 2) the idiomatic way
model = torch.nn.Linear(1, 1)
opt = torch.optim.SGD(model.parameters(), lr=0.1)   # then try Adam
for step in range(500):
    opt.zero_grad()
    loss = torch.nn.functional.mse_loss(model(x), y)
    loss.backward()
    opt.step()
    
    
    
# Check: convert w back to real units (w / speed.std() should be ≈ 0.9) and compare with torch.linalg.lstsq. 
# Plot loss per step for SGD vs Adam at a few learning rates.



