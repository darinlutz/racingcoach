# Friday — gradient checks
# Gradient checks prove your gradients are right by comparing autograd against finite differences. Always use float64.
import torch
from torch.autograd import gradcheck

from day4_mlp import make_mlp


# a RacingCoach-style custom loss: braking too late costs twice as much as too early
def late_brake_loss(pred, target, late_weight=2.0):
    err = pred - target                     # pred < target = braking later
    return torch.where(err < 0, late_weight * err**2, err**2).mean()


p = torch.randn(8, dtype=torch.double, requires_grad=True)
t = torch.randn(8, dtype=torch.double)
print(gradcheck(lambda q: late_brake_loss(q, t), (p,)))


# your own checker, used on the MLP's first-layer weights
def numeric_grad(f, param, eps=1e-6):
    grad = torch.zeros_like(param)
    flat = param.data.view(-1)
    for i in range(flat.numel()):
        orig = flat[i].item()
        flat[i] = orig + eps; plus = f().item()
        flat[i] = orig - eps; minus = f().item()
        flat[i] = orig
        grad.view(-1)[i] = (plus - minus) / (2 * eps)
    return grad


#Convert Thursday's model with model.double(), compute autograd grads, compare with numeric_grad,
# and report the relative error ‖a − n‖ / (‖a‖ + ‖n‖). Then plant a bug (e.g., drop a factor
# of 2 in a manual gradient) and confirm the check catches it.
model = make_mlp().double()
