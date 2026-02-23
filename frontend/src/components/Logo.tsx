/** Main logo: PNG on landing/login, GIF (animated) in dashboard sidebar. */

type LogoProps = {
  className?: string;
  /** Compact size for sidebar */
  compact?: boolean;
  /** Use animated GIF (e.g. in dashboard sidebar); otherwise PNG */
  animated?: boolean;
};

export default function Logo({ className = "", compact = false, animated = false }: LogoProps) {
  const src = animated ? "/logo_co.gif" : "/logo_co1.png";
  return (
    <div className={`logo ${compact ? "logo--compact" : ""} ${className}`.trim()} aria-hidden>
      <img src={src} alt="" />
    </div>
  );
}
