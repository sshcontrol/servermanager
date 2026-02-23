/** Small logo (logo_sm1.png) used as loading spinner with flip animation. */

export default function LogoSpinner() {
  return (
    <div className="logo-spinner-wrap" aria-hidden>
      <img src="/logo_sm1.png" alt="" className="logo-spinner" />
    </div>
  );
}
