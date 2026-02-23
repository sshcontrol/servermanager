/** Inline page spinner — use instead of "Loading..." text */
export default function Spinner() {
  return (
    <div className="inline-spinner" aria-label="Loading">
      <img src="/logo_sm1.png" alt="" className="logo-spinner" />
    </div>
  );
}
