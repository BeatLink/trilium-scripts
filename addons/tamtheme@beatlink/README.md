# TAMTheme

A Trilium theme built on the TriliumNext "next" theme base, carrying the exact visual language of
the [Trilium Addon Manager](../trilium-addon-manager@beatlink)'s own embedded UI into the whole app:
white/slate surfaces, slate-900 headings, a single blue-600 accent, thin slate-200 borders, and a
dark navy chrome (launcher rail + tab bar) echoing TAM's own gradient header. Ships with a matching
dark mode built from the same palette family (slate + blue), following the system color scheme.

Beyond colors, it also sets TAM's own font stack (`--main-font-family`), a larger note-pane corner
radius (`--center-pane-border-radius: 14px` vs. stock's 10px), and real card shadows
(`--card-box-shadow`) — color alone reads as a close cousin of Trilium's default light theme (which
is also white/gray with a blue accent), so shape/typography carry most of the actual distinction.
Every `--` variable declaration carries `!important`: Trilium's own `theme-next-light.css`/
`theme-next-dark.css` declare several of the same variables (e.g. `--main-background-color`,
`--left-pane-background-color`) under an equal-specificity plain `:root` selector, so without
`!important` a load-order change could silently make TAMTheme lose that variable back to stock.

Text inputs/selects/textareas also get a small block of real selector-based CSS (not just
variables): the "next" base theme renders them with `border: unset` at rest — no CSS variable
governs that, it's a literal `unset` — so form controls otherwise show no visible border until
focused. TAMTheme restores a persistent border (accent-colored on focus/hover), matching TAM's own
widget inputs.

A note's custom `#color` label isn't rendered as-is in the tree: Trilium converts it to Lab color
space and clamps its lightness (`--tree-item-light-theme-max-color-lightness`, 60 by default on the
"next" base theme) so it stays legible against the tree background. That default cap is aggressive
enough that bright colors like `gold` or `lime` render as dark olive/forest-green. TAMTheme raises
the light-mode cap (and lowers the dark-mode floor a little) so note colors read much closer to
their real hue.

Buttons match TAM's own "normal" button (see `tam.css`'s `.btn-ghost`, used for every non-CTA
action): transparent background, a border and text in the accent color, and hover is just a subtle
opacity fade — never a background/text color swap. That also sidesteps a real bug: `forms.css` gives
a button's icon glyph its own explicit color that's never redeclared on `:hover`, so a
background-swap hover (the "next" theme's default) made the icon the same color as the new
background and it visually vanished. The border and compact padding need real selectors, not just
variables — `forms.css` sets a literal `border: unset` and a 120px min-width on every button.

Dropdowns (`<select>` and the combo-box-style dropdown-toggle button) get the same ghost treatment —
transparent background, accent text, opacity-only hover — rather than the filled-surface look they'd
otherwise share with plain text inputs via `--input-background-color`/`--input-text-color` (forms.css
uses the same two variables for both, so ghost-ing them directly would also ghost every text input).
The open dropdown's own option list stays a normal readable panel
(`--select-dropdown-text-color`) — only the closed control reads as a button.

Add to a CSS note and set the following attributes: `#appThemeBase=next` `#appTheme=TAMTheme`
