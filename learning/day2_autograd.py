import matplotlib.pyplot as plt
import torch
from torchvision.models import resnet18, ResNet18_Weights

from lap_data import report, results

torch.manual_seed(0)

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
