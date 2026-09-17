// Demo/showcase for the shadcn LiquidButton component (src/components/ui/liquid-glass-button.tsx).
// Not wired into the app's actual navigation — this is here so the component can be viewed and
// verified in isolation. See the ".shadcn-scope" note in shadcn.css for why that wrapper class
// is added here (it wasn't in the originally supplied demo.tsx): the button's Tailwind classes
// (bg-primary, text-primary-foreground, etc.) need shadcn's theme variables in scope somewhere,
// and they're deliberately NOT defined at :root to avoid colliding with this app's own
// --accent/--border/--muted variables (see src/styles.css) used by every other page.
import "../shadcn.css";
import { LiquidButton } from "@/components/ui/liquid-glass-button";

export default function LiquidGlassButtonDemo() {
  return (
    <div className="shadcn-scope">
      <div className="relative h-[200px] w-[800px]">
        <LiquidButton className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          Liquid Glass
        </LiquidButton>
      </div>
    </div>
  );
}
