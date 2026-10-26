# TrackForge v0.1.0

TrackForge is a local Disguise Designer plugin built to import track lists from CSV and Excel files, preview the changes, and create or update timecode (TC) tags directly in the project.

This first release focuses on a fast, practical workflow for live-show rundowns and Reaper-exported region/marker lists. It supports common naming variations, auto-detects track-name and timecode columns, and lets users review every proposed change before applying it.

## Highlights

- Imports CSV and XLSX files
- Detects common English and Italian column names automatically
- Supports manual column mapping when needed
- Validates and normalizes TC values such as HH:MM:SS and HH:MM:SS:FF
- Creates new tracks with a blank first section and places the TC tag in the second section
- Updates existing tracks without recreating them when the imported TC differs
- Supports track-only mode when no timecode column is present
- Shows a selectable preview report with per-row confirm/unconfirm actions
- Handles Reaper-style region and marker exports comfortably

## Included features

- Track creation from imported rows
- TC tag creation and update on existing tracks
- Name cleanup for extra characters such as ref mix, suffixes, and common technical tags
- Select all / select individual row actions in the preview table
- Ready-to-install plugin bundle for Designer

## Typical workflow

1. Import a CSV or XLSX file
2. Review the detected track name and TC columns
3. Check the preview list and select only the rows to apply
4. Run the import and confirm the result in Designer

## Best for

- Reaper region and marker CSV exports
- Show rundowns and set lists
- Quick track-and-timecode alignment in Designer

## Notes

- This is the initial release and is intended for practical use in Designer workflows.
- It is recommended to test the import on a copy of the project before applying major changes.
