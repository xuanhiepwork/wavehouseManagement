"""Small, dependency-free ridge regression for *supervised* AI2 forecasting.

Fitting happens only if a caller explicitly invokes fit_ridge; importing this
module cannot train a model. Regression uses floating point internally (normal
for ML), while API quantities remain Decimal strings through Pydantic.
"""

from dataclasses import dataclass
from math import expm1, isfinite, log1p, sqrt


@dataclass(frozen=True)
class RidgeParameters:
    center: tuple[float, ...]
    scale: tuple[float, ...]
    intercept: float
    weights: tuple[float, ...]

    def predict(self, features: tuple[float, ...]) -> float:
        if len(features) != len(self.weights):
            raise ValueError("Model feature dimension mismatch")
        value = self.intercept
        for index, number in enumerate(features):
            if not isfinite(number):
                raise ValueError("Nonfinite inference feature")
            value += self.weights[index] * ((number - self.center[index]) / self.scale[index])
        if not isfinite(value) or value > 600:
            raise ValueError("Model prediction outside numerical limits")
        # Ridge models log1p(demand), so inverse-transform and clamp to >= 0.
        result = 0.0 if value <= 0 else expm1(value)
        if not isfinite(result):
            raise ValueError("Model produced nonfinite prediction")
        return result


def _solve(matrix: list[list[float]], rhs: list[float]) -> tuple[float, ...]:
    """Partial-pivot Gaussian elimination for a tiny regularized system."""
    n = len(rhs)
    a = [row[:] + [rhs[index]] for index, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda i: abs(a[i][col]))
        if abs(a[pivot][col]) < 1e-11:
            raise ValueError("Ridge normal equations could not be solved")
        a[col], a[pivot] = a[pivot], a[col]
        factor = a[col][col]
        for j in range(col, n + 1):
            a[col][j] /= factor
        for row in range(n):
            if row == col:
                continue
            factor = a[row][col]
            if factor != 0:
                for j in range(col, n + 1):
                    a[row][j] -= factor * a[col][j]
    result = tuple(a[i][n] for i in range(n))
    if any(not isfinite(value) for value in result):
        raise ValueError("Ridge coefficients are not finite")
    return result


def fit_ridge(
    x: tuple[tuple[float, ...], ...],
    demand: tuple[float, ...],
    alpha: float,
) -> RidgeParameters:
    """Fit L2-regularized least squares on log1p targets, no external ML library."""
    if not x or len(x) != len(demand) or not isfinite(alpha) or alpha <= 0:
        raise ValueError("Training requires examples and positive finite regularization")
    width = len(x[0])
    if width == 0 or any(len(row) != width for row in x):
        raise ValueError("Inconsistent ML feature widths")
    if any(not isfinite(value) for row in x for value in row):
        raise ValueError("Nonfinite feature in training data")
    if any(not isfinite(value) or value < 0 for value in demand):
        raise ValueError("Labels must be finite nonnegative quantities")

    count = len(x)
    center = tuple(sum(row[j] for row in x) / count for j in range(width))
    spread = tuple(sqrt(sum((row[j] - center[j]) ** 2 for row in x) / count)
                   for j in range(width))
    scale = tuple(number if number > 1e-9 else 1.0 for number in spread)
    design = [tuple([1.0] + [(row[j] - center[j]) / scale[j]
                              for j in range(width)]) for row in x]
    targets = [log1p(number) for number in demand]
    p = width + 1
    gram = [[0.0] * p for _ in range(p)]
    vector = [0.0] * p
    for row, target in zip(design, targets):
        for i in range(p):
            vector[i] += row[i] * target
            for j in range(p):
                gram[i][j] += row[i] * row[j]
    # Keep the intercept unpenalized.
    for j in range(1, p):
        gram[j][j] += alpha
    coefficients = _solve(gram, vector)
    return RidgeParameters(center, scale, coefficients[0], coefficients[1:])
