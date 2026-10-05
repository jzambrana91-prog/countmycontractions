export const siteName = "Count My Contractions";
export const siteUrl = "https://countmycontractions.com";
export const contactEmail = "hello@countmycontractions.com";

export const guides = [
  {
    href: "/printable-contraction-log",
    label: "Printable contraction log",
    short: "Printable log",
  },
  {
    href: "/how-to-time-contractions",
    label: "How to time contractions",
    short: "How to time",
  },
  { href: "/5-1-1-rule", label: "The 5-1-1 rule", short: "5-1-1 rule" },
  {
    href: "/braxton-hicks-vs-real-contractions",
    label: "Braxton Hicks vs labor",
    short: "Braxton Hicks",
  },
  {
    href: "/when-to-go-to-the-hospital",
    label: "When to go to the hospital",
    short: "When to go",
  },
  { href: "/partner-guide", label: "Partner and doula guide", short: "Partner guide" },
];

export const trust = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/medical-disclaimer", label: "Medical disclaimer" },
  { href: "/contact", label: "Contact" },
];

export const navLinks = [{ href: "/", label: "Contraction timer" }, ...guides, ...trust];

export function faqJsonLd(faqs) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };
}

export function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: new URL(item.path, siteUrl).href,
    })),
  };
}
