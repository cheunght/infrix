"""Read-only, sequentially executable U-space plans for uniform device batches."""

from dataclasses import dataclass

from .physical_location import rack_position_ranges
from .reporting.capacity import rack_effective_used_u


@dataclass(frozen=True)
class _PlannedAllocation:
    asset_id: int
    start_u: int
    end_u: int

    @property
    def units(self):
        return self.end_u - self.start_u + 1


def plan_rack_capacity(allocations, total_u, height_u, quantity):
    """Pack beside occupied edges so each suggested single-asset write is legal.

    A bounded free span must retain its last U when placing 1U devices:
    that final space becomes a prohibited gap before it can be filled.
    At the bottom edge, pack downwards from the existing device instead.
    """
    rows = list(allocations)
    before = rack_position_ranges(rows, total_u)
    maximum, placements = 0, []
    for span in before["available_ranges"]:
        length = span["end_u"] - span["start_u"] + 1
        bounded = span["start_u"] > 1 and span["end_u"] < total_u
        capacity = max(0, length - 1) if height_u == 1 and bounded else length // height_u
        maximum += capacity
        count = min(capacity, quantity - len(placements))
        for offset in range(count):
            if span["start_u"] == 1 and span["end_u"] < total_u:
                end_u = span["end_u"] - offset * height_u
                start_u = end_u - height_u + 1
            else:
                start_u = span["start_u"] + offset * height_u
                end_u = start_u + height_u - 1
            placements.append({"start_u": start_u, "end_u": end_u})

    after_rows = rows + [_PlannedAllocation(-index, **placement) for index, placement in enumerate(placements, 1)]
    after = rack_position_ranges(after_rows, total_u)
    used_before = rack_effective_used_u(rows, total_u)
    used_after = rack_effective_used_u(after_rows, total_u)
    return {
        "capacity": maximum,
        "planned_quantity": len(placements),
        "placements": placements,
        "total_u": total_u,
        "used_u_before": used_before,
        "free_u_before": max(0, total_u - used_before),
        "used_u_after": used_after,
        "free_u_after": max(0, total_u - used_after),
        "utilization_after": round(used_after / total_u * 100, 1) if total_u else 0,
        "available_ranges_after": after["available_ranges"],
        "gap_ranges_after": after["gap_ranges"],
    }
