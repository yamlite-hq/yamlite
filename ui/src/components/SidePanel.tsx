import { ArrowLeft, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { usePanelWidth } from "@/lib/panelWidth";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";
import { useViewportHeight } from "@/lib/viewportHeight";
import { m } from "@/paraglide/messages.js";
import { PanelResizeHandle } from "./PanelResizeHandle";

// an overlay lies over the table, so opening a record does not reflow the page under it;
// a docked panel sits beside the page for work alongside it. A phone gives either the whole screen
const placement = {
  overlay: "absolute inset-y-0 right-0 z-20 shadow-xl",
  docked: "relative",
};

export function SidePanel({
  layout,
  widthKey,
  defaultWidth,
  resizeLabel,
  className,
  children,
  ...props
}: ComponentProps<"aside"> & {
  layout: keyof typeof placement;
  widthKey: string;
  defaultWidth: number;
  resizeLabel: string;
}) {
  const mobile = useIsMobile();
  const [width, setWidth] = usePanelWidth(widthKey, defaultWidth);
  const viewportHeight = useViewportHeight(mobile);
  const size = mobile ? (viewportHeight ? { height: viewportHeight } : undefined) : { width };
  return (
    <aside
      {...props}
      className={cn(
        "flex min-h-0 flex-col border-l bg-background",
        placement[layout],
        "max-md:fixed max-md:inset-0 max-md:z-40 max-md:h-dvh max-md:border-l-0 max-md:shadow-none max-md:animate-[y-slide-up_160ms_ease-out]",
        className,
      )}
      style={size}
    >
      {!mobile && <PanelResizeHandle width={width} label={resizeLabel} onResize={setWidth} />}
      {children}
    </aside>
  );
}

// a full-screen panel on a phone reads as a page of its own, so it goes back rather than closes
export function SidePanelHeader({
  onClose,
  className,
  children,
}: {
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  return (
    <header
      className={cn(
        "flex items-center gap-2 border-b px-3.5 py-2.5 max-md:gap-1 max-md:px-2 max-md:pt-[calc(0.625rem+env(safe-area-inset-top))]",
        className,
      )}
    >
      {mobile && (
        <Button variant="ghost" size="icon-lg" aria-label={m.common_close()} onClick={onClose}>
          <ArrowLeft className="size-5" />
        </Button>
      )}
      {children}
      {!mobile && (
        <Button variant="ghost" size="icon" aria-label={m.common_close()} onClick={onClose}>
          <X className="size-5" />
        </Button>
      )}
    </header>
  );
}

export function SidePanelFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "flex items-center gap-2 border-t px-3.5 py-2.5 max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))]",
        className,
      )}
    />
  );
}
