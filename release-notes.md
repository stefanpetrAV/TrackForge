# TrackForge v0.2.0

This release adds **ReaperConnect**, a new tab that reads regions straight from a running REAPER project, on the same computer or another one on the network, and compares them with the tracks in Designer. No CSV export is needed anymore to keep track TCs aligned with the REAPER session.

## Highlights

- New **ReaperConnect** tab next to **Import file**
- Connects to REAPER's built-in web interface (host, port, optional username and password)
- **Test connection** and **Read regions** buttons with clear error messages for timeout, wrong port, wrong credentials and firewall issues
- Converts region starts to timecode with a selectable frame rate (23.976 to 60, including 29.97 drop-frame) and a project start TC
- Compares every region with the Designer tracks and highlights:
  - **TC to update**: the track exists but its TC differs or is missing
  - **Missing in Designer**: the region has no track yet
  - **To repair**: the track lacks its second section
  - **Conflict**: two regions give the same track name
  - **In sync** and **Designer only** (shown for information, never changed)
- Track names can be edited per row to match a different track or resolve a conflict
- Changes are applied with the same create/update/repair logic as file import
- REAPER connection status shown in the top bar

## Setup

1. In REAPER, open **Preferences › Control/OSC/web**, add a **Web browser interface** and note its port (8080 by default).
2. On the REAPER computer, allow incoming connections on that port in the firewall.
3. In TrackForge, open **ReaperConnect**, enter the REAPER computer's IP and port, the frame rate and the project start TC, then choose **Test connection** and **Read regions**.

## Notes

- TrackForge reads REAPER directly from the plugin page when possible, otherwise through Designer. The status line shows which path was used.
- The REAPER password is not saved.
- The release ZIP now uses standard forward-slash paths, so it extracts correctly with any ZIP tool.
- As always, test on a copy of the project before applying a large set of changes.

---

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
