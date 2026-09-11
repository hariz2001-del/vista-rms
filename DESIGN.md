# Vista RMS visual system

## Thesis

Vista should feel like a well-kept counter ledger: warm paper, dark counter-green navigation,
thin ruled dividers, restrained Food and Drinks markers, and amounts aligned like receipt totals.
It is an operating tool for Malaysian food-service owners, not an interchangeable SaaS dashboard.

## Interface rules

- Structure follows the owner's questions: what needs a decision, what the month did, where the
  cash moved, and what each partner is owed.
- Warm paper and ink are the 60/30 foundation. Food orange and Drinks teal retain their existing
  semantic roles; they are never decorative gradients.
- Editorial serif type marks page and section hierarchy. Interface copy stays in a practical
  sans serif; money, dates, labels, IDs, and ratios use tabular mono figures.
- Panels are flat, ruled surfaces with square ends. Elevation is reserved for the fixed mobile
  navigation and chart tooltip.
- Badges describe state in words. Colour never carries state by itself.
- Motion is limited to short colour transitions and respects `prefers-reduced-motion`.
- Controls keep 40–44px targets and visible focus rings. Dense tables remain horizontally
  scrollable rather than collapsing financial columns into ambiguous cards.

## Anti-slop gate

Before shipping a new screen, check that it avoids:

- decorative purple/blue gradients, aurora blobs, glass surfaces, and glow;
- rounded cards nested inside rounded cards;
- equal-weight metric tiles when one number answers the primary question;
- pills for navigation, filters, or actions without a product reason;
- invented evidence, generic hype copy, emoji UI icons, and vague calls to action;
- animation on every card or reveal effects unrelated to a state change;
- desktop-only compositions, clipped long names, or states that rely on colour alone.

The logo should not be swappable with a generic dashboard brand without the interface feeling
wrong. If it can, strengthen the counter-ledger hierarchy, content, or financial typography.
