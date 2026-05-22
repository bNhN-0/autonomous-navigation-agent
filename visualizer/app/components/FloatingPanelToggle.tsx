"use client";

type FloatingPanelToggleProps = {
  showLeftPanel: boolean;
  showRightPanel: boolean;
  sceneFocusMode: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onToggleSceneFocus: () => void;
};

export default function FloatingPanelToggle({
  showLeftPanel,
  showRightPanel,
  sceneFocusMode,
  onToggleLeftPanel,
  onToggleRightPanel,
  onToggleSceneFocus,
}: FloatingPanelToggleProps) {
  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-20 flex flex-wrap gap-2">
      <ToggleButton onClick={onToggleLeftPanel}>
        {showLeftPanel && !sceneFocusMode ? "Hide Info" : "Show Info"}
      </ToggleButton>
      <ToggleButton onClick={onToggleRightPanel}>
        {showRightPanel && !sceneFocusMode ? "Hide Editor" : "Show Editor"}
      </ToggleButton>
      <ToggleButton onClick={onToggleSceneFocus}>
        {sceneFocusMode ? "Exit Full View" : "Full View"}
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-white/8 bg-[#171b21]/95 px-3 py-2 text-[11px] text-[#d4d4da] backdrop-blur-none transition hover:text-[#f4f4f5]"
    >
      {children}
    </button>
  );
}
