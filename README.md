# Bolblar Agent — Landing Page

Static marketing site for **Bolblar Agent**, the video generation automation tool.

No build step: open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Structure

- `index.html` — page markup (hero, how it works, features, use cases, pricing, FAQ, CTA)
- `assets/styles.css` — styles (dark theme, responsive, reduced-motion aware)
- `assets/main.js` — mobile menu, animated agent demo, tabs, billing toggle, scroll reveals
- `assets/favicon.svg` — logo mark

## Before launch

- Hook the early-access form in `assets/main.js` up to a real backend or form service.
- Replace placeholder pricing, plan limits, integrations and the `sales@bolblar.com` address.
- Point the Privacy / Terms footer links at real pages.
