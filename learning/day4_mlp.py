#Thursday — a small neural network
#Add features and a nonlinear target, predict two outputs at once:
import torch.nn as nn


# inputs: entry speed, min corner speed, fuel load  -> outputs: brake point, max brake %
def make_mlp():
    return nn.Sequential(
        nn.Linear(3, 32), nn.ReLU(),
        nn.Linear(32, 32), nn.ReLU(),
        nn.Linear(32, 2),
    )


# Generate synthetic data where braking distance grows with (entry² − min²), normalize
# inputs and targets, split 80/20 train/val, and log both losses each epoch.
# Compare against Wednesday's linear model and watch for overfitting when you
# shrink the dataset to 50 rows.
if __name__ == "__main__":
    model = make_mlp()
    print(model)
