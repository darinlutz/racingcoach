# Saturday — deterministic training
import os, random, numpy as np, torch

os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"   # set before any CUDA work

def set_seed(seed=42):
    random.seed(seed); np.random.seed(seed)
    torch.manual_seed(seed); torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False


# Also seed the DataLoader (generator=torch.Generator().manual_seed(seed)), keep num_workers=0 for now, and log torch, CUDA and Python versions with each run. Prove it: train Thursday's model twice in fresh processes, save each state_dict, and assert torch.equal on every tensor. Then change one thing (seed, batch order) and watch it diverge.

