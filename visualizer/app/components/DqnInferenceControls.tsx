"use client";

import { Play, RefreshCw, Sparkles } from "lucide-react";

type DqnInferenceControlsProps = {
  isRunning: boolean;
  canRun: boolean;
  onRun: () => void;
  onLoadSample: () => void;
  onReset: () => void;
};

export default function DqnInferenceControls({
  isRunning,
  canRun,
  onRun,
  onLoadSample,
  onReset,
}: DqnInferenceControlsProps) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-medium text-[#a1a1aa]">
        <Sparkles className="h-3.5 w-3.5 text-[#93c5fd]" />
        Planner-Guided DQN
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun || isRunning}
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
            canRun && !isRunning
              ? "border-[#86efac]/30 bg-[#1a231d] text-[#f4f4f5]"
              : "cursor-not-allowed border-white/6 bg-[#15191f] text-[#71717a]"
          }`}
        >
          <Play className="h-3.5 w-3.5" />
          {isRunning ? "Running..." : "Run"}
        </button>
        <button
          type="button"
          onClick={onLoadSample}
          className="rounded-xl border border-white/8 bg-[#15191f] px-3 py-2 text-xs text-[#a1a1aa] transition hover:text-[#f4f4f5]"
        >
          Sample
        </button>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#15191f] px-3 py-2 text-xs text-[#a1a1aa] transition hover:text-[#f4f4f5]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>
    </div>
  );
}
