---
title: Flutter screen
tags: [flutter, dart, mobile, app, screen, widget, تطبيق, شاشة, هاتف]
stacks: [flutter]
---
1. One screen per file in lib/screens (or the folder the project already uses); shared widgets in lib/widgets.
2. Keep state where the project already keeps it (Provider, Riverpod, Bloc); do not introduce a second state library.
3. Text from localisation files when the project has them; support RTL with Directionality and EdgeInsetsDirectional.
4. Layout that adapts with LayoutBuilder/MediaQuery; test small phones.
5. Widget tests in test/ for what the user sees and taps.
Checks: flutter test, flutter analyze.
