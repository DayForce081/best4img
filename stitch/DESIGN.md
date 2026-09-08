# Design System Specification: The Kinetic Minimalist

## 1. Overview & Creative North Star
The "Creative North Star" for this system is **The Precision Atelier**. 

While many utility tools feel like cluttered workshops, this system treats digital batch processing as a high-end editorial experience. We are moving away from the "browser tool" aesthetic and toward a "digital appliance" feel. The goal is to make the heavy lifting of batch-compressing 20+ images feel effortless, light, and hyper-organized.

We achieve this through **Intentional Asymmetry** and **Tonal Depth**. By avoiding rigid, centered grids in favor of purposeful whitespace and staggered layouts, we guide the user’s eye through the compression pipeline with the authority of a premium magazine layout.

## 2. Colors & Surface Architecture
We move beyond flat hex codes to a tiered system of "Environmental Shifting."

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to define sections. Layout boundaries must be established via background shifts.
- A `surface-container-low` section sitting on a `surface` background creates a sophisticated, borderless break.
- Use `surface-container-highest` for high-interaction zones (like a drag-and-drop area) to provide a "recessed" physical feel.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—stacked sheets of fine paper.
- **Base Layer:** `surface` (#f7f9fb)
- **Secondary Structural Layer:** `surface-container-low` (#f2f4f6)
- **Interactive Component Layer:** `surface-container-lowest` (#ffffff)
- **Nesting Logic:** Place a `surface-container-lowest` card (the image preview) inside a `surface-container-low` tray (the batch list) to create natural lift without using a single line of CSS border.

### The "Glass & Gradient" Rule
To escape the "generic utility" look, use **Backdrop Blurs** for floating navigation or sticky action bars. 
- Use `surface` at 80% opacity with a `blur(12px)` to allow the vibrant `primary` colors of the image thumbnails to bleed through.
- **Signature Gradient:** For the "Compress All" CTA, use a linear gradient from `primary` (#3525cd) to `primary_container` (#4f46e5) at a 135-degree angle. This adds "soul" and depth that flat hex codes lack.

## 3. Typography
We utilize **Inter** with an editorial eye. Contrast is our primary tool for hierarchy.

*   **Display (display-md/lg):** Use for the main "Drop files" prompt. High-impact, low-letter-spacing, semi-bold. It should feel like a headline in a design journal.
*   **Headline (headline-sm):** Use for category titles (e.g., "Compression Settings").
*   **Body (body-md):** The workhorse. Use for file names and metadata.
*   **Label (label-md):** Used for "Success" badges or "Original Size" vs "Optimized Size" comparisons.

**The Editorial Shift:** Balance large `display-sm` text with significantly smaller `label-sm` metadata. This extreme scale variance makes the tool feel designed, not just "built."

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering**, not structural shadows.

*   **The Layering Principle:** Stacking tiers is mandatory. A `surface-container-lowest` card on a `surface-container-low` background creates a "soft lift."
*   **Ambient Shadows:** For floating modals or tooltips, use `on-surface` at 4% opacity with a `40px` blur and `12px` Y-offset. It should feel like a cloud casting a shadow, not a piece of plastic.
*   **The "Ghost Border" Fallback:** If a container is visually lost (e.g., a white card on a white background), use `outline-variant` at **15% opacity**. High-contrast, 100% opaque borders are strictly forbidden.
*   **Glassmorphism:** Apply to the "Processing" overlay. Use `surface_bright` with 60% opacity and a heavy blur to maintain the user's context of their files while focusing on the progress.

## 5. Components

### Buttons
*   **Primary:** High-intent. Uses the "Signature Gradient." Border radius: `md` (0.75rem / 12px).
*   **Secondary:** `surface-container-highest` background with `on-surface` text. No border.
*   **Tertiary:** Ghost style. `on-surface` text. Only a `surface-variant` background on hover.

### Batch Image Cards (Specific to Utility Box)
*   **Structure:** No dividers. Use `spacing-4` (1.4rem) of vertical white space to separate items.
*   **States:** On hover, a card should shift from `surface-container-lowest` to `surface-bright` with a 4% ambient shadow.
*   **Progress Indicators:** Use a thin, 2px line of `primary` at the very bottom of the card, or a subtle `primary_container` glow behind the thumbnail.

### Input Fields & Controls
*   **Text Inputs:** Use `surface-container-high` as the fill. No border. On focus, a 2px "Ghost Border" of `primary` at 40% opacity appears.
*   **Checkboxes/Radios:** Softened edges. Use `primary` for selected states with `on_primary` (white) icons.

### Tooltips
*   Dark-mode aesthetic: `inverse_surface` background with `inverse_on_surface` text to provide a sharp, authoritative contrast to the light UI.

## 6. Do's and Don'ts

### Do:
*   **Embrace Asymmetry:** Let the "Batch Settings" panel be wider than the "File List" if the data requires it.
*   **Use Generous Padding:** Use `spacing-8` (2.75rem) for main container padding to let the tool "breathe."
*   **Prioritize Motion:** Use a "Spring" easing for cards entering the list (batch processing feel).

### Don't:
*   **Don't use Divider Lines:** Never use `<hr>` or `border-bottom` to separate list items. Use the spacing scale.
*   **Don't use Pure Black:** Always use `on-surface` (#191c1e) for text; pure #000000 kills the editorial "softness."
*   **Don't Over-Radius:** Stick strictly to `md` (12px) for cards. Excessive rounding (like `xl`) makes the tool look like a toy; no rounding (none) makes it look like legacy software.