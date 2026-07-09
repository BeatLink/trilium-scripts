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

Add to a CSS note and set the following attributes: `#appThemeBase=next` `#appTheme=TAMTheme`
