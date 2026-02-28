/**
 * Fetches platform settings (SEO, Analytics, Ads) and injects meta tags + scripts.
 * Used at app root so all pages benefit from SEO and tracking.
 */
import { useEffect, useRef } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

type PublicSettings = {
  google_analytics_id?: string;
  google_ads_id?: string;
  google_ads_conversion_label?: string;
  google_tag_manager_id?: string;
  google_oauth_client_id?: string;
  seo_site_title?: string;
  seo_meta_description?: string | null;
  seo_keywords?: string;
  seo_og_image_url?: string;
};

function setMeta(name: string, content: string, isProperty = false) {
  const attr = isProperty ? "property" : "name";
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function injectScript(id: string, src: string, async = true): HTMLScriptElement | null {
  if (document.getElementById(id)) return null;
  const script = document.createElement("script");
  script.id = id;
  script.src = src;
  script.async = async;
  document.head.appendChild(script);
  return script;
}

function injectInlineScript(id: string, content: string): HTMLScriptElement | null {
  if (document.getElementById(id)) return null;
  const script = document.createElement("script");
  script.id = id;
  script.textContent = content;
  document.head.appendChild(script);
  return script;
}

export default function PlatformSeo() {
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;

    fetch(`${API_BASE}/api/public/platform-settings`)
      .then((r) => r.ok ? r.json() : null)
      .then((s: PublicSettings | null) => {
        if (!s) return;

        // SEO meta tags
        if (s.seo_site_title) {
          document.title = s.seo_site_title;
          setMeta("og:title", s.seo_site_title, true);
        }
        if (s.seo_meta_description) {
          setMeta("description", s.seo_meta_description);
          setMeta("og:description", s.seo_meta_description, true);
        }
        if (s.seo_keywords) {
          setMeta("keywords", s.seo_keywords);
        }
        if (s.seo_og_image_url) {
          setMeta("og:image", s.seo_og_image_url, true);
        }
        setMeta("og:type", "website", true);

        // Google Tag Manager (loads first, can manage GA + Ads)
        if (s.google_tag_manager_id) {
          const gtmId = s.google_tag_manager_id.replace(/^GTM-/, "");
          injectInlineScript("gtm-head", `
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${gtmId}');
          `);
        }

        // Google Analytics 4 & Ads (only if GTM not used - GTM manages both)
        if (!s.google_tag_manager_id && (s.google_analytics_id || s.google_ads_id)) {
          const firstId = s.google_analytics_id || s.google_ads_id;
          injectScript("gtag-js", `https://www.googletagmanager.com/gtag/js?id=${firstId}`);
          const configs: string[] = [];
          if (s.google_analytics_id) {
            configs.push(`gtag('config', '${s.google_analytics_id}');`);
          }
          if (s.google_ads_id) {
            const sendTo = s.google_ads_conversion_label
              ? `'${s.google_ads_id}/${s.google_ads_conversion_label}'`
              : `'${s.google_ads_id}'`;
            configs.push(`gtag('config', '${s.google_ads_id}', { send_to: ${sendTo} });`);
          }
          injectInlineScript("gtag-config", `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            ${configs.join("\n            ")}
          `);
        }
      })
      .catch(() => {});
  }, []);

  return null;
}
