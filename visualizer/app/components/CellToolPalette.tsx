"use client";

import {
  AlertTriangle,
  CarFront,
  Eraser,
  Flag,
  Map,
  Package,
  PencilRuler,
  Route,
  Slash,
  Square,
} from "lucide-react";
import type { CellTool } from "./types";

type CellToolPaletteProps = {
  selectedTool: CellTool;
  onToolChange: (tool: CellTool) => void;
};

const TOOLS: Array<{
  id: CellTool;
  label: string;
  accent: string;
  icon: typeof Map;
}> = [
  { id: "road", label: "Road", accent: "#71717a", icon: Route },
  { id: "obstacle", label: "Obstacle", accent: "#52525b", icon: Square },
  { id: "rough", label: "Rough", accent: "#f59e0b", icon: PencilRuler },
  { id: "danger", label: "Danger", accent: "#ef4444", icon: AlertTriangle },
  { id: "start", label: "Start", accent: "#93c5fd", icon: Map },
  { id: "pickup", label: "Pickup", accent: "#93c5fd", icon: Package },
  { id: "delivery", label: "Delivery", accent: "#86efac", icon: Flag },
  { id: "dynamic_path", label: "Dynamic Path", accent: "#ef4444", icon: CarFront },
  { id: "clear_dynamic_path", label: "Trim Path", accent: "#f59e0b", icon: Slash },
  { id: "clear", label: "Clear", accent: "#a1a1aa", icon: Eraser },
];

export default function CellToolPalette({
  selectedTool,
  onToolChange,
}: CellToolPaletteProps) {
  return (
    <div>
      <p className="text-xs font-medium text-[#a1a1aa]">Tools</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {TOOLS.map((tool) => {
          const isActive = tool.id === selectedTool;
          const Icon = tool.icon;

          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onToolChange(tool.id)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition ${
                isActive
                  ? "border-white/16 bg-[#15191f] text-[#f4f4f5]"
                  : "border-white/8 bg-[#15191f] text-[#a1a1aa]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tool.accent }} />
              <span>{tool.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
