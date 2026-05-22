"use client";

import type { CellTool, CustomMapConfig, GridPosition } from "./types";

type CustomMapEditorProps = {
  mapConfig: CustomMapConfig;
  selectedTool: CellTool;
  activeDynamicObstacleId: string | null;
  onCellSelect: (cell: GridPosition) => void;
};

function sameCell(a: GridPosition | null, b: GridPosition) {
  return Boolean(a && a[0] === b[0] && a[1] === b[1]);
}

function cellHasPenalty(mapConfig: CustomMapConfig, cell: GridPosition) {
  return mapConfig.penalty_zones.find(
    (zone) => zone.cell[0] === cell[0] && zone.cell[1] === cell[1],
  );
}

export default function CustomMapEditor({
  mapConfig,
  selectedTool,
  activeDynamicObstacleId,
  onCellSelect,
}: CustomMapEditorProps) {
  const cells = Array.from({ length: mapConfig.rows * mapConfig.cols }, (_, index) => [
    Math.floor(index / mapConfig.cols),
    index % mapConfig.cols,
  ]) as GridPosition[];

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-[#a1a1aa]">Map canvas</p>
        <p className="text-xs text-[#71717a]">
          Active tool: {selectedTool.replace("_", " ")}
        </p>
      </div>

      <div className="mt-2 overflow-x-auto rounded-xl border border-white/8 bg-[#15191f] p-2.5">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${mapConfig.cols}, minmax(1.45rem, 1fr))`,
            minWidth: `${mapConfig.cols * 1.7}rem`,
          }}
        >
          {cells.map((cell) => {
            const [row, col] = cell;
            const cellKey = `${row}-${col}`;
            const isObstacle = mapConfig.obstacles.some(
              (obstacle) => obstacle[0] === row && obstacle[1] === col,
            );
            const isStart = sameCell(mapConfig.start, cell);
            const isPickup = mapConfig.pickups.some((pickupCell) => sameCell(pickupCell, cell));
            const isDelivery = mapConfig.deliveries.some((deliveryCell) => sameCell(deliveryCell, cell));
            const penaltyZone = cellHasPenalty(mapConfig, cell);
            const activeDynamicIndex = mapConfig.dynamic_obstacles
              .find((obstacle) => obstacle.id === activeDynamicObstacleId)
              ?.path.findIndex((pathCell) => sameCell(pathCell, cell)) ?? -1;
            const hasOtherDynamicPath = mapConfig.dynamic_obstacles.some(
              (obstacle) => (
                obstacle.id !== activeDynamicObstacleId
                && obstacle.path.some((pathCell) => sameCell(pathCell, cell))
              ),
            );
            const isDynamicCell = activeDynamicIndex >= 0 || hasOtherDynamicPath;
            const cellStyle = isStart
              ? "bg-[#93c5fd] text-[#0b0d0f]"
              : isPickup
                ? "bg-[#93c5fd] text-[#0b0d0f]"
                : isDelivery
                  ? "bg-[#86efac] text-[#0b0d0f]"
                  : isObstacle
                    ? "bg-[#232831] text-[#f4f4f5]"
                    : penaltyZone?.severity === "danger"
                      ? "bg-[#452122] text-[#f4f4f5]"
                      : penaltyZone
                        ? "bg-[#3a2a18] text-[#f4f4f5]"
                        : "bg-[#161a20] text-[#71717a]";
            const dynamicBorder = activeDynamicIndex >= 0
              ? "border-[#ef4444]"
              : hasOtherDynamicPath
                ? "border-[#f59e0b]"
                : "border-white/8";
            const marker = isStart
              ? "S"
              : isPickup
                ? "P"
                : isDelivery
                  ? "D"
                  : isObstacle
                    ? "X"
                    : penaltyZone?.severity === "danger"
                      ? "!"
                      : penaltyZone
                        ? "~"
                        : activeDynamicIndex >= 0
                          ? String(activeDynamicIndex + 1)
                          : hasOtherDynamicPath
                            ? "*"
                            : "";

            return (
              <button
                key={cellKey}
                type="button"
                onClick={() => onCellSelect(cell)}
                className={`relative flex aspect-square items-center justify-center rounded-md border text-[0.58rem] font-medium transition ${cellStyle} ${dynamicBorder}`}
                title={`Row ${row}, Col ${col}`}
              >
                <span>{marker}</span>
                {isDynamicCell && (
                  <span
                    className={`pointer-events-none absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full ${
                      activeDynamicIndex >= 0 ? "bg-[#ef4444]" : "bg-[#f59e0b]"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
