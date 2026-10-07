---
title: Arabic and right-to-left interfaces
tags: [arabic, rtl, عربي, عربية, اتجاه, bilingual, i18n, translation, ترجمة]
stacks: [any]
---
1. Set <html lang="ar" dir="rtl"> (or switch both together for bilingual sites).
2. Use logical CSS: margin-inline-start, padding-inline-end, inset-inline, text-align: start. Avoid left/right.
3. Icons that point (arrows, chevrons) must be mirrored in RTL; logos and media controls must not.
4. Mixed Arabic/English text: wrap English fragments, codes and numbers in elements with dir="auto" or <bdi>.
5. Fonts: a system stack that includes Arabic (Segoe UI, Noto Sans Arabic, Tahoma); never letter-spacing on Arabic.
6. Dates and numbers: Intl.DateTimeFormat / NumberFormat with the user's locale.
Visual check: browser.test on desktop and mobile; look for overlapping text and wrong alignment.
