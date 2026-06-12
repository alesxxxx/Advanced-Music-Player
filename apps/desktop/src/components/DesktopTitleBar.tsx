import { Minus, Square, Copy, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  closeDesktopWindow,
  getDesktopWindowState,
  minimizeDesktopWindow,
  toggleDesktopWindowMaximize
} from "@/lib/desktopBridge";
import { getAppEnv } from "@/lib/env";

/**
 * Classic custom title bar for Windows/Linux (macOS draws its own). App name on the left, standard
 * minimize / maximize / close on the right. Solid, flat, conventional — nothing fancy.
 */
export function DesktopTitleBar({
  visible
}: {
  visible: boolean;
}) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let active = true;
    void getDesktopWindowState().then((state) => {
      if (active) {
        setIsMaximized(state.isMaximized);
      }
    });

    return () => {
      active = false;
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <div className="desktop-drag-region flex h-10 items-center justify-between border-b border-[var(--edge)] bg-[var(--panel-strong)] pl-4 pr-1">
      <p className="font-display text-[13px] font-semibold tracking-[-0.01em] text-[var(--paper)]">
        {getAppEnv().productName}
      </p>

      <div className="desktop-no-drag flex items-center">
        <WindowButton label="Minimize" onClick={() => void minimizeDesktopWindow()}>
          <Minus className="h-4 w-4" />
        </WindowButton>
        <WindowButton
          label={isMaximized ? "Restore" : "Maximize"}
          onClick={() =>
            void toggleDesktopWindowMaximize().then((state) => setIsMaximized(state.isMaximized))
          }
        >
          {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </WindowButton>
        <WindowButton label="Close" danger onClick={() => void closeDesktopWindow()}>
          <X className="h-4 w-4" />
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({
  label,
  onClick,
  danger = false,
  children
}: {
  label: string;
  onClick(): void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        danger
          ? "grid h-8 w-11 place-items-center rounded text-[var(--muted)] transition hover:bg-[#c0392b] hover:text-white"
          : "grid h-8 w-11 place-items-center rounded text-[var(--muted)] transition hover:bg-white/10 hover:text-[var(--paper)]"
      }
    >
      {children}
    </button>
  );
}
