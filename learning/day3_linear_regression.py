# Wednesday — linear regression and optimizers
# Synthetic first: brake point (m before the corner) rises with entry speed.
import torch

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
