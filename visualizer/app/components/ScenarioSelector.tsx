"use client";

import { motion } from "framer-motion";

import type { ScenarioId, ScenarioOption } from "./types";

type ScenarioSelectorProps = {
  scenarios: ScenarioOption[];
  activeScenarioId: ScenarioId;
  onScenarioChange: (scenarioId: ScenarioId) => void;
  isLoading: boolean;
};

export default function ScenarioSelector({
  scenarios,
  activeScenarioId,
  onScenarioChange,
  isLoading,
}: ScenarioSelectorProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="pointer-events-auto w-full rounded-2xl border border-white/8 bg-[#1c2128]"
    >
      <div className="border-b border-white/8 px-4 py-3">
        <p className="text-sm font-medium text-[#f4f4f5]">Scenarios</p>
        <p className="mt-1 text-xs leading-5 text-[#c1c1c9]">
          Preset mission layouts for replay.
        </p>
      </div>

      <div className="grid gap-2 px-4 py-3">
        {scenarios.map((scenario) => {
          const isActive = scenario.id === activeScenarioId;

          return (
            <button
              key={scenario.id}
              type="button"
              onClick={() => onScenarioChange(scenario.id)}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${
                isActive
                  ? "border-white/16 bg-[#2b3340]"
                  : "border-white/8 bg-[#232933] hover:border-white/12"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: scenario.accent }}
                  />
                  <span className="truncate text-sm text-[#f4f4f5]">
                    {scenario.name}
                  </span>
                </div>
                {isActive && (
                  <span className="text-[11px] text-[#c1c1c9]">
                    {isLoading ? "Loading" : "Active"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-5 text-[#c1c1c9]">
                {scenario.blurb}
              </p>
            </button>
          );
        })}
      </div>
    </motion.section>
  );
}
