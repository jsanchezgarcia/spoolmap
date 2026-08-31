# Contributing

Compatibility reports and small, focused pull requests are welcome. Before opening a change:

1. Search existing issues and describe the user-visible problem.
2. Remove private model metadata from sample files. Prefer a small synthetic or freely redistributable fixture. The bundled Heihei sample is an unmodified CC BY-ND MakerWorld project, so its creator metadata stays.
3. Add a behavior-level regression test for parser, matching, export, or recovery changes.
4. Run `npm run check`, `npm run test:coverage`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`.

Export must remain download-first and behave the same locally and in production. See the README before proposing direct opening or hosted uploads; both are intentionally outside the current deployment. Do not use a private 3MF fixture for export testing.

Keep Spoolmap focused on matching project colors to owned spools. Slicing, printer control, cloud accounts, inventory management, and automatic AMS routing are intentionally outside the product boundary.

Bug reports should include the Bambu Studio or OrcaSlicer version that created the file, the browser and operating system, expected behavior, and the exact error shown by Spoolmap. Never attach a private project or inventory export unless you are comfortable publishing it.
