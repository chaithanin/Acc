# Company logos

Drop the four files here with exactly these names:

| File | Company |
|---|---|
| `marina-golden-bay.png` | every company whose name starts บริษัท มาริน่า โกลเด้น เบย์ — Victoria, Elya, Geneva |
| `harmonia.png` | บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9 (Harmonia City Garden) |
| `chaithanin.png` | บริษัท ไชยธนินทร์ |
| `global-top-group.png` | บริษัท โกลบอล ท็อป กรุ๊ป |

PNG with a transparent background is what these are drawn for. SVG also works —
change the extension in `src/config/company-logos.ts` if you use it.

The rules match on the start of the company name, not on an id, because the rule
the business gave is about names: a Marina company added next year takes the
Marina mark with no code change.

A company whose file is missing shows its code instead of a broken image, so
adding these is safe to do one at a time.
