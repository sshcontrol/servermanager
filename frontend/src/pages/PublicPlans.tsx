import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import LogoSpinner from "../components/LogoSpinner";
import "./Landing.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

type Plan = {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  duration_label: string;
  max_users: number;
  max_servers: number;
  is_free: boolean;
};

export default function PublicPlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/plans`)
      .then(r => r.json())
      .then(d => { setPlans(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="land">
      <nav className="land-nav">
        <div className="land-nav-inner">
          <Link to="/" className="land-nav-brand"><Logo /></Link>
          <div className="land-nav-links">
            <Link to="/">Home</Link>
            <Link to="/plans" style={{ color: "var(--primary)" }}>Plans</Link>
          </div>
          <div className="land-nav-actions">
            <Link to="/login" className="land-nav-signin">Sign In</Link>
            <Link to="/signup" className="land-nav-signup">Sign Up</Link>
          </div>
        </div>
      </nav>

      <section className="land-section" style={{ paddingTop: "8rem" }}>
        <div className="land-container">
          <h2 className="land-section-title">Choose Your Plan</h2>
          <p className="land-section-sub">Flexible pricing for teams of every size. Start free, upgrade anytime.</p>

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "3rem 0" }}><LogoSpinner /></div>
          ) : plans.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "3rem 0" }}>No plans available at the moment.</p>
          ) : (
            <div className="land-plans-grid">
              {plans.map(p => (
                <div key={p.id} className={`land-plan-card${p.is_free ? " land-plan-featured" : ""}`}>
                  {p.is_free && <div className="land-plan-badge">Free</div>}
                  <h3>{p.name}</h3>
                  <div className="land-plan-price">
                    {p.is_free ? <span className="land-plan-amount">$0</span> : <><span className="land-plan-amount">${p.price}</span><span className="land-plan-period">/ {p.duration_label}</span></>}
                  </div>
                  {p.description && <p className="land-plan-desc">{p.description}</p>}
                  <ul className="land-plan-features">
                    <li>Up to <strong>{p.max_users}</strong> users</li>
                    <li>Up to <strong>{p.max_servers}</strong> servers</li>
                    <li>SSH Key Management</li>
                    <li>Two-Factor Authentication</li>
                    <li>Audit Logs & Monitoring</li>
                    <li>Multi-Cloud Support</li>
                    <li>IP Whitelisting</li>
                    {!p.is_free && <li>Priority Support</li>}
                  </ul>
                  <Link to="/signup" className={`land-plan-btn${p.is_free ? " land-plan-btn-primary" : ""}`}>
                    {p.is_free ? "Get Started Free" : "Choose Plan"}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <footer className="land-footer">
        <div className="land-footer-bottom">
          <div className="land-container">
            <span>&copy; {new Date().getFullYear()} SSHCONTROL. All rights reserved.</span>
            <span>Powered by <a href="https://devotel.com/" target="_blank" rel="noopener noreferrer">Devotel</a></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
