# PawsLink visual system

PawsLink is the City Agriculture and Veterinary Department's adoption registry in Butuan City. Its presentation is white paper and forest ink: a municipal form on the web, with animal photographs carrying the emotion. Restyling preserves the existing routes, access rules, data, and workflows.

## Tokens

The source of truth is `src/tokens.css`. Use these variables for every component; do not introduce additional brand colours.

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#ffffff` | Page and surface backgrounds |
| `--canvas-wash` | `#f3f8f6` | Office table stripes and pending items |
| `--ink` | `#0b0c0c` | Text and input borders |
| `--ink-muted` | `#484949` | Secondary text |
| `--line` | `#cecece` | Hairlines |
| `--brand` | `#083d29` | Masthead and primary actions |
| `--brand-hover` | `#0b5c3e` | Primary action hover |
| `--brand-mid` | `#0f7a52` | Links, active navigation, approved status |
| `--brand-soft` | `#cfe4dc` | Source chips and timeline borders |
| `--focus` | `#ffdd00` | Keyboard focus outline |
| `--danger` | `#ca3535` | Rejected status and errors |
| `--warn` | `#a34b00` | Pending status |
| `--on-brand` | `#ffffff` | Text on dark green |

White is the default page background. Keep green to approximately 10–15% of the screen. Small white text uses the dark brand background. Status always includes a text label. Pending items use amber text on the wash; approved uses green; rejected uses red.

## Typography

- Body and interface: IBM Plex Sans, weights 400, 500, 600. Body is 18px / 26px.
- Page titles and animal names: Source Serif 4, weight 600. Page titles are 36px / 40px with -0.02em tracking; listing names are 22px / 28px.
- Sections: IBM Plex Sans 600, 24px / 30px.
- Metadata and office tables: IBM Plex Sans 400, 14px / 20px.
- IDs, QR slugs, dates, and timestamps: IBM Plex Mono 400, 13–14px / 20px.
- Buttons: IBM Plex Sans 500, 16px / 20px.

Load the three named families. Do not substitute a generic startup font stack. Keep prose within 66 characters per line where practical.

## Shared chrome

Use a full-width, approximately 52px dark green masthead. The white identity reads “City of Butuan · CAVD”, then a hairline, then “PawsLink” in the serif face. A white service navigation row follows, with a 1px bottom border and a 3px green underline for the active route. No pill navigation.

Every page displays “Capstone pilot — Barangay Ampayon / CAVD Tiniwisan”. Keep this strip white, consistent with the restriction on wash backgrounds. Use a maximum 1120px shell and a maximum 720px form measure, with 24px desktop / 16px mobile gutters. The footer has a hairline, muted 14px text, CAVD identification, and “This is an official city system.”

## Components and route density

- Buttons: 2px radius, no shadow; primary dark green with white text, secondary white with an ink border, reject actions white with a red border. At most one filled primary action per view. Repeated table actions and listing links are secondary or text links.
- Inputs: labels above, 2px ink border, 2px radius. All keyboard controls receive a 3px yellow outline; focused inputs also receive a brand border.
- Listing cards: 3:4 photograph with cover cropping, square edges, 1px hairline, no shadow. Name below photo, one metadata line, “CAVD shelter” or “Owner listing” source chip, and “View record”. Hover changes only the border. Never place chips or text over photographs.
- Public / QR records: two-thirds photo and definition-list facts, one-third “How to apply” and QR. Never expose owner contact details. Preserve the existing public data boundary.
- `/app`: comfortable rows for My pets, with photograph, name, registry status, and approved QR. Pending text is “Waiting for CAVD”. Listing requests are secondary actions on the existing record.
- `/vet`: search first, compact result rows, 48px thumbnails. Record pages have an existing visit timeline with a left border and monospaced dates, followed by the add-visit form at the bottom.
- `/office`: compact tables with white headings, a 2px brand heading rule, approximately 44px rows, alternating wash, and status text with small square markers. Filters are labelled forms. Review actions preserve their existing behavior.
- Empty listing state: “No approved listings yet. CAVD publishes pets after review.”
- Missing photographs: quiet text fallback, never an emoji or fabricated animal photograph.

The logged-out home contains CAVD identification, one sentence explaining the service, “Browse approved pets”, “Log in”, and the existing approved listing board. No feature-card marketing row or testimonials.

## Motion and accessibility

Only 120ms colour and border transitions. Disable transitions under `prefers-reduced-motion`. No scroll or entrance animations, gradients, glows, decorative textures, shadows, scaling cards, mascots, or dark theme. Include a visible-on-focus skip link, semantic navigation and tables, explicit form labels, and textual status labels. Use only the specified colour tokens in UI styling.

## Verification

Build and lint the app. Check public, user, vet, and office views at desktop and mobile sizes, keyboard focus, font loading, overflow, portrait photos, primary-action count, and unchanged role workflows. Browser fixtures used for review must remain outside production code.
