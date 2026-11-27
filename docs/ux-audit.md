# UX and performance audit, 15 Nov 2026

Tested at 390×844 (iPhone 15/16 class) and 1280×900 against a local Worker build. Lighthouse mobile, simulated throttling.

| Page | Performance | Accessibility | Best practices | LCP | CLS |
|---|---|---|---|---|---|
| /uk/ | 100 | 100 | 100 | 0.6 s | 0 |
| /uk/mounjaro/ | 100 | 100 | 100 | 0.6 s | 0 |
| /uk/providers/ | 100 | 100 | 100 | — | 0 |
| /uk/providers/click-2-pharmacy/ | 100 | 100 | 100 | — | 0 |

Weight: one self-hosted variable font (46 KB, preloaded), CSS inlined (~12 KB), ~1.5 KB of JS. No third-party requests, no cookies apart from the preview gate.

## Old site → new site
| Problem on the old site | Fix |
|---|---|
| Wide 9-column table: unusable on a phone without sideways scrolling | One price per row for the chosen dose; full dose ladder behind "All doses" |
| Stale hand-entered prices mixed in with tracked ones | Only prices confirmed in the last 48 h are shown, each with "Checked X ago" |
| "Updated" banner and countdown implied freshness for every row | Freshness is per row, not per page |
| Trustpilot ratings and GPhC numbers with no check date, several GPhC numbers shared by different companies | Ratings removed; GPhC shown only when the number is unique to that provider, linked to the register |
| Undated "offer" text | Offers come from the provider's page on each run and disappear when they do |
| Affiliate "sponsored" links | Plain links, rel="nofollow noopener" |
| Operator details "coming soon" in privacy policy | No company info anywhere; privacy page states what's collected (nothing beyond server logs) |
| Prices refreshed every 72 h | Daily |

## Checks passed
- Tap targets ≥ 44 px (dose chips 48 px).
- Visible focus ring on every control; skip link to prices.
- Dose picker works without JS for the starting dose; the URL keeps the chosen dose (?dose=5mg) so it can be shared.
- Colour contrast AA on all text, including the yellow price tag (ink #2b2400 on #ffe14d).
- prefers-reduced-motion respected (there is no motion beyond the disclosure arrow).
- No horizontal overflow at 390 px.

## Fixed during the audit
- Tabular figures were applied to all text, putting gaps around full stops and commas. Now limited to rank numbers.
- "Lowest price" note showed on every row after switching dose (CSS display overrode `hidden`). Fixed globally.
- Mobile rows stacked "Visit site" and "All doses" on separate lines. Now side by side.
- Long hostnames overflowed the fact boxes on provider pages.
- Home medicine switcher used aria-pressed on links (Lighthouse a11y 94). Now buttons.

## Still to do
- Price history chart on provider pages (data starts accumulating from the first live run in data/history/).
- Desktop: show the full dose ladder inline in each row (space is there).
- Real-device check on a mid-range Android once it's on the preview URL.
