"use client";

import type { CellTool, MapSourceMode } from "./types";

const TOOL_OPTIONS: Array<{ id: CellTool; label: string }> = [
  { id: "road", label: "Road" },
  { id: "obstacle", label: "Obstacle" },
  { id: "rough", label: "Rough" },
  { id: "danger", label: "Danger" },
  { id: "start", label: "Start" },
  { id: "pickup", label: "Pickup" },
  { id: "delivery", label: "Delivery" },
  { id: "dynamic_path", label: "Dynamic path" },
  { id: "clear_dynamic_path", label: "Trim path" },
  { id: "clear", label: "Clear" },
];

type SceneToolbarProps = {
  sourceMode: MapSourceMode;
  isEditMode: boolean;
  selectedTool: CellTool;
  onSelectedToolChange: (tool: CellTool) => void;
  onToggleEditMode: () => void;
  onRunInference: () => void;
  onLoadSampleMap: () => void;
  onResetMap: () => void;
  canRunInference: boolean;
  isRunningInference: boolean;
};

export default function SceneToolbar({
  sourceMode,
  isEditMode,
  selectedTool,
  onSelectedToolChange,
  onToggleEditMode,
  onRunInference,
  onLoadSampleMap,
  onResetMap,
  canRunInference,
  isRunningInference,
}: SceneToolbarProps) {
  if (sourceMode !== "custom") {
    return (
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 text-[11px] text-[#8d8d97]">
        F full view · I info · E editor
      </div>
    );
  }

  return (
    <>
      <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-[#171b21]/96 px-3 py-2">
        <button
          type="button"
          onClick={onToggleEditMode}
          className={`rounded-xl border px-3 py-2 text-[11px] transition ${
            isEditMode
              ? "border-white/16 bg-[#2a313b] text-[#f4f4f5]"
              : "border-white/8 bg-[#15191f] text-[#a1a1aa]"
          }`}
        >
          {isEditMode ? "Edit Mode" : "View Mode"}
        </button>

        <label className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#15191f] px-3 py-2 text-[11px] text-[#a1a1aa]">
          <span>Tool</span>
          <select
            value={selectedTool}
            onChange={(event) => onSelectedToolChange(event.target.value as CellTool)}
            className="min-w-[128px] bg-transparent text-[#f4f4f5] outline-none"
          >
            {TOOL_OPTIONS.map((tool) => (
              <option key={tool.id} value={tool.id} className="bg-[#15191f] text-[#f4f4f5]">
                {tool.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={onRunInference}
          disabled={!canRunInference || isRunningInference}
          className={`rounded-xl border px-3 py-2 text-[11px] transition ${
            canRunInference && !isRunningInference
              ? "border-white/16 bg-[#1d2721] text-[#f4f4f5]"
              : "cursor-not-allowed border-white/6 bg-[#15191f] text-[#71717a]"
          }`}
        >
          {isRunningInference ? "Running..." : "Run Planner-Guided DQN"}
        </button>

        <button
          type="button"
          onClick={onLoadSampleMap}
          className="rounded-xl border border-white/8 bg-[#15191f] px-3 py-2 text-[11px] text-[#c1c1c9]"
        >
          Load Sample
        </button>

        <button
          type="button"
          onClick={onResetMap}
          className="rounded-xl border border-white/8 bg-[#15191f] px-3 py-2 text-[11px] text-[#c1c1c9]"
        >
          Reset
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 z-20 text-[11px] text-[#8d8d97]">
        F full view · I info · E editor · Esc exit
      </div>
    </>
  );
}
