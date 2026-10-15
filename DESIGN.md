---
name: PawsLink
description: A warm, pet-first adoption and registry experience for Butuan City
colors:
  deep-green: "#18251d"
  hover-green: "color-mix(in srgb, #18251d 87%, #b7ff72)"
  lime: "#b7ff72"
  warm-cream: "#fbf7e9"
  soft-wash: "#edf3dc"
  paper: "#fffdf5"
  sage: "#dceac9"
  hairline: "#cbd5bd"
  muted-ink: "color-mix(in srgb, #18251d 70%, #ffffff)"
  hero-ink: "#fff9e9"
  hero-muted: "#d6e7d2"
  white: "#ffffff"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(3.7rem, 5.5vw, 5.5rem)"
    fontWeight: 900
    lineHeight: 0.98
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(2.35rem, 4vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.55rem"
    fontWeight: 800
    lineHeight: 1.18
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Source Sans 3, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.44
  label:
    fontFamily: "Source Sans 3, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.43
rounded:
  control: "10px"
  small-panel: "12px"
  card: "16px"
  hero: "22px"
  shell: "24px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  section: "72px"
components:
  button-primary:
    backgroundColor: "{colors.deep-green}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
    height: "44px"
  button-hero:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.deep-green}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
    height: "44px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.deep-green}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
    height: "44px"
  nav-active:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.deep-green}"
    rounded: "9px"
    padding: "9px 14px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.deep-green}"
    rounded: "{rounded.card}"
    padding: "20px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.deep-green}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "46px"
  chip-source:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.deep-green}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
---

# Design System: PawsLink

## Overview

**Creative North Star: "The Caring Bridge"**

PawsLink makes the path from pet registration to approved adoption feel welcoming and clear. Warm cream surrounds deep green navigation and feature panels. Lime marks the next useful action. Real pet photographs supply warmth and individuality, especially in the large right-side home and learning heroes and the adoption cards.

The public experience has generous spacing, oversized Fraunces headlines, and playful rounded cards. Owner, veterinarian, and CAVD screens use the same colors and type with tighter rows, forms, filters, and tables so work remains easy to scan. The default is light; the existing theme control offers a dark variant. CAVD and capstone identification remain visible without making the visual world look like a paper form.

**Key Characteristics:**

- A cream ground with a contiguous deep green header, navigation, prototype strip, and home hero.
- Lime action and active-navigation highlights paired with deep green text.
- Prominent real animal photography, serif display type, and softly rounded cards.
- Coordinated, denser task layouts for owner, veterinary, and office workflows.

## Colors

The two fixed brand colors are deep green and lime; warm neutrals and quiet sage surfaces support them.

### Primary

- **Shelter Green** (deep-green): header and hero fields, body ink, primary buttons, and the light theme's active text.
- **Action Lime** (lime): prominent calls to action, the active navigation tile, the brand mark, focus outlines, and the hero photo frame.

### Neutral

- **Warm Cream** (warm-cream): default page ground.
- **Quiet Paper** (paper): cards, forms, and table surfaces.
- **Pale Wash** (soft-wash) and **Soft Sage** (sage): alternating work rows, filters, supporting panels, and varied public cards.
- **Hairline Sage** (hairline): field and dense-data separators.
- **Muted Green Ink** (muted-ink): secondary text and supporting metadata.
- **Hero Ivory** (hero-ink), **Hero Mist** (hero-muted), and **White** (white): text on green and other high-contrast light details.

**The Two-Color Anchor Rule.** Keep Shelter Green (#18251d) and Action Lime (#b7ff72) exact. Supporting colors may distinguish surfaces and feedback states, but must not replace either anchor.

## Typography

**Display Font:** Fraunces (Georgia fallback), loaded in index.html at weights 600–900.

**Body Font:** Source Sans 3 (Arial fallback), loaded at weights 400–700.
**Data Font:** System monospace for IDs, dates, QR URLs, and compact counts only.

Fraunces gives welcome messages, section titles, pet names, and the wordmark a friendly, editorial voice. Source Sans 3 keeps instructions, controls, and dense records legible.

### Hierarchy

- **Display** (900, clamp(3.7rem, 5.5vw, 5.5rem), 0.98): the desktop home hero; it scales down on smaller screens.
- **Headline** (800, clamp(2.35rem, 4vw, 4.25rem), 1.08): page and feature headings; office and vet titles use a tighter upper bound.
- **Title** (800, 1.55rem, 1.18): pet names and prominent card titles.
- **Body** (400, 18px/26px): descriptions and form content, generally held to 75ch or less.
- **Label** (600, 14px/20px): navigation and compact interface metadata; field labels use 16px/22px.

**The Two-Voice Rule.** Use Fraunces for expressive headings and Source Sans 3 for task content. Reserve monospace for values that benefit from fixed-width scanning.

## Layout

The content shell tops out at 1240px plus its side padding; common forms top out at 720px. The public home joins the header to a two-column green hero with copy on the left and a framed pet photograph on the right. The composition stacks at 900px and the photo shifts to a 4:3 frame at 600px. The learning hero uses the same copy-and-photo relationship.

Public sections have open vertical rhythm (roughly 60–78px between large groups), while cards commonly use 20–30px inside. Pet listings use a three-column desktop grid, two columns on smaller screens, and 4:3 image crops. Owner adoption paths move from multiple columns to one column on phones. The office and vet layouts keep compact tables and result rows; on narrow screens, wide tables scroll horizontally with a visible swipe cue, and navigation with more than three destinations becomes a disclosure menu.

**The Density Follows Task Rule.** Give discovery and learning generous space; keep review queues, forms, and records compact enough to scan without losing the shared palette or type.

## Elevation & Depth

The system uses tonal layers first and soft, offset shadows on selected interactive or featured cards. Ordinary staff panels have a fine border and paper fill. Listing cards and quick links gain a modest lift on hover; the hero's lime photo frame creates emphasis without a card shadow.

### Shadow Vocabulary

- **Pet card at rest** (0 9px 22px rgba(24, 37, 29, .08)): separates the image-led listing from cream.
- **Pet card hover** (0 16px 28px rgba(24, 37, 29, .14)): accompanies a small upward move.
- **Quick link at rest** (0 8px 20px rgba(24, 37, 29, .07)): light lift on public actions.

**The Quiet Work Surface Rule.** Use paper and borders for staff content. Save lifted shadows for cards that invite exploration or selection.

## Shapes

Controls have gently curved corners (10px), staff containers and most cards have soft corners (12–16px), and feature heroes have larger curves (22–24px). Small status and source chips may be pills (999px). The home header and hero read as one green panel with rounded outer corners and a scalloped lower edge. Photographs crop cleanly inside rounded frames; their image content stays unobscured.

## Components

### Buttons

- **Primary:** deep green with white text, 10px corners, at least 44px tall, and 11px × 16px padding. Hover darkens and lifts slightly.
- **Hero:** lime with deep green text on green feature panels; secondary hero actions are transparent with a light outline.
- **Outline and small actions:** retain the same control family for repeated table and form actions. Disabled buttons visibly mute.
- **Focus:** a 3px lime outline is visible on keyboard focus.

### Navigation

The brand mark, wordmark, account actions, service label, navigation, and prototype attribution share the green header assembly. Service links use Source Sans 3 at 14px; hover adds a translucent lime wash and the active destination fills lime with deep green text (9px radius). The office navigation uses tighter wrapping gaps (12px vertically, 16px horizontally). On phones, the multi-link menu is an explicit disclosure with 44px targets. The existing theme toggle sits with account actions.

### Cards and Photography

Pet cards use a 4:3 cover photograph above name, concise metadata, and a record action; their paper surface has 16px corners and soft lift. Missing photos use the existing “No photo” text fallback. Public quick links and lessons vary between paper, sage, and pale wash, while staff cards favor paper with a hairline border. The public and learning heroes frame real pet photography in lime on the right at desktop widths.

### Inputs and Feedback

Labels sit above inputs. Fields have a paper fill, sage border, 10px corners, 46px minimum height, and a visible lime focus outline. Filters group labelled fields in a sage panel. Statuses include text, with small colored markers or pills as support; success, warning, and error notices keep distinct feedback surfaces. Office tables use pale sage headings and alternating wash rows.

## Do's and Don'ts

### Do:

- **Do** keep all existing routes, forms, validation, permissions, review actions, and Supabase behavior while extending this visual system.
- **Do** use real project pet photography and the text fallback when an image is unavailable.
- **Do** keep the skip link, semantic navigation and tables, labelled fields, visible keyboard focus, textual status, and reduced-motion treatment.
- **Do** retain CAVD and capstone identification and the existing public-record privacy boundary.

### Don't:

- **Don't** revive the old white-paper municipal styling, square listing cards, IBM Plex/Source Serif pairing, or tiny forest-green accents as the default look.
- **Don't** treat a match as an approval or expose owner contact details on public records.
- **Don't** replace the exact green and lime anchors, cover pet photographs with chips or copy, or fabricate a photo when one is missing.
