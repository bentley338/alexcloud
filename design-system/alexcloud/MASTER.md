# AlexCloud Product Design System

This file is the UI source of truth for customer-facing AlexCloud pages. Page-specific notes may refine layout, but may not redefine the brand tokens or accessibility rules below.

## Brand direction

- Character: premium, focused, trustworthy technology product.
- Primary visual: black surfaces with restrained orange actions.
- Avoid: neon/cyberpunk treatments, fake telemetry, heavy glassmorphism, decorative gradients, exaggerated claims, or multiple competing accent colors.
- Copy: concise Indonesian, factual, direct, and consistent with live product behavior.

## Core tokens

| Role | Value |
|---|---|
| Page background | `#080808` |
| Primary surface | `#111111` |
| Secondary surface | `#161616` |
| Elevated surface | `#1B1B1B` |
| Primary orange | `#FF7A00` |
| Orange hover | `#FF8A1F` |
| Primary text | `#F5F5F5` |
| Secondary text | `#A6A6A6` |
| Muted text | `#707070` |
| Border | `rgba(255,255,255,.09)` |
| Success | `#34D399` |
| Warning | `#FBBF24` |
| Error | `#FB7185` |
| Information | `#60A5FA` |

## Typography

- Use self-hosted **Inter** for headings, body, controls, and numeric data.
- Headings use 700–800 weight with tight, restrained tracking.
- Body copy uses 400–500 weight and at least 1.55 line-height.
- Avoid all-caps except for small eyebrow labels and status chips.

## Layout and spacing

- Maximum content width: `1240px`.
- Desktop side gutters: `20px`; tablet/mobile: `16px`; compact mobile: `12px`.
- Spacing scale: `4, 8, 12, 16, 24, 32, 48, 64, 96`.
- Radius: `10px` controls, `14px` cards, `20px` feature containers.
- Public header height: `68px` desktop, `64px` mobile.
- Touch targets: at least `44px × 44px`.

## Components

- Primary button: solid orange, near-black text, no glow.
- Secondary button: dark surface, subtle white border, white text.
- Cards: one dark surface, 1px neutral border, no ambient glow. Hover may lift at most 3px.
- Inputs: `46px` minimum height, dark fill, visible border and focus ring.
- Status colors are semantic; orange is reserved for brand actions and selection.
- Modals use a dark surface, clear heading, close button, backdrop, Escape support, and focusable controls.
- Tables require clear headers, horizontal containment on mobile, and text labels in addition to color.

## Responsive behavior

- Design mobile-first for 360–430px widths and verify at 768px, 1024px, and 1440px.
- Navigation on mobile exposes Search and Menu as separate 44px controls.
- Game imagery must remain visible on mobile and use a stable aspect ratio to prevent layout shift.
- Multi-column cards collapse without forcing horizontal page scroll. Filter chips may scroll horizontally.
- Primary action remains easy to reach without hiding essential content behind sticky elements.

## Product integrity

- Game counts come from the database through `gameCount`/`totalGamesCount`.
- Do not publish hardware, latency, resolution, support-hour, user-count, or uptime claims unless supported by a maintained data source.
- Cookie categories must control actual behavior. Necessary cookies stay active; attribution and location refresh require analytics consent.
- Legal, support, and cookie settings must be reachable from the footer.

## Accessibility and performance checklist

- Visible keyboard focus on every interactive element.
- WCAG AA text contrast; never use color alone to communicate state.
- Meaningful image alt text and labels for icon-only buttons.
- `prefers-reduced-motion` disables nonessential motion.
- Lazy-load below-the-fold imagery and reserve image dimensions/aspect ratios.
- No horizontal overflow at 360px and no content hidden under the fixed header.
